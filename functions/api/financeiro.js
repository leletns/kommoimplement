// /api/financeiro: controle financeiro da GESTÃO (conciliação de comprovantes → planilha).
// Senha própria: FINANCEIRO_SENHA (cabeçalho x-financeiro-senha). Não usa a senha da equipe nem a Ficha Blue.
// Ações (?acao=…):
//   GET  status                        → banco e planilha configurados?
//   POST conciliacao {comprovante,hash,origem} → cria a conciliação (comprovante lido) + duplicidade + candidatos
//   GET  conciliacao&id=               → conciliação (a página acompanha a conferência no AmigoApp)
//   GET  pendente                      → última conciliação sem lançamento (botão no AmigoApp)
//   POST paciente {id,paciente}        → paciente conferida no AmigoApp
//   POST lancar {...}                  → grava o lançamento (bloqueia duplicado) e envia para a planilha
//   POST descartar {id} · GET lancamentos · POST sincronizar (reenvia à planilha o que falhou)
import { json, igual } from '../_lib/comum.js';
import * as fin from '../_lib/financeiro.js';

function cors(request) {
  const o = request.headers.get('origin') || '';
  // O botão roda no AmigoApp (conferência da paciente); a página /financeiro é do próprio site.
  return /^https:\/\/([a-z0-9-]+\.)*(amigoapp\.com\.br|amigotech\.com\.br)$/.test(o)
    ? { 'access-control-allow-origin': o, 'access-control-allow-headers': 'x-financeiro-senha, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'origin' } : {};
}

export async function onRequest({ request, env }) {
  const h = cors(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const senha = env.FINANCEIRO_SENHA;
  if (!senha) return json({ ok: false, erro: 'FINANCEIRO_SENHA não configurada no Cloudflare.' }, 503, h);
  if (!igual(request.headers.get('x-financeiro-senha') || '', senha)) return json({ ok: false, erro: 'senha' }, 401, h);
  if (!env.DB) return json({ ok: false, erro: 'Banco D1 não ligado ao projeto (binding DB).' }, 503, h);
  const db = env.DB;
  const u = new URL(request.url);
  const acao = u.searchParams.get('acao') || 'status';
  let b = {};
  if (request.method === 'POST') { try { b = await request.json(); } catch { return json({ ok: false, erro: 'JSON inválido' }, 400, h); } }
  try {
    switch (acao) {
      case 'status':
        return json({ ok: true, banco: true, planilha: !!(env.FINANCEIRO_PLANILHA_URL && env.FINANCEIRO_PLANILHA_CHAVE), planilhaLink: env.FINANCEIRO_PLANILHA_LINK || null }, 200, h);
      case 'conciliacao': {
        if (request.method === 'GET') {
          const c = await fin.conciliacao(db, u.searchParams.get('id') || '');
          if (!c) return json({ ok: false, erro: 'não encontrada' }, 404, h);
          return json({ ok: true, conciliacao: c }, 200, h);
        }
        const c = b.comprovante || {};
        const id = await fin.criarConciliacao(db, { comprovante: c, hash: b.hash, origem: b.origem });
        const duplicidade = await fin.duplicidade(db, { idTransacao: c.idTransacao, hash: b.hash, valor: c.valor, data: c.data, pagador: c.pagador });
        const cpfMeio = String(c.pagadorDoc || '').replace(/[^\d]/g, '');
        const candidatos = await fin.candidatosPorHistorico(db, { pagador: c.pagador, cpfMeio: cpfMeio.length >= 6 ? cpfMeio : '' });
        return json({ ok: true, id, duplicidade, candidatos }, 200, h);
      }
      case 'pendente':
        return json({ ok: true, conciliacao: await fin.conciliacaoPendente(db) }, 200, h);
      case 'paciente':
        return json({ ok: true, paciente: await fin.definirPaciente(db, b.id, b.paciente || {}) }, 200, h);
      case 'descartar':
        await fin.descartar(db, b.id);
        return json({ ok: true }, 200, h);
      case 'duplicidade':
        return json({ ok: true, duplicidade: await fin.duplicidade(db, b) }, 200, h);
      case 'lancar': {
        const id = await fin.lancar(db, b);
        const planilha = await fin.enviarParaPlanilha(db, env, id);
        return json({ ok: true, id, planilha, lancamento: await fin.lancamento(db, id) }, 200, h);
      }
      case 'lancamentos':
        return json({ ok: true, lancamentos: await fin.lancamentos(db, { dias: Math.min(400, Number(u.searchParams.get('dias')) || 60) }) }, 200, h);
      case 'sincronizar':
        return json({ ok: true, resultado: await fin.sincronizarPlanilha(db, env) }, 200, h);
      default:
        return json({ ok: false, erro: 'ação desconhecida' }, 400, h);
    }
  } catch (e) {
    if (e.status) return json({ ok: false, erro: e.message, duplicidade: e.duplicidade || null }, e.status, h);
    console.error('[financeiro]', acao, e.message);
    return json({ ok: false, erro: 'Erro no servidor: ' + e.message }, 500, h);
  }
}
