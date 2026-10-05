// Controle financeiro da GESTÃO (conciliação de comprovantes). Separado da Ficha Blue e da Comercial:
// tabelas próprias no D1 (binding DB) e senha própria (FINANCEIRO_SENHA).
// A PLANILHA da gestão (Google Sheets) recebe cada lançamento confirmado pelo Apps Script (FINANCEIRO_PLANILHA_URL).
// O D1 guarda o histórico e é quem barra a duplicidade (índices únicos); a planilha é o controle que a gestão acompanha.

const TABELAS = [
  `CREATE TABLE IF NOT EXISTS fin_conciliacoes (
    id TEXT PRIMARY KEY,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'aguardando_paciente',
    origem TEXT,
    hash_comprovante TEXT,
    comprovante_json TEXT NOT NULL,
    paciente_json TEXT,
    lancamento_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS fin_lancamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data_pagamento TEXT,
    data_comprovante TEXT,
    hora TEXT,
    paciente TEXT NOT NULL,
    paciente_id_amigo TEXT,
    paciente_cpf TEXT,
    pagador TEXT,
    pagador_doc TEXT,
    valor_centavos INTEGER NOT NULL,
    moeda TEXT NOT NULL DEFAULT 'BRL',
    forma TEXT,
    banco TEXT,
    instituicao_recebedora TEXT,
    recebedor TEXT,
    id_transacao TEXT,
    tipo_id TEXT,
    hash_comprovante TEXT,
    referencia_comprovante TEXT,
    status TEXT NOT NULL,
    divergencias TEXT,
    confirmado_em TEXT NOT NULL,
    responsavel TEXT NOT NULL,
    observacoes TEXT,
    origem TEXT,
    confianca REAL,
    corrigidos TEXT,
    planilha TEXT NOT NULL DEFAULT 'pendente',
    planilha_erro TEXT
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS fin_lanc_idtx ON fin_lancamentos (id_transacao) WHERE id_transacao IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS fin_lanc_hash ON fin_lancamentos (hash_comprovante) WHERE hash_comprovante IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS fin_lanc_data ON fin_lancamentos (data_pagamento)',
];
// Dados da mensagem enviada junto com o comprovante (WhatsApp): quem é a paciente, o que foi pago e de quê.
const COLUNAS_MENSAGEM = ['paciente_mensagem TEXT', 'procedimento TEXT', 'consulta_em TEXT', 'parcela TEXT', 'total_centavos INTEGER', 'falta_centavos INTEGER', 'desconto INTEGER', 'mensagem TEXT', 'categoria TEXT', 'itens TEXT'];
let pronto = false;
async function preparar(db) {
  if (pronto) return;
  for (const sql of TABELAS) await db.prepare(sql).run();
  const { results } = await db.prepare('PRAGMA table_info(fin_lancamentos)').all();
  const tem = new Set(results.map((r) => r.name));
  for (const c of COLUNAS_MENSAGEM) if (!tem.has(c.split(' ')[0])) await db.prepare('ALTER TABLE fin_lancamentos ADD COLUMN ' + c).run();
  pronto = true;
}

const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digitos = (s) => String(s || '').replace(/\D/g, '');
const agora = () => new Date().toISOString();
const iso = (br) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const limpo = (s, n = 200) => (s == null ? null : String(s).slice(0, n).trim() || null);

/** Comprovante lido na página → conciliação aguardando a paciente (conferência no AmigoApp). */
export async function criarConciliacao(db, { comprovante, hash, origem }) {
  await preparar(db);
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO fin_conciliacoes (id, criado_em, atualizado_em, origem, hash_comprovante, comprovante_json) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, agora(), agora(), limpo(origem), limpo(hash, 100), JSON.stringify(comprovante)).run();
  return id;
}

const conc = (x) => x && ({ id: x.id, criadoEm: x.criado_em, status: x.status, origem: x.origem, hash: x.hash_comprovante, comprovante: JSON.parse(x.comprovante_json), paciente: x.paciente_json ? JSON.parse(x.paciente_json) : null, lancamentoId: x.lancamento_id });

export async function conciliacao(db, id) {
  await preparar(db);
  return conc(await db.prepare('SELECT * FROM fin_conciliacoes WHERE id = ?').bind(id).first());
}

/** A conciliação mais recente ainda sem lançamento (o botão no AmigoApp usa esta). */
export async function conciliacaoPendente(db) {
  await preparar(db);
  return conc(await db.prepare("SELECT * FROM fin_conciliacoes WHERE status <> 'lancada' AND status <> 'descartada' AND criado_em >= ? ORDER BY criado_em DESC LIMIT 1")
    .bind(new Date(Date.now() - 12 * 3600e3).toISOString()).first());
}

/** Paciente conferida no AmigoApp (lida da tela do Amigo pelo botão) → vinculada à conciliação. */
export async function definirPaciente(db, id, paciente) {
  await preparar(db);
  const p = { nome: limpo(paciente.nome), idAmigo: limpo(paciente.idAmigo, 60), cpf: limpo(paciente.cpf, 20), celular: limpo(paciente.celular, 30), nascimento: limpo(paciente.nascimento, 20), fonte: limpo(paciente.fonte, 60), url: limpo(paciente.url, 300) };
  if (!p.nome) throw Object.assign(new Error('Paciente sem nome.'), { status: 400 });
  const r = await db.prepare("UPDATE fin_conciliacoes SET paciente_json = ?, status = 'paciente_conferida', atualizado_em = ? WHERE id = ? AND status <> 'lancada'").bind(JSON.stringify(p), agora(), id).run();
  if (!r.meta || !r.meta.changes) throw Object.assign(new Error('Conciliação não encontrada ou já lançada.'), { status: 404 });
  return p;
}

/** A gestão corrigiu os dados ou a mensagem: atualiza o que o botão do AmigoApp vai comparar. */
export async function atualizarComprovante(db, id, comprovante) {
  await preparar(db);
  await db.prepare("UPDATE fin_conciliacoes SET comprovante_json = ?, atualizado_em = ? WHERE id = ? AND status <> 'lancada'").bind(JSON.stringify(comprovante || {}), agora(), id).run();
}

export async function descartar(db, id) {
  await preparar(db);
  await db.prepare("UPDATE fin_conciliacoes SET status = 'descartada', atualizado_em = ? WHERE id = ? AND status <> 'lancada'").bind(agora(), id).run();
}

const lanc = (x) => x && ({
  id: x.id, dataPagamento: x.data_pagamento, dataComprovante: x.data_comprovante, hora: x.hora, paciente: x.paciente, pacienteIdAmigo: x.paciente_id_amigo,
  pagador: x.pagador, valor: x.valor_centavos / 100, moeda: x.moeda, forma: x.forma, banco: x.banco, recebedor: x.recebedor, idTransacao: x.id_transacao,
  status: x.status, divergencias: x.divergencias ? JSON.parse(x.divergencias) : [], confirmadoEm: x.confirmado_em, responsavel: x.responsavel,
  observacoes: x.observacoes, origem: x.origem, confianca: x.confianca, planilha: x.planilha, planilhaErro: x.planilha_erro, referencia: x.referencia_comprovante,
  pacienteMensagem: x.paciente_mensagem, procedimento: x.procedimento, consultaEm: x.consulta_em, parcela: x.parcela,
  total: x.total_centavos == null ? null : x.total_centavos / 100, falta: x.falta_centavos == null ? null : x.falta_centavos / 100, desconto: x.desconto, mensagem: x.mensagem,
  categoria: x.categoria, itens: x.itens,
});

/**
 * Duplicidade: 'certa' (mesmo ID da transação ou mesmo arquivo) bloqueia;
 * 'provavel' (mesmo valor + mesma data + mesmo pagador ou paciente) só deixa lançar com confirmação explícita.
 */
export async function duplicidade(db, { idTransacao, hash, valor, data, pagador, paciente }) {
  await preparar(db);
  const certos = [];
  if (idTransacao) certos.push(...(await db.prepare('SELECT * FROM fin_lancamentos WHERE id_transacao = ?').bind(String(idTransacao).trim()).all()).results.map((r) => ({ ...lanc(r), motivo: 'mesmo ID da transação' })));
  if (hash) certos.push(...(await db.prepare('SELECT * FROM fin_lancamentos WHERE hash_comprovante = ?').bind(hash).all()).results.filter((r) => !certos.some((c) => c.id === r.id)).map((r) => ({ ...lanc(r), motivo: 'mesmo arquivo de comprovante' })));
  if (certos.length) return { tipo: 'certa', lancamentos: certos };
  const dia = iso(data), cent = Math.round(Number(valor) * 100);
  if (dia && cent > 0) {
    const { results } = await db.prepare('SELECT * FROM fin_lancamentos WHERE data_pagamento = ? AND valor_centavos = ?').bind(dia, cent).all();
    const pg = normal(pagador), pc = normal(paciente);
    const provaveis = results.filter((r) => (pg && normal(r.pagador) === pg) || (pc && normal(r.paciente) === pc)).map((r) => ({ ...lanc(r), motivo: 'mesmo valor, mesma data e mesmo ' + (pg && normal(r.pagador) === pg ? 'pagador' : 'paciente') }));
    if (provaveis.length) return { tipo: 'provavel', lancamentos: provaveis };
  }
  return { tipo: 'nenhuma', lancamentos: [] };
}

/** Grava o lançamento confirmado pela gestão. Lança erro 409 se for duplicado. */
export async function lancar(db, e) {
  await preparar(db);
  const valor = Number(e.valor);
  if (!(valor > 0)) throw Object.assign(new Error('Valor inválido.'), { status: 400 });
  if (!limpo(e.paciente)) throw Object.assign(new Error('Paciente não identificada: não é possível lançar.'), { status: 400 });
  if (!limpo(e.responsavel, 80)) throw Object.assign(new Error('Informe quem está confirmando.'), { status: 400 });
  const dup = await duplicidade(db, e);
  if (dup.tipo === 'certa') throw Object.assign(new Error('PAGAMENTO JÁ REGISTRADO'), { status: 409, duplicidade: dup });
  if (dup.tipo === 'provavel' && !e.confirmarNaoDuplicado) throw Object.assign(new Error('POSSÍVEL PAGAMENTO JÁ REGISTRADO'), { status: 409, duplicidade: dup });
  const divergencias = Array.isArray(e.divergencias) ? e.divergencias.map((d) => limpo(d, 400)).filter(Boolean) : [];
  if (divergencias.length && !e.confirmarDivergencia) throw Object.assign(new Error('Há divergências: confirme que conferiu antes de lançar.'), { status: 422 });
  const status = divergencias.length ? 'conferido_com_divergencia' : 'conferido';
  try {
    const r = await db.prepare(`INSERT INTO fin_lancamentos (data_pagamento, data_comprovante, hora, paciente, paciente_id_amigo, paciente_cpf, pagador, pagador_doc,
      valor_centavos, moeda, forma, banco, instituicao_recebedora, recebedor, id_transacao, tipo_id, hash_comprovante, referencia_comprovante, status, divergencias,
      confirmado_em, responsavel, observacoes, origem, confianca, corrigidos,
      paciente_mensagem, procedimento, consulta_em, parcela, total_centavos, falta_centavos, desconto, mensagem, categoria, itens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(
      iso(e.data), limpo(e.data, 20), limpo(e.hora, 10), limpo(e.paciente), limpo(e.pacienteIdAmigo, 60), digitos(e.pacienteCpf) || null, limpo(e.pagador), limpo(e.pagadorDoc, 30),
      Math.round(valor * 100), e.moeda === 'USD' ? 'USD' : 'BRL', limpo(e.forma, 40), limpo(e.banco, 60), limpo(e.bancoRecebedor, 60), limpo(e.recebedor), limpo(e.idTransacao, 80), limpo(e.tipoId, 40),
      limpo(e.hash, 100), limpo(e.referencia, 300), status, divergencias.length ? JSON.stringify(divergencias) : null,
      agora(), limpo(e.responsavel, 80), limpo(e.observacoes, 1000), limpo(e.origem, 120), Number.isFinite(Number(e.confianca)) ? Number(e.confianca) : null,
      Array.isArray(e.corrigidos) && e.corrigidos.length ? e.corrigidos.join(', ') : null,
      ...(() => {
        const m = e.mensagem || {};
        const cent = (v) => (Number(v) > 0 ? Math.round(Number(v) * 100) : null);
        return [limpo(m.nome), limpo(m.procedimento, 120), limpo(m.consultaEm, 20), limpo(m.parcela, 20), cent(m.total), m.falta === 0 ? 0 : cent(m.falta),
          Number.isFinite(Number(m.desconto)) && m.desconto !== undefined && m.desconto !== null ? Number(m.desconto) : null, limpo(m.texto, 1500),
          limpo(m.categoria, 120), limpo(m.resumoItens, 400)];
      })()).first();
    if (e.conciliacaoId) await db.prepare("UPDATE fin_conciliacoes SET status = 'lancada', lancamento_id = ?, atualizado_em = ? WHERE id = ?").bind(r.id, agora(), e.conciliacaoId).run();
    return r.id;
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) throw Object.assign(new Error('PAGAMENTO JÁ REGISTRADO'), { status: 409, duplicidade: await duplicidade(db, e) });
    throw err;
  }
}

