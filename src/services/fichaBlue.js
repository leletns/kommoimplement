'use strict';

/**
 * Ficha Blue: link pessoal por lead → a paciente preenche → nota + etiqueta + tarefa no Kommo
 * e cadastro no AmigoClinic (pela API, sem duplicar quem já existe).
 *
 * O código do link é "<lead em base 36>-<assinatura>", assinado com FICHA_SEGREDO
 * (ou derivado do KOMMO_TOKEN): ninguém consegue montar o link de outro lead.
 */
const crypto = require('crypto');

const CAMPO_CONSULTA = Number(process.env.KOMMO_CONSULTA_FIELD_ID || 3728948);
const CAMPO_PRIMEIRO_NOME = Number(process.env.KOMMO_PRIMEIRO_NOME_FIELD_ID || 3837314);
const ETIQUETA = 'ficha_recebida';
const MARCA_JSON = 'FICHA_BLUE_JSON:';

function segredoPadrao(env = process.env) {
  if (env.FICHA_SEGREDO) return env.FICHA_SEGREDO;
  if (!env.KOMMO_TOKEN) throw new Error('Defina FICHA_SEGREDO (ou KOMMO_TOKEN) para assinar os links da ficha');
  return crypto.createHmac('sha256', env.KOMMO_TOKEN).update('ficha-blue').digest('hex');
}

const assinatura = (leadId, segredo) =>
  crypto.createHmac('sha256', segredo).update(`ficha:${leadId}`).digest('base64url').slice(0, 10);

function codigoFicha(leadId, segredo = segredoPadrao()) {
  const id = Number(leadId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('lead inválido');
  return `${id.toString(36)}-${assinatura(id, segredo)}`;
}

/** Devolve o id do lead se o código for válido; senão null. */
function lerCodigo(codigo, segredo = segredoPadrao()) {
  const m = /^([0-9a-z]{1,12})-([A-Za-z0-9_-]{10})$/.exec(String(codigo || '').trim());
  if (!m) return null;
  const id = parseInt(m[1], 36);
  const esperado = Buffer.from(assinatura(id, segredo));
  const recebido = Buffer.from(m[2]);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido) ? id : null;
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}

const UF = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/** Celular brasileiro como o Amigo espera ("21999998888"); null se for de fora. */
function celularBR(v) {
  const bruto = String(v || '').trim();
  let d = soDigitos(bruto);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  else if (/^\+/.test(bruto) || /^00/.test(bruto)) return null;
  return d.length === 10 || d.length === 11 ? d : null;
}

const CAMPOS_TEXTO = ['nome', 'cpf', 'documento', 'rg', 'nasc', 'sexo', 'estadoCivil', 'prof', 'cel', 'mail', 'instagram', 'cep', 'rua', 'numero',
  'compl', 'bairro', 'cidade', 'uf', 'pais', 'end', 'plano', 'alt', 'peso', 'diag', 'dor', 'med', 'cirP', 'quer', 'como', 'quem'];
const CAMPOS_LISTA = ['reg', 'area'];

/** Limpa o que veio do navegador: só campos conhecidos, texto curto. */
function limparDados(bruto = {}) {
  const d = {};
  for (const k of CAMPOS_TEXTO) {
    if (bruto[k] == null) continue;
    const v = String(bruto[k]).replace(/\s+/g, ' ').trim().slice(0, k === 'med' || k === 'quer' || k === 'cirP' ? 1500 : 200);
    if (v) d[k] = v;
  }
  for (const k of CAMPOS_LISTA) {
    if (Array.isArray(bruto[k])) d[k] = bruto[k].map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 12);
  }
  d.cons = bruto.cons === true;
  return d;
}

function validar(d) {
  const erros = [];
  if (!d.nome || d.nome.split(' ').length < 2) erros.push('nome');
  if (d.cpf && !cpfValido(d.cpf)) erros.push('cpf');
  if (d.nasc && !/^\d{4}-\d{2}-\d{2}$/.test(d.nasc)) erros.push('nasc');
  if (!d.cons) erros.push('cons');
  return erros;
}

