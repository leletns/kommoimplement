#!/usr/bin/env node
'use strict';

/**
 * Consultas pagas → leads ganhos no Kommo.
 *
 * Fontes (arquivos com dados de pacientes: ficam fora do git):
 *   --whatsapp ARQ     exportação do grupo "Comprovantes de pagamento" (.txt)
 *   --amigoclinic ARQ  relatório de produtividade do AmigoClinic (.csv ";")
 *
 * Para cada paciente com consulta paga:
 *   1. acha o contato no Kommo pelo TELEFONE (8 últimos dígitos) e, sem telefone, pelo E-MAIL;
 *      por nome só com --incluir-nome (nome igual e único na conta);
 *   2. se algum lead do contato já está ganho: só completa o valor, se estiver vazio;
 *   3. senão, marca o lead mais adequado como GANHO ("Consulta concluída"), com a data real do
 *      pagamento (closed_at), o valor da consulta (se o lead não tiver valor) e a tag consulta_paga.
 *      Leads de outros funis (Arquivo, Reativação) vão para o Comercial 1.
 *   4. lead já ganho com data em outro mês que a do grupo: ajusta a data para a do grupo
 *      (o grupo de comprovantes é a referência de quando a venda aconteceu);
 *   5. com --criar-desde AAAA-MM-DD: paciente que não existe no Kommo vira contato + lead ganho
 *      no Comercial 1 (só vendas a partir dessa data).
 *
 * No fim, lista os leads ganhos no Kommo nos últimos meses que não aparecem em nenhuma fonte.
 *
 * Sempre simula primeiro. Relatório (com dados de pacientes) e backup vão para backups/.
 *
 *   node src/scripts/importarConsultasPagas.js --whatsapp grupo.txt --amigoclinic amigo.csv
 *   node src/scripts/importarConsultasPagas.js --whatsapp grupo.txt --amigoclinic amigo.csv --aplicar
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getKommoClient } = require('../services/kommoClient');
const P = require('../services/pagamentos');

const WON = 142;
const LOST = 143;
const TAG = 'consulta_paga';
const PIPE_C1 = Number(config.kommo.pipelineId) || 13604187;
const COMERCIAIS = new Set(Object.keys(JSON.parse(process.env.KOMMO_METRICS_PIPELINES || '{}')).map(Number).concat([PIPE_C1]));

function parseArgs(argv) {
  const a = { apply: false, byName: false, criarDesde: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--whatsapp') a.whatsapp = argv[++i];
    else if (argv[i] === '--amigoclinic') a.amigo = argv[++i];
    else if (argv[i] === '--aplicar') a.apply = true;
    else if (argv[i] === '--incluir-nome') a.byName = true;
    else if (argv[i] === '--criar-desde') a.criarDesde = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') a.help = true;
    else throw new Error(`Opção desconhecida: ${argv[i]}`);
  }
  return a;
}

const fieldValues = (entity, code) =>
  (entity.custom_fields_values || []).filter((f) => f.field_code === code).flatMap((f) => (f.values || []).map((v) => String(v.value || '')));

/** Meio-dia de Brasília do dia informado (evita cair no dia anterior por fuso). */
const unixDate = (iso) => Math.floor(new Date(`${iso}T12:00:00-03:00`).getTime() / 1000);

async function carregarKommo(kommo) {
  const contacts = await kommo.listAll('/contacts', { embeddedKey: 'contacts', params: { with: 'leads' } });
  const leads = await kommo.listAll('/leads', { embeddedKey: 'leads' });
  const byPhone = new Map();
  const byEmail = new Map();
  const byName = new Map();
  const push = (map, k, c) => {
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    if (!map.get(k).includes(c)) map.get(k).push(c);
  };
  for (const c of contacts) {
    for (const ph of fieldValues(c, 'PHONE')) push(byPhone, P.phoneKey(P.normPhone(ph) || String(ph).replace(/\D/g, '').slice(-11)), c);
    for (const em of fieldValues(c, 'EMAIL')) push(byEmail, em.trim().toLowerCase(), c);
    const n = P.normName(c.name);
    if (n.split(' ').length >= 2) push(byName, n, c);
  }
  // Contatos cujos leads já foram marcados por esta importação: casar pelo nome é seguro
  // (evita duplicar pacientes sem telefone/e-mail numa segunda execução).
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const byNameImported = new Map();
  for (const c of contacts) {
    const importado = (c._embedded?.leads || []).some((x) => (leadMap.get(x.id)?._embedded?.tags || []).some((t) => t.name === TAG));
    if (importado) push(byNameImported, P.normName(c.name), c);
  }
  return { contacts, leads: leadMap, byPhone, byEmail, byName, byNameImported };
}

