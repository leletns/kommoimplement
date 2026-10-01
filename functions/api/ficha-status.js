// GET /api/ficha-status → diz se o servidor da ficha consegue falar com o Kommo (só leitura, sem dados de pacientes).
import { json } from '../_lib/comum.js';

export async function onRequest({ env }) {
  const res = { kommoToken: env.KOMMO_TOKEN ? 'configurado' : 'faltando', fichaSenha: env.FICHA_SENHA ? 'configurada' : 'faltando',
    fichaSegredo: env.FICHA_SEGREDO ? 'configurado' : 'faltando', amigoToken: env.AMIGO_TOKEN ? 'configurado' : 'não usado' };
  if (env.KOMMO_TOKEN) {
    const token = env.KOMMO_TOKEN;
    res.tokenFormato = /^\s|\s$|^["']|["']$|^Bearer /i.test(token) ? 'tem espaço, aspas ou "Bearer" sobrando' : 'ok';
    const r = await fetch(`https://${env.KOMMO_SUBDOMAIN || 'comercialblueclinica'}.kommo.com/api/v4/account`, { headers: { authorization: `Bearer ${token.trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '')}` } }).catch(() => null);
    res.kommo = r ? (r.ok ? 'conectado' : `recusou (${r.status})`) : 'sem resposta';
  }
  return json(res, 200);
}
