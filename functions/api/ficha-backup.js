// GET /api/ficha-backup → cópia de segurança de TODAS as fichas do banco, para baixar e guardar fora do Cloudflare.
// ?formato=csv (padrão, abre no Excel) ou ?formato=json (completo, serve para restaurar). Sempre com a senha da equipe.
import { json, senhaOk } from '../_lib/comum.js';
import { todasFichas } from '../_lib/banco.js';

const FIXAS = [['id', 'Nº'], ['recebida_em', 'Recebida em'], ['ver', 'Ficha'], ['lang', 'Idioma'], ['nome', 'Nome'], ['cpf', 'CPF'],
  ['celular', 'Celular'], ['email', 'E-mail'], ['lead_id', 'Lead no Kommo'], ['status', 'Situação'], ['erro', 'Erro']];
const cel = (v, sep = ';') => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.includes(sep) || /["\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const hora = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function paraCsv(linhas, { sep = ';', planilha = false } = {}) {
  const resp = linhas.map((x) => { try { return (JSON.parse(x.dados_json)._ficha || {}).r || {}; } catch { return {}; } });
  const chaves = [...new Set(resp.flatMap((r) => Object.keys(r)))];
  const cab = [...FIXAS.map(([, t]) => t), ...chaves, ...(planilha ? [] : ['Dados completos (JSON)'])];
  const corpo = linhas.map((x, i) => [
    ...FIXAS.map(([k]) => (k === 'recebida_em' ? hora(x[k]) : x[k] === 'lip' ? 'Lipedema' : x[k] === 'pla' ? 'Plástica' : x[k])),
    ...chaves.map((k) => resp[i][k]), ...(planilha ? [] : [x.dados_json]),
  ].map((v) => (planilha && v != null ? String(v).replace(/\s*[\r\n]+\s*/g, ' / ') : v)).map((v) => cel(v, sep)).join(sep));
  return (planilha ? '' : '﻿') + [cab.map((v) => cel(v, sep)).join(sep), ...corpo].join('\r\n');
}

export async function onRequest({ request, env }) {
  if (!senhaOk(request, env)) return json({ ok: false, erro: 'senha' }, 401);
  if (!env.DB) return json({ ok: false, erro: 'banco não ligado' }, 503);
  const linhas = await todasFichas(env.DB);
  const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const formato = new URL(request.url).searchParams.get('formato') === 'json' ? 'json' : 'csv';
  const corpo = formato === 'json'
    ? JSON.stringify({ geradoEm: new Date().toISOString(), total: linhas.length, fichas: linhas.map((x) => ({ ...x, dados: JSON.parse(x.dados_json), dados_json: undefined })) }, null, 1)
    : paraCsv(linhas);
  return new Response(corpo, { headers: {
    'content-type': formato === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="fichas-blue-${dia}.${formato}"`, 'cache-control': 'no-store', 'x-total-fichas': String(linhas.length),
  } });
}
