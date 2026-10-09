'use strict';

/**
 * Lê as fontes de "consulta paga" e monta uma lista única de pacientes:
 *   - Exportação do grupo de WhatsApp "Comprovantes de pagamento" (fichas enviadas pela comercial)
 *   - Relatório de produtividade do AmigoClinic (CSV separado por ";")
 *
 * Nada aqui fala com o Kommo: é só leitura e consolidação (testável).
 */

const G = require('../../ficha/js/grupo-comprovantes.js');
const { parseComprovantes, parsePagamento, consultaData, consultaHora, normPhone, phoneKey, normCpf, normName, cleanName } = G;
const isoFromBr = (br) => {
  const [d, m, y] = br.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
};

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
        hora: /^\d{1,2}:\d{2}$/.test(r['Hora do Agendamento'] || '') ? r['Hora do Agendamento'] : null,
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
      // Fichas de consulta do grupo de comprovantes, em ordem (valores e data da consulta de cada venda).
      fichas: consultas.filter((r) => r.fonte === 'whatsapp'),
      valorCirurgia: cirurgias.reduce((a, r) => a + (r.valor || 0), 0) || null,
      registros: regs.length,
    };
  });
}

module.exports = { parseComprovantes, parseAmigoClinic, consolidarPacientes, normPhone, phoneKey, normName, parsePagamento, consultaData, consultaHora };
