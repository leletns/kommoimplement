// GET /api/ficha-busca?q=<nome, celular ou e-mail> → fichas da Ficha Blue (nota do lead no Kommo).
// Para quem não usa o Kommo: o botão ✍️ Preencher cadastro (Amigo/DocSignature) e a página /equipe chamam aqui,
// sempre com a senha da equipe (FICHA_SENHA) no cabeçalho x-painel-senha.
import busca from '../../src/services/fichaBusca.js';
import { json, kommoFetch, corsDe, senhaOk } from '../_lib/comum.js';

export async function onRequest({ request, env }) {
  const cors = corsDe(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!senhaOk(request, env)) return json({ ok: false, erro: 'senha' }, 401, cors);
  if (!env.KOMMO_TOKEN) return json({ ok: false, erro: 'indisponível' }, 503, cors);
  try {
    const r = await busca.buscarFichas(new URL(request.url).searchParams.get('q'), { kommo: kommoFetch(env) });
    console.log('[ficha-busca]', r.ok ? `${r.fichas.length} ficha(s)` : r.erro);
    return json(r, r.ok ? 200 : 400, cors);
  } catch (e) {
    console.error('[ficha-busca] erro', e.message);
    return json({ ok: false, erro: 'Não consegui buscar agora.' }, 500, cors);
  }
}
