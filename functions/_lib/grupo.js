// Conciliação pelo grupo "Comprovantes de pagamento": cada mensagem de pagamento lida no WhatsApp Web vira uma linha.
// A chave é a própria mensagem (data, hora, autor e texto), então ler o grupo de novo não duplica nada.
// Ajustes feitos à mão na página (valor, total, telefone…) ficam em ajustes_json e nunca são apagados por uma nova leitura.
const TABELA = `CREATE TABLE IF NOT EXISTS fin_grupo (
  chave TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  hora TEXT,
  autor TEXT,
  registro_json TEXT NOT NULL,
  ajustes_json TEXT,
  ignorado INTEGER NOT NULL DEFAULT 0,
  lido_em TEXT NOT NULL
)`;
// Lote: o que o botão mandou do WhatsApp Web (mensagens + imagens/PDFs), guardado até a página processar (some depois).
const LOTE = `CREATE TABLE IF NOT EXISTS fin_lote (id TEXT PRIMARY KEY, criado_em TEXT NOT NULL, dados_json TEXT NOT NULL)`;
const LOTE_ARQ = `CREATE TABLE IF NOT EXISTS fin_lote_arquivo (lote TEXT NOT NULL, nome TEXT NOT NULL, tipo TEXT, dados BLOB NOT NULL, PRIMARY KEY (lote, nome))`;
let pronto = false;
async function preparar(db) {
  if (pronto) return;
  await db.prepare(TABELA).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS fin_grupo_data ON fin_grupo (data)').run();
  await db.prepare(LOTE).run();
  await db.prepare(LOTE_ARQ).run();
  pronto = true;
}

/** Chave do botão e da planilha: derivada da FINANCEIRO_SENHA (trocar a senha invalida botão e link antigos). */
export async function chave(senha, rotulo) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(senha)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(rotulo));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function criarLote(db, dados, arquivos) {
  await preparar(db);
  // Lotes com mais de 2 dias que ninguém abriu são apagados
  const velho = new Date(Date.now() - 2 * 86400000).toISOString();
  const { results } = await db.prepare('SELECT id FROM fin_lote WHERE criado_em < ?').bind(velho).all();
  for (const r of results) await apagarLote(db, r.id);
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('INSERT INTO fin_lote (id, criado_em, dados_json) VALUES (?, ?, ?)').bind(id, new Date().toISOString(), JSON.stringify(dados)).run();
  for (const a of arquivos) await db.prepare('INSERT OR REPLACE INTO fin_lote_arquivo (lote, nome, tipo, dados) VALUES (?, ?, ?, ?)').bind(id, a.nome, a.tipo, a.dados).run();
  return id;
}
export async function lote(db, id) {
  await preparar(db);
  const l = await db.prepare('SELECT * FROM fin_lote WHERE id = ?').bind(id).first();
  if (!l) return null;
  const { results } = await db.prepare('SELECT nome, tipo, length(dados) AS tamanho FROM fin_lote_arquivo WHERE lote = ?').bind(id).all();
  return { id, criadoEm: l.criado_em, dados: JSON.parse(l.dados_json), arquivos: results };
}
export async function arquivoDoLote(db, id, nome) {
  await preparar(db);
  return db.prepare('SELECT tipo, dados FROM fin_lote_arquivo WHERE lote = ? AND nome = ?').bind(id, nome).first();
}
export async function apagarLote(db, id) {
  await db.prepare('DELETE FROM fin_lote_arquivo WHERE lote = ?').bind(id).run();
  await db.prepare('DELETE FROM fin_lote WHERE id = ?').bind(id).run();
}

