'use strict';

const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/services/fichaBlue');

const SEG = 'segredo-teste';
const dados = {
  nome: 'larissa sampaio da costa', cpf: '529.982.247-25', nasc: '1990-05-17', cel: '(21) 99876-5432', mail: 'Lari@Email.com',
  cep: '22775-056', rua: 'Av. José Silva de Azevedo Neto', numero: '200', compl: 'apto 101', bairro: 'Barra da Tijuca', cidade: 'Rio de Janeiro', uf: 'RJ',
  como: 'Indicação', quem: 'Dra. Ana', reg: ['Coxas', 'Braços'], cons: true, estadoCivil: 'Casada(o)', instagram: '@lari',
};

function kommoFake() {
  const chamadas = [];
  return {
    chamadas,
    request: async (metodo, url, opts) => {
      chamadas.push([metodo, url, opts]);
      if (metodo === 'get') return { id: 123, responsible_user_id: 9, custom_fields_values: [{ field_id: 3837314, values: [{ value: 'LARISSA' }] }] };
      return {};
    },
  };
}

test('link assinado: abre o lead certo e recusa código adulterado', () => {
  const c = F.codigoFicha(80201234, SEG);
  assert.strictEqual(F.lerCodigo(c, SEG), 80201234);
  assert.strictEqual(F.lerCodigo(c.replace(/^./, 'z'), SEG), null);
  assert.strictEqual(F.lerCodigo(c, 'outro'), null);
  assert.strictEqual(F.lerCodigo('abc', SEG), null);
});

test('mapeia para o Amigo só os campos aceitos pela API', () => {
  const p = F.paraAmigo(F.limparDados(dados), 'lip');
  assert.deepStrictEqual(p, {
    name: 'Larissa Sampaio da Costa', gender: 'Feminino', contact_cellphone: '21998765432', email: 'lari@email.com', cpf: '52998224725',
    address_cep: '22775056', address_address: 'Av. José Silva de Azevedo Neto', address_number: '200', address_district: 'Barra da Tijuca',
    address_city: 'Rio de Janeiro', address_state: 'Rio de Janeiro', address_country: 'Brasil', civil_status: 'Casada(o)',
  });
  assert.strictEqual(F.celularBR('+54 9 11 2222-3333'), null);
});

test('ficha nova: cria no Amigo, nota com JSON para o botão, etiqueta e tarefa', async () => {
  const kommo = kommoFake();
  const criados = [];
  const amigo = { pacienteExiste: async () => null, criarPaciente: async (p) => { criados.push(p); return { id: 777 }; } };
  const r = await F.processarFicha({ codigo: F.codigoFicha(123, SEG), lang: 'pt', ver: 'lip', dados }, { kommo, amigo, segredo: SEG });
  assert.deepStrictEqual(r, { ok: true, leadId: 123, amigo: 'criado', novo: false, origem: 'link pessoal' });
  assert.strictEqual(criados.length, 1);
  const nota = kommo.chamadas.find((c) => c[1] === '/leads/123/notes')[2].data[0].params.text;
  assert.match(nota, /paciente cadastrada \(#777\)/);
  const json = JSON.parse(nota.split(F.MARCA_JSON)[1]);
  assert.strictEqual(json.nascimento, '17/05/1990');
  assert.strictEqual(json.indicacao, 'Dra. Ana');
  assert.ok(kommo.chamadas.some((c) => c[1] === '/leads' && c[2].data[0].tags_to_add[0].name === 'ficha_recebida'));
  assert.strictEqual(kommo.chamadas.find((c) => c[1] === '/tasks')[2].data[0].responsible_user_id, 9);
});

test('paciente que já existe no Amigo não é duplicada', async () => {
  const amigo = { pacienteExiste: async ({ cpf }) => (cpf ? { id: 55 } : null), criarPaciente: async () => assert.fail('não deveria criar') };
  const r = await F.processarFicha({ codigo: F.codigoFicha(123, SEG), dados }, { kommo: kommoFake(), amigo, segredo: SEG });
  assert.strictEqual(r.amigo, 'existia');
});

test('sem autorização ou com CPF errado não envia; link falso dá 404', async () => {
  const kommo = kommoFake();
  let r = await F.processarFicha({ codigo: F.codigoFicha(123, SEG), dados: { ...dados, cons: false } }, { kommo, segredo: SEG });
  assert.deepStrictEqual([r.ok, r.campos], [false, ['cons']]);
  r = await F.processarFicha({ codigo: F.codigoFicha(123, SEG), dados: { ...dados, cpf: '111.222.333-44' } }, { kommo, segredo: SEG });
  assert.deepStrictEqual(r.campos, ['cpf']);
  r = await F.processarFicha({ codigo: '3f-AAAAAAAAAA', dados }, { kommo, segredo: SEG });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(kommo.chamadas.length, 0);
});

test('link fixo (sem código): acha o lead pelo celular e ignora contato que só parece', async () => {
  const chamadas = [];
  const kommo = {
    request: async (m, url, opts) => {
      chamadas.push([m, url, opts]);
      if (url.startsWith('/contacts?')) return { _embedded: { contacts: [
        { id: 1, custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '+55 21 99876-5432' }] }], _embedded: { leads: [{ id: 50 }, { id: 51 }] } },
        { id: 2, custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '+55 11 90000-0000' }] }], _embedded: { leads: [{ id: 99 }] } },
      ] } };
      if (url === '/leads/50') return { id: 50, status_id: 143, updated_at: 900 };
      if (url === '/leads/51') return { id: 51, status_id: 142, updated_at: 800, responsible_user_id: 7 };
      if (url === '/leads/99') return { id: 99, status_id: 142, updated_at: 999 };
      return {};
    },
  };
  const amigo = { pacienteExiste: async () => null, criarPaciente: async () => ({ id: 1 }) };
  const r = await F.processarFicha({ lang: 'pt', ver: 'lip', dados }, { kommo, amigo });
  assert.deepStrictEqual([r.leadId, r.origem, r.novo, r.amigo], [51, 'celular', false, 'criado']);
  assert.ok(!chamadas.some((c) => c[1] === '/leads/99'), 'lead de outro contato não pode ser usado');
});

test('link fixo: paciente fora do Kommo vira lead novo e não é cadastrada no Amigo sozinha', async () => {
  const chamadas = [];
  const kommo = {
    request: async (m, url, opts) => {
      chamadas.push([m, url, opts]);
      if (url.startsWith('/contacts?')) return null;
      if (url === '/leads/complex') return [{ id: 777, contact_id: 5 }];
      return {};
    },
  };
  const amigo = { pacienteExiste: async () => assert.fail('não deveria consultar'), criarPaciente: async () => assert.fail('não deveria criar') };
  const r = await F.processarFicha({ lang: 'es', ver: 'lip', dados }, { kommo, amigo, pipelineId: 13604187 });
  assert.deepStrictEqual([r.leadId, r.novo, r.amigo], [777, true, 'sem_lead']);
  const novo = chamadas.find((c) => c[1] === '/leads/complex')[2].data[0];
  assert.strictEqual(novo.pipeline_id, 13604187);
  assert.strictEqual(novo._embedded.contacts[0].custom_fields_values[0].values[0].value, dados.cel);
});
