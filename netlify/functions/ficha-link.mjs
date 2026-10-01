// Gera o link pessoal da Ficha Blue para um lead. Chamado pelo botão "📝 Link da ficha" no Kommo.
// Protegido pela senha do painel (PAINEL_SENHA) enviada no cabeçalho x-painel-senha.
import crypto from 'node:crypto';
import ficha from '../../src/services/fichaBlue.js';

const origemKommo = () => `https://${process.env.KOMMO_SUBDOMAIN || 'comercialblueclinica'}.kommo.com`;
const cors = (request) => {
  const origin = request.headers.get('origin');
  return origin === origemKommo()
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'x-painel-senha, content-type', 'access-control-allow-methods': 'GET, OPTIONS', vary: 'origin' }
    : {};
};
const igual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default async (request) => {
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(request) };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const senha = process.env.PAINEL_SENHA;
  if (!senha || !igual(request.headers.get('x-painel-senha') || '', senha)) return new Response(JSON.stringify({ ok: false, erro: 'senha' }), { status: 401, headers: h });
  const lead = new URL(request.url).searchParams.get('lead');
  try {
    const codigo = ficha.codigoFicha(lead);
    const base = (process.env.FICHA_URL_BASE || process.env.URL || new URL(request.url).origin).replace(/\/$/, '');
    return new Response(JSON.stringify({ ok: true, codigo, url: `${base}/f/${codigo}` }), { status: 200, headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: e.message }), { status: 400, headers: h });
  }
};

export const config = { path: '/api/ficha-link' };