const nomeProprio = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (x) => x.toLowerCase());
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/** Corpo do POST /patients do Amigo (só os campos que a API aceita). */
function paraAmigo(d, ver) {
  const p = { name: nomeProprio(d.nome) };
  const sexo = d.sexo || (ver === 'lip' ? 'Feminino' : '');
  if (['Feminino', 'Masculino'].includes(sexo)) p.gender = sexo;
  const cel = celularBR(d.cel);
  if (cel) p.contact_cellphone = cel;
  if (d.mail && /@/.test(d.mail)) p.email = d.mail.toLowerCase();
  if (cpfValido(d.cpf)) p.cpf = soDigitos(d.cpf);
  if (d.cep) p.address_cep = soDigitos(d.cep) || d.cep;
  if (d.rua || d.end) p.address_address = d.rua || d.end;
  if (d.numero) p.address_number = d.numero;
  if (d.bairro) p.address_district = d.bairro;
  if (d.cidade) p.address_city = d.cidade;
  if (d.uf) p.address_state = UF[d.uf.toUpperCase()] || d.uf;
  p.address_country = d.pais || 'Brasil';
  if (d.prof) p.jobrole = d.prof;
  if (d.estadoCivil) p.civil_status = d.estadoCivil.slice(0, 25);
  return p;
}

/** Mesma forma da ficha do WhatsApp: o botão "Preencher cadastro" completa no Amigo o que a API não aceita. */
function paraBotao(d, leadId) {
  const conheceu = d.como ? d.como + (d.quem ? ' - ' + d.quem : '') : '';
  const out = {
    nome: nomeProprio(d.nome), cpf: d.cpf || d.documento, rg: d.rg, nascimento: dataBR(d.nasc), sexo: d.sexo, profissao: d.prof,
    estadoCivil: d.estadoCivil, telefone: d.cel, email: d.mail, instagram: d.instagram, rua: d.rua || d.end, numero: d.numero,
    complemento: d.compl, bairro: d.bairro, cidade: d.cidade, estado: d.uf, cep: d.cep, plano: d.plano, objetivo: d.quer,
    comoConheceu: conheceu, indicacao: /indica|referr|recomend/i.test(d.como || '') ? d.quem : undefined, _lead: leadId,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ''));
}

