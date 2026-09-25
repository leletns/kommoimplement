#!/usr/bin/env node
'use strict';

/**
 * Importa o histórico de um GRUPO de WhatsApp para a timeline do lead no Kommo.
 *
 * Nenhuma integração de WhatsApp (Lite, Wazzup etc.) traz mensagens antigas de grupos:
 * elas só passam a chegar depois que a opção de grupos é ligada. Para o passado, use o
 * "Exportar conversa" do próprio WhatsApp (sem mídia) e rode este script.
 *
 * Cada dia de conversa vira UMA nota no card do lead (não polui a timeline com milhares
 * de notas). Rodar de novo não duplica: dias já importados são pulados.
 *
 * Uso:
 *   node src/scripts/importarGrupo.js --lead 79973970 --arquivo "Conversa do WhatsApp com Pós-op Ana.txt"
 *   node src/scripts/importarGrupo.js --lead 79973970 --arquivo conversa.txt --gravar
 *
 *   --lead ID          Lead do Kommo que recebe as notas (obrigatório)
 *   --arquivo CAMINHO  .txt exportado pelo WhatsApp (no iPhone vem dentro de um .zip: extraia o _chat.txt)
 *   --grupo NOME       Nome do grupo na nota (padrão: tirado do nome do arquivo)
 *   --desde DD/MM/AAAA Ignora mensagens anteriores a esta data
 *   --gravar           Grava no Kommo (sem isso, só mostra o que faria)
 */

const fs = require('fs');
const path = require('path');

const MARKER = '(histórico importado)';
const MAX_NOTE_CHARS = 8000;

// Android: 23/09/2026 14:05 - Ana: texto      iPhone: [23/09/2026, 14:05:12] Ana: texto
const LINE_RE = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}:\d{2})(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\]?(?: -)? (.+?): ([\s\S]*)$/i;
const SYSTEM_RE = /^\[?\d{1,2}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d{2}/;
const MEDIA_RE = /^<?(m[íi]dia oculta|media omitted|arquivo de m[íi]dia oculto|imagem ocultada|[áa]udio ocultado|v[íi]deo omitido)>?$/i;

const clean = (s) => s.replace(/[‎‏‪-‮﻿]/g, '');

function parseExport(text) {
  const messages = [];
  for (const raw of clean(text).split(/\r?\n/)) {
    const m = raw.match(LINE_RE);
    if (m) {
      const [, d, mo, y, time, author, body] = m;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      const date = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${year}`;
      const sortKey = `${year}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}`;
      const text = MEDIA_RE.test(body.trim()) ? '[mídia]' : body;
      messages.push({ date, sortKey, time: time.padStart(5, '0'), author: author.trim(), text });
    } else if (SYSTEM_RE.test(raw)) {
      // Mensagem do sistema ("Fulano adicionou Ciclano", "mensagens protegidas com criptografia"…)
      continue;
    } else if (messages.length && raw.trim()) {
      messages[messages.length - 1].text += `\n${raw}`;
    }
  }
  return messages;
}

/** Agrupa por dia; dias muito longos são quebrados em partes de até MAX_NOTE_CHARS. */
function buildDailyNotes(messages, groupName) {
  const byDay = new Map();
  for (const msg of messages) {
    if (!byDay.has(msg.date)) byDay.set(msg.date, { sortKey: msg.sortKey, lines: [] });
    byDay.get(msg.date).lines.push(`${msg.time} ${msg.author}: ${msg.text}`);
  }
  const notes = [];
  for (const [date, { sortKey, lines }] of [...byDay.entries()].sort((a, b) => a[1].sortKey.localeCompare(b[1].sortKey))) {
    const header = (part) => `💬 WhatsApp · grupo "${groupName}" · ${date} ${MARKER}${part ? ` · parte ${part}` : ''}`;
    const chunks = [[]];
    let size = 0;
    for (const line of lines) {
      if (size + line.length > MAX_NOTE_CHARS && chunks[chunks.length - 1].length) {
        chunks.push([]);
        size = 0;
      }
      chunks[chunks.length - 1].push(line);
      size += line.length + 1;
    }
    chunks.forEach((chunk, i) => {
      const h = header(chunks.length > 1 ? i + 1 : 0);
      notes.push({ key: h, date, sortKey, text: `${h}\n${chunk.join('\n')}`, count: chunk.length });
    });
  }
  return notes;
}

function parseArgs(argv) {
  const args = { write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--lead') args.leadId = Number(argv[++i]);
    else if (a === '--arquivo') args.file = argv[++i];
    else if (a === '--grupo') args.group = argv[++i];
    else if (a === '--desde') args.since = argv[++i];
    else if (a === '--gravar') args.write = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Opção desconhecida: ${a}`);
  }
  return args;
}

function sinceKey(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split('/');
  return `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.leadId || !args.file) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(args.help ? 0 : 1);
  }
  const group =
    args.group ||
    path.basename(args.file, path.extname(args.file)).replace(/^(Conversa do WhatsApp com|WhatsApp Chat with|_chat)\s*/i, '').trim() ||
    'Grupo';

  let messages = parseExport(fs.readFileSync(args.file, 'utf8'));
  if (args.since) messages = messages.filter((m) => m.sortKey >= sinceKey(args.since));
  if (!messages.length) throw new Error('Nenhuma mensagem reconhecida no arquivo. É o .txt do "Exportar conversa"?');
  const notes = buildDailyNotes(messages, group);

  const { getKommoClient } = require('../services/kommoClient');
  const kommo = getKommoClient();
  const lead = await kommo.getLead(args.leadId);
  const existing = await kommo.listAll(`/leads/${args.leadId}/notes`, { embeddedKey: 'notes' });
  const done = new Set(existing.map((n) => (n.params?.text || '').split('\n')[0]));
  const pending = notes.filter((n) => !done.has(n.key));

  console.log(`Lead #${lead.id} "${lead.name}" · grupo "${group}"`);
  console.log(`${messages.length} mensagens em ${new Set(notes.map((n) => n.date)).size} dias → ${notes.length} notas (${notes.length - pending.length} já importadas)`);
  for (const n of pending.slice(0, 5)) console.log(`  • ${n.date}: ${n.count} mensagens`);
  if (pending.length > 5) console.log(`  … e mais ${pending.length - 5}`);

  if (!args.write) {
    console.log('\n🧪 Simulação: nada foi gravado. Rode de novo com --gravar para importar.');
    return;
  }
  await kommo.addLeadNotesBulk(pending.map((n) => ({ leadId: args.leadId, text: n.text })), 25);
  console.log(`✅ ${pending.length} notas gravadas no lead #${args.leadId}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

module.exports = { parseExport, buildDailyNotes };
