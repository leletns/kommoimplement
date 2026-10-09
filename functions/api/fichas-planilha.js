// /api/fichas-planilha?k=<chave> → TODAS as fichas em CSV para a planilha do Google (fórmula IMPORTDATA, atualiza sozinha).
// /api/fichas-planilha?link=1 (com a senha da equipe no cabeçalho) → devolve o link pronto para a página /equipe.
// A chave é derivada da FICHA_SENHA: trocar a senha troca a chave e o link antigo para de funcionar. Só leitura.
import { json, igual, senhaOk } from '../_lib/comum.js';
import { todasFichas } from '../_lib/banco.js';
import { paraCsv } from './ficha-backup.js';

export async function chavePlanilha(senha) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(senha)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('planilha-fichas-v1'));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest({ request, env }) {
  const txt = (body, status) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  const senha = env.FICHA_SENHA || env.PAINEL_SENHA;
  if (!senha || !env.DB) return txt('Banco de fichas não configurado.', 503);
  const u = new URL(request.url);
  if (u.searchParams.get('link')) {
    if (!senhaOk(request, env)) return json({ ok: false, erro: 'senha' }, 401);
    return json({ ok: true, link: `${u.origin}/api/fichas-planilha?k=${await chavePlanilha(senha)}` });
  }
  if (!igual(u.searchParams.get('k') || '', await chavePlanilha(senha))) return txt('Link da planilha inválido.', 401);
  const csv = paraCsv(await todasFichas(env.DB), { sep: ',', planilha: true });
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });
}
