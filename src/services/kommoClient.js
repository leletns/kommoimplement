'use strict';

/**
 * Cliente da API v4 do Kommo com fila de execução e retry.
 *
 * - O Kommo aceita no máximo 7 req/s por conta. Toda chamada passa por uma fila
 *   (p-queue) que inicia no máximo 1 requisição a cada `minIntervalMs` (250 ms = 4 req/s).
 * - 429 (Too Many Requests), 5xx e falhas de rede são repetidos com Exponential Backoff
 *   + jitter. Em 429 o header `Retry-After` é respeitado e a fila inteira é pausada,
 *   para que as outras chamadas em espera não continuem batendo no limite.
 * - Retries voltam para a fila, então também respeitam o throttle.
 */

const axios = require('axios');
const PQueueModule = require('p-queue');
const config = require('../config');

const PQueue = PQueueModule.default || PQueueModule;

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'ERR_NETWORK',
]);

class KommoApiError extends Error {
  constructor(message, { status, method, url, data } = {}) {
    super(message);
    this.name = 'KommoApiError';
    this.status = status;
    this.method = method;
    this.url = url;
    this.data = data;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function createKommoClient(options = {}) {
  const opts = {
    subdomain: config.kommo.subdomain,
    baseURL: config.kommo.baseURL,
    token: config.kommo.token,
    minIntervalMs: config.kommo.minIntervalMs,
    maxConcurrency: config.kommo.maxConcurrency,
    maxRetries: config.kommo.maxRetries,
    timeoutMs: config.kommo.timeoutMs,
    baseBackoffMs: 1000,
    maxBackoffMs: 30000,
    logger: console,
    ...options,
  };

  const http =
    opts.http ||
    axios.create({
      baseURL: opts.baseURL || `https://${opts.subdomain}.kommo.com/api/v4`,
      timeout: opts.timeoutMs,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      // Tratamos todos os status manualmente para decidir sobre retry.
      validateStatus: () => true,
    });

  const queue = new PQueue({
    concurrency: opts.maxConcurrency,
    intervalCap: 1,
    interval: opts.minIntervalMs,
    carryoverConcurrencyCount: true,
  });

  let pausedUntil = 0;
  function pauseQueue(ms) {
    const until = Date.now() + ms;
    if (until <= pausedUntil) return;
    pausedUntil = until;
    queue.pause();
    setTimeout(() => {
      if (Date.now() >= pausedUntil) queue.start();
    }, ms).unref?.();
  }

  function backoffDelay(attempt, retryAfterMs) {
    if (retryAfterMs != null) return Math.min(retryAfterMs + 100, opts.maxBackoffMs * 4);
    const exp = Math.min(opts.baseBackoffMs * 2 ** attempt, opts.maxBackoffMs);
    return exp / 2 + Math.random() * (exp / 2);
  }

  const stats = { requests: 0, retries: 0, rateLimited: 0, errors: 0 };

  async function request(method, url, { params, data, headers } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      let response;
      let networkError;
      try {
        stats.requests += 1;
        response = await queue.add(() => http.request({ method, url, params, data, headers }));
      } catch (err) {
        networkError = err;
      }

      if (response && response.status < 400) {
        // 204 = sem conteúdo (ex.: página vazia na listagem).
        return response.status === 204 ? null : response.data;
      }

      const status = response ? response.status : undefined;
      const retryable = networkError
        ? RETRYABLE_NETWORK_CODES.has(networkError.code) || !networkError.response
        : status === 429 || status >= 500;

      if (!retryable || attempt >= opts.maxRetries) {
        stats.errors += 1;
        const detail = networkError ? networkError.message : JSON.stringify(response.data)?.slice(0, 500);
        throw new KommoApiError(`Kommo ${method.toUpperCase()} ${url} falhou (${status || networkError.code}): ${detail}`, {
          status,
          method,
          url,
          data: response ? response.data : undefined,
        });
      }

      const retryAfterMs = status === 429 ? parseRetryAfter(response.headers?.['retry-after']) : null;
      const wait = backoffDelay(attempt, retryAfterMs);
      stats.retries += 1;
      if (status === 429) {
        stats.rateLimited += 1;
        pauseQueue(wait);
      }
      opts.logger.warn?.(
        `[kommo] ${method.toUpperCase()} ${url} -> ${status || networkError.code}; tentativa ${attempt + 1}/${opts.maxRetries}, aguardando ${Math.round(wait)} ms`
      );
      await sleep(wait);
    }
  }

  /**
   * Itera todas as páginas de uma listagem (`page` + `limit`), seguindo `_links.next`
   * como cursor. Entrega cada página já desembrulhada (array de entidades).
   */
  async function* paginate(url, { params = {}, embeddedKey, limit = 250, startPage = 1 } = {}) {
    const key = embeddedKey || url.split('/').filter(Boolean).pop();
    let page = startPage;
    while (true) {
      const body = await request('get', url, { params: { ...params, page, limit } });
      const items = body?._embedded?.[key] || [];
      if (!items.length) return;
      yield { page, items };
      if (!body?._links?.next || items.length < limit) return;
      page += 1;
    }
  }

  async function listAll(url, options) {
    const all = [];
    for await (const { items } of paginate(url, options)) all.push(...items);
    return all;
  }

  // Helpers de alto nível ------------------------------------------------------

  const api = {
    request,
    paginate,
    listAll,
    queue,
    stats,
    get: (url, params) => request('get', url, { params }),
    post: (url, data) => request('post', url, { data }),
    patch: (url, data) => request('patch', url, { data }),

    getAccount: () => request('get', '/account'),
    getPipelines: async () => (await request('get', '/leads/pipelines'))?._embedded?.pipelines || [],
    getUsers: () => listAll('/users', { embeddedKey: 'users' }),
    getLead: (id, withParams = 'contacts') => request('get', `/leads/${id}`, { params: { with: withParams } }),

    /** PATCH /leads em lotes (o Kommo aceita até 250 leads por chamada; usamos 50). */
    async updateLeads(leads, batchSize = 50) {
      const results = [];
      for (let i = 0; i < leads.length; i += batchSize) {
        results.push(await request('patch', '/leads', { data: leads.slice(i, i + batchSize) }));
      }
      return results;
    },

    /** Nota em um lead: POST /leads/{id}/notes */
    addLeadNote: (leadId, text, noteType = 'common') =>
      request('post', `/leads/${leadId}/notes`, { data: [{ note_type: noteType, params: { text } }] }),

    /** Várias notas em uma chamada: POST /leads/notes com entity_id (economiza rate limit). */
    async addLeadNotesBulk(notes, batchSize = 50) {
      const payload = notes.map(({ leadId, text, noteType = 'common' }) => ({
        entity_id: Number(leadId),
        note_type: noteType,
        params: { text },
      }));
      const results = [];
      for (let i = 0; i < payload.length; i += batchSize) {
        results.push(await request('post', '/leads/notes', { data: payload.slice(i, i + batchSize) }));
      }
      return results;
    },

    /** Busca contatos por telefone/e-mail/nome (GET /contacts?query=) com os leads vinculados. */
    async findContacts(query) {
      const body = await request('get', '/contacts', { params: { query, with: 'leads', limit: 10 } });
      return body?._embedded?.contacts || [];
    },

    /** Notas de vários leads em uma chamada: GET /leads/notes?filter[entity_id][]=... */
    async getNotesForLeads(leadIds) {
      if (!leadIds.length) return [];
      const params = { 'filter[entity_id]': leadIds, 'order[updated_at]': 'desc' };
      return listAll('/leads/notes', { params, embeddedKey: 'notes' });
    },
  };

  return api;
}

let defaultClient;
function getKommoClient() {
  if (!defaultClient) {
    if (!config.kommo.token) {
      throw new Error('KOMMO_TOKEN não configurado. Copie .env.example para .env e preencha o token.');
    }
    defaultClient = createKommoClient();
  }
  return defaultClient;
}

module.exports = { createKommoClient, getKommoClient, KommoApiError, parseRetryAfter };
