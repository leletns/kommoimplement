'use strict';

const test = require('node:test');
const assert = require('node:assert');
const alice = require('../src/services/aliceEngine');

const NOW = Date.parse('2026-09-23T12:00:00Z');
const note = (text) => ({ params: { text } });

test('classify segue a régua do Manual Comercial Blue', () => {
  assert.deepStrictEqual(alice.classify(70), { temperatura: 'quente', tag: 'lead_quente', stage: 'INTERESSE_AGENDAR' });
  assert.deepStrictEqual(alice.classify(100).stage, 'INTERESSE_AGENDAR');
  assert.deepStrictEqual(alice.classify(69), { temperatura: 'morna', tag: 'lead_morna', stage: 'QUALIFICADOS' });
  assert.deepStrictEqual(alice.classify(40).temperatura, 'morna');
  assert.deepStrictEqual(alice.classify(39), { temperatura: 'fria', tag: 'lead_fria', stage: 'NOVOS' });
  assert.deepStrictEqual(alice.classify(0).stage, 'NOVOS');
});

test('lead com sintomas, diagnóstico e intenção de agendar fica quente', () => {
  const lead = { id: 1, name: 'Maria', price: 1500, updated_at: NOW / 1000 - 3600 };
  const notes = [
    note('Tenho lipedema, diagnóstico confirmado. Sinto muita dor e peso nas pernas, hematomas.'),
    note('Quero agendar a consulta com o Dr. Rafael, qual o valor?'),
    note('Penso em cirurgia'),
  ];
  const r = alice.evaluateLead({ lead, notes, now: NOW });
  assert.ok(r.score >= 70, `score ${r.score}`);
  assert.strictEqual(r.temperatura, 'quente');
  assert.deepStrictEqual(r.tags, ['lead_quente', 'handoff_maria', 'follow_up_day2', 'alice_bot_finalizado']);
  assert.match(alice.buildSummary(r), /Score \d+\/100 · QUENTE[\s\S]*Maria assume/);
});

test('lead sem sinais e parada há meses fica fria', () => {
  const lead = { id: 2, name: 'Contato Instagram', updated_at: NOW / 1000 - 400 * 86400 };
  const r = alice.evaluateLead({ lead, notes: [], now: NOW });
  assert.ok(r.score < 40);
  assert.strictEqual(r.stage, 'NOVOS');
});

test('desinteresse derruba o score', () => {
  const lead = { id: 3, name: 'X', updated_at: NOW / 1000 };
  const a = alice.calculateScore({ lead, notes: [note('quero agendar consulta')], now: NOW }).score;
  const b = alice.calculateScore({ lead, notes: [note('quero agendar consulta'), note('desisti, não tenho interesse')], now: NOW }).score;
  assert.ok(b < a);
});

test('score sempre entre 0 e 100', () => {
  const lead = { id: 4, name: 'dor peso nas pernas hematoma inchaço desproporção lipedema diagnóstico confirmado agendar cirurgia valor sublift', price: 9e9, updated_at: NOW / 1000, status_id: 142 };
  const r = alice.calculateScore({ lead, notes: Array(20).fill(note('quero agendar')), now: NOW, stages: { sortById: new Map() } });
  assert.strictEqual(r.score, 100);
  const cold = alice.calculateScore({ lead: { id: 5, name: 'número errado, desisti', updated_at: 1 }, now: NOW });
  assert.strictEqual(cold.score, 0);
});

test('mergeTags preserva tags existentes e troca a temperatura', () => {
  const tags = alice.mergeTags([{ name: 'Lipedema' }, { name: 'lead_fria' }, { name: 'follow_up_day2' }], 'lead_quente');
  assert.deepStrictEqual(tags, ['Lipedema', 'follow_up_day2', 'lead_quente', 'handoff_maria', 'alice_bot_finalizado']);
  // quente → morna tira o handoff
  assert.deepStrictEqual(alice.mergeTags(tags, 'lead_morna'), ['Lipedema', 'follow_up_day2', 'alice_bot_finalizado', 'lead_morna']);
});

test('19 objeções com os 5 passos completos', () => {
  assert.strictEqual(alice.OBJECTIONS.length, 19);
  const ids = new Set();
  for (const o of alice.OBJECTIONS) {
    assert.ok(!ids.has(o.id), `id duplicado ${o.id}`);
    ids.add(o.id);
    for (const passo of ['acolher', 'investigar', 'compreender', 'reposicionar', 'conduzir']) {
      assert.ok(o.passos[passo] && o.passos[passo].length > 10, `${o.id}.${passo}`);
    }
  }
});

test('detecta objeções no texto', () => {
  const found = alice.detectObjections('Achei a consulta cara e tenho medo de cirurgia. Aceita convênio? Moro em outra cidade.').map((o) => o.id);
  for (const id of ['valor_consulta', 'medo_cirurgia', 'plano_saude', 'distancia']) assert.ok(found.includes(id), id);
});

test('nota da Alice traz score, tags e roteiro das objeções', () => {
  const r = alice.evaluateLead({ lead: { id: 9, name: 'Ana' }, notes: [note('tenho medo de cirurgia')], now: NOW });
  const text = alice.buildNote(r);
  assert.match(text, /Score: \d+\/100/);
  assert.match(text, /follow_up_day2/);
  assert.match(text, /1\. Acolher:/);
  assert.match(text, /5\. Conduzir:/);
});

test('respostas das objeções não prometem resultado', () => {
  const forbidden = /garant(o|imos|ido)|cura |100%|milagre|com certeza|voce precisa operar/;
  for (const o of alice.OBJECTIONS) {
    for (const t of Object.values(o.passos)) {
      const n = alice.normalize(t);
      assert.ok(!forbidden.test(n.replace('sem garantia', '')), `${o.id}: ${t}`);
    }
  }
});
