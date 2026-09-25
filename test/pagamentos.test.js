'use strict';

const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/services/pagamentos');

const GRUPO = `02/01/2025 22:18 - Comercial 1: Nome:Fernanda Teste Silva

Tel:+55 21 99505-9620

Pagamento : R$1800
Consulta presencial com o Dr.Rafael Erthal dia 21/05 às 9hrs
03/01/2025 12:17 - Comercial 1: Restante consulta : Luciana Teste
Pagamento: R$950
08/01/2025 17:51 - Comercial 1: Nome
SILVIA TESTE
CPF: 038.103.267-12
Telefone:
21 98888-7777
Consulta presencial no RJ dia 12/02 às 9hrs
Pagamento: 1/3 de R$1800 = R$600
09/01/2025 10:00 - Concierge Blue: Olá! Seja bem vindo à clínica BLUE.💙
Pagamento: R$10`;

const AMIGO = '﻿Cód. Atendimento;Agendado em;Data do Agendamento;Paciente;CPF;Telefone;E-mail;Tipo de Atendimento;Status do Agendamento;Forma de Pagamento;Valor\r\n' +
  '1;06/04/2026;14/04/2026;Fernanda Teste Silva;;(21) 99505-9620;f@x.com;1ª CONSULTA- LIPEDEMA I;Finalizado;Pix;0\r\n' +
  '2;07/04/2026;24/04/2026;Paula Pendente;;(51) 99693-0767;;1ª CONSULTA- LIPEDEMA I;Agendado;Pendente;0\r\n';

test('lê as fichas do grupo de comprovantes', () => {
  const r = P.parseComprovantes(GRUPO);
  assert.strictEqual(r.length, 3, 'mensagem automática do concierge é ignorada');
  assert.deepStrictEqual([r[0].nome, r[0].telefone, r[0].pago, r[0].total, r[0].consultaEm], ['Fernanda Teste Silva', '21995059620', 1800, 1800, '2025-05-21']);
  assert.deepStrictEqual([r[1].nome, r[1].restante, r[1].pago], ['Luciana Teste', true, 950]);
  assert.deepStrictEqual([r[2].nome, r[2].telefone, r[2].cpf, r[2].pago, r[2].total], ['SILVIA TESTE', '21988887777', '03810326712', 600, 1800]);
});

test('parsePagamento entende parcial e fração', () => {
  assert.deepStrictEqual(P.parsePagamento('R$900 de R$1800'), { pago: 900, total: 1800 });
  assert.deepStrictEqual(P.parsePagamento('1/3 de R$1800 = R$600'), { pago: 600, total: 1800 });
  assert.deepStrictEqual(P.parsePagamento('R$1.300,00'), { pago: 1300, total: 1300 });
});

test('consolida as duas fontes pelo telefone; "Pendente" não conta como paga', () => {
  const regs = [
    ...P.parseComprovantes(GRUPO).map((r) => ({ ...r, fonte: 'whatsapp' })),
    ...P.parseAmigoClinic(AMIGO).map((r) => ({ ...r, fonte: 'amigoclinic' })),
  ];
  const pac = P.consolidarPacientes(regs);
  const fer = pac.find((p) => p.nome === 'Fernanda Teste Silva');
  assert.deepStrictEqual(fer.fontes.sort(), ['amigoclinic', 'whatsapp']);
  assert.strictEqual(fer.dataGanho, '2025-01-02');
  const paula = pac.find((p) => p.nome === 'Paula Pendente');
  assert.strictEqual(paula.consultaPaga, false);
  assert.strictEqual(P.phoneKey(P.normPhone('+55 (21) 99505-9620')), P.phoneKey(P.normPhone('21 9505-9620')));
});
