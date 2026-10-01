// GET /api/ficha-link?lead=<id> → link pessoal assinado. Chamado pelo botão "📝 Link da ficha" no Kommo,
// com a senha (FICHA_SENHA) no cabeçalho x-painel-senha. Só aceita chamadas vindas do Kommo da clínica.
import ficha from '../../src/services/fichaBlue.js';
import { json } from '../_lib/comum.js';

const igual = (a, b) => {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
};

export async function onRequest({ request, env }) {
  const origem = `https://${env.KOMMO_SUBDOMAIN || 'comercialblueclinica'}.kommo.com`;
  const cors = request.headers.get('origin') === origem
    ? { 'access-control-allow-origin': origem, 'access-control-allow-headers': 'x-painel-senha, content-type', 'access-control-allow-methods': 'GET, OPTIONS', vary: 'origin' }
    : {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const senha = env.FICHA_SENHA || env.PAINEL_SENHA;
  if (!senha || !igual(request.headers.get('x-painel-senha') || '', senha)) return json({ ok: false, erro: 'senha' }, 401, cors);
  try {
    const codigo = ficha.codigoFicha(new URL(request.url).searchParams.get('lead'), ficha.segredoPadrao(env));
    const base = (env.FICHA_URL_BASE || new URL(request.url).origin).replace(/\/$/, '');
    return json({ ok: true, codigo, url: `${base}/f/${codigo}` }, 200, cors);
  } catch (e) {
    return json({ ok: false, erro: e.message }, 400, cors);
  }
}
