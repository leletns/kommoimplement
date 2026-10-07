// Banco da Ficha Blue (Cloudflare D1, ligado ao projeto com o nome DB).
// Toda ficha é salva aqui ANTES de ir para o Kommo: se o Kommo falhar, nada se perde e a equipe vê na página /equipe.
// Sem o banco ligado, tudo continua funcionando só pelo Kommo.
const TABELA = `CREATE TABLE IF NOT EXISTS fichas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recebida_em TEXT NOT NULL,
  ver TEXT, lang TEXT,
  nome TEXT, nome_busca TEXT, cpf TEXT, celular TEXT, email TEXT,
  lead_id INTEGER, origem TEXT,
  status TEXT NOT NULL DEFAULT 'recebida',
  amigo TEXT, erro TEXT,
  dados_json TEXT NOT NULL
)`;
let pronto = false;
async function preparar(db) {
  if (pronto) return;
  await db.prepare(TABELA).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS fichas_recebida ON fichas (recebida_em)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS fichas_lead ON fichas (lead_id)').run();
  pronto = true;
}
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digitos = (s) => String(s || '').replace(/\D/g, '');

export async function salvarFicha(db, { ver, lang, d, dados }) {
  await preparar(db);
  const r = await db.prepare(`INSERT INTO fichas (recebida_em, ver, lang, nome, nome_busca, cpf, celular, email, dados_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(new Date().toISOString(), ver, lang, d.nome || '', normal(d.nome) + ' ' + normal(d.apelido),
    digitos(d.cpf) || null, digitos(d.cel) || null, String(d.mail || '').toLowerCase() || null, JSON.stringify(dados)).first();
  return r && r.id;
}

export async function atualizarFicha(db, id, { leadId = null, origem = null, status, amigo = null, erro = null, dados = null }) {
  await preparar(db);
  await db.prepare(`UPDATE fichas SET lead_id = COALESCE(?, lead_id), origem = COALESCE(?, origem), status = ?, amigo = COALESCE(?, amigo),
    erro = ?, dados_json = COALESCE(?, dados_json) WHERE id = ?`).bind(leadId, origem, status, amigo, erro, dados ? JSON.stringify(dados) : null, id).run();
}

const linha = (x) => ({ id: x.id, lead: x.lead_id, nome: x.nome, recebidaEm: Math.floor(Date.parse(x.recebida_em) / 1000), status: x.status, erro: x.erro, dados: JSON.parse(x.dados_json) });

export async function fichasRecentes(db, dias = 7) {
  await preparar(db);
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const { results } = await db.prepare('SELECT * FROM fichas WHERE recebida_em >= ? ORDER BY recebida_em DESC LIMIT 200').bind(desde).all();
  return results.map(linha);
}

export async function buscarFichas(db, q) {
  await preparar(db);
  const t = normal(q), dg = digitos(q);
  const { results } = dg.length >= 8
    ? await db.prepare('SELECT * FROM fichas WHERE celular LIKE ? OR cpf = ? ORDER BY recebida_em DESC LIMIT 30').bind('%' + dg.slice(-8), dg).all()
    : await db.prepare('SELECT * FROM fichas WHERE nome_busca LIKE ? OR email = ? ORDER BY recebida_em DESC LIMIT 30').bind('%' + t + '%', t).all();
  return results.map(linha);
}

export async function resumo(db) {
  await preparar(db);
  return db.prepare("SELECT COUNT(*) AS total, SUM(status = 'no_kommo') AS no_kommo, SUM(status <> 'no_kommo') AS pendentes FROM fichas").first();
}

/** Todas as fichas, da mais antiga para a mais nova (cópia de segurança). */
export async function todasFichas(db) {
  await preparar(db);
  const { results } = await db.prepare('SELECT * FROM fichas ORDER BY id').all();
  return results;
}
