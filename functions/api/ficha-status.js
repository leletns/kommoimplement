// GET /api/ficha-status → diz se o servidor da ficha consegue falar com o Kommo (só leitura, sem dados de pacientes).
import { json, tokenLimpo } from '../_lib/comum.js';

export async function onRequest({ env }) {
  const res = { kommoToken: env.KOMMO_TOKEN ? 'configurado' : 'faltando', fichaSenha: env.FICHA_SENHA ? 'configurada' : 'faltando',
    fichaSegredo: env.FICHA_SEGREDO ? 'configurado' : 'faltando', amigoToken: env.AMIGO_TOKEN ? 'configurado' : 'não usado' };
  if (env.KOMMO_TOKEN) {
    const token = env.KOMMO_TOKEN;
    const lt = tokenLimpo(token);
    // Só o formato (nunca o valor): um token do Kommo começa com "eyJ" e tem 3 partes separadas por ponto
    res.tokenPistas = { tamanho: lt.length, comecaComEyJ: lt.startsWith('eyJ'), partes: lt.split('.').length, temIgual: token.includes('='), temEspacoNoMeio: /\S\s+\S/.test(token.trim()) };
    res.tokenFormato = tokenLimpo(token) === token ? 'ok' : 'tinha caracteres a mais (quebra de linha, espaço ou aspas); o servidor limpa sozinho';
    const r = await fetch(`https://${env.KOMMO_SUBDOMAIN || 'comercialblueclinica'}.kommo.com/api/v4/account`, { headers: { authorization: `Bearer ${tokenLimpo(token)}` } }).catch((e) => ({ erro: String(e && e.message || e).slice(0, 200) }));
    res.kommo = r.erro ? 'sem resposta: ' + r.erro : r.ok ? 'conectado' : `recusou (${r.status})`;
  }
  return json(res, 200);
}
