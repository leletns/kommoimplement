// /api/conciliacao-planilha?k=<chave> → planilha da conciliação em CSV, uma paciente por linha (fórmula IMPORTDATA no Google Planilhas).
// A chave aparece na página /conciliacao (depois da senha) e muda quando a FINANCEIRO_SENHA muda. Só leitura.
import G from '../../ficha/js/grupo-comprovantes.js';
import * as grupo from '../_lib/grupo.js';
import { igual } from '../_lib/comum.js';
import { senhaFinanceiro } from './conciliacao.js';

const brl = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));
const br = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const cel = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export async function onRequest({ request, env }) {
  const txt = (b, s) => new Response(b, { status: s, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  const senha = senhaFinanceiro(env);
  if (!senha || !env.DB) return txt('Conciliação não configurada.', 503);
  if (!igual(new URL(request.url).searchParams.get('k') || '', await grupo.chave(senha, 'planilha-conciliacao-v1'))) return txt('Link da planilha inválido.', 401);
  const pac = G.planilhaPorPaciente(await grupo.listar(env.DB));
  const linhas = [['Paciente', 'Telefone', 'Tipo', 'Consulta', 'Total', 'Recebido', 'Falta', 'Pagamentos', 'Faltando no grupo']];
  for (const p of pac) linhas.push([p.nome || '', p.telefone || '', p.tipo, br(p.consultaEm) + (p.consultaHora ? ' ' + p.consultaHora : ''), brl(p.total), brl(p.pago), brl(p.falta),
    p.linhas.map((l) => br(l.data) + ' ' + (l.valor == null ? '?' : 'R$ ' + brl(l.valor)) + (l.calculado ? ' (calculado)' : '')).join(' | '), p.faltando.join(', ')]);
  return new Response(linhas.map((l) => l.map(cel).join(',')).join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });
}
