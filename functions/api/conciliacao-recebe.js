// POST /api/conciliacao-recebe?k=<chave do botão> — chamado pelo botão 📊 Conciliar grupo no WhatsApp Web.
// O WhatsApp Web bloqueia fetch para outros sites, mas deixa enviar formulário: o botão manda as mensagens do período
// (campo "dados") e as imagens/PDFs dos comprovantes (campos "arquivo"). Guardamos num lote e levamos a gestão para
// /conciliacao, que lê os comprovantes e atualiza a planilha. A chave vem da página /conciliacao (depois da senha).
import * as grupo from '../_lib/grupo.js';
import { igual } from '../_lib/comum.js';
import { senhaFinanceiro } from './conciliacao.js';

const pagina = (titulo, texto, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><body style="font:16px/1.5 Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#13294a"><h1 style="font-size:20px">${titulo}</h1><p>${texto}</p></body>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return pagina('Conciliação', 'Use o botão 📊 Conciliar grupo no WhatsApp Web.', 405);
  const senha = senhaFinanceiro(env);
  if (!senha || !env.DB) return pagina('Conciliação indisponível', 'O financeiro não está configurado no servidor.', 503);
  const k = new URL(request.url).searchParams.get('k') || '';
  if (!igual(k, await grupo.chave(senha, 'botao-conciliar-v1'))) return pagina('Botão desatualizado', 'Instale o botão de novo pela página <a href="/conciliacao">/conciliacao</a> (a senha da gestão mudou).', 401);
  const tam = Number(request.headers.get('content-length') || 0);
  if (tam > 90_000_000) return pagina('Período grande demais', 'Escolha um período menor e clique de novo.', 413);
  let form;
  try { form = await request.formData(); } catch { return pagina('Não consegui ler o envio', 'Tente de novo.', 400); }
  let dados;
  try { dados = JSON.parse(String(form.get('dados') || '{}')); } catch { return pagina('Não consegui ler o envio', 'Tente de novo.', 400); }
  const arquivos = [];
  for (const f of form.getAll('arquivo')) {
    if (!f || typeof f === 'string' || !f.size || f.size > 1_900_000) continue; // D1 guarda até ~2 MB por linha
    if (!/^(image\/|application\/pdf)/.test(f.type || '')) continue;
    arquivos.push({ nome: String(f.name || 'arquivo').slice(0, 80), tipo: f.type, dados: new Uint8Array(await f.arrayBuffer()) });
  }
  const id = await grupo.criarLote(env.DB, dados, arquivos);
  return new Response(null, { status: 303, headers: { location: '/conciliacao#lote=' + id, 'cache-control': 'no-store' } });
}
