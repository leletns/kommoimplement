'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buscarFichas } = require('../src/services/fichaBusca');

function kommoFake() {
  const urls = [];
  return {
    urls,
    request: async (m, url) => {
      urls.push(url);
      if (url.startsWith('/contacts?')) return { _embedded: { contacts: [{ id: 5, _embedded: { leads: [{ id: 10 }, { id: 11 }] } }] } };
      if (url.startsWith('/leads?')) return null; // 204: nada
      if (url.startsWith('/leads/10/notes')) return { _embedded: { notes: [{ created_at: 1790000000, params: { text: '📋 FICHA BLUE recebida\n\nFICHA_BLUE_JSON: {"nome":"Ana Teste","cpf":"529.982.247-25"}' } }] } };
      if (url.startsWith('/leads/11/notes')) return { _embedded: { notes: [{ params: { text: 'outra nota' } }] } };
      return null;
    },
  };
}

test('acha a Ficha Blue pelo celular (8 últimos dígitos) e conta quem ainda não mandou', async () => {
  const k = kommoFake();
  const r = await buscarFichas('(21) 99876-5432', { kommo: k });
  assert.ok(k.urls[0].includes('query=98765432'));
  assert.strictEqual(r.fichas.length, 1);
  assert.strictEqual(r.fichas[0].dados.nome, 'Ana Teste');
  assert.strictEqual(r.semFicha, 1);
});

test('busca pelo nome usa o texto e recusa busca curta', async () => {
  const k = kommoFake();
  await buscarFichas('Ana Teste', { kommo: k });
  assert.ok(k.urls[0].includes('query=Ana%20Teste'));
  assert.strictEqual((await buscarFichas('an', { kommo: k })).ok, false);
});
