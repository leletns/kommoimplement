'use strict';

process.env.KOMMO_PAGAMENTO_FIELD_ID = '900';
process.env.KOMMO_CONSULTA_EVENTOS_DESDE = '2026-09-10';

const test = require('node:test');
const assert = require('node:assert');
const { classificar } = require('../src/scripts/organizarConsultas');
const { buildPeriod } = require('../src/services/metricsService');

const hoje = '2026-09-23';
const inicio = '2026-01-05';
const at = (tipo, status, data) => ({ tipo, status, data });

test('consulta finalizada no AmigoClinic vai para "Consulta realizada"', () => {
  const c = classificar([at('consulta', 'Finalizado', '2026-08-10')], '2026-08-01', hoje, inicio);
  assert.strictEqual(c.alvo, 'realizada');
});

test('consulta marcada para o futuro fica em "Consulta agendada"', () => {
  const c = classificar([at('consulta', 'Agendado', '2026-10-02')], '2026-09-15', hoje, inicio);
  assert.strictEqual(c.alvo, 'agendada');
  assert.ok(!c.verificar);
});

test('cirurgia realizada continua ganho', () => {
  const c = classificar([at('consulta', 'Finalizado', '2026-03-01'), at('cirurgia', 'Finalizado', '2026-05-01')], '2026-02-01', hoje, inicio);
  assert.strictEqual(c.alvo, 'ganho');
});

test('paga antes do relatório conta como realizada; sem registro depois disso, pede confirmação', () => {
  assert.strictEqual(classificar([], '2025-06-01', hoje, inicio).alvo, 'realizada');
  const c = classificar([], '2026-07-01', hoje, inicio);
  assert.strictEqual(c.alvo, 'agendada');
  assert.ok(c.verificar);
});

test('painel conta a consulta pela "Data do pagamento", em qualquer etapa', () => {
  const unix = (iso) => Math.floor(new Date(`${iso}T12:00:00-03:00`).getTime() / 1000);
  const win = { key: 'set', ym: '2026-09', label: 'Setembro 2026', from: unix('2026-09-01') - 43200, to: unix('2026-09-30') + 43199 };
  const PIPE = 1;
  const ctx = { sortById: new Map([[10, 10], [40, 40], [50, 50]]), qualificados: null, apn: { sort: 40, ids: new Set([40]) }, cirurgia: null };
  const pago = (id, status, iso, price = 900) => ({
    id, pipeline_id: PIPE, status_id: status, price, created_at: unix('2026-08-01'),
    custom_fields_values: [{ field_id: 900, values: [{ value: unix(iso) }] }],
  });
  const todos = [
    pago(1, 50, '2026-09-05'), // realizada, paga em setembro → conta
    pago(2, 40, '2026-08-20'), // agendada, paga em agosto → não conta em setembro
    pago(3, 142, '2026-09-02'), // ganho com campo → conta uma vez só
    { id: 4, pipeline_id: PIPE, status_id: 40, price: 900, created_at: unix('2026-09-01') }, // entrou na etapa 4 depois da data de corte
    { id: 5, pipeline_id: PIPE, status_id: 40, price: 900, created_at: unix('2026-09-01') }, // entrou antes da data de corte (regra antiga das 48h)
  ];
  const won = [{ ...todos[2], closed_at: unix('2026-09-02') }, { id: 6, pipeline_id: PIPE, status_id: 142, price: 700, closed_at: unix('2026-09-03'), created_at: unix('2026-09-01') }];
  const entered = new Map([[4, [{ id: 40, at: unix('2026-09-15') }]], [5, [{ id: 40, at: unix('2026-09-05') }]]]);
  const p = buildPeriod(win, {
    created: todos.filter((l) => l.created_at >= win.from),
    won,
    todos,
    ctxByPipeline: new Map([[PIPE, ctx]]),
    entered,
    users: new Map(),
    cirurgiaLeads: [],
    teamPipelines: null,
  });
  // 1 (campo) + 3 (campo, ganho) + 4 (evento novo) + 6 (ganho sem campo) = 4
  assert.strictEqual(Number(p.num.consultas), 4);
});
