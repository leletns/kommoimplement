// GET /api/ficha?c=<código> → primeiro nome e data da consulta; POST /api/ficha → nota + etiqueta + tarefa no Kommo
// e cadastro no AmigoClinic (só se a paciente ainda não existir). Mesma lógica da versão Netlify (src/services/fichaBlue.js).
import ficha from '../../src/services/fichaBlue.js';
import amigoClient from '../../src/services/amigoClient.js';
import { json, kommoFetch } from '../_lib/comum.js';

export async function onRequest({ request, env }) {
  if (!env.KOMMO_TOKEN) return json({ ok: false, erro: 'indisponível' }, 503);
  const kommo = kommoFetch(env);
  const segredo = ficha.segredoPadrao(env);
  try {
    if (request.method === 'GET') {
      const info = await ficha.infoFicha(new URL(request.url).searchParams.get('c'), { kommo, segredo });
      return info ? json({ ok: true, ...info }) : json({ ok: false, erro: 'link inválido' }, 404);
    }
    if (request.method !== 'POST') return json({ ok: false }, 405);
    const texto = await request.text();
    if (texto.length > 30000) return json({ ok: false, erro: 'ficha grande demais' }, 413);
    let corpo;
    try { corpo = JSON.parse(texto); } catch { return json({ ok: false, erro: 'formato inválido' }, 400); }
    const amigo = env.AMIGO_TOKEN ? amigoClient.createAmigoClient({ token: env.AMIGO_TOKEN, baseURL: env.AMIGO_API_URL || undefined }) : null;
    const r = await ficha.processarFicha(
      { codigo: corpo.c, lang: ['pt', 'es', 'en'].includes(corpo.lang) ? corpo.lang : 'pt', ver: corpo.ver === 'pla' ? 'pla' : 'lip', dados: corpo.dados },
      { kommo, amigo, segredo }
    );
    console.log('[ficha]', r.ok ? `lead ${r.leadId} · amigo ${r.amigo}` : r.erro);
    return json(r.ok ? { ok: true, amigo: r.amigo } : { ok: false, erro: r.erro, campos: r.campos }, r.ok ? 200 : r.status);
  } catch (e) {
    console.error('[ficha] erro', e.message);
    return json({ ok: false, erro: 'Não conseguimos enviar agora. Tente de novo em instantes.' }, 500);
  }
}