function textoNota(d, { ver, lang, amigo, quando }) {
  const L = (rotulo, v) => (v && (!Array.isArray(v) || v.length) ? `${rotulo}: ${Array.isArray(v) ? v.join(', ') : v}` : null);
  const endereco = [d.rua || d.end, d.numero, d.compl, d.bairro, d.cidade, d.uf, d.cep, d.pais].filter(Boolean).join(', ');
  const amigoTxt = !amigo ? null
    : amigo.status === 'criado' ? `✅ AmigoClinic: paciente cadastrada (#${amigo.id}). Complete nascimento, RG, complemento e "Como nos conheceu" com o botão Preencher cadastro.`
      : amigo.status === 'existia' ? `ℹ️ AmigoClinic: paciente já existia (#${amigo.id}). Nada foi alterado lá; confira os dados.`
        : `⚠️ AmigoClinic: não cadastrou (${amigo.erro}). Use os botões Copiar ficha → Preencher cadastro.`;
  return [
    `📋 FICHA BLUE recebida (${ver === 'pla' ? 'Plástica' : 'Lipedema'} · ${String(lang || 'pt').toUpperCase()}) em ${quando}`,
    '',
    '👤 Dados',
    L('Nome', nomeProprio(d.nome)), L('CPF', d.cpf), L('Documento', d.documento), L('RG', d.rg), L('Nascimento', dataBR(d.nasc)),
    L('Sexo', d.sexo), L('Estado civil', d.estadoCivil), L('Profissão', d.prof), L('Celular', d.cel), L('E-mail', d.mail),
    L('Instagram', d.instagram), L('Endereço', endereco), L('Plano de saúde', d.plano),
    '',
    '🩺 Saúde',
    L('Altura (cm)', d.alt), L('Peso (kg)', d.peso), L('Diagnóstico', d.diag), L('Regiões', d.reg), L('Dor/peso/cansaço', d.dor),
    L('Quer avaliar', d.area), L('Plástica anterior', d.cirP), L('Medicamentos, alergias, cirurgias', d.med),
    '',
    '🎯 Expectativas',
    L('Objetivo', d.quer), L('Como conheceu', d.como), L('Quem indicou', d.quem),
    '',
    '✔️ Autorizou o uso dos dados (LGPD).',
    amigoTxt,
  ].filter((x) => x !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

async function buscarLead(kommo, id) {
  try {
    return await kommo.request('get', `/leads/${id}`);
  } catch (e) {
    if (e.status === 404 || e.status === 204) return null;
    throw e;
  }
}

const valorCampo = (lead, id) => ((lead.custom_fields_values || []).find((f) => f.field_id === id) || { values: [{}] }).values[0].value;

/** Dados para a página abrir já personalizada (só o primeiro nome e a data da consulta). */
async function infoFicha(codigo, { kommo, segredo = segredoPadrao() }) {
  const leadId = lerCodigo(codigo, segredo);
  if (!leadId) return null;
  const lead = await buscarLead(kommo, leadId);
  if (!lead || !lead.id) return null;
  const consulta = Number(valorCampo(lead, CAMPO_CONSULTA)) || null;
  const nome = String(valorCampo(lead, CAMPO_PRIMEIRO_NOME) || '').trim().split(/\s+/)[0] || '';
  return { nome: nome ? nomeProprio(nome) : '', consulta: consulta ? new Date(consulta * 1000).toISOString() : null };
}

/**
 * Recebe a ficha enviada. Nunca apaga nem sobrescreve nada: no Kommo só acrescenta nota, etiqueta e tarefa;
 * no Amigo só cria a paciente se ela ainda não existir (busca por CPF e por celular).
 */
async function processarFicha({ codigo, lang, ver, dados }, { kommo, amigo, segredo = segredoPadrao(), agora = new Date() }) {
  const leadId = lerCodigo(codigo, segredo);
  if (!leadId) return { ok: false, status: 404, erro: 'link inválido' };
  const d = limparDados(dados);
  const erros = validar(d);
  if (erros.length) return { ok: false, status: 400, erro: 'dados incompletos', campos: erros };
  const lead = await buscarLead(kommo, leadId);
  if (!lead || !lead.id) return { ok: false, status: 404, erro: 'lead não encontrado' };

  let am = null;
  if (amigo) {
    try {
      const cpf = cpfValido(d.cpf) ? soDigitos(d.cpf) : null;
      const cel = celularBR(d.cel);
      const existe = (cpf && await amigo.pacienteExiste({ cpf })) || (cel && await amigo.pacienteExiste({ celular: cel }));
      if (existe && existe.id) am = { status: 'existia', id: existe.id };
      else {
        const novo = await amigo.criarPaciente(paraAmigo(d, ver));
        am = { status: 'criado', id: novo && novo.id };
      }
    } catch (e) {
      am = { status: 'erro', erro: String(e.message || e).slice(0, 160) };
    }
  }

  const quando = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const nota = `${textoNota(d, { ver, lang, amigo: am, quando })}\n\n${MARCA_JSON} ${JSON.stringify(paraBotao(d, leadId))}`;
  await kommo.request('post', `/leads/${leadId}/notes`, { data: [{ note_type: 'common', params: { text: nota } }] });
  await kommo.request('patch', '/leads', { data: [{ id: leadId, tags_to_add: [{ name: ETIQUETA }] }] });
  await kommo.request('post', '/tasks', {
    data: [{
      text: am && am.status === 'criado' ? 'Ficha Blue recebida: conferir e completar o cadastro no Amigo' : 'Ficha Blue recebida: conferir e cadastrar no Amigo',
      complete_till: Math.floor(agora.getTime() / 1000) + 3600, entity_id: leadId, entity_type: 'leads',
      ...(lead.responsible_user_id ? { responsible_user_id: lead.responsible_user_id } : {}),
    }],
  });
  return { ok: true, leadId, amigo: am ? am.status : 'sem_api' };
}

module.exports = {
  codigoFicha, lerCodigo, segredoPadrao, cpfValido, celularBR, limparDados, validar, paraAmigo, paraBotao, textoNota,
  infoFicha, processarFicha, MARCA_JSON, ETIQUETA,
};
