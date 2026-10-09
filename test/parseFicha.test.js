'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseFicha, pareceFicha } = require('../ferramentas/cadastro-amigo/parse-ficha');

// Dados fictícios (CPF válido gerado para teste).
const SEM_ROTULO = ['Maria Aparecida Souza Lima', '52998224725', '29/02/1960', 'Empresária', '21980273210', 'Casada',
  'maria.teste@icloud.com', 'Av.lucio costa 4600, bloco 8 ap 506', '22630011'].join('\n');

test('ficha sem rótulos: reconhece cada dado pelo formato', () => {
  assert.ok(pareceFicha(SEM_ROTULO));
  const d = parseFicha(SEM_ROTULO);
  assert.strictEqual(d.nome, 'Maria Aparecida Souza Lima');
  assert.strictEqual(d.cpf, '52998224725');
  assert.strictEqual(d.nascimento, '29/02/1960');
  assert.strictEqual(d.profissao, 'Empresária');
  assert.strictEqual(d.telefone, '21980273210');
  assert.strictEqual(d.estadoCivil, 'Casada');
  assert.strictEqual(d.email, 'maria.teste@icloud.com');
  assert.strictEqual(d.rua, 'Av. lucio costa');
  assert.strictEqual(d.numero, '4600');
  assert.strictEqual(d.complemento, 'bloco 8 ap 506');
  assert.strictEqual(d.cep, '22630011');
});

test('CPF com DV inválido mas sem cara de celular continua sendo CPF; celular não vira CPF', () => {
  const d = parseFicha(['Ana Beatriz Rocha', '92003508791', '01/02/1980', 'ana@x.com', '21991234567', '20000-000'].join('\n'));
  assert.strictEqual(d.cpf, '92003508791');
  assert.strictEqual(d.telefone, '21991234567');
  assert.strictEqual(d.cep, '20000000');
});

test('ficha com rótulos continua igual', () => {
  const d = parseFicha('Nome completo: Ana Teste\nCPF: 529.982.247-25\nData de nascimento: 01/01/1990\nProfissão: Advogada\nTelefone: (21) 99999-0000\nE-mail: Ana@Teste.com');
  assert.deepStrictEqual([d.nome, d.cpf, d.profissao, d.telefone, d.email], ['Ana Teste', '52998224725', 'Advogada', '21999990000', 'ana@teste.com']);
});

test('conversa comum não é ficha', () => {
  assert.ok(!pareceFicha('Olá\nBoa tarde\nJá preenchi o questionário\nObrigada'));
  assert.ok(!pareceFicha('Meu telefone é 21999990000'));
});
