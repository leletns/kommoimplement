#!/usr/bin/env node
'use strict';

/**
 * Sincronização retroativa da Alice Bot.
 *
 * Varre todos os leads do funil (GET /api/v4/leads, paginação por `page` seguindo
 * `_links.next`), lê o histórico de notas em lote, calcula o score de qualificação
 * (0–100) e aplica no Kommo:
 *   - PATCH /api/v4/leads           → tags (+ score em campo personalizado, + etapa)
 *   - POST  /api/v4/leads/notes     → nota com o resumo da qualificação (em lote)
 *
 * Tudo passa pelo kommoClient (4 req/s + retry com backoff), então pode rodar em
 * contas grandes sem estourar o limite de 7 req/s do Kommo.
 *
 * Uso:
 *   node src/scripts/retroativo.js [opções]
 *
 *   --dry-run         Só calcula e mostra; não grava nada no Kommo
 *   --force           Reprocessa leads que já têm a tag alice_bot_finalizado
 *   --sem-mover       Não altera a etapa dos leads (só tags, score e nota)
 *   --sem-notas       Não lê o histórico de notas (mais rápido, score menos preciso)
 *   --sem-nota-alice  Não cria a nota de resumo no card
 *   --retomar         Continua da última página concluída (retroativo-checkpoint.json)
 *   --pagina N        Começa na página N
 *   --limite N        Processa no máximo N leads
 *   --desde AAAA-MM-DD Só leads criados a partir desta data
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getKommoClient } = require('../services/kommoClient');
const { resolvePipeline, WON, LOST } = require('../services/pipelineResolver');
const alice = require('../services/aliceEngine');

const CHECKPOINT_FILE = path.resolve(process.cwd(), 'retroativo-checkpoint.json');
const NOTES_ID_CHUNK = 50; // ids por chamada em GET /leads/notes (limite de tamanho de URL)

function parseArgs(argv) {
  const args = { dryRun: false, force: false, move: true, readNotes: true, writeNote: true, resume: false, page: 1, limit: Infinity, since: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--sem-mover') args.move = false;
    else if (a === '--sem-notas') args.readNotes = false;
    else if (a === '--sem-nota-alice') args.writeNote = false;
    else if (a === '--retomar') args.resume = true;
    else if (a === '--pagina') args.page = parseInt(argv[++i], 10) || 1;
    else if (a === '--limite') args.limit = parseInt(argv[++i], 10) || Infinity;
    else if (a === '--desde') args.since = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      console.error(`Opção desconhecida: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

function hasTag(lead, name) {
  return (lead._embedded?.tags || []).some((t) => t.name === name);
}

/**
 * Decide se o lead deve mudar de etapa. Regra de segurança: só avança no funil,
 * nunca faz o lead voltar (ex.: lead em "Consulta agendada" com score baixo não volta
 * para NOVOS) e nunca mexe em leads de entrada (incoming), ganhos ou perdidos.
 */
function planMove(lead, evaluation, ctx) {
  const target = evaluation.stage === 'QUALIFICADOS' ? ctx.qualificados : ctx.novos;
  if (!target || lead.pipeline_id !== ctx.pipeline.id) return null;
  const current = ctx.byId.get(lead.status_id);
  if (!current || current.type === 1) return null;
  if (current.sort >= target.sort) return null;
  return target;
}

async function fetchNotesByLead(kommo, leadIds) {
  const byLead = new Map();
  for (let i = 0; i < leadIds.length; i += NOTES_ID_CHUNK) {
    const notes = await kommo.getNotesForLeads(leadIds.slice(i, i + NOTES_ID_CHUNK));
    for (const n of notes) {
      if (!byLead.has(n.entity_id)) byLead.set(n.entity_id, []);
      byLead.get(n.entity_id).push(n);
    }
  }
  return byLead;
}