const CAMPOS_EDITAVEIS = ['nome', 'telefone', 'pago', 'total', 'consultaEm', 'consultaHora', 'tipo', 'restante', 'servico', 'forma', 'desconto'];
const limpo = (r) => ({
  data: String(r.data || '').slice(0, 10), hora: String(r.hora || '').slice(0, 5), autor: String(r.autor || '').slice(0, 80),
  nome: r.nome ? String(r.nome).slice(0, 120) : null, telefone: r.telefone ? String(r.telefone).slice(0, 20) : null,
  cpf: r.cpf ? String(r.cpf).slice(0, 11) : null, email: r.email ? String(r.email).slice(0, 120) : null,
  pago: Number.isFinite(Number(r.pago)) && r.pago !== null && r.pago !== '' ? Number(r.pago) : null,
  total: Number.isFinite(Number(r.total)) && r.total !== null && r.total !== '' ? Number(r.total) : null,
  pagoMensagem: Number.isFinite(Number(r.pagoMensagem)) && r.pagoMensagem !== null && r.pagoMensagem !== '' ? Number(r.pagoMensagem) : null,
  tipo: r.tipo === 'cirurgia' ? 'cirurgia' : 'consulta', restante: !!r.restante, retorno: !!r.retorno,
  servico: r.servico ? String(r.servico).slice(0, 40) : null, forma: r.forma ? String(r.forma).slice(0, 40) : null,
  desconto: Number.isFinite(Number(r.desconto)) && r.desconto !== null && r.desconto !== '' ? Number(r.desconto) : null,
  consultaEm: r.consultaEm ? String(r.consultaEm).slice(0, 10) : null, consultaHora: r.consultaHora ? String(r.consultaHora).slice(0, 5) : null,
  texto: String(r.texto || '').slice(0, 400), origem: r.origem === 'comprovante' ? 'comprovante' : 'mensagem',
  comprovante: r.comprovante && typeof r.comprovante === 'object' ? {
    valor: Number.isFinite(Number(r.comprovante.valor)) ? Number(r.comprovante.valor) : null, moeda: String(r.comprovante.moeda || 'BRL').slice(0, 5),
    data: String(r.comprovante.data || '').slice(0, 10), forma: String(r.comprovante.forma || '').slice(0, 40), pagador: String(r.comprovante.pagador || '').slice(0, 120),
    banco: String(r.comprovante.banco || '').slice(0, 60), idTransacao: String(r.comprovante.idTransacao || '').slice(0, 80), arquivo: String(r.comprovante.arquivo || '').slice(0, 80),
    tipo: String(r.comprovante.tipo || '').slice(0, 20), lido: !!r.comprovante.lido,
  } : null,
});

/** Grava as mensagens lidas. Devolve quantas eram novas. */
export async function gravar(db, registros) {
  await preparar(db);
  const agora = new Date().toISOString();
  let novos = 0;
  for (const r0 of (registros || []).slice(0, 2000)) {
    const r = limpo(r0);
    const chave = String(r0.chave || '').slice(0, 120);
    if (!chave || !/^\d{4}-\d{2}-\d{2}$/.test(r.data)) continue;
    // Ler de novo atualiza a linha (ex.: agora com o comprovante lido), mas nunca mexe nas correções feitas à mão.
    const antes = await db.prepare('SELECT 1 FROM fin_grupo WHERE chave = ?').bind(chave).first();
    await db.prepare(`INSERT INTO fin_grupo (chave, data, hora, autor, registro_json, lido_em) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chave) DO UPDATE SET registro_json = excluded.registro_json, lido_em = excluded.lido_em`)
      .bind(chave, r.data, r.hora, r.autor, JSON.stringify(r), agora).run();
    if (!antes) novos++;
  }
  return novos;
}

export async function listar(db) {
  await preparar(db);
  const { results } = await db.prepare('SELECT * FROM fin_grupo ORDER BY data, hora LIMIT 5000').all();
  return results.map((x) => ({ chave: x.chave, ignorado: !!x.ignorado, lidoEm: x.lido_em, ...JSON.parse(x.registro_json), ajustes: x.ajustes_json ? JSON.parse(x.ajustes_json) : {} }));
}

export async function ajustar(db, chave, campo, valor) {
  await preparar(db);
  if (campo === 'ignorado') {
    await db.prepare('UPDATE fin_grupo SET ignorado = ? WHERE chave = ?').bind(valor ? 1 : 0, chave).run();
    return true;
  }
  if (!CAMPOS_EDITAVEIS.includes(campo)) return false;
  const x = await db.prepare('SELECT ajustes_json FROM fin_grupo WHERE chave = ?').bind(chave).first();
  if (!x) return false;
  const aj = x.ajustes_json ? JSON.parse(x.ajustes_json) : {};
  if (valor === null || valor === '') delete aj[campo];
  else aj[campo] = ['pago', 'total', 'desconto'].includes(campo) ? Number(valor) : campo === 'restante' ? !!valor : String(valor).slice(0, 120);
  await db.prepare('UPDATE fin_grupo SET ajustes_json = ? WHERE chave = ?').bind(JSON.stringify(aj), chave).run();
  return true;
}