function acharContatos(p, idx, byName) {
  for (const t of p.telefones) {
    const hit = idx.byPhone.get(P.phoneKey(t));
    if (hit) return { contatos: hit, via: 'telefone' };
  }
  if (p.email && idx.byEmail.get(p.email)) return { contatos: idx.byEmail.get(p.email), via: 'email' };
  if (p.nome && idx.byNameImported.get(P.normName(p.nome))) return { contatos: idx.byNameImported.get(P.normName(p.nome)), via: 'importado' };
  if (p.nome) {
    const hit = idx.byName.get(P.normName(p.nome));
    if (hit && hit.length === 1) return { contatos: hit, via: byName ? 'nome' : 'nome (revisar)' };
  }
  return { contatos: [], via: null };
}

/** Lead a marcar: funil comercial aberto > comercial perdido > outros funis; o mais recente. */
function escolherLead(leads) {
  const score = (l) => (COMERCIAIS.has(l.pipeline_id) ? (l.status_id === LOST ? 2 : 3) : 1) * 1e10 + (l.updated_at || 0);
  return leads.slice().sort((a, b) => score(b) - score(a))[0];
}

const PAGAMENTO_FIELD = config.kommo.pagamentoFieldId;
const temTag = (l) => (l._embedded?.tags || []).some((t) => t.name === TAG);
const temPagamento = (l) => (l.custom_fields_values || []).some((c) => c.field_id === PAGAMENTO_FIELD && c.values?.[0]?.value);
/** Data da venda da consulta: campo "Data do pagamento" (lead fora do ganho) ou closed_at. */
function dataVenda(l) {
  const f = (l.custom_fields_values || []).find((c) => c.field_id === PAGAMENTO_FIELD);
  const v = f && f.values && f.values[0] && f.values[0].value;
  return typeof v === 'number' ? v : v ? Math.floor(new Date(v).getTime() / 1000) : l.status_id === WON ? l.closed_at : null;
}
const campoPagamento = (iso) => (PAGAMENTO_FIELD && iso ? [{ field_id: PAGAMENTO_FIELD, values: [{ value: unixDate(iso) }] }] : null);

const mesDe = (unix) => (unix ? new Date(unix * 1000 - 3 * 3600 * 1000).toISOString().slice(0, 7) : null);

