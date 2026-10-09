#!/usr/bin/env node
'use strict';

/**
 * Põe cada consulta paga na etapa certa, usando o AmigoClinic como prova de que aconteceu:
 *
 *   consulta "Finalizado" no AmigoClinic (data já passou)  → 5. Consulta realizada
 *   consulta "Agendado" no AmigoClinic (data futura)       → 4. Consulta agendada
 *   paga antes do início do relatório do AmigoClinic       → 5. Consulta realizada (nota "anterior ao relatório")
 *   paga, sem registro no AmigoClinic                      → 4. Consulta agendada + tag confirmar_se_realizou
 *   cirurgia "Finalizado" no AmigoClinic                   → continua GANHO (só preenche os campos)
 *
 * Todas recebem "Data do pagamento" (é essa data que o painel usa para contar a consulta vendida
 * no mês certo, em qualquer etapa) e, quando o AmigoClinic tem, "Data e horário da consulta".
 *
 * Referência de "consulta paga": a mesma da importação (grupo de comprovantes + AmigoClinic,
 * leads com a tag consulta_paga). Rode a importação antes, se chegaram comprovantes novos.
 *
 *   node src/scripts/organizarConsultas.js --whatsapp grupo.txt --amigoclinic amigo.csv            # simula
 *   node src/scripts/organizarConsultas.js --whatsapp grupo.txt --amigoclinic amigo.csv --aplicar
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getKommoClient } = require('../services/kommoClient');
const { resolvePipeline } = require('../services/pipelineResolver');
const { normalize } = require('../services/aliceEngine');
const P = require('../services/pagamentos');
const imp = require('./importarConsultasPagas');

const WON = 142;
const LOST = 143;
const TAG_VERIFICAR = 'confirmar_se_realizou';
const TAG_REALIZADA = 'consulta_realizada';
const PAGAMENTO_FIELD = config.kommo.pagamentoFieldId;
const CONSULTA_FIELD = config.kommo.consultaFieldId;
const NOME_CAMPO_PAGAMENTO = 'Data do pagamento';

function parseArgs(argv) {
  const a = { apply: false, hoje: new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--whatsapp') a.whatsapp = argv[++i];
    else if (argv[i] === '--amigoclinic') a.amigo = argv[++i];
    else if (argv[i] === '--aplicar') a.apply = true;
    else if (argv[i] === '--hoje') a.hoje = argv[++i];
    else throw new Error(`Opção desconhecida: ${argv[i]}`);
  }
  if (!a.amigo) throw new Error('Informe --amigoclinic (é a prova de que a consulta aconteceu). --whatsapp é recomendado.');
  return a;
}

const dia = (unix) => (unix ? new Date(unix * 1000 - 3 * 3600 * 1000).toISOString().slice(0, 10) : null);
const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const unixDataHora = (iso, hora) => Math.floor(new Date(`${iso}T${(hora || '12:00').padStart(5, '0')}:00-03:00`).getTime() / 1000);

/** Índice dos atendimentos do AmigoClinic por CPF, telefone, e-mail e nome completo. */
function indexarAmigo(regs) {
  const idx = new Map();
  const add = (k, r) => {
    if (!k) return;
    if (!idx.has(k)) idx.set(k, new Set());
    idx.get(k).add(r);
  };
  for (const r of regs) {
    add(r.cpf && `cpf:${r.cpf}`, r);
    add(r.telefone && `tel:${P.phoneKey(r.telefone)}`, r);
    add(r.email && `mail:${r.email}`, r);
    const n = P.normName(r.nome || '');
    if (n.split(' ').length >= 2) add(`nome:${n}`, r);
  }
  return idx;
}

function atendimentosDa(p, idx) {
  const keys = [
    p.cpf && `cpf:${p.cpf}`,
    p.email && `mail:${p.email}`,
    ...p.telefones.map((t) => `tel:${P.phoneKey(t)}`),
    p.nome && P.normName(p.nome).split(' ').length >= 2 && `nome:${P.normName(p.nome)}`,
  ].filter(Boolean);
  const out = new Set();
  for (const k of keys) for (const r of idx.get(k) || []) out.add(r);
  return [...out].sort((a, b) => a.data.localeCompare(b.data));
}

