#!/usr/bin/env node
'use strict';

/**
 * Preenche, nos leads de quem pagou consulta, o que os comprovantes dizem — sem mudar etapa nem funil:
 *
 *   Venda (valor do lead)          = quanto a paciente pagou de fato nesta venda (ficha + restantes do
 *                                    grupo; restante pago na clínica quando o AmigoClinic finalizou a consulta)
 *   Data do pagamento              = dia da 1ª ficha no grupo de comprovantes (só se estiver vazio)
 *   Data e horário da consulta     = AmigoClinic (data + hora do agendamento) ou, sem ele, o
 *                                    "Dia 02 de outubro às 09h00" da ficha (só se estiver vazio)
 *   Nota                           = resumo dos pagamentos ("pago R$ 1.100 de R$ 2.200; falta R$ 1.100")
 *
 * Sempre simula primeiro. Relatório e backup (dados de pacientes) vão para backups/.
 *
 *   node src/scripts/preencherPagamentos.js --whatsapp grupo.txt --amigoclinic a.csv [--amigoclinic b.csv]
 *   node src/scripts/preencherPagamentos.js ... --aplicar
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getKommoClient } = require('../services/kommoClient');
const P = require('../services/pagamentos');
const imp = require('./importarConsultasPagas');
const org = require('./organizarConsultas');

const PAGAMENTO_FIELD = config.kommo.pagamentoFieldId;
const CONSULTA_FIELD = config.kommo.consultaFieldId;
const COM_LEAD = new Set(['ja_ganho', 'ja_ganho_completar_valor', 'ajustar_data', 'marcar_ganho']);

function parseArgs(argv) {
  const a = { apply: false, amigo: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--whatsapp') a.whatsapp = argv[++i];
    else if (argv[i] === '--amigoclinic') a.amigo.push(argv[++i]);
    else if (argv[i] === '--aplicar') a.apply = true;
    else throw new Error(`Opção desconhecida: ${argv[i]}`);
  }
  if (!a.whatsapp) throw new Error('Informe --whatsapp (exportação do grupo de comprovantes).');
  return a;
}

const reais = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const unixDataHora = (iso, hora) => Math.floor(new Date(`${iso}T${(hora || '12:00').padStart(5, '0')}:00-03:00`).getTime() / 1000);
const campo = (l, id) => (l.custom_fields_values || []).find((f) => f.field_id === id)?.values?.[0]?.value;

const dia = (unix) => (unix ? new Date(unix * 1000 - 3 * 3600 * 1000).toISOString().slice(0, 10) : null);
const diasEntre = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;

/**
 * A venda deste lead e o que foi pago nela. Cada "venda" é uma ficha com valor que não é parcela;
 * as fichas seguintes de restante (até a próxima venda) completam o pagamento. Usa a venda mais
 * próxima da data de pagamento do lead (paciente que voltou anos depois tem vendas separadas).
 * Sem restante no grupo, mas com a consulta finalizada no AmigoClinic, o restante foi pago na clínica.
 */
function cicloDe(l, p, idxAmigo, hoje = new Date().toISOString().slice(0, 10)) {
  const fichas = p.fichas || [];
  const vendas = fichas.filter((f) => !f.restante && f.pago);
  if (!vendas.length) return null;
  const ref = dia(imp.dataVenda(l));
  const venda = ref ? vendas.reduce((m, v) => (diasEntre(v.data, ref) < diasEntre(m.data, ref) ? v : m)) : vendas[vendas.length - 1];
  const i = fichas.indexOf(venda);
  const prox = fichas.findIndex((f, j) => j > i && !f.restante && f.pago);
  const ciclo = fichas.slice(i, prox === -1 ? undefined : prox);

  const total = Math.max(...ciclo.map((f) => f.total || 0), venda.pago);
  let pago = venda.pago;
  const detalhe = [`${br(venda.data)} ${reais(venda.pago)}`];
  for (const f of ciclo.slice(1).filter((x) => x.restante)) {
    const v = f.pago || Math.max(0, total - pago);
    if (!v) continue;
    pago += v;
    detalhe.push(`${br(f.data)} ${reais(v)} (restante)`);
  }

  // Consulta desta venda: a 1ª do AmigoClinic a partir do pagamento (até 6 meses); senão a da ficha.
  const amigo = org
    .atendimentosDa(p, idxAmigo)
    .filter((r) => r.tipo === 'consulta' && r.data >= venda.data && diasEntre(r.data, venda.data) <= 180 && !/cancel|desmarc|faltou/i.test(r.status || ''));
  const noGrupo = ciclo.find((f) => f.consultaEm);
  let consulta = null;
  if (amigo[0]) consulta = { data: amigo[0].data, hora: amigo[0].hora, fonte: 'AmigoClinic', status: amigo[0].status, valor: amigo[0].valor };
  else if (noGrupo) consulta = { data: noGrupo.consultaEm, hora: noGrupo.consultaHora, fonte: 'ficha do grupo' };

  // Consulta finalizada no AmigoClinic: o valor cobrado lá é o que a paciente pagou no total
  // (o restante é pago na clínica, no dia).
  let fechado = total;
  if (/finaliz/i.test(consulta?.status || '') && consulta.valor > pago) fechado = Math.max(total, consulta.valor);
  // Consulta antiga, que o relatório do AmigoClinic não cobre: data já passou → restante pago no dia.
  const antiga = !consulta?.status && ((consulta && consulta.data < hoje) || (!consulta && diasEntre(venda.data, hoje) > 60));
  if (pago < fechado && (fechado > total || /finaliz/i.test(consulta?.status || '') || antiga)) {
    const fonte = consulta?.status ? 'AmigoClinic, consulta finalizada' : 'consulta já realizada';
    detalhe.push(`${reais(fechado - pago)} restante pago na clínica${consulta ? ` em ${br(consulta.data)}` : ''} (${fonte})`);
    pago = fechado;
  }
  const totalFinal = Math.max(total, fechado);
  // Consulta que já aconteceu está quitada: o valor do lead nunca baixa (pode incluir itens do dia).
  const realizada = /finaliz/i.test(consulta?.status || '') || antiga;
  return { venda, pago, total: totalFinal, falta: realizada ? 0 : Math.max(0, totalFinal - pago), realizada, detalhe, consulta };
}

