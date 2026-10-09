'use strict';
// Leitor de comprovantes (texto → dados) e validação contra a paciente — ficha/js/comprovante.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../ficha/js/comprovante.js');

const NUBANK = `Comprovante de transferência
05 OUT 2026 - 14:32:10
Valor R$ 1.800,00
Tipo de transferência Pix
Destino
Nome CLINICA BLUE SERVICOS MEDICOS LTDA
CNPJ 12.345.678/0001-90
Instituição ITAÚ UNIBANCO S.A.
Origem
Nome Maria da Silva Santos
Instituição NU PAGAMENTOS - IP
CPF •••.456.789-••
ID da transação:
E18236120202610051732s0a1B2c3D4e`;

const ITAU = `Pix enviado
valor: R$ 2.200,00
data da transferência: 03/10/2026
horário: 09:15
pagador
nome: CARLOS EDUARDO PEREIRA
CPF: ***.321.654-**
instituição: Itaú Unibanco S.A.
recebedor
nome: Clinica Blue Servicos Medicos
ID da transação: E60701190202610030915DY5k8h3n2Qa`;

const CARTAO = `Comprovante de pagamento
Cartão de crédito VISA final 1234
Aprovado em 3x
Valor total R$ 1.800,00
Data: 02/10/2026 16:39
NSU: 778899
Pago por: Talita do Paço Lima`;

test('Nubank (Pix): valor, data, hora, forma, banco, pagador, recebedor, ID E2E', () => {
  const d = C.lerComprovante(NUBANK);
  assert.strictEqual(d.valor, 1800);
  assert.strictEqual(d.data, '05/10/2026');
  assert.strictEqual(d.hora, '14:32');
  assert.strictEqual(d.forma, 'PIX');
  assert.strictEqual(d.banco, 'Nubank');
  assert.strictEqual(d.pagador, 'Maria da Silva Santos');
  assert.match(d.recebedor, /CLINICA BLUE/);
  assert.strictEqual(d.idTransacao, 'E18236120202610051732S0A1B2C3D4E');
  assert.deepStrictEqual(d.faltando, []);
});

test('Itaú (Pix) com rótulos em minúsculas e ID com espaços do OCR', () => {
  const d = C.lerComprovante(ITAU.replace('E60701190202610030915DY5k8h3n2Qa', 'E6070 1190 2026 1003 0915 DY5k8h3n2Qa'));
  assert.strictEqual(d.valor, 2200);
  assert.strictEqual(d.data, '03/10/2026');
  assert.strictEqual(d.pagador, 'CARLOS EDUARDO PEREIRA');
  assert.strictEqual(d.banco, 'Itaú');
  assert.strictEqual(d.idTransacao, 'E60701190202610030915DY5K8H3N2QA');
});

test('Cartão de crédito: forma, NSU como identificador, pagador em "Pago por"', () => {
  const d = C.lerComprovante(CARTAO);
  assert.strictEqual(d.forma, 'Cartão de crédito');
  assert.strictEqual(d.valor, 1800);
  assert.strictEqual(d.data, '02/10/2026');
  assert.strictEqual(d.idTransacao, 'NSU 778899 · 02/10/2026');
  assert.strictEqual(d.nsu, '778899');
  assert.strictEqual(d.bandeira, 'Visa');
  assert.strictEqual(d.cartaoFinal, '1234');
  assert.strictEqual(d.parcelas, 3);
  assert.strictEqual(d.pagador, 'Talita do Paço Lima');
});

test('Texto ilegível: não inventa nada e lista o que falta', () => {
  const d = C.lerComprovante('foto borrada\n@@@ ###');
  assert.strictEqual(d.valor, null);
  assert.deepStrictEqual(d.faltando, ['valor', 'data', 'forma', 'pagador']);
  assert.ok(d.confianca < 0.2);
});

test('Validação: paciente igual ao pagador e CPF parcial confere → confirmada', () => {
  const c = C.lerComprovante(NUBANK);
  const v = C.validar(c, { nome: 'Maria da Silva Santos', cpf: '123.456.789-09' }, { hoje: new Date('2026-10-05T18:00:00-03:00') });
  assert.strictEqual(v.status, 'confirmada');
  assert.deepStrictEqual(v.divergencias, []);
});