function planejar(pacientes, idx, byName, criarDesde) {
  const plano = [];
  for (const p of pacientes) {
    // Guarda a paciente no item (não enumerável: não vai para o relatório).
    const push = (it) => plano.push(Object.defineProperty(it, 'p', { value: p }));
    if (!p.consultaPaga) continue;
    const { contatos, via } = acharContatos(p, idx, byName);
    const leads = contatos.flatMap((c) => (c._embedded?.leads || []).map((x) => idx.leads.get(x.id)).filter(Boolean));
    const base = { paciente: p.nome, telefone: p.telefones[0] || '', dataGanho: p.dataGanho, valor: p.valorConsulta, via: via || '' };
    if (!contatos.length) {
      const criar = criarDesde && p.dataGanho && p.dataGanho >= criarDesde && p.nome;
      push({ ...base, acao: criar ? 'criar' : 'sem_contato', email: p.email });
      continue;
    }
    if (via === 'nome (revisar)') {
      push({ ...base, acao: 'revisar_nome', leadId: (leads[0] || {}).id || '' });
      continue;
    }
    if (!leads.length) {
      push({ ...base, acao: 'contato_sem_lead', contatoId: contatos[0].id });
      continue;
    }
    // Já confirmado: ganho, ou com a tag consulta_paga (agendada/realizada/cirurgia, fora do ganho).
    const ganho = leads.find((l) => l.status_id === WON) || leads.find((l) => (temTag(l) || temPagamento(l)) && l.status_id !== LOST);
    if (ganho) {
      const semValor = !(Number(ganho.price) > 0) && p.valorConsulta;
      const outroMes = p.noGrupo && p.dataGanho && mesDe(dataVenda(ganho)) !== p.dataGanho.slice(0, 7);
      const acao = outroMes ? 'ajustar_data' : semValor ? 'ja_ganho_completar_valor' : 'ja_ganho';
      push({ ...base, acao, leadId: ganho.id, lead: ganho, mesAntes: mesDe(dataVenda(ganho)) });
      continue;
    }
    const alvo = escolherLead(leads);
    push({ ...base, acao: 'marcar_ganho', leadId: alvo.id, lead: alvo, moverParaC1: !COMERCIAIS.has(alvo.pipeline_id) });
  }
  // Várias fichas da mesma paciente podem cair no mesmo lead: vale a data da 1ª venda,
  // e o lead recebe uma ação só (senão a data ficaria indo e voltando a cada execução).
  const porLead = new Map();
  for (const it of plano) {
    if (!it.leadId || it.acao === 'revisar_nome') continue;
    const atual = porLead.get(it.leadId);
    if (!atual || (it.dataGanho && (!atual.dataGanho || it.dataGanho < atual.dataGanho))) porLead.set(it.leadId, it);
  }
  return plano.map((it) => {
    const escolhido = it.leadId && porLead.get(it.leadId);
    if (!escolhido || escolhido === it) {
      if (escolhido && escolhido.acao === 'ajustar_data' && mesDe(dataVenda(escolhido.lead)) === (escolhido.dataGanho || '').slice(0, 7)) return { ...it, acao: 'ja_ganho' };
      return it;
    }
    return { ...it, acao: 'duplicada' };
  });
}

