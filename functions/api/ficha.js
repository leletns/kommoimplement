// GET /api/ficha?c=<código> → primeiro nome e data da consulta (link pessoal).
// POST /api/ficha → nota + etiqueta + tarefa no Kommo e cadastro no AmigoClinic (src/services/fichaBlue.js).
// Proteções: campo-isca para robôs, tempo mínimo de preenchimento e, se configurado, Cloudflare Turnstile.
import ficha from '../../src/services/fichaBlue.js';
import amigoClient from '../../src/services/amigoClient.js';
import { json, kommoFetch } from '../_lib/comum.js';
import { salvarFicha, atualizarFicha } from '../_lib/banco.js';

async function humano(corpo, env, request) {
  if (corpo.hp) return false; // campo escondido: só robô preenche
  if (!(Number(corpo.ms) >= 20000)) return false; // ninguém preenche a ficha inteira em menos de 20 s
  if (!env.TURNSTILE_SECRET) return true;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(corpo.ts || ''));
  form.append('remoteip', request.headers.get('cf-connecting-ip') || '');
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then((x) => x.json()).catch(() => ({}));
  return r.success === true;
}

export async function onRequest({ request, env }) {
  if (!env.KOMMO_TOKEN) return json({ ok: false, erro: 'indisponível' }, 503);
  const kommo = kommoFetch(env);
  try {
    if (request.method === 'GET') {
      const info = await ficha.infoFicha(new URL(request.url).searchParams.get('c'), { kommo, segredo: ficha.segredoPadrao(env) });
      return info ? json({ ok: true, ...info }) : json({ ok: false, erro: 'link inválido' }, 404);
    }
    if (request.method !== 'POST') return json({ ok: false }, 405);
    const texto = await request.text();
    if (texto.length > 60000) return json({ ok: false, erro: 'ficha grande demais' }, 413);
    let corpo;
    try { corpo = JSON.parse(texto); } catch { return json({ ok: false, erro: 'formato inválido' }, 400); }
    if (!(await humano(corpo, env, request))) {
      console.log('[ficha] bloqueada pela proteção contra robôs');
      return corpo.hp ? json({ ok: true }) : json({ ok: false, erro: 'verificacao' }, 403);
    }
    const amigo = env.AMIGO_TOKEN ? amigoClient.createAmigoClient({ token: env.AMIGO_TOKEN, baseURL: env.AMIGO_API_URL || undefined }) : null;
    const lang = ['pt', 'es', 'en'].includes(corpo.lang) ? corpo.lang : 'pt', ver = corpo.ver === 'pla' ? 'pla' : 'lip';
    const d = ficha.limparDados(corpo.dados);
    const invalidos = ficha.validar(d);
    if (invalidos.length) return json({ ok: false, erro: 'dados incompletos', campos: invalidos }, 400);
    // 1) Banco primeiro: a ficha fica guardada mesmo se o Kommo falhar
    let idBanco = null;
    if (env.DB) {
      try { idBanco = await salvarFicha(env.DB, { ver, lang, d, dados: { ...ficha.paraBotao(d, null), _ficha: { ver, lang, em: new Date().toISOString(), r: d } } }); }
      catch (e) { console.error('[ficha] banco', e.message); }
    }
    // 2) Kommo (+ Amigo, se configurado)
    let r;
    try {
      r = await ficha.processarFicha({ codigo: corpo.c || null, lang, ver, dados: corpo.dados },
        { kommo, amigo, segredo: corpo.c ? ficha.segredoPadrao(env) : undefined, pipelineId: env.FICHA_PIPELINE_ID || 13604187 });
    } catch (e) {
      console.error('[ficha] kommo', e.message);
      if (idBanco) {
        await atualizarFicha(env.DB, idBanco, { status: 'erro_kommo', erro: String(e.message).slice(0, 300) }).catch(() => {});
        return json({ ok: true }); // a ficha está salva; a equipe vê o aviso na página /equipe
      }
      throw e;
    }
    if (idBanco) {
      await atualizarFicha(env.DB, idBanco, r.ok
        ? { leadId: r.leadId, origem: r.origem, status: 'no_kommo', amigo: r.amigo, dados: { ...ficha.paraBotao(d, r.leadId), _ficha: { ver, lang, em: new Date().toISOString(), r: d } } }
        : { status: 'erro_kommo', erro: r.erro }).catch((e) => console.error('[ficha] banco', e.message));
      if (!r.ok && r.status !== 404) return json({ ok: true });
    }
    console.log('[ficha]', r.ok ? `lead ${r.leadId} (${r.origem}) · amigo ${r.amigo}` : r.erro);
    return json(r.ok ? { ok: true } : { ok: false, erro: r.erro, campos: r.campos }, r.ok ? 200 : r.status);
  } catch (e) {
    console.error('[ficha] erro', e.message);
    return json({ ok: false, erro: 'Não conseguimos enviar agora. Tente de novo em instantes.' }, 500);
  }
}
