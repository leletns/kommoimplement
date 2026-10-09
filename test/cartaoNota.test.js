'use strict';
// Leitura de comprovante de cartão (maquininha) e de nota fiscal. Textos fictícios, no formato que o OCR devolve.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../ficha/js/comprovante.js');

const STONE = `STONE
VIA CLIENTE
CLINICA BLUE LTDA
CNPJ 12.345.678/0001-90
VISA CREDITO
************4321
PARCELADO LOJA 3X
VALOR: R$ 1.800,00
3 X R$ 600,00
06/10/2026 14:22
NSU: 004512
AUT: A1B2C3
TRANSACAO AUTORIZADA MEDIANTE USO DE SENHA`;

const CIELO_DEB = `cielo
COMPROVANTE DE VENDA
MASTERCARD DEBITO
**** **** **** 9876
ESTABELECIMENTO: CLINICA BLUE
05/10/26 09:10
DOC: 123456   AUT: 778899
VALOR APROVADO R$ 450,00`;

const NFSE = `PREFEITURA DA CIDADE DO RIO DE JANEIRO
NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e
Número da Nota: 2871
Data e Hora de Emissão: 06/10/2026 10:15:30
PRESTADOR DE SERVIÇOS
Razão Social: CLINICA BLUE LTDA
CNPJ: 12.345.678/0001-90
TOMADOR DE SERVIÇOS
Nome/Razão Social: Fernanda Alves Rocha
CPF/CNPJ: 529.982.247-25
DISCRIMINAÇÃO DOS SERVIÇOS
Consulta médica - lipedema
VALOR TOTAL DA NOTA = R$ 1.800,00
Base de Cálculo (R$) 1.800,00
Alíquota (%) 2,00
Valor do ISS (R$) 36,00`;

test('maquininha (Stone, crédito parcelado): bandeira, final, NSU, autorização, parcelas', () => {
  const d = C.lerComprovante(STONE);
  assert.strictEqual(d.tipoDocumento, 'Cartão');
  assert.strictEqual(d.forma, 'Cartão de crédito');
  assert.strictEqual(d.bandeira, 'Visa');
  assert.strictEqual(d.cartaoFinal, '4321');
  assert.strictEqual(d.nsu, '004512');
  assert.strictEqual(d.autorizacao, 'A1B2C3');
  assert.strictEqual(d.parcelas, 3);
  assert.strictEqual(d.adquirente, 'Stone');
  assert.strictEqual(d.valor, 1800);
  assert.strictEqual(d.data, '06/10/2026');
  assert.strictEqual(d.idTransacao, 'NSU 004512 · 06/10/2026');
  assert.deepStrictEqual(d.faltando, []);
});

test('maquininha (Cielo, débito): Mastercard, débito, 1 parcela, DOC como NSU', () => {
  const d = C.lerComprovante(CIELO_DEB);
  assert.strictEqual(d.forma, 'Cartão de débito');
  assert.strictEqual(d.bandeira, 'Mastercard');
  assert.strictEqual(d.cartaoFinal, '9876');
  assert.strictEqual(d.nsu, '123456');
  assert.strictEqual(d.autorizacao, '778899');
  assert.strictEqual(d.parcelas, 1);
  assert.strictEqual(d.valor, 450);
  assert.strictEqual(d.data, '05/10/2026');
});

test('nota fiscal (NFS-e): número, tomador e CPF, prestador, valor total (sem ISS) e emissão', () => {
  const d = C.lerComprovante(NFSE);
  assert.strictEqual(d.tipoDocumento, 'Nota fiscal');
  assert.strictEqual(d.numeroNota, '2871');
  assert.strictEqual(d.pagador, 'Fernanda Alves Rocha');
  assert.strictEqual(d.pagadorDoc, '529.982.247-25');
  assert.match(d.recebedor, /CLINICA BLUE/i);
  assert.strictEqual(d.valor, 1800);
  assert.strictEqual(d.data, '06/10/2026');
  assert.strictEqual(d.idTransacao, 'NF 2871');
  const v = C.validar({ ...d, forma: '' }, { nome: 'Fernanda Alves Rocha', cpf: '52998224725' }, { hoje: new Date('2026-10-06T12:00:00') });
  assert.strictEqual(v.status, 'confirmada', JSON.stringify(v.divergencias));
});

test('comprovante Pix continua sendo Pix (não vira cartão)', () => {
  const d = C.lerComprovante('Comprovante de transferência\nPix enviado\nValor R$ 900,00\n05/10/2026 10:00\nDe\nMaria Souza Lima\nPara\nClinica Blue\nID da transação: E18236120202610051000ABCDEFGHIJK');
  assert.strictEqual(d.tipoDocumento, 'Comprovante Pix');
  assert.strictEqual(d.forma, 'PIX');
  assert.ok(!d.bandeira);
});
