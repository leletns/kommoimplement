// /api/conciliacao: conciliação da GESTÃO pelo grupo "Comprovantes de pagamento" (sem AmigoApp).
// Senha: FINANCEIRO_SENHA no cabeçalho x-financeiro-senha (a mesma da página /financeiro).
//   GET                                  → todas as linhas lidas do grupo (com as correções feitas à mão)
//   GET ?acao=chave                      → chave do botão 📊 e link da planilha do Google (IMPORTDATA)
//   GET ?acao=lote&id=                   → o que o botão mandou (mensagens + lista de imagens/PDFs)
//   GET ?acao=arquivo&id=&nome=          → uma imagem/PDF do lote
//   POST {registros:[…], lote?}          → grava as linhas (não duplica) e apaga o lote já processado
//   POST ?acao=ajustar {chave, campo, valor} → corrige uma célula (ou ignora a linha: campo "ignorado")
import { json, igual } from '../_lib/comum.js';
import * as grupo from '../_lib/grupo.js';

export const senhaFinanceiro = (env) => String(env.FINANCEIRO_SENHA || '').trim();

export async function onRequest({ request, env }) {
  const senha = senhaFinanceiro(env);
  if (!senha) return json({ ok: false, erro: 'FINANCEIRO_SENHA não configurada no Cloudflare.' }, 503);
  let dada = String(request.headers.get('x-financeiro-senha') || '').trim();
  try { dada = decodeURIComponent(dada).trim(); } catch { /* senha sem codificação */ }
  if (!igual(dada, senha)) return json({ ok: false, erro: 'senha' }, 401);
  if (!env.DB) return json({ ok: false, erro: 'Banco D1 não ligado ao projeto (binding DB).' }, 503);
  const u = new URL(request.url), acao = u.searchParams.get('acao') || '';
  try {
    if (request.method === 'GET') {
      if (acao === 'chave') {
        const k = await grupo.chave(senha, 'botao-conciliar-v1');
        return json({ ok: true, chave: k, planilha: `${u.origin}/api/conciliacao-planilha?k=${await grupo.chave(senha, 'planilha-conciliacao-v1')}` });
      }
      if (acao === 'lote') {
        const l = await grupo.lote(env.DB, u.searchParams.get('id') || '');
        return l ? json({ ok: true, ...l }) : json({ ok: false, erro: 'lote não encontrado (já processado?)' }, 404);
      }
      if (acao === 'arquivo') {
        const a = await grupo.arquivoDoLote(env.DB, u.searchParams.get('id') || '', u.searchParams.get('nome') || '');
        if (!a) return json({ ok: false }, 404);
        // O D1 pode devolver o BLOB como lista de números: vira bytes de novo
        const bytes = a.dados instanceof ArrayBuffer ? new Uint8Array(a.dados) : ArrayBuffer.isView(a.dados) ? a.dados : new Uint8Array(a.dados);
        return new Response(bytes, { headers: { 'content-type': a.tipo || 'application/octet-stream', 'cache-control': 'no-store' } });
      }
      return json({ ok: true, linhas: await grupo.listar(env.DB) });
    }
    if (request.method !== 'POST') return json({ ok: false }, 405);
    const texto = await request.text();
    if (texto.length > 5_000_000) return json({ ok: false, erro: 'leitura grande demais' }, 413);
    let b; try { b = JSON.parse(texto); } catch { return json({ ok: false, erro: 'JSON inválido' }, 400); }
    if (acao === 'ajustar') return json({ ok: await grupo.ajustar(env.DB, String(b.chave || ''), String(b.campo || ''), b.valor) });
    const novos = await grupo.gravar(env.DB, b.registros);
    if (b.lote) await grupo.apagarLote(env.DB, String(b.lote));
    return json({ ok: true, novos, linhas: await grupo.listar(env.DB) });
  } catch (e) {
    console.error('[conciliacao]', e.message);
    return json({ ok: false, erro: 'Não consegui salvar agora.' }, 500);
  }
}
