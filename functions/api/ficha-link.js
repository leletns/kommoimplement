// GET /api/ficha-link?lead=<id> → link pessoal assinado. Chamado pelo botão "📝 Link da ficha" no Kommo,
// com a senha (FICHA_SENHA) no cabeçalho x-painel-senha.
import ficha from '../../src/services/fichaBlue.js';
import { json, corsDe, senhaOk } from '../_lib/comum.js';

export async function onRequest({ request, env }) {
  const cors = corsDe(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!senhaOk(request, env)) return json({ ok: false, erro: 'senha' }, 401, cors);
  try {
    const codigo = ficha.codigoFicha(new URL(request.url).searchParams.get('lead'), ficha.segredoPadrao(env));
    const base = (env.FICHA_URL_BASE || new URL(request.url).origin).replace(/\/$/, '');
    return json({ ok: true, codigo, url: `${base}/f/${codigo}` }, 200, cors);
  } catch (e) {
    return json({ ok: false, erro: e.message }, 400, cors);
  }
}
