// Ficha Blue (página pública /f/<código>): GET devolve primeiro nome e data da consulta para personalizar;
// POST recebe a ficha → nota + etiqueta + tarefa no Kommo e cadastro no AmigoClinic (se AMIGO_TOKEN existir).
// Variáveis: KOMMO_TOKEN (obrigatório), AMIGO_TOKEN (opcional), FICHA_SEGREDO (opcional, assina os links).
import kommoClient from '../../src/services/kommoClient.js';
import ficha from '../../src/services/fichaBlue.js';
import amigoClient from '../../src/services/amigoClient.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async (request) => {
  if (!process.env.KOMMO_TOKEN) return json({ ok: false, erro: 'indisponível' }, 503);
  const kommo = kommoClient.getKommoClient();
  try {
    if (request.method === 'GET') {
      const info = await ficha.infoFicha(new URL(request.url).searchParams.get('c'), { kommo });
      return info ? json({ ok: true, ...info }) : json({ ok: false, erro: 'link inválido' }, 404);
    }
    if (request.method !== 'POST') return json({ ok: false }, 405);
    const texto = await request.text();
    if (texto.length > 30000) return json({ ok: false, erro: 'ficha grande demais' }, 413);
    let corpo;
    try { corpo = JSON.parse(texto); } catch { return json({ ok: false, erro: 'formato inválido' }, 400); }
    const amigo = process.env.AMIGO_TOKEN ? amigoClient.createAmigoClient() : null;
    const r = await ficha.processarFicha(
      { codigo: corpo.c, lang: ['pt', 'es', 'en'].includes(corpo.lang) ? corpo.lang : 'pt', ver: corpo.ver === 'pla' ? 'pla' : 'lip', dados: corpo.dados },
      { kommo, amigo }
    );
    console.log('[ficha]', r.ok ? `lead ${r.leadId} · amigo ${r.amigo}` : r.erro);
    return json(r.ok ? { ok: true, amigo: r.amigo } : { ok: false, erro: r.erro, campos: r.campos }, r.ok ? 200 : r.status);
  } catch (e) {
    console.error('[ficha] erro', e.message);
    return json({ ok: false, erro: 'Não conseguimos enviar agora. Tente de novo em instantes.' }, 500);
  }
};

export const config = { path: '/api/ficha' };