export async function lancamento(db, id) {
  await preparar(db);
  return lanc(await db.prepare('SELECT * FROM fin_lancamentos WHERE id = ?').bind(id).first());
}

export async function lancamentos(db, { dias = 60, limite = 300 } = {}) {
  await preparar(db);
  const desde = new Date(Date.now() - dias * 86400e3).toISOString();
  const { results } = await db.prepare('SELECT * FROM fin_lancamentos WHERE confirmado_em >= ? ORDER BY confirmado_em DESC LIMIT ?').bind(desde, limite).all();
  return results.map(lanc);
}

/** Lançamentos antigos do mesmo pagador → pacientes já vinculados a ele (candidatos, nunca escolhidos sozinhos). */
export async function candidatosPorHistorico(db, { pagador, cpfMeio, pacienteMensagem }) {
  await preparar(db);
  const pg = normal(pagador), pm = normal(pacienteMensagem);
  if (!pg && !pm) return [];
  const { results } = await db.prepare('SELECT paciente, paciente_id_amigo, paciente_cpf, pagador, pagador_doc, MAX(confirmado_em) AS ultimo, COUNT(*) AS n FROM fin_lancamentos GROUP BY paciente, paciente_id_amigo, pagador').all();
  return results.filter((r) => (pg && normal(r.pagador) === pg) || (pm && normal(r.paciente) === pm) || (cpfMeio && digitos(r.pagador_doc).includes(cpfMeio)))
    .map((r) => ({ nome: r.paciente, idAmigo: r.paciente_id_amigo, cpf: r.paciente_cpf, fonte: 'histórico de lançamentos (' + r.n + 'x, pago por ' + r.pagador + ')' }));
}

