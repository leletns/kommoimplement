'use strict';

process.env.KOMMO_PAGAMENTO_FIELD_ID = '900';

const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/services/pagamentos');
const { cicloDe, planejarLead } = require('../src/scripts/preencherPagamentos');

const hoje = '2026-09-30';
const ficha = (data, pago, total, extra = {}) => ({ fonte: 'whatsapp', tipo: 'consulta', data, pago, total, restante: false, ...extra });
const paciente = (fichas) => ({ nome: 'Teste Paciente', telefones: [], fichas });
const semAmigo = new Map();
const lead = (price, pagamentoUnix) => ({ id: 1, price, custom_fields_values: pagamentoUnix ? [{ field_id: 900, values: [{ value: pagamentoUnix }] }] : [] });

test('lê "Dia 02 de outubro às 09h00" da ficha', () => {
  assert.strictEqual(P.consultaData('Consulta 1x\nDia 02 de outubro às 09h00', '21/09/2026'), '2026-10-02');
  assert.strictEqual(P.consultaHora('Dia 02 de outubro às 09h00'), '09:00');
  assert.strictEqual(P.consultaHora('dia 26/06 às 19hrs'), '19:00');
});

test('consulta futura com 50% pago: valor = o que foi pago, com o que falta', () => {
  const c = cicloDe(lead(2200), paciente([ficha('2026-09-21', 1100, 2200, { consultaEm: '2026-10-02', consultaHora: '09:00' })]), semAmigo, hoje);
  assert.deepStrictEqual([c.pago, c.total, c.falta], [1100, 2200, 1100]);
  assert.strictEqual(planejarLead(lead(2200), c).patch.price, 1100);
});

test('restante sem valor no grupo quita a ficha anterior', () => {
  const c = cicloDe(lead(0), paciente([ficha('2026-09-01', 900, 1800), ficha('2026-09-10', null, null, { restante: true })]), semAmigo, hoje);
  assert.deepStrictEqual([c.pago, c.falta], [1800, 0]);
});

test('vendas de anos diferentes não se somam: usa a mais próxima do pagamento do lead', () => {
  const p = paciente([ficha('2025-01-07', 450, 900), ficha('2026-04-30', 900, 900)]);
  const c = cicloDe(lead(900, Date.UTC(2026, 3, 30, 15) / 1000), p, semAmigo, hoje);
  assert.strictEqual(c.venda.data, '2026-04-30');
  assert.strictEqual(c.pago, 900);
});

test('consulta que já aconteceu está quitada e nunca baixa o valor do lead', () => {
  const c = cicloDe(lead(1800), paciente([ficha('2025-08-29', 900, 1800, { consultaEm: '2025-09-25' })]), semAmigo, hoje);
  assert.strictEqual(c.falta, 0);
  assert.strictEqual(planejarLead(lead(1800), c).patch.price, undefined);
});
