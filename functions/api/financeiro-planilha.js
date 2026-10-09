// /api/financeiro-planilha?k=<chave> → lançamentos em CSV para a planilha do Google (fórmula IMPORTDATA, atualiza sozinha).
// A chave é derivada da FINANCEIRO_SENHA (não precisa de outro segredo); a página /financeiro mostra o link pronto para a gestão.
// Só leitura. Trocar a FINANCEIRO_SENHA troca a chave (o link antigo para de funcionar).
import { igual } from '../_lib/comum.js';
import * as fin from '../_lib/financeiro.js';

export async function chavePlanilha(senha) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(senha)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('planilha-financeiro-v1'));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest({ request, env }) {
  const txt = (body, status) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  if (!env.FINANCEIRO_SENHA || !env.DB) return txt('Controle financeiro não configurado.', 503);
  const k = new URL(request.url).searchParams.get('k') || '';
  if (!igual(k, await chavePlanilha(env.FINANCEIRO_SENHA))) return txt('Link da planilha inválido.', 401);
  const csv = await fin.csvPlanilha(env.DB);
  return new Response(csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });
}
