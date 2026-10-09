'use strict';

const test = require('node:test');
const assert = require('node:assert');
const G = require('../ficha/js/grupo-comprovantes.js');

const linhas = (msgs) => G.parseComprovantes(G.textoDoWhatsAppWeb(msgs)).map((r, i) => ({ ...r, chave: 'k' + i }));

test('WhatsApp Web: cabeçalho em português e em inglês (mês/dia, AM/PM) viram a mesma data', () => {
  const t = G.textoDoWhatsAppWeb([
    { cab: '[14:08, 11/09/2026] Maria: ', texto: 'Ana Paula Souza\nPagamento: R$ 900,00 de R$ 1.800,00' },
    { cab: '[2:08 PM, 9/24/2026] Maria: ', texto: 'Bia Lima Costa\nPagamento: R$ 900 de R$ 1800' },
  ]);
  const r = G.parseComprovantes(t);
  assert.deepStrictEqual(r.map((x) => [x.data, x.hora, x.pago, x.total]), [['2026-09-11', '14:08', 900, 1800], ['2026-09-24', '14:08', 900, 1800]]);
});

test('lê a data e a hora da consulta no formato do botão Agendamento (🗓️)', () => {
  const [r] = linhas([{ cab: '[09:00, 01/10/2026] Maria Gabriela: ', texto: 'Juliana Costa Mendes\nTel: 21 98888-7777\n🗓️ quinta-feira, 08/10/2026 às 14h00\nPagamento: R$ 900,00 de R$ 1.800,00' }]);
  assert.strictEqual(r.consultaEm, '2026-10-08');
  assert.strictEqual(r.consultaHora, '14:00');
  assert.strictEqual(r.telefone, '21988887777');
});

test('planilha: soma a mesma paciente, calcula o restante sem valor e marca o que falta', () => {
  const regs = linhas([
    { cab: '[14:08, 11/09/2026] Maria: ', texto: 'Luciana Tarbes Mattana Saturnino\nTel: 21 99196-1450\nDia 14/09 às 17h20\nPagamento: R$ 900,00 de R$ 1.800,00' },
    { cab: '[17:04, 15/09/2026] Maria: ', texto: 'Restante pagamento: Luciana Tarbes Mattana Saturnino' },
    { cab: '[09:00, 08/08/2026] Maria: ', texto: 'Cinthia Nunes Siqueira Amorim\nTel: (47) 99235-3315\nPagamento: R$ 900 de R$ 1800' },
    { cab: '[09:47, 10/09/2026] Helen: ', texto: 'Pagamento 2/2 Cinthia Nunes' },
    { cab: '[10:00, 11/09/2026] Helen: ', texto: 'Segue pagamento da paciente Fulana Sem Valor - Consulta' },
  ]);
  const P = G.planilhaPorPaciente(regs);
  const luciana = P.find((p) => /Luciana/.test(p.nome));
  assert.deepStrictEqual([luciana.total, luciana.pago, luciana.falta, luciana.faltando], [1800, 1800, 0, []]);
  assert.strictEqual(luciana.linhas[1].calculado, true);
  const cinthia = P.find((p) => /Cinthia/.test(p.nome));
  assert.strictEqual(cinthia.linhas.length, 2, 'nome curto junta com o completo');
  assert.ok(cinthia.faltando.includes('consultaEm'));
  const fulana = P.find((p) => /Fulana/.test(p.nome));
  assert.deepStrictEqual(fulana.faltando.sort(), ['consultaEm', 'telefone', 'total', 'valor']);
});

test('planilha: correção feita à mão vale e linha ignorada some', () => {
  const regs = linhas([{ cab: '[10:00, 11/09/2026] Helen: ', texto: 'Segue pagamento da paciente Fulana Sem Valor - Consulta' }]);
  regs[0].ajustes = { pago: 500, total: 1800, telefone: '21999990000' };
  const [p] = G.planilhaPorPaciente(regs);
  assert.deepStrictEqual([p.pago, p.falta, p.telefone], [500, 1300, '21999990000']);
  assert.strictEqual(G.planilhaPorPaciente([{ ...regs[0], ignorado: true }]).length, 0);
});