test('Validação: pagador diferente (marido) → divergência explicada, nunca confirmada sozinha', () => {
  const c = C.lerComprovante(ITAU);
  const v = C.validar(c, { nome: 'Ana Paula Pereira', cpf: '555.111.222-33' }, { hoje: new Date('2026-10-05T12:00:00-03:00') });
  assert.strictEqual(v.status, 'divergencia');
  assert.ok(v.divergencias.some((d) => /CPF do pagador/.test(d)));
});

test('Validação: valor esperado diferente e data no futuro aparecem como divergência', () => {
  const c = { ...C.lerComprovante(NUBANK), data: '20/12/2026' };
  const v = C.validar(c, { nome: 'Maria da Silva Santos' }, { hoje: new Date('2026-10-05T12:00:00-03:00'), esperado: { valor: 900 } });
  assert.strictEqual(v.status, 'divergencia');
  assert.ok(v.divergencias.some((d) => /diferente do esperado/.test(d)));
  assert.ok(v.divergencias.some((d) => /no futuro/.test(d)));
});

test('Validação: sem paciente → PACIENTE NÃO IDENTIFICADO', () => {
  const v = C.validar(C.lerComprovante(NUBANK), null);
  assert.strictEqual(v.status, 'nao_identificado');
});

test('Nomes: abreviação conta como forte; só o primeiro nome igual é fraco', () => {
  assert.strictEqual(C.compararNomes('Maria S. Santos', 'Maria da Silva Santos').nivel, 'forte');
  assert.strictEqual(C.compararNomes('Maria Oliveira', 'Maria da Silva Santos').nivel, 'fraca');
  assert.strictEqual(C.compararNomes('Carlos Pereira', 'Ana Paula Pereira').nivel, 'diferente');
});

// ---------- mensagem enviada junto com o comprovante ----------
test('Mensagem do grupo (formato do botão Agendamento): paciente, telefone, procedimento, data e pagamento parcial', () => {
  const m = C.lerMensagem('Ana Paula Pereira\nTel: (11) 98888-7777\nObjetivo: lipedema\nTeleconsulta com o Dr. Leonardo - Lipedema 1x\nDia 12 de novembro às 15h30\nPagamento: R$ 900,00 de R$ 1.800,00\nDados recebidos ✅');
  assert.strictEqual(m.nome, 'Ana Paula Pereira');
  assert.strictEqual(m.telefone, '11988887777');
  assert.strictEqual(m.procedimento, 'Teleconsulta com o Dr. Leonardo - Lipedema 1x');
  assert.strictEqual(m.consultaEm, '12/11 15:30');
  assert.deepStrictEqual([m.pago, m.total, m.falta, m.parcela, m.local, m.medico], [900, 1800, 900, 'reserva', 'tele', 'Dr. Leonardo']);
});

test('Mensagem curta "Segue pagamento da paciente … - procedimento" com observação de desconto', () => {
  const m = C.lerMensagem('Segue pagamento da paciente Juliana Paranhos - Botox e preenchedor.\nObs: Desconto de 30% de familiar e amigo');
  assert.strictEqual(m.nome, 'Juliana Paranhos');
  assert.strictEqual(m.procedimento, 'Botox e preenchedor');
  assert.strictEqual(m.obs, 'Desconto de 30% de familiar e amigo');
  assert.strictEqual(m.desconto, 30);
  assert.strictEqual(m.pago, undefined);
});

test('Mensagem de segunda parte ("Pagamento 2/2 | Nome") e conversa solta não vira paciente', () => {
  assert.deepStrictEqual([C.lerMensagem('Pagamento 2/2 | Marcela Lisboa Dias').nome, C.lerMensagem('Pagamento 2/2 | Marcela Lisboa Dias').parcela], ['Marcela Lisboa Dias', 'restante']);
  assert.strictEqual(C.lerMensagem('ok obrigada').nome, undefined);
});