async function patchWithFallback(kommo, patches, stats) {
  try {
    await kommo.updateLeads(patches);
    stats.updated += patches.length;
  } catch (err) {
    log(`⚠️  PATCH em lote falhou (${err.status || ''}); tentando lead a lead…`);
    for (const p of patches) {
      try {
        await kommo.updateLeads([p]);
        stats.updated += 1;
      } catch (e) {
        stats.failed += 1;
        stats.failures.push({ id: p.id, erro: e.message.slice(0, 300) });
        log(`❌ Lead ${p.id}: ${e.message.slice(0, 200)}`);
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kommo = getKommoClient();

  if (args.resume && fs.existsSync(CHECKPOINT_FILE)) {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    args.page = (cp.lastCompletedPage || 0) + 1;
    log(`↩️  Retomando da página ${args.page}`);
  }

  const account = await kommo.getAccount();
  log(`Conta: ${account.name} (${config.kommo.subdomain}.kommo.com)`);
  const ctx = await resolvePipeline(kommo);
  log(`Funil: ${ctx.pipeline.name} (#${ctx.pipeline.id}) · NOVOS=${ctx.novos?.name || '—'} · QUALIFICADOS=${ctx.qualificados?.name || '—'}`);
  if (args.dryRun) log('🧪 DRY-RUN: nada será gravado no Kommo.');

  const params = { 'filter[pipeline_id]': ctx.pipeline.id, 'order[id]': 'asc' };
  if (args.since) params['filter[created_at][from]'] = Math.floor(new Date(`${args.since}T00:00:00`).getTime() / 1000);

  const stats = { seen: 0, skipped: 0, evaluated: 0, updated: 0, moved: 0, notes: 0, failed: 0, failures: [], quente: 0, morna: 0, fria: 0 };
  const startedAt = Date.now();

  for await (const { page, items } of kommo.paginate('/leads', { params, embeddedKey: 'leads', startPage: args.page })) {
    const remaining = args.limit - stats.evaluated;
    const leads = [];
    for (const lead of items) {
      stats.seen += 1;
      const closed = lead.status_id === WON || lead.status_id === LOST;
      const done = !args.force && hasTag(lead, alice.TAGS.FINALIZADO);
      if (closed || done || leads.length >= remaining) stats.skipped += 1;
      else leads.push(lead);
    }

    const notesByLead = args.readNotes ? await fetchNotesByLead(kommo, leads.map((l) => l.id)) : new Map();

    const patches = [];
    const notes = [];
    for (const lead of leads) {
      const evaluation = alice.evaluateLead({ lead, notes: notesByLead.get(lead.id) || [], stages: ctx.stages });
      stats.evaluated += 1;
      stats[evaluation.temperatura] += 1;

      const patch = { id: lead.id, _embedded: { tags: evaluation.tags.map((name) => ({ name })) } };
      if (config.kommo.scoreFieldId) {
        patch.custom_fields_values = [{ field_id: config.kommo.scoreFieldId, values: [{ value: evaluation.score }] }];
      }
      const target = args.move ? planMove(lead, evaluation, ctx) : null;
      if (target) {
        patch.status_id = target.id;
        patch.pipeline_id = ctx.pipeline.id;
        stats.moved += 1;
      }
      patches.push(patch);
      if (args.writeNote) notes.push({ leadId: lead.id, text: alice.buildNote(evaluation) });

      if (args.dryRun) {
        log(`  #${lead.id} ${String(lead.name || '').slice(0, 40).padEnd(40)} score=${String(evaluation.score).padStart(3)} ${evaluation.temperatura.padEnd(6)}${target ? ` → ${target.name}` : ''}${evaluation.objections.length ? ` · objeções: ${evaluation.objections.map((o) => o.id).join(',')}` : ''}`);
      }
    }

    if (!args.dryRun && patches.length) {
      await patchWithFallback(kommo, patches, stats);
      if (notes.length) {
        try {
          await kommo.addLeadNotesBulk(notes);
          stats.notes += notes.length;
        } catch (err) {
          log(`⚠️  Falha ao gravar notas da página ${page}: ${err.message.slice(0, 200)}`);
        }
      }
      fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lastCompletedPage: page, at: new Date().toISOString() }, null, 2));
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    log(`📄 Página ${page}: ${items.length} leads · avaliados ${stats.evaluated} · atualizados ${stats.updated} · movidos ${stats.moved} · ${kommo.stats.requests} req · ${kommo.stats.retries} retries · ${elapsed}s`);

    if (stats.evaluated >= args.limit) break;
  }

  const report = { ...stats, dryRun: args.dryRun, finishedAt: new Date().toISOString(), api: kommo.stats };
  const reportFile = path.resolve(process.cwd(), `retroativo-${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  if (!args.dryRun && fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);

  log('✅ Concluído');
  log(`   Leads vistos: ${stats.seen} · ignorados (ganhos/perdidos/já processados): ${stats.skipped}`);
  log(`   Avaliados: ${stats.evaluated} → 🔥 quentes ${stats.quente} · 🌤 mornas ${stats.morna} · ❄️ frias ${stats.fria}`);
  log(`   Atualizados: ${stats.updated} · movidos de etapa: ${stats.moved} · notas: ${stats.notes} · falhas: ${stats.failed}`);
  log(`   Relatório: ${reportFile}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Retroativo interrompido:', err.message);
    console.error('   Rode novamente com --retomar para continuar da última página concluída.');
    process.exit(1);
  });
}

module.exports = { planMove, parseArgs };
