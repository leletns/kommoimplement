'use strict';

/**
 * Busca de fichas para quem não usa o Kommo (concierge no Amigo/DocSignature):
 * procura a paciente pelo nome, celular ou e-mail e devolve a Ficha Blue gravada na nota do lead.
 */
const { MARCA_JSON } = require('./fichaBlue');

const lista = (r, chave) => (r && r._embedded && r._embedded[chave]) || [];

async function buscarFichas(q, { kommo, limite = 6 }) {
  const texto = String(q || '').trim();
  const digitos = texto.replace(/\D/g, '');
  if (texto.length < 3) return { ok: false, erro: 'Digite pelo menos 3 letras ou números.' };
  // Celular: busca pelos 8 últimos dígitos (o Kommo guarda com +55, DDD, espaços…)
  const termo = digitos.length >= 8 && digitos.length >= texto.replace(/\s/g, '').length - 4 ? digitos.slice(-8) : texto;
  const q2 = encodeURIComponent(termo);
  const [contatos, leads] = await Promise.all([
    kommo.request('get', `/contacts?query=${q2}&with=leads&limit=10`).catch(() => null),
    kommo.request('get', `/leads?query=${q2}&limit=10`).catch(() => null),
  ]);
  const ids = [];
  for (const c of lista(contatos, 'contacts')) for (const l of lista(c, 'leads')) if (!ids.includes(l.id)) ids.push(l.id);
  for (const l of lista(leads, 'leads')) if (!ids.includes(l.id)) ids.push(l.id);
  const fichas = [];
  let semFicha = 0;
  for (const id of ids.slice(0, limite)) {
    const notas = lista(await kommo.request('get', `/leads/${id}/notes?limit=100&order[id]=desc`).catch(() => null), 'notes');
    const nota = notas.find((n) => n.params && String(n.params.text || '').includes(MARCA_JSON));
    if (!nota) { semFicha++; continue; }
    try {
      const dados = JSON.parse(nota.params.text.split(MARCA_JSON)[1].trim());
      fichas.push({ lead: id, nome: dados.nome || '', recebidaEm: nota.created_at || null, dados });
    } catch { semFicha++; }
  }
  fichas.sort((a, b) => (b.recebidaEm || 0) - (a.recebidaEm || 0));
  return { ok: true, fichas, semFicha };
}

module.exports = { buscarFichas };