// ---------- planilha (Google Sheets via Apps Script) ----------
export const COLUNAS = ['Lançamento', 'Data do pagamento', 'Data do comprovante', 'Hora', 'Paciente', 'ID AmigoApp', 'Pagador', 'Doc. pagador', 'Valor', 'Moeda',
  'Forma', 'Banco', 'Instituição recebedora', 'Recebedor', 'ID da transação / Pix', 'Tipo do ID', 'Referência do comprovante', 'Status', 'Divergências',
  'Confirmado em', 'Responsável', 'Observações', 'Origem', 'Confiança da leitura',
  'Paciente (mensagem)', 'Procedimento (mensagem)', 'Consulta (mensagem)', 'Parcela', 'Total', 'Falta pagar', 'Desconto (%)', 'Categoria', 'Itens pagos'];

export function linhaPlanilha(l) {
  const br = (isoD) => (isoD ? isoD.slice(8, 10) + '/' + isoD.slice(5, 7) + '/' + isoD.slice(0, 4) : '');
  const conf = new Date(l.confirmadoEm);
  return [l.id, br(l.dataPagamento), l.dataComprovante || '', l.hora || '', l.paciente, l.pacienteIdAmigo || '', l.pagador || '', l.pagadorDoc || '', l.valor, l.moeda,
    l.forma || '', l.banco || '', l.instituicaoRecebedora || '', l.recebedor || '', l.idTransacao || '', l.tipoId || '', l.referencia || '',
    { conferido: 'Conferido', conferido_com_divergencia: 'Conferido com divergência' }[l.status] || l.status, (l.divergencias || []).join(' | '),
    conf.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), l.responsavel, l.observacoes || '', l.origem || '', l.confianca == null ? '' : Math.round(l.confianca * 100) + '%',
    l.pacienteMensagem || '', l.procedimento || '', l.consultaEm || '', { reserva: 'Reserva (1ª parte)', restante: 'Restante (2ª parte)', integral: 'Integral', sinal: 'Sinal' }[l.parcela] || '',
    l.total == null ? '' : l.total, l.falta == null ? '' : l.falta, l.desconto == null ? '' : l.desconto, l.categoria || '', l.itens || ''];
}