function planejarLead(l, c) {
  const patch = { id: l.id };
  const campos = [];
  const mud = [];
  const baixaria = Number(l.price) > Math.round(c.pago);
  if (Number(l.price) !== Math.round(c.pago) && !(baixaria && c.realizada)) {
    patch.price = Math.round(c.pago);
    mud.push(`valor ${l.price ? reais(l.price) : 'vazio'} → ${reais(c.pago)}`);
  }
  if (PAGAMENTO_FIELD && !campo(l, PAGAMENTO_FIELD)) {
    campos.push({ field_id: PAGAMENTO_FIELD, values: [{ value: imp.unixDate(c.venda.data) }] });
    mud.push(`pagamento ${br(c.venda.data)}`);
  }
  if (CONSULTA_FIELD && c.consulta && !campo(l, CONSULTA_FIELD)) {
    campos.push({ field_id: CONSULTA_FIELD, values: [{ value: unixDataHora(c.consulta.data, c.consulta.hora) }] });
    mud.push(`consulta ${br(c.consulta.data)}${c.consulta.hora ? ` ${c.consulta.hora}` : ''} (${c.consulta.fonte})`);
  }
  if (campos.length) patch.custom_fields_values = campos;
  return { patch, mud };
}

function notaDe(c) {
  let t = `💳 Comprovantes: pago ${reais(c.pago)}`;
  if (c.total > c.pago) t += ` de ${reais(c.total)} · falta ${reais(c.falta)}`;
  t += ` (${c.detalhe.join(' + ')})`;
  if (c.consulta) t += ` · consulta ${br(c.consulta.data)}${c.consulta.hora ? ` às ${c.consulta.hora}` : ''}`;
  return `${t}.`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kommo = getKommoClient();

  const registros = P.parseComprovantes(fs.readFileSync(args.whatsapp, 'utf8')).map((r) => ({ ...r, fonte: 'whatsapp' }));
  const amigo = args.amigo.flatMap((f) => P.parseAmigoClinic(fs.readFileSync(f, 'utf8'))).map((r) => ({ ...r, fonte: 'amigoclinic' }));
  registros.push(...amigo);
  const idxAmigo = org.indexarAmigo(amigo);

  const idx = await imp.carregarKommo(kommo);
  const plano = imp.planejar(P.consolidarPacientes(registros), idx, false, null);

  const itens = [];
  const vistos = new Set();
  for (const it of plano) {
    if (!COM_LEAD.has(it.acao) || !it.leadId || !it.p || !it.p.noGrupo) continue;
    const l = idx.leads.get(Number(it.leadId)) || it.lead;
    if (!l || vistos.has(l.id)) continue;
    vistos.add(l.id);
    const c = cicloDe(l, it.p, idxAmigo);
    if (!c) continue;
    const { patch, mud } = planejarLead(l, c);
    if (mud.length) itens.push({ l, p: it.p, c, patch, mud });
  }

  const n = (re) => itens.filter((x) => x.mud.some((m) => re.test(m))).length;
  console.log(`\nLeads com consulta paga no grupo de comprovantes: ${vistos.size}`);
  console.log(`A atualizar: ${itens.length} · valor ${n(/^valor/)} · data do pagamento ${n(/^pagamento/)} · data da consulta ${n(/^consulta/)}`);
  for (const x of itens.slice(0, 12)) console.log(`  lead ${x.l.id} · ${x.mud.join(' · ')}`);
  if (itens.length > 12) console.log(`  … e mais ${itens.length - 12}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const csv = ['leadId;paciente;mudancas'].concat(itens.map((x) => `${x.l.id};"${x.p.nome || ''}";"${x.mud.join(' | ')}"`));
  fs.writeFileSync(path.join(dir, `preencher-pagamentos-${stamp}.csv`), csv.join('\n'));

  if (!args.apply) {
    console.log('\nSimulação. Para gravar: --aplicar');
    return;
  }
  const antes = itens.map((x) => ({ id: x.l.id, price: x.l.price, custom_fields_values: x.l.custom_fields_values }));
  fs.writeFileSync(path.join(dir, `preencher-pagamentos-backup-${stamp}.json`), JSON.stringify(antes));
  const patches = itens.map((x) => x.patch);
  for (let i = 0; i < patches.length; i += 50) await kommo.request('patch', '/leads', { data: patches.slice(i, i + 50) });
  const notas = itens.map((x) => ({ entity_id: x.l.id, note_type: 'common', params: { text: notaDe(x.c) } }));
  for (let i = 0; i < notas.length; i += 50) await kommo.request('post', '/leads/notes', { data: notas.slice(i, i + 50) });
  console.log(`\nGravado: ${patches.length} leads atualizados e ${notas.length} notas.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.response?.data ? JSON.stringify(e.response.data) : e.message);
    process.exit(1);
  });
}

module.exports = { cicloDe, planejarLead, notaDe };
