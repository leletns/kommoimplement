'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { avaliarPagamento } = require('../ferramentas/cadastro-amigo/pagamento-consulta');

const T0 = 1790000000;
const eq = (dt, texto, tipo = 'text') => ({ t: 90, ts: T0 + dt, tipo, texto });
const pa = (dt, texto, tipo = 'text') => ({ t: 89, ts: T0 + dt, tipo, texto });
const OFERTA = eq(0, 'Você pode optar pelo *pagamento integral de R$ 1.800,00*, garantindo totalmente o seu horário, ou realizar *R$ 900,00 para a reserva*.');
const PIX = eq(120, 'Chave Pix: 00.000.000/0001-00');

test('nota do grupo de pagamentos manda: integral ou falta, com o valor', () => {
  let r = avaliarPagamento({ notas: [{ ts: T0, text: '💳 Comprovantes: pago R$ 1.800 (pix).' }] });
  assert.deepStrictEqual([r.status, r.falta], ['integral', 0]);
  r = avaliarPagamento({ notas: [{ ts: T0, text: '💳 Comprovantes: pago R$ 1.100 de R$ 2.200 · falta R$ 1.100 (cartão).' }] });
  assert.deepStrictEqual([r.status, r.pago, r.falta], ['falta', 1100, 1100]);
});

test('pela conversa: escolheu a reserva e mandou 1 comprovante → falta a segunda parte', () => {
  const r = avaliarPagamento({ msgs: [OFERTA, pa(60, 'Vou pagar a reserva'), PIX, pa(600, '', 'picture'), eq(700, 'Obrigada por me enviar o comprovante')] });
  assert.deepStrictEqual([r.status, r.falta], ['falta', 900]);
});

test('fotos do corpo depois do pedido da segunda parte não contam como pagamento', () => {
  const fotos = [1, 2, 3, 4].map((i) => pa(90000 + i, '', 'picture'));
  const r = avaliarPagamento({ msgs: [OFERTA, pa(60, 'metade'), PIX, pa(600, '', 'picture'),
    eq(86400, 'Podemos aproveitar e concluir a segunda parte do seu pagamento? Nesse doc você pode conferir como deve ser tirado as fotos.'), ...fotos] });
  assert.notStrictEqual(r.status, 'integral');
});

test('comprovante novo depois da nota que dizia "falta" → conferir', () => {
  const r = avaliarPagamento({
    notas: [{ ts: T0 + 1000, text: '💳 Comprovantes: pago R$ 900 de R$ 1.800 · falta R$ 900 (pix).' }],
    msgs: [OFERTA, PIX, eq(86400, 'Podemos aproveitar e já concluir a segunda parte do seu pagamento?'), pa(87000, 'segue o comprovante')],
  });
  assert.strictEqual(r.status, 'conferir');
});

test('sem nota, sem valor no lead e sem comprovante → sem pagamento', () => {
  assert.strictEqual(avaliarPagamento({ msgs: [OFERTA] }).status, 'sem_pagamento');
});

test('valor seguido de vírgula ou ponto final é lido certo', () => {
  const r = avaliarPagamento({ msgs: [eq(0, 'Puedes optar por el pago integral de R$ 1.800,00, o R$ 900,00 de reserva.'), pa(60, 'la reserva'), eq(120, 'https://www.userede.com.br/pagamentos/pt/x'), pa(3600, 'blob:https://www.userede.com.br/y', 'file')] });
  assert.deepStrictEqual([r.status, r.total, r.falta], ['falta', 1800, 900]);
});

test('consulta em SP: total R$ 2.200 e segunda parte R$ 1.100, mesmo se a conversa citar R$ 1.800 do Rio', () => {
  const msgs = [eq(0, 'O valor do investimento na consulta é de R$ 1.800,00.'), eq(50, 'O valor do investimento da consulta em São Paulo é R$ 2.200,00'),
    eq(60, 'Você pode optar pelo *pagamento integral de R$ 1.800,00*, ou realizar R$ 900,00 para a reserva'), pa(70, 'a reserva'), PIX, pa(600, '', 'picture')];
  const sp = avaliarPagamento({ msgs, local: 'sp' });
  assert.deepStrictEqual([sp.total, sp.falta], [2200, 1100]);
  const rj = avaliarPagamento({ msgs, local: 'rj' });
  assert.deepStrictEqual([rj.total, rj.falta], [1800, 900]);
});

test('nota do grupo vale mais que a tabela: SP com 1.100 de 2.200', () => {
  const r = avaliarPagamento({ local: 'sp', notas: [{ ts: T0, text: '💳 Comprovantes: pago R$ 1.100 de R$ 2.200 · falta R$ 1.100 (pix).' }] });
  assert.deepStrictEqual([r.status, r.falta], ['falta', 1100]);
});
