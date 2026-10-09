#!/usr/bin/env node
'use strict';

/**
 * Tira do "4. Consulta agendada" (e do ganho) os leads que NÃO têm consulta paga confirmada
 * e devolve para "2. Qualificado". A referência é a mesma da importação de consultas pagas:
 * grupo de comprovantes + AmigoClinic (pacientes que o importador vinculou a um lead) e
 * qualquer lead com a tag consulta_paga.
 *
 *   node src/scripts/corrigirAgendadas.js --whatsapp grupo.txt --amigoclinic amigo.csv            # simula
 *   node src/scripts/corrigirAgendadas.js --whatsapp grupo.txt --amigoclinic amigo.csv --aplicar
 *
 *   --ganhos-desde AAAA-MM-DD  também reabre ganhos sem comprovante fechados a partir da data
 *                              (padrão 2026-05-01; use "nao" para não mexer em ganhos)
 *
 * Etapas 5 a 8 (consulta realizada, oportunidade, cirurgia, nutrição) só aparecem no relatório.
 */

const fs = require('fs');
const path = require('path');
const { getKommoClient } = require('../services/kommoClient');
const { resolvePipeline } = require('../services/pipelineResolver');
const P = require('../services/pagamentos');
const imp = require('./importarConsultasPagas');

const WON = 142;
const TAG_OK = 'consulta_paga';
const TAG_NOVA = 'agendamento_sem_comprovante';

function parseArgs(argv) {
  const a = { apply: false, ganhosDesde: '2026-05-01' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--whatsapp') a.whatsapp = argv[++i];
    else if (argv[i] === '--amigoclinic') a.amigo = argv[++i];
    else if (argv[i] === '--aplicar') a.apply = true;
    else if (argv[i] === '--ganhos-desde') a.ganhosDesde = argv[++i] === 'nao' ? null : argv[i];
    else throw new Error(`Opção desconhecida: ${argv[i]}`);
  }
  if (!a.whatsapp && !a.amigo) throw new Error('Informe --whatsapp e/ou --amigoclinic (as mesmas fontes da importação).');
  return a;
}

const dia = (unix) => (unix ? new Date(unix * 1000 - 3 * 3600 * 1000).toISOString().slice(0, 10) : '');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kommo = getKommoClient();
  const pipelines = JSON.parse(process.env.KOMMO_METRICS_PIPELINES || '{}');
  const pipeIds = Object.keys(pipelines).map(Number);

  // Leads com consulta paga confirmada (mesmo cruzamento da importação).
  const registros = [];
  if (args.whatsapp) registros.push(...P.parseComprovantes(fs.readFileSync(args.whatsapp, 'utf8')).map((r) => ({ ...r, fonte: 'whatsapp' })));
  if (args.amigo) registros.push(...P.parseAmigoClinic(fs.readFileSync(args.amigo, 'utf8')).map((r) => ({ ...r, fonte: 'amigoclinic' })));
  const pacientes = P.consolidarPacientes(registros);
  const idx = await imp.carregarKommo(kommo);
  const plano = imp.planejar(pacientes, idx, false, null);
  const confirmados = new Set(plano.filter((i) => i.leadId && i.acao !== 'revisar_nome').map((i) => Number(i.leadId)));
  for (const l of idx.leads.values()) if ((l._embedded?.tags || []).some((t) => t.name === TAG_OK)) confirmados.add(l.id);
  // Paciente pode ter mais de um lead: qualquer lead de um contato confirmado conta como confirmado.
  for (const c of idx.contacts) {
    const ids = (c._embedded?.leads || []).map((x) => x.id);
    if (ids.some((id) => confirmados.has(id))) ids.forEach((id) => confirmados.add(id));
  }

  const mover = [];
  const relatorio = {};
  for (const pid of pipeIds) {
    const ctx = await resolvePipeline(kommo, { pipelineId: pid });
    const nome = pipelines[pid].role || ctx.pipeline.name;
    const agendada = ctx.apnStatuses.map((s) => s.id);
    const qualificado = ctx.qualificados;
    const depois = ctx.statuses.filter((s) => s.sort > Math.max(...ctx.apnStatuses.map((x) => x.sort)) && s.id !== WON && s.id !== 143);
    const leads = [...idx.leads.values()].filter((l) => l.pipeline_id === pid);
    const semComprovante = (l) => !confirmados.has(l.id);

    const ag = leads.filter((l) => agendada.includes(l.status_id));
    const agFalsas = ag.filter(semComprovante);
    const ganhos = leads.filter((l) => l.status_id === WON);
    const ganhosFalsos = args.ganhosDesde ? ganhos.filter((l) => semComprovante(l) && dia(l.closed_at) >= args.ganhosDesde) : [];
    for (const l of [...agFalsas, ...ganhosFalsos]) mover.push({ lead: l, para: qualificado, pid, eraGanho: l.status_id === WON });

    relatorio[nome] = {
      'consulta agendada': `${ag.length} (${ag.length - agFalsas.length} com comprovante, ${agFalsas.length} sem → Qualificado)`,
      [`ganhos desde ${args.ganhosDesde || '—'}`]: `${ganhos.filter((l) => dia(l.closed_at) >= (args.ganhosDesde || '9999')).length} (${ganhosFalsos.length} sem comprovante → Qualificado)`,
      'etapas 5–8 sem comprovante (só informativo)': depois
        .map((s) => `${s.name}: ${leads.filter((l) => l.status_id === s.id && semComprovante(l)).length}/${leads.filter((l) => l.status_id === s.id).length}`)
        .join(' · '),
    };
  }

  for (const [nome, r] of Object.entries(relatorio)) {
    console.log(`\n${nome}`);
    for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${v}`);
  }
  console.log(`\nTotal a mover para "2. Qualificado": ${mover.length} (${mover.filter((m) => m.eraGanho).length} eram ganhos)`);
  if (mover.some((m) => m.eraGanho)) console.log(`  ganhos reabertos: ${mover.filter((m) => m.eraGanho).map((m) => m.lead.id).join(', ')}`);

  if (!args.apply) {
    console.log('\n🧪 Simulação: nada foi gravado. Rode com --aplicar.');
    return;
  }
  const dir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(dir, `corrigir-agendadas-backup-${stamp}.json`),
    JSON.stringify(mover.map((m) => ({ id: m.lead.id, pipeline_id: m.lead.pipeline_id, status_id: m.lead.status_id, closed_at: m.lead.closed_at })))
  );
  const patches = mover.map((m) => ({
    id: m.lead.id,
    pipeline_id: m.pid,
    status_id: m.para.id,
    _embedded: { tags: [...new Set([...(m.lead._embedded?.tags || []).map((t) => t.name), TAG_NOVA])].map((name) => ({ name })) },
  }));
  await kommo.updateLeads(patches, 25);
  await kommo.addLeadNotesBulk(
    mover.map((m) => ({
      leadId: m.lead.id,
      text: `↩️ Voltou para "2. Qualificado": estava em ${m.eraGanho ? 'ganho' : '"Consulta agendada"'} sem comprovante de pagamento no grupo nem no AmigoClinic. Se a consulta foi paga, mova de volta e anexe o comprovante.`,
    })),
    25
  );
  console.log(`\n✅ ${patches.length} leads movidos para "2. Qualificado" (backup em backups/).`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });
}
