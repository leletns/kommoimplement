'use strict';

/**
 * Lê as fontes de "consulta paga" e monta uma lista única de pacientes:
 *   - Exportação do grupo de WhatsApp "Comprovantes de pagamento" (fichas enviadas pela comercial)
 *   - Relatório de produtividade do AmigoClinic (CSV separado por ";")
 *
 * Nada aqui fala com o Kommo: é só leitura e consolidação (testável).
 */

const { parseExport } = require('../scripts/importarGrupo');
const { normalize } = require('./aliceEngine');

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

/** Telefone brasileiro normalizado: DDD + número (10 ou 11 dígitos), sem 55. */
function normPhone(raw) {
  let d = onlyDigits(raw);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return d;
  return null;
}

/** Os 8 últimos dígitos: casa "21 98765-4321" com "(21) 8765-4321" (número antigo sem o 9). */
const phoneKey = (p) => (p ? p.slice(-8) : null);

function normCpf(raw) {
  const d = onlyDigits(raw);
  return d.length === 11 ? d : null;
}

function normName(raw) {
  return normalize(raw)
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(de|da|do|das|dos|e)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "R$1.800,00" → 1800 */
function money(s) {
  const m = String(s || '').match(/R\$\s*([\d.]+(?:,\d{1,2})?)/i);
  if (!m) return null;
  return Number(m[1].replace(/\./g, '').replace(',', '.'));
}

/**
 * Linha de pagamento → { pago, total }.
 *   "R$900 de R$1800" → 900 de 1800 · "1/3 de R$1800 = R$600" → 600 de 1800 · "R$1800" → 1800
 */
function parsePagamento(line) {
  const valores = [...String(line).matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/gi)].map((m) =>
    Number(m[1].replace(/\./g, '').replace(',', '.'))
  );
  if (!valores.length) return null;
  const fracao = line.match(/(\d)\s*\/\s*(\d)\s*de\s*R\$/i);
  if (fracao) {
    const total = valores[0];
    const pago = valores[1] || Math.round((total * Number(fracao[1])) / Number(fracao[2]));
    return { pago, total };
  }
  if (/\bde\s*R\$/i.test(line) && valores.length >= 2) return { pago: valores[0], total: valores[1] };
  return { pago: valores[0], total: valores[0] };
}

const LABEL = (label) => new RegExp(`^\\s*\\*?(?:${label})\\*?\\s*[:\\-]?\\s*(.*)$`, 'i');
const RE = {
  nome: LABEL('nome(?: completo)?|nombre(?: completo)?|name|full name|paciente'),
  // "Restante pagamento: X", "Restante de pagamento da consulta: X", "Pagamento restante : X"…
  restante: /^\s*\*?(?:pagamento\s+)?restante(?:\s+(?:do|de|da))?(?:\s+pagamento)?(?:\s+(?:de|da|do))?(?:\s+(?:consulta|teleconsulta))?\*?\s*(?::\s*(.*))?$/i,
  tel: LABEL('tel(?:efone)?|tel[ée]fono|fone|phone(?: number)?|cel(?:ular)?|whats(?:app)?|contato'),
  cpf: LABEL('cpf'),
  email: /[\w.+-]+@[\w-]+\.[\w.]+/,
  pagamento: LABEL('pagamento|valor|pago'),
  cpfSolto: /^\s*\d{3}\.\d{3}\.\d{3}-\d{2}\s*$/,
  telSolto: /^\s*(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[\s.-]?\d{4}\s*$/,
};

function cleanName(s) {
  return String(s || '')
    .replace(/\([^)]*\)/g, ' ') // "(estrangeira)"
    .replace(/[.,;:]+\s*$/, '')
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '') // CPF colado no nome
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const looksLikeName = (raw) => {
  const s = String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/[.,;:]+$/, '').replace(/\.(?=\S)/g, '. ').trim();
  return /^[A-Za-zÀ-ÿ'´`^~. ]{5,}$/.test(s) && s.split(/\s+/).length >= 2 && !/^(restante|pagamento|consulta|teleconsulta|cirurgia)\b/i.test(s);
};