/** Decide a etapa. Devolve { alvo: 'realizada' | 'agendada' | 'ganho', motivo, consulta? }. */
function classificar(regs, dataPagamento, hoje, inicioRelatorio) {
  const fin = (r) => /finaliz/i.test(r.status || '') && r.data <= hoje;
  const ag = (r) => /agendad/i.test(r.status || '') && r.data >= hoje;
  const cirFeita = regs.filter((r) => r.tipo === 'cirurgia' && fin(r));
  if (cirFeita.length) return { alvo: 'ganho', motivo: `cirurgia realizada em ${br(cirFeita[cirFeita.length - 1].data)}` };
  const realizadas = regs.filter((r) => r.tipo === 'consulta' && fin(r));
  if (realizadas.length) {
    const c = realizadas[realizadas.length - 1];
    return { alvo: 'realizada', motivo: `consulta realizada em ${br(c.data)} (AmigoClinic)`, consulta: c };
  }
  const futuras = regs.filter((r) => r.tipo === 'consulta' && ag(r));
  if (futuras.length) return { alvo: 'agendada', motivo: `consulta marcada para ${br(futuras[0].data)} (AmigoClinic)`, consulta: futuras[0] };
  if (dataPagamento && inicioRelatorio && dataPagamento < inicioRelatorio) {
    return { alvo: 'realizada', motivo: `paga em ${br(dataPagamento)}, antes do início do relatório do AmigoClinic` };
  }
  return { alvo: 'agendada', motivo: 'paga, mas sem atendimento no AmigoClinic: confirmar se a consulta aconteceu', verificar: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!PAGAMENTO_FIELD) throw new Error('Defina KOMMO_PAGAMENTO_FIELD_ID (config/conta.env).');
  const kommo = getKommoClient();
  const pipelines = JSON.parse(process.env.KOMMO_METRICS_PIPELINES || '{}');

  const amigo = P.parseAmigoClinic(fs.readFileSync(args.amigo, 'utf8')).map((r) => ({ ...r, fonte: 'amigoclinic' }));
  // Mesma ordem da importação (grupo primeiro): a consolidação e a data da venda saem iguais.
  const registros = args.whatsapp ? P.parseComprovantes(fs.readFileSync(args.whatsapp, 'utf8')).map((r) => ({ ...r, fonte: 'whatsapp' })) : [];
  registros.push(...amigo);
  const inicioRelatorio = amigo.map((r) => r.data).sort()[0];
  const idxAmigo = indexarAmigo(amigo);

  const idx = await imp.carregarKommo(kommo);
  const plano = imp.planejar(P.consolidarPacientes(registros), idx, false, null);

  // Etapas 4 e 5 de cada funil comercial.
  const etapas = new Map();
  for (const pid of Object.keys(pipelines).map(Number)) {
    const ctx = await resolvePipeline(kommo, { pipelineId: pid });
    const achar = (re) => ctx.statuses.find((s) => re.test(normalize(s.name)));
    const agendada = achar(/consulta agendada/);
    const realizada = achar(/consulta realizada/);
    if (!agendada || !realizada) throw new Error(`Funil ${ctx.pipeline.name}: não achei "Consulta agendada" e "Consulta realizada".`);
    etapas.set(pid, { nome: pipelines[pid].role || ctx.pipeline.name, agendada, realizada, statuses: ctx.statuses });
  }
  const nomeEtapa = (l) => (l.status_id === WON ? 'ganho' : etapas.get(l.pipeline_id)?.statuses.find((s) => s.id === l.status_id)?.name || l.status_id);

  const itens = [];
  const vistos = new Set();
  for (const it of plano) {
    if (!['ja_ganho', 'ja_ganho_completar_valor', 'ajustar_data'].includes(it.acao) || !it.lead || !it.p) continue;
    const l = idx.leads.get(Number(it.leadId)) || it.lead;
    if (vistos.has(l.id) || l.status_id === LOST || !etapas.has(l.pipeline_id)) continue;
    vistos.add(l.id);
    // Data da venda: a do grupo quando a importação quer ajustar; senão a do ganho; fora do ganho, o campo.
    const dataPagamento =
      (it.acao === 'ajustar_data' && it.dataGanho) || (l.status_id === WON ? dia(l.closed_at) : dia(imp.dataVenda(l))) || it.dataGanho;
    const c = classificar(atendimentosDa(it.p, idxAmigo), dataPagamento, args.hoje, inicioRelatorio);
    const e = etapas.get(l.pipeline_id);
    const para = c.alvo === 'ganho' ? WON : c.alvo === 'realizada' ? e.realizada.id : e.agendada.id;
    itens.push({ l, it, c, para, dataPagamento });
  }

  // Resumo
  const grupos = {};
  for (const x of itens) {
    const k = `${nomeEtapa(x.l)} → ${x.para === WON ? 'ganho (cirurgia)' : x.para === etapas.get(x.l.pipeline_id).realizada.id ? '5. Consulta realizada' : '4. Consulta agendada'}${x.c.verificar ? ' (confirmar)' : ''}`;
    grupos[k] = (grupos[k] || 0) + 1;
  }
  console.log(`\nConsultas pagas encontradas no Kommo: ${itens.length}  (relatório AmigoClinic a partir de ${br(inicioRelatorio)}, hoje ${br(args.hoje)})`);
  for (const [k, v] of Object.entries(grupos).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  const verificar = itens.filter((x) => x.c.verificar);
  if (verificar.length) {
    console.log(`\nPara a Maria confirmar se a consulta aconteceu (tag ${TAG_VERIFICAR}):`);
    for (const x of verificar) console.log(`  lead ${x.l.id} · ${x.it.paciente} · paga em ${br(x.dataPagamento)}`);
  }

  const patches = [];
  const notas = [];
  for (const x of itens) {
    const campos = [];
    // A data da venda é a do ganho (já alinhada ao grupo de comprovantes pela importação).
    const pagAtual = (x.l.custom_fields_values || []).find((f) => f.field_id === PAGAMENTO_FIELD)?.values?.[0]?.value;
    if (x.dataPagamento && dia(Number(pagAtual)) !== x.dataPagamento) campos.push({ field_id: PAGAMENTO_FIELD, values: [{ value: imp.unixDate(x.dataPagamento) }] });
    if (CONSULTA_FIELD && x.c.consulta) {
      const v = unixDataHora(x.c.consulta.data, x.c.consulta.hora);
      const atual = (x.l.custom_fields_values || []).find((f) => f.field_id === CONSULTA_FIELD)?.values?.[0]?.value;
      if (atual !== v) campos.push({ field_id: CONSULTA_FIELD, values: [{ value: v }] });
    }
    const tagsAntes = (x.l._embedded?.tags || []).map((t) => t.name);
    const tags = new Set(tagsAntes);
    tags.add(imp.TAG);
    if (x.c.verificar) tags.add(TAG_VERIFICAR);
    else tags.delete(TAG_VERIFICAR);
    if (x.para === etapas.get(x.l.pipeline_id).realizada.id) tags.add(TAG_REALIZADA);
    const mudaEtapa = x.para !== x.l.status_id;
    const mudaTags = tags.size !== tagsAntes.length || tagsAntes.some((t) => !tags.has(t));
    if (!mudaEtapa && !campos.length && !mudaTags) continue;
    const patch = { id: x.l.id };
    if (mudaEtapa) Object.assign(patch, { pipeline_id: x.l.pipeline_id, status_id: x.para });
    if (campos.length) patch.custom_fields_values = campos;
    if (mudaTags) patch._embedded = { tags: [...tags].map((name) => ({ name })) };
    patches.push(patch);
    if (mudaEtapa) {
      notas.push({
        leadId: x.l.id,
        text: `🩺 ${x.c.motivo}. Movido de "${nomeEtapa(x.l)}" para "${x.para === WON ? 'ganho' : etapas.get(x.l.pipeline_id).statuses.find((s) => s.id === x.para).name}". Consulta paga em ${br(x.dataPagamento)} (campo "${NOME_CAMPO_PAGAMENTO}").`,
      });
    }
  }
  console.log(`\n${patches.length} leads a atualizar (${notas.length} mudam de etapa).`);
  if (!args.apply && patches.length <= 10) for (const p of patches) console.log(`  ${JSON.stringify(p)}`);

  if (!args.apply) {
    console.log('\n🧪 Simulação: nada foi gravado. Rode com --aplicar.');
    return;
  }

  // O campo de data já existe ("Data de contrato", sem uso): passa a se chamar "Data do pagamento".
  const campo = await kommo.get(`/leads/custom_fields/${PAGAMENTO_FIELD}`);
  if (campo && campo.name !== NOME_CAMPO_PAGAMENTO) {
    await kommo.request('patch', `/leads/custom_fields/${PAGAMENTO_FIELD}`, { data: { name: NOME_CAMPO_PAGAMENTO } });
  }

  const dir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(dir, `organizar-consultas-backup-${stamp}.json`),
    JSON.stringify(
      itens.map((x) => ({
        id: x.l.id,
        pipeline_id: x.l.pipeline_id,
        status_id: x.l.status_id,
        closed_at: x.l.closed_at,
        tags: (x.l._embedded?.tags || []).map((t) => t.name),
        custom_fields_values: x.l.custom_fields_values,
      }))
    )
  );
  // Campo de data antes da mudança de etapa: se o lead sair do ganho, a venda continua no mês certo.
  const soCampos = patches.filter((p) => p.custom_fields_values).map((p) => ({ id: p.id, custom_fields_values: p.custom_fields_values }));
  await kommo.updateLeads(soCampos, 25);
  await kommo.updateLeads(patches.map(({ custom_fields_values, ...rest }) => rest).filter((p) => Object.keys(p).length > 1), 25);
  await kommo.addLeadNotesBulk(notas, 25);
  console.log(`\n✅ ${patches.length} leads atualizados, ${notas.length} mudaram de etapa (backup em backups/).`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

module.exports = { classificar, indexarAmigo, atendimentosDa };