test('Validação com mensagem: familiar pagou, mas a mensagem confirma a paciente → confirmada com aviso', () => {
  const c = { ...C.lerComprovante(ITAU), mensagem: C.lerMensagem('Ana Paula Pereira\nPagamento: R$ 2.200,00 (integral)') };
  const v = C.validar(c, { nome: 'Ana Paula Pereira' }, { hoje: new Date('2026-10-05T12:00:00-03:00') });
  assert.strictEqual(v.status, 'confirmada');
  assert.ok(v.avisos.some((a) => /CARLOS EDUARDO PEREIRA/.test(a)));
});

test('Validação com mensagem: paciente da mensagem ≠ paciente escolhida e valor da mensagem ≠ comprovante → divergências', () => {
  const c = { ...C.lerComprovante(NUBANK), mensagem: C.lerMensagem('Juliana Costa Mendes\nPagamento: R$ 900,00 de R$ 1.800,00') };
  const v = C.validar(c, { nome: 'Maria da Silva Santos' }, { hoje: new Date('2026-10-05T18:00:00-03:00') });
  assert.strictEqual(v.status, 'divergencia');
  assert.ok(v.divergencias.some((d) => /mensagem enviada com o comprovante fala de "Juliana Costa Mendes"/.test(d)));
  assert.ok(v.divergencias.some((d) => /mensagem diz que foi pago R\$ 900,00/.test(d)));
});

// ---------- o que foi pago (catálogo) ----------
test('Catálogo: entende o que foi pago em qualquer formato de mensagem', () => {
  const casos = [
    ['Segue pagamento da paciente Juliana Paranhos - Botox e preenchedor.', 'Estética', 'Botox, Preenchimento'],
    ['Segue pagamento da paciente Carla Souza - ferro + vitamina D (soroterapia)', 'Soroterapia', 'Ferro, Vitamina D'],
    ['Fabiana Lima\nSinal de 50% da cirurgia', 'Cirurgia', 'Sinal da cirurgia (50%)'],
    ['Segue pagamento da paciente Ana Reis - meia de compressão e compressor', 'Produto', 'Meia de compressão, Compressor / bota pneumática'],
    ['Renata Alves - 10 sessões de fisio pós-operatório', 'Fisioterapia', 'Fisioterapia (10 sessões)'],
    ['Paula Dias\nConsulta com angiologista', 'Consulta', 'Consulta com especialista (angiologista)'],
    ['Bia Melo\nConsulta de acompanhamento Dra. Lorena', 'Consulta', 'Consulta Dra. Lorena (clínica), Acompanhamento'],
  ];
  for (const [txt, cat, resumo] of casos) {
    const m = C.lerMensagem(txt);
    assert.strictEqual(m.categoria, cat, txt);
    assert.strictEqual(m.resumoItens, resumo, txt);
  }
  assert.strictEqual(C.lerMensagem('Fabiana Lima\nSinal de 50% da cirurgia').parcela, 'sinal');
  assert.strictEqual(C.lerMensagem('Renata Alves - 10 sessões de fisio pós-operatório').nome, 'Renata Alves');
});

test('Nomes parecidos: erro de digitação, sobrenome a mais e apelido batem; Bruna × Bruno não', () => {
  const nivel = (a, b) => C.compararNomes(a, b).nivel;
  assert.strictEqual(nivel('Juliana Paranho', 'Juliana Paranhos'), 'forte');
  assert.strictEqual(nivel('Juliana Paranhos', 'Juliana Paranhos de Souza'), 'forte');
  assert.strictEqual(nivel('Luiza Mendes', 'Luisa Mendes Costa'), 'forte');
  assert.strictEqual(nivel('Ju Paranhos', 'Juliana Paranhos'), 'forte');
  assert.notStrictEqual(nivel('Bruna Costa', 'Bruno Costa'), 'forte');
  assert.notStrictEqual(nivel('Gabriel Lima', 'Gabriela Lima'), 'forte');
  assert.strictEqual(nivel('Carlos Pereira', 'Ana Paula Pereira'), 'diferente');
});