/** Data da consulta citada ("dia 26/02", "amanhã") → AAAA-MM-DD (ano pela data da mensagem). */
function consultaData(text, msgDate) {
  const [d, m, y] = msgDate.split('/').map(Number);
  if (/amanh[aã]/i.test(text)) {
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    return t.toISOString().slice(0, 10);
  }
  const mm = text.match(/\bdia\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/i);
  if (!mm) return null;
  const dd = Number(mm[1]);
  const mo = Number(mm[2]);
  let yy = mm[3] ? Number(mm[3].length === 2 ? `20${mm[3]}` : mm[3]) : y;
  if (!mm[3] && mo < m - 1) yy += 1; // consulta em janeiro marcada em dezembro
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

const isoFromBr = (br) => {
  const [d, m, y] = br.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
};

/**
 * Fichas de pagamento do grupo de WhatsApp. Cada ficha vira um registro:
 * { data, autor, nome, telefone, cpf, email, pago, total, tipo, restante, consultaEm, texto }
 */
function parseComprovantes(txt) {
  const out = [];
  for (const msg of parseExport(txt)) {
    const text = msg.text.replace(/<Mensagem editada>/gi, '').trim();
    if (text === '[mídia]' || /seja bem[- ]vind[ao] (a|à) cl[ií]nica/i.test(text)) continue;
    const lines = text.split('\n').map((l) => l.replace(/^[-•·]\s*/, '').trim()).filter(Boolean);
    const pagLine = lines.find((l) => RE.pagamento.test(l) && money(l) != null);
    // Segunda parte / restante de uma consulta já vendida: "Pagamento 2/2", "2/2 Joanna", "Restante…"
    const parcela = /\b(?:pagamento\s*)?2\s*\/\s*2\b|\bpagamento\s+restante\b/i.test(text);
    const restLine = lines.find((l) => RE.restante.test(l)) || (parcela ? lines.find((l) => /2\s*\/\s*2|restante/i.test(l)) : null);
    const cirurgiaParte = /cirurgia\s*\(?\s*parte/i.test(text);
    // "Segue pagamento da paciente X - Consulta Dra. Lorena" (Concierge)
    const segue = text.match(/segue pagamento d[ao]s?\s+pacientes?\s+(.+?)(?:\s+-\s+|\n|$)([\s\S]*)/i);
    // Ficha de cadastro enviada depois do pagamento (CPF + nome), mesmo sem linha de valor
    const ficha = /\b(cpf|passport|passaporte|identidade|id number)\b/i.test(text) && lines.length >= 3;
    if (!pagLine && !restLine && !cirurgiaParte && !segue && !ficha) continue;
    // Pagamentos que não são consulta (protocolos, exames, produtos) não entram
    const naoConsulta = /(protocolo|capilar|[aá]cido|doppler|exame|soro|vitamina|botox|preenchimento|bioestimulador)/i;
    if (segue && naoConsulta.test(segue[2] + ' ' + segue[1]) && !/consulta|tele/i.test(segue[2] + ' ' + segue[1])) continue;

    // Valor do rótulo: na mesma linha ou, se vazio, na linha seguinte ("Nome" ↵ "SILVIA CORREIA").
    const labelValue = (re) => {
      for (let i = 0; i < lines.length; i += 1) {
        const m = lines[i].match(re);
        if (!m) continue;
        const v = (m[1] || '').trim();
        if (v) return v;
        if (lines[i + 1] && !/:/.test(lines[i + 1])) return lines[i + 1];
      }
      return null;
    };
    let nome = null;
    const rotulo = labelValue(RE.nome);
    if (rotulo && looksLikeName(cleanName(rotulo))) nome = cleanName(rotulo);
    if (!nome && restLine) {
      const v = cleanName((restLine.match(RE.restante) || [])[1] || '');
      if (looksLikeName(v)) nome = v;
    }
    if (!nome) {
      const nf = text.match(/nota fiscal no nome de\s+([^\n]+)/i);
      if (nf) nome = cleanName(nf[1]);
    }
    if (!nome && segue) {
      const v = cleanName(segue[1].split(/\s+e\s+/)[0]);
      if (looksLikeName(v)) nome = v;
    }
    if (!nome) {
      // "Pagamento 2/2 | Fulana de Tal" / "Fulana de Tal | Pagamento 2/2" / primeira linha com o nome
      for (const l of lines.slice(0, 3)) {
        const v = cleanName(l.replace(/pagamento\s*\d\s*\/\s*\d|\d\s*\/\s*\d|pagamento|restante|consulta.*$|sp$/gi, ''));
        if (looksLikeName(v)) {
          nome = v;
          break;
        }
      }
    }

    let telefone = normPhone(labelValue(RE.tel));
    let cpf = null;
    for (const l of lines) {
      const c = l.match(RE.cpf);
      if (!cpf && c) cpf = normCpf(c[1]);
      if (!cpf && RE.cpfSolto.test(l)) cpf = normCpf(l);
      if (!telefone && RE.telSolto.test(l)) telefone = normPhone(l);
    }
    if (!cpf && restLine) cpf = normCpf((restLine.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/) || [])[0]);
    const email = (text.match(RE.email) || [])[0]?.toLowerCase() || null;

    const valores = pagLine ? parsePagamento(pagLine.match(RE.pagamento)[1] || pagLine) : null;
    const tipo = cirurgiaParte || (/cirurgia/i.test(text) && !/consulta|teleconsulta/i.test(text)) ? 'cirurgia' : 'consulta';

    if (!nome && !telefone && !cpf && !email) continue;
    out.push({
      data: isoFromBr(msg.date),
      autor: msg.author,
      nome,
      telefone,
      cpf,
      email,
      pago: valores ? valores.pago : null,
      total: valores ? valores.total : null,
      tipo,
      restante: Boolean(restLine) || parcela,
      retorno: /retorno/i.test(text),
      consultaEm: consultaData(text, msg.date),
      texto: text.slice(0, 400),
    });
  }
  return out;
}

/** CSV do AmigoClinic (";", com BOM). Agrupa por atendimento. */
function parseAmigoClinic(csvText) {
  const lines = csvText.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(';');
  const rows = lines.slice(1).map((l) => {
    const cols = l.split(';');
    return Object.fromEntries(header.map((h, i) => [h.trim(), (cols[i] || '').trim()]));
  });
  const byAtendimento = new Map();
  for (const r of rows) {
    const id = r['Cód. Atendimento'];
    if (!byAtendimento.has(id)) {
      const tipoAt = r['Tipo de Atendimento'] || '';
      byAtendimento.set(id, {
        atendimento: id,
        data: isoFromBr(r['Data do Agendamento']),
        agendadoEm: r['Agendado em'] ? isoFromBr(r['Agendado em']) : null,
        nome: cleanName(r.Paciente),
        telefone: normPhone(r.Telefone),
        cpf: normCpf(r.CPF),
        email: (r['E-mail'] || '').includes('@') ? r['E-mail'].toLowerCase() : null,
        tipo: /cirurgia/i.test(tipoAt) ? 'cirurgia' : 'consulta',
        tipoAtendimento: tipoAt,
        status: r['Status do Agendamento'],
        profissional: r.Profissional,
        formaPagamento: r['Forma de Pagamento'],
        comoConheceu: r['Como conheceu'],
        valor: 0,
      });
    }
    byAtendimento.get(id).valor += Number(String(r.Valor || '0').replace(',', '.')) || 0;
  }
  return [...byAtendimento.values()];
}

/**
 * Junta registros das duas fontes em pacientes únicos (por CPF, telefone ou e-mail;
 * por nome completo só quando não há nenhum outro identificador).
 */
function consolidarPacientes(registros) {
  const pacientes = [];
  const idx = new Map();
  const keysOf = (r) =>
    [
      r.cpf && `cpf:${r.cpf}`,
      r.telefone && `tel:${phoneKey(r.telefone)}`,
      r.email && `mail:${r.email}`,
      r.nome && normName(r.nome).split(' ').length >= 2 && `nome:${normName(r.nome)}`,
    ].filter(Boolean);

  for (const r of registros) {
    const keys = keysOf(r);
    let p = keys.map((k) => idx.get(k)).find(Boolean);
    if (!p) {
      p = { nome: null, telefones: new Set(), cpf: null, email: null, registros: [] };
      pacientes.push(p);
    }
    p.registros.push(r);
    if (r.nome && (!p.nome || r.nome.length > p.nome.length)) p.nome = r.nome;
    if (r.telefone) p.telefones.add(r.telefone);
    p.cpf = p.cpf || r.cpf;
    p.email = p.email || r.email;
    for (const k of keysOf(p.registros.length ? { ...r, cpf: p.cpf, email: p.email } : r)) idx.set(k, p);
    for (const t of p.telefones) idx.set(`tel:${phoneKey(t)}`, p);
  }

  return pacientes.map((p) => {
    const regs = p.registros.sort((a, b) => a.data.localeCompare(b.data));
    // Consulta paga: ficha no grupo de comprovantes, ou atendimento do AmigoClinic que não está "Pendente".
    const pagou = (r) => r.fonte !== 'amigoclinic' || !/pendente/i.test(r.formaPagamento || '');
    const consultas = regs.filter((r) => r.tipo === 'consulta' && pagou(r));
    const cirurgias = regs.filter((r) => r.tipo === 'cirurgia');
    // Data do ganho: 1º pagamento no grupo; no AmigoClinic, o dia em que a consulta foi agendada.
    const dataDe = (r) => (r.fonte === 'amigoclinic' ? r.agendadoEm || r.data : r.data);
    // Venda = 1ª ficha do grupo que não é parcela (2/2, restante); senão, a 1ª ficha; senão, o AmigoClinic.
    const primeiroPagamento =
      consultas.find((r) => r.fonte === 'whatsapp' && !r.restante) ||
      consultas.find((r) => r.fonte === 'whatsapp') ||
      consultas[0] ||
      null;
    const totalConsulta = Math.max(0, ...consultas.map((r) => r.total || r.valor || 0));
    return {
      nome: p.nome,
      telefones: [...p.telefones],
      cpf: p.cpf,
      email: p.email,
      fontes: [...new Set(regs.map((r) => r.fonte))],
      noGrupo: consultas.some((r) => r.fonte === 'whatsapp'),
      consultaPaga: consultas.length > 0,
      cirurgia: cirurgias.length > 0,
      dataGanho: primeiroPagamento ? dataDe(primeiroPagamento) : null,
      consultaEm: (consultas.find((r) => r.consultaEm) || consultas.find((r) => r.fonte === 'amigoclinic') || {}).consultaEm ||
        (consultas.find((r) => r.fonte === 'amigoclinic') || {}).data || null,
      pendente: regs.some((r) => r.fonte === 'amigoclinic' && /pendente/i.test(r.formaPagamento || '')),
      valorConsulta: totalConsulta || null,
      valorCirurgia: cirurgias.reduce((a, r) => a + (r.valor || 0), 0) || null,
      registros: regs.length,
    };
  });
}

module.exports = { parseComprovantes, parseAmigoClinic, consolidarPacientes, normPhone, phoneKey, normName, parsePagamento, consultaData };
