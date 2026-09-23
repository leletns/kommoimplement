'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createKommoClient, parseRetryAfter, KommoApiError } = require('../src/services/kommoClient');

const silent = { warn() {} };

function fakeHttp(responses) {
  const calls = [];
  return {
    calls,
    request: async (cfg) => {
      calls.push({ ...cfg, at: Date.now() });
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      return { headers: {}, data: {}, ...next };
    },
  };
}

test('respeita o intervalo mínimo entre requisições (throttle)', async () => {
  const http = fakeHttp([{ status: 200, data: { ok: true } }]);
  const kommo = createKommoClient({ http, minIntervalMs: 100, maxConcurrency: 4, logger: silent });
  await Promise.all(Array.from({ length: 6 }, () => kommo.get('/account')));
  const gaps = http.calls.slice(1).map((c, i) => c.at - http.calls[i].at);
  for (const g of gaps) assert.ok(g >= 90, `intervalo ${g}ms < 100ms`);
});

test('429 com Retry-After: espera e tenta de novo', async () => {
  const http = fakeHttp([{ status: 429, headers: { 'retry-after': '0.2' } }, { status: 200, data: { id: 1 } }]);
  const kommo = createKommoClient({ http, minIntervalMs: 1, logger: silent });
  const t0 = Date.now();
  const data = await kommo.get('/leads/1');
  assert.deepStrictEqual(data, { id: 1 });
  assert.ok(Date.now() - t0 >= 200);
  assert.strictEqual(kommo.stats.rateLimited, 1);
});

test('5xx e erro de rede usam exponential backoff', async () => {
  const netErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const http = fakeHttp([{ status: 502 }, netErr, { status: 503 }, { status: 200, data: 'ok' }]);
  const kommo = createKommoClient({ http, minIntervalMs: 1, baseBackoffMs: 10, logger: silent });
  assert.strictEqual(await kommo.get('/x'), 'ok');
  assert.strictEqual(kommo.stats.retries, 3);
});

test('desiste após maxRetries e lança KommoApiError', async () => {
  const http = fakeHttp([{ status: 500, data: { title: 'err' } }]);
  const kommo = createKommoClient({ http, minIntervalMs: 1, baseBackoffMs: 1, maxRetries: 2, logger: silent });
  await assert.rejects(kommo.get('/x'), (err) => err instanceof KommoApiError && err.status === 500);
  assert.strictEqual(http.calls.length, 3);
});

test('4xx (exceto 429) não é repetido', async () => {
  const http = fakeHttp([{ status: 400, data: { title: 'Bad Request' } }]);
  const kommo = createKommoClient({ http, minIntervalMs: 1, logger: silent });
  await assert.rejects(kommo.patch('/leads', []), /400/);
  assert.strictEqual(http.calls.length, 1);
});

test('204 devolve null e encerra a paginação', async () => {
  const page1 = { status: 200, data: { _embedded: { leads: [{ id: 1 }, { id: 2 }] }, _links: { next: { href: 'x' } } } };
  const http = fakeHttp([page1, { status: 204 }]);
  const kommo = createKommoClient({ http, minIntervalMs: 1, logger: silent });
  const all = await kommo.listAll('/leads', { limit: 2 });
  assert.deepStrictEqual(all.map((l) => l.id), [1, 2]);
  assert.deepStrictEqual(http.calls.map((c) => c.params.page), [1, 2]);
});

test('parseRetryAfter aceita segundos e data HTTP', () => {
  assert.strictEqual(parseRetryAfter('3'), 3000);
  assert.strictEqual(parseRetryAfter(undefined), null);
  assert.ok(parseRetryAfter(new Date(Date.now() + 5000).toUTCString()) > 3000);
});
