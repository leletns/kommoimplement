'use strict';

process.env.KOMMO_METRICS_PIPELINES = '{"1":{"name":"Maria","role":"Comercial 1"}}';

const test = require('node:test');
const assert = require('node:assert');
const { executarAutomacao, TAG_PENDENTE } = require('../src/services/automacaoMaria');

const NOW = 1_800_000_000;
const H = 3600;
const D = 86400;
const ST = { novo: 10, qual: 20, int: 30, ret: 31, fu1: 32, fu2: 33, fu3: 34, ag: 40 };
const statuses = [
  [ST.novo, '1. Novo · boas-vindas'],
  [ST.qual, '2. Qualificado'],
  [ST.int, '3. Interesse em agendar · Maria'],
  [ST.ret, '3.1 Retomar depois · Maria'],
  [ST.fu1, '3.2 Follow-up 1 · dia 1'],
  [ST.fu2, '3.3 Follow-up 2 · dia 3'],
  [ST.fu3, '3.4 Follow-up 3 · dia 7'],
  [ST.ag, '4. Consulta agendada'],
  [142, 'ganho'],
  [143, 'perdido'],
].map(([id, name], i) => ({ id, name, sort: (i + 1) * 10 }));

function fakeKommo({ leads, chat = [], mudancas = [], tarefas = [] }) {
  const gravado = { leads: [], tarefas: [], concluidas: [], notas: [] };
  return {
    gravado,
    getPipelines: async () => [{ id: 1, name: 'Comercial 1', _embedded: { statuses } }],
    listAll: async (url, { params }) => {
      if (url === '/leads') return leads;
      if (url === '/tasks') return tarefas;
      if (url === '/events') return params['filter[type]'] === 'lead_status_changed' ? mudancas : chat;
      return [];
    },
    request: async (method, url, { data }) => {
      if (url === '/tasks' && method === 'post') gravado.tarefas.push(...data);
      if (url === '/tasks' && method === 'patch') gravado.concluidas.push(...data);
    },
    updateLeads: async (p) => gravado.leads.push(...p),
    addLeadNotesBulk: async (n) => gravado.notas.push(...n),
  };
}
const lead = (id, status, extra = {}) => ({ id, pipeline_id: 1, status_id: status, responsible_user_id: 7, updated_at: NOW - 10 * D, _embedded: { tags: [] }, ...extra });
const msg = (leadId, entrada, at) => ({ entity_type: 'lead', entity_id: leadId, type: entrada ? 'incoming_chat_message' : 'outgoing_chat_message', created_at: at });
const entrou = (leadId, status, at) => ({ entity_id: leadId, created_at: at, value_after: [{ lead_status: { id: status } }] });
const rodar = (k) => executarAutomacao(k, { apply: true, now: NOW, log: () => {}, ia: null });

test('última mensagem da paciente → tag aguardando_resposta + tarefa (sem duplicar)', async () => {
  const k = fakeKommo({
    leads: [lead(1, ST.novo), lead(2, ST.qual)],
    chat: [msg(1, false, NOW - 2 * H), msg(1, true, NOW - H), msg(2, true, NOW - H)],
    tarefas: [{ id: 99, entity_id: 2, text: 'Responder paciente (mensagem sem resposta desde 10:00)' }],
  });
  const r = await rodar(k);
  assert.strictEqual(r.pendentes, 2);
  assert.deepStrictEqual(k.gravado.tarefas.map((t) => t.entity_id), [1]);
  assert.ok(k.gravado.leads.every((p) => p._embedded.tags.some((t) => t.name === TAG_PENDENTE)));
});

test('equipe respondeu → tira a tag e conclui a tarefa', async () => {
  const k = fakeKommo({
    leads: [lead(1, ST.int, { _embedded: { tags: [{ name: TAG_PENDENTE }] } })],
    chat: [msg(1, true, NOW - 3 * H), msg(1, false, NOW - H)],
    tarefas: [{ id: 50, entity_id: 1, text: 'Responder paciente (x)' }],
  });
  await rodar(k);
  assert.deepStrictEqual(k.gravado.leads[0]._embedded.tags, []);
  assert.strictEqual(k.gravado.concluidas[0].id, 50);
});

test('paciente respondeu no follow-up → volta para a Maria com a resposta sugerida', async () => {
  const k = fakeKommo({ leads: [lead(1, ST.fu2)], chat: [msg(1, false, NOW - 2 * D), msg(1, true, NOW - H)] });
  await rodar(k);
  assert.strictEqual(k.gravado.leads[0].status_id, ST.int);
  assert.match(k.gravado.notas[0].text, /Nem toda paciente precisa operar/);
});

test('régua: parado 1 dia → FU1; FU1 há 2 dias → FU2; FU3 há 5 dias → Retomar depois', async () => {
  const k = fakeKommo({
    leads: [lead(1, ST.int), lead(2, ST.fu1), lead(3, ST.fu3), lead(4, ST.qual), lead(5, ST.int)],
    chat: [msg(1, false, NOW - 26 * H), msg(2, false, NOW - 3 * D), msg(3, false, NOW - 6 * D), msg(4, false, NOW - 5 * H), msg(5, false, NOW - 20 * D)],
    mudancas: [entrou(2, ST.fu1, NOW - 2 * D - H), entrou(3, ST.fu3, NOW - 5 * D - H)],
  });
  await rodar(k);
  const para = Object.fromEntries(k.gravado.leads.filter((p) => p.status_id).map((p) => [p.id, p.status_id]));
  assert.deepStrictEqual(para, { 1: ST.fu1, 2: ST.fu2, 3: ST.ret }); // 4: parado há pouco; 5: conversa antiga
});

test('Retomar depois: sem data → +30 dias; data chegou → volta para a Maria com tarefa e sugestão', async () => {
  const comData = (v) => ({ custom_fields_values: [{ field_id: 3839458, values: [{ value: v }] }] });
  const k = fakeKommo({ leads: [lead(1, ST.ret), lead(2, ST.ret, comData(NOW - H)), lead(3, ST.ret, comData(NOW + D))] });
  await rodar(k);
  const p = Object.fromEntries(k.gravado.leads.map((x) => [x.id, x]));
  assert.strictEqual(p[1].custom_fields_values[0].values[0].value, NOW + 30 * D);
  assert.strictEqual(p[2].status_id, ST.int);
  assert.ok(!p[3]);
  assert.strictEqual(k.gravado.tarefas[0].text, 'Retomar contato hoje');
  assert.match(k.gravado.notas[0].text, /Mensagem sugerida/);
});

test('opt_out não entra na régua', async () => {
  const k = fakeKommo({ leads: [lead(1, ST.int, { _embedded: { tags: [{ name: 'opt_out' }] } })], chat: [msg(1, false, NOW - 26 * H)] });
  await rodar(k);
  assert.strictEqual(k.gravado.leads.length, 0);
});
