'use strict';

/**
 * Cliente mínimo da API do AmigoClinic (https://amigobot-api.amigoapp.com.br/api-docs).
 * Token só em variável de ambiente (AMIGO_TOKEN no Netlify / .env), nunca no código ou no navegador.
 */
const BASE = process.env.AMIGO_API_URL || 'https://amigobot-api.amigoapp.com.br';

function createAmigoClient({ token = process.env.AMIGO_TOKEN, baseURL = BASE, fetchImpl = globalThis.fetch } = {}) {
  if (!token) throw new Error('AMIGO_TOKEN não configurado');
  async function request(method, path, { query, body } = {}) {
    const url = new URL(path, baseURL);
    for (const [k, v] of Object.entries(query || {})) if (v) url.searchParams.set(k, v);
    const res = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { json = null; }
    if (res.status === 404) return null;
    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || txt.slice(0, 200);
      throw new Error(`Amigo ${method} ${path}: ${res.status} ${msg}`);
    }
    return json && json.data !== undefined ? json.data : json;
  }
  return {
    request,
    /** Paciente pelo CPF ou celular (DDD + 9 dígitos). null se não existir. */
    pacienteExiste: ({ cpf, celular } = {}) => request('GET', '/patients/exists', { query: { cpf, contact_cellphone: celular } }),
    criarPaciente: (dados) => request('POST', '/patients', { body: dados }),
    paciente: (id) => request('GET', `/patients/${id}`),
  };
}

module.exports = { createAmigoClient };
