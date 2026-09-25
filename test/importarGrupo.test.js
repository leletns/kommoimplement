'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseExport, buildDailyNotes } = require('../src/scripts/importarGrupo');

const ANDROID = `12/09/2026 09:00 - As mensagens e as chamadas são protegidas com a criptografia de ponta a ponta.
12/09/2026 09:01 - Maria criou o grupo "Pós-op Ana"
12/09/2026 09:02 - Maria: Bom dia, Ana! Seja bem-vinda ao grupo do seu pós-operatório 💙
12/09/2026 09:05 - Ana: Bom dia! Obrigada
continuação na linha de baixo
12/09/2026 09:06 - Ana: <Mídia oculta>
13/09/2026 18:30 - Ana: Hoje: dor leve, tudo bem`;

const IOS = `[12/09/2026, 09:02:10] Maria: Bom dia, Ana!
[12/09/2026, 09:05:44] ‎Ana: ‎imagem ocultada
[13/09/26, 18:30:00] Ana: Tudo certo`;

test('lê exportação do Android (sistema ignorado, multilinha, mídia)', () => {
  const msgs = parseExport(ANDROID);
  assert.strictEqual(msgs.length, 4);
  assert.deepStrictEqual(msgs[0], { date: '12/09/2026', sortKey: '20260912', time: '09:02', author: 'Maria', text: 'Bom dia, Ana! Seja bem-vinda ao grupo do seu pós-operatório 💙' });
  assert.strictEqual(msgs[1].text, 'Bom dia! Obrigada\ncontinuação na linha de baixo');
  assert.strictEqual(msgs[2].text, '[mídia]');
  assert.strictEqual(msgs[3].text, 'Hoje: dor leve, tudo bem');
});

test('lê exportação do iPhone (colchetes, segundos, ano com 2 dígitos)', () => {
  const msgs = parseExport(IOS);
  assert.strictEqual(msgs.length, 3);
  assert.strictEqual(msgs[1].author, 'Ana');
  assert.strictEqual(msgs[1].text, '[mídia]');
  assert.strictEqual(msgs[2].date, '13/09/2026');
});

test('uma nota por dia, em ordem, com marcador para não duplicar', () => {
  const notes = buildDailyNotes(parseExport(ANDROID), 'Pós-op Ana');
  assert.strictEqual(notes.length, 2);
  assert.strictEqual(notes[0].key, '💬 WhatsApp · grupo "Pós-op Ana" · 12/09/2026 (histórico importado)');
  assert.match(notes[0].text, /09:02 Maria: Bom dia/);
  assert.strictEqual(notes[1].date, '13/09/2026');
});

test('dia muito longo é quebrado em partes', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `14/09/2026 10:${String(i % 60).padStart(2, '0')} - Ana: ${'x'.repeat(50)}`).join('\n');
  const notes = buildDailyNotes(parseExport(lines), 'G');
  assert.ok(notes.length > 1);
  assert.match(notes[1].key, /parte 2$/);
  for (const n of notes) assert.ok(n.text.length < 8300);
});