function patchDe(item) {
  const l = item.lead;
  const tags = [...new Set([...(l._embedded?.tags || []).map((t) => t.name), TAG])].map((name) => ({ name }));
  const patch = { id: l.id, _embedded: { tags } };
  if (!(Number(l.price) > 0) && item.valor) patch.price = Math.round(item.valor);
  if (item.acao === 'ajustar_data' && item.dataGanho && l.status_id === WON) patch.closed_at = unixDate(item.dataGanho);
  if (item.acao === 'marcar_ganho') {
    patch.status_id = WON;
    patch.pipeline_id = item.moverParaC1 ? PIPE_C1 : l.pipeline_id;
    if (item.dataGanho) patch.closed_at = unixDate(item.dataGanho);
  }
  // "Data do pagamento" acompanha a venda (é ela que conta no painel quando o lead sai do ganho).
  if (['marcar_ganho', 'ajustar_data'].includes(item.acao) && campoPagamento(item.dataGanho)) patch.custom_fields_values = campoPagamento(item.dataGanho);
  return patch;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.whatsapp && !args.amigo)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(args.help ? 0 : 1);
  }
  const registros = [];
  if (args.whatsapp) registros.push(...P.parseComprovantes(fs.readFileSync(args.whatsapp, 'utf8')).map((r) => ({ ...r, fonte: 'whatsapp' })));
  if (args.amigo) registros.push(...P.parseAmigoClinic(fs.readFileSync(args.amigo, 'utf8')).map((r) => ({ ...r, fonte: 'amigoclinic' })));
  const pacientes = P.consolidarPacientes(registros);
  console.log(`${registros.length} registros → ${pacientes.length} pacientes · ${pacientes.filter((p) => p.consultaPaga).length} com consulta paga`);

  const kommo = getKommoClient();
  const idx = await carregarKommo(kommo);
  console.log(`Kommo: ${idx.contacts.length} contatos · ${idx.leads.size} leads`);

  const plano = planejar(pacientes, idx, args.byName, args.criarDesde);
  const cont = {};
  for (const it of plano) cont[it.acao] = (cont[it.acao] || 0) + 1;
  const ganhar = plano.filter((i) => i.acao === 'marcar_ganho');
  const porMes = {};
  for (const it of ganhar) porMes[(it.dataGanho || 'sem data').slice(0, 7)] = (porMes[(it.dataGanho || 'sem data').slice(0, 7)] || 0) + 1;

  console.log('\nResultado do cruzamento:');
  const rotulos = {
    marcar_ganho: 'marcar como GANHO',
    ajustar_data: 'já ganhos, ajustar a data para o mês do grupo',
    criar: 'criar contato + lead ganho (não existiam no Kommo)',
    ja_ganho: 'já estavam ganhos',
    ja_ganho_completar_valor: 'já ganhos, completar o valor',
    contato_sem_lead: 'contato sem lead no Kommo',
    revisar_nome: 'achados só pelo nome (revisar; use --incluir-nome)',
    sem_contato: 'não encontrados no Kommo',
  };
  for (const [k, label] of Object.entries(rotulos)) if (cont[k]) console.log(`  ${String(cont[k]).padStart(4)}  ${label}`);
  console.log(`  por telefone ${plano.filter((i) => i.via === 'telefone').length} · por e-mail ${plano.filter((i) => i.via === 'email').length} · por nome ${plano.filter((i) => i.via === 'nome').length}`);
  console.log(`  a ganhar por mês: ${Object.entries(porMes).sort().map(([m, n]) => `${m}: ${n}`).join(' · ')}`);

  // Vendas por mês depois da importação (o que o painel vai mostrar) × vendas do grupo.
  const pagos = pacientes.filter((p) => p.consultaPaga && p.dataGanho);
  const doGrupo = {};
  for (const p of pagos.filter((x) => x.noGrupo)) doGrupo[p.dataGanho.slice(0, 7)] = (doGrupo[p.dataGanho.slice(0, 7)] || 0) + 1;
  const vinculados = new Set(plano.filter((i) => i.leadId).map((i) => i.leadId));
  const meses = Object.keys(doGrupo).filter((m) => m >= '2026-05').sort();
  const extras = {};
  const depois = {};
  for (const l of idx.leads.values()) {
    if (l.status_id !== WON || !COMERCIAIS.has(l.pipeline_id)) continue;
    const plan = plano.find((i) => i.leadId === l.id && i.dataGanho);
    const m = plan && plan.acao !== 'ja_ganho' && plan.acao !== 'ja_ganho_completar_valor' ? plan.dataGanho.slice(0, 7) : mesDe(l.closed_at);
    depois[m] = (depois[m] || 0) + 1;
    if (!vinculados.has(l.id) && meses.includes(m)) (extras[m] = extras[m] || []).push(l.id);
  }
  for (const it of plano) if (it.acao === 'marcar_ganho' || it.acao === 'criar') depois[it.dataGanho.slice(0, 7)] = (depois[it.dataGanho.slice(0, 7)] || 0) + 1;
  console.log('\n  Mês      grupo  painel depois  ganhos no Kommo sem ficha no grupo/AmigoClinic');
  for (const m of meses) console.log(`  ${m}   ${String(doGrupo[m] || 0).padStart(4)}  ${String(depois[m] || 0).padStart(13)}  ${(extras[m] || []).length ? (extras[m] || []).length + ' → leads ' + extras[m].join(', ') : '0'}`);
  console.log(`  a ganhar vindos de outros funis → Comercial 1: ${ganhar.filter((i) => i.moverParaC1).length}`);

  const dir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rel = path.join(dir, `consultas-pagas-${stamp}.csv`);
  const cols = ['acao', 'via', 'paciente', 'telefone', 'dataGanho', 'valor', 'leadId'];
  fs.writeFileSync(rel, [cols.join(';'), ...plano.map((i) => cols.map((c) => csvCell(i[c])).join(';'))].join('\n'));
  console.log(`\nRelatório (com dados de pacientes): ${path.relative(process.cwd(), rel)}`);

  const patches = plano.filter((i) => ['marcar_ganho', 'ja_ganho_completar_valor', 'ajustar_data'].includes(i.acao)).map(patchDe);
  if (!args.apply) {
    console.log(`\n🧪 Simulação: nada foi gravado. ${patches.length} leads seriam atualizados e ${plano.filter((i) => i.acao === 'criar').length} criados. Rode com --aplicar.`);
    return;
  }

  // Backup do estado atual dos leads que vão mudar.
  const antes = patches.map((p) => {
    const l = idx.leads.get(p.id);
    return { id: l.id, pipeline_id: l.pipeline_id, status_id: l.status_id, price: l.price, closed_at: l.closed_at, tags: (l._embedded?.tags || []).map((t) => t.name) };
  });
  fs.writeFileSync(path.join(dir, `consultas-pagas-backup-${stamp}.json`), JSON.stringify(antes));

  let ok = 0;
  const falhas = [];
  for (let i = 0; i < patches.length; i += 25) {
    const lote = patches.slice(i, i + 25);
    try {
      await kommo.updateLeads(lote, 25);
      ok += lote.length;
    } catch {
      for (const p of lote) {
        try {
          await kommo.updateLeads([p]);
          ok += 1;
        } catch (e) {
          falhas.push({ id: p.id, erro: e.message.slice(0, 200) });
        }
      }
    }
  }
  // Pacientes que não existiam: contato + lead ganho no Comercial 1.
  const criar = plano.filter((i) => i.acao === 'criar');
  const criados = [];
  for (let i = 0; i < criar.length; i += 25) {
    const lote = criar.slice(i, i + 25);
    const body = lote.map((it) => ({
      name: `Consulta · ${it.paciente}`,
      price: it.valor ? Math.round(it.valor) : undefined,
      pipeline_id: PIPE_C1,
      status_id: WON,
      closed_at: it.dataGanho ? unixDate(it.dataGanho) : undefined,
      created_at: it.dataGanho ? unixDate(it.dataGanho) : undefined,
      ...(campoPagamento(it.dataGanho) ? { custom_fields_values: campoPagamento(it.dataGanho) } : {}),
      _embedded: {
        tags: [{ name: TAG }],
        contacts: [
          (() => {
            // O Kommo recusa a lista de campos vazia: só manda quando há telefone ou e-mail.
            const campos = [
              ...(it.telefone ? [{ field_code: 'PHONE', values: [{ value: `+55${it.telefone}`, enum_code: 'MOB' }] }] : []),
              ...(it.email ? [{ field_code: 'EMAIL', values: [{ value: it.email, enum_code: 'WORK' }] }] : []),
            ];
            return campos.length ? { first_name: it.paciente, custom_fields_values: campos } : { first_name: it.paciente };
          })(),
        ],
      },
    }));
    try {
      const res = await kommo.request('post', '/leads/complex', { data: body });
      for (const [j, r] of (Array.isArray(res) ? res : []).entries()) criados.push({ ...lote[j], leadId: r.id });
    } catch (e) {
      falhas.push({ id: 'criar', erro: e.message.slice(0, 200) });
    }
  }
  const notas = [...ganhar, ...criados].map((it) => ({
    leadId: it.leadId,
    text: `✅ Consulta paga confirmada${it.dataGanho ? ` em ${it.dataGanho.split('-').reverse().join('/')}` : ''}` +
      `${it.valor ? ` · R$ ${Math.round(it.valor).toLocaleString('pt-BR')}` : ''} (importado do grupo de comprovantes / AmigoClinic).`,
  }));
  if (notas.length) await kommo.addLeadNotesBulk(notas, 25);
  console.log(`\n✅ ${ok} leads atualizados · ${criados.length} criados · ${notas.length} notas · ${falhas.length} falhas`);
  for (const f of falhas.slice(0, 5)) console.log(`   ❌ ${f.id}: ${f.erro}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

module.exports = { planejar, escolherLead, patchDe, unixDate, carregarKommo, dataVenda, TAG };