/** Envia o lançamento para a planilha. Nunca derruba o lançamento: se falhar, fica 'pendente' para reenviar. */
export async function enviarParaPlanilha(db, env, id, fetchImpl = fetch) {
  const url = env.FINANCEIRO_PLANILHA_URL, chave = env.FINANCEIRO_PLANILHA_CHAVE;
  if (!url || !chave) {
    await db.prepare("UPDATE fin_lancamentos SET planilha = 'pendente', planilha_erro = ? WHERE id = ?").bind('planilha não configurada (FINANCEIRO_PLANILHA_URL / FINANCEIRO_PLANILHA_CHAVE)', id).run();
    return { ok: false, erro: 'planilha não configurada' };
  }
  const l = await db.prepare('SELECT * FROM fin_lancamentos WHERE id = ?').bind(id).first();
  const dados = { ...lanc(l), pagadorDoc: l.pagador_doc, tipoId: l.tipo_id, instituicaoRecebedora: l.instituicao_recebedora };
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ chave, acao: 'lancar', colunas: COLUNAS, linha: linhaPlanilha(dados) }), redirect: 'follow' });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* resposta não-JSON */ }
    if (!r.ok || !j || !j.ok) throw new Error((j && j.erro) || `HTTP ${r.status}`);
    await db.prepare("UPDATE fin_lancamentos SET planilha = ?, planilha_erro = NULL WHERE id = ?").bind(j.duplicado ? 'ok (já estava)' : 'ok', id).run();
    return { ok: true, linha: j.linha, duplicado: !!j.duplicado };
  } catch (err) {
    await db.prepare("UPDATE fin_lancamentos SET planilha = 'erro', planilha_erro = ? WHERE id = ?").bind(String(err.message).slice(0, 300), id).run();
    return { ok: false, erro: err.message };
  }
}

/** Reenvia para a planilha tudo o que ficou pendente ou com erro. */
export async function sincronizarPlanilha(db, env, fetchImpl = fetch) {
  await preparar(db);
  const { results } = await db.prepare("SELECT id FROM fin_lancamentos WHERE planilha NOT LIKE 'ok%' ORDER BY id LIMIT 100").all();
  const out = [];
  for (const r of results) out.push({ id: r.id, ...(await enviarParaPlanilha(db, env, r.id, fetchImpl)) });
  return out;
}
