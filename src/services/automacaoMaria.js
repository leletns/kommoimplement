'use strict';

/**
 * Automação da Maria (roda a cada 15 minutos no Netlify, ou pelo script automacaoMaria.js).
 *
 * 1. RESPOSTA PENDENTE DE VERDADE: olha a última mensagem do WhatsApp de cada lead (eventos
 *    incoming/outgoing_chat_message). Se a última é da paciente → tag "aguardando_resposta" +
 *    tarefa "Responder paciente". Quando a equipe responde → tira a tag e conclui a tarefa.
 *    Não depende do "não lida" do Kommo (que some quando alguém só abre a conversa).
 * 2. RESPONDEU NA RÉGUA OU NO "RETOMAR DEPOIS" → volta para "3. Interesse em agendar · Maria"
 *    com a tarefa acima e uma nota com a resposta pronta para a Maria.
 * 3. RÉGUA DE FOLLOW-UP: conversa parada há 1 dia (última mensagem foi nossa) em 2 ou 3
 *    → 3.2 Follow-up 1; 2 dias sem resposta → 3.3; 4 dias → 3.4; 5 dias → 3.1 Retomar depois.
 *    Os robôs do Kommo mandam a mensagem de cada etapa ao entrar nela.
 * 5. GUARDA DA "CONSULTA AGENDADA": lead que o SISTEMA (regra automática do Kommo, ex.: a das 48h)
 *    jogou em "4. Consulta agendada" sem pagamento confirmado volta para a etapa de onde veio.
 * 4. RETOMAR DEPOIS: sem "Data Próxima Ação" → coloca daqui a 30 dias. Chegou a data → volta
 *    para a etapa 3 com tarefa "Retomar contato hoje" e sugestão de mensagem (IA).
 */

const config = require('../config');
const { resolvePipeline, WON, LOST } = require('./pipelineResolver');
const { normalize, OBJECTIONS } = require('./aliceEngine');

const DIA = 86400;
const TAG_PENDENTE = 'aguardando_resposta';
const TAG_RESPONDEU = 'fu_respondeu';
const TAG_SEM_RESPOSTA = 'fu_sem_resposta';
const TAG_OPT_OUT = 'opt_out';
const TAG_CONSULTA_PAGA = 'consulta_paga';
const TAG_48H = 'regra_48h_desfeita';
const FIELD_PAGAMENTO = config.kommo.pagamentoFieldId;
// Sem emoji: o Kommo apaga emojis do texto das tarefas (e aí a tarefa não seria reconhecida na próxima rodada).
const TAREFA_RESPONDER = 'Responder paciente';
const TAREFA_RETOMAR = 'Retomar contato hoje';

const FIELD_PROXIMA_ACAO_DATA = Number(process.env.KOMMO_PROXIMA_ACAO_DATA_FIELD_ID || 3839458);
const FIELD_RESUMO = config.kommo.resumoFieldId;
const FIELD_OBJECAO = config.kommo.objecaoFieldId;
const FIELD_CLASSIFICACAO = config.kommo.classificacaoFieldId;

const REGRA = {
  esperaParaPendente: Number(process.env.AUTOMACAO_PENDENTE_MIN || 3) * 60, // dá tempo do robô/equipe
  paradoParaFollowUp: 1 * DIA,
  janelaConversaRecente: 7 * DIA, // só entra na régua quem conversou nos últimos 7 dias
  fu1: 2 * DIA,
  fu2: 4 * DIA,
  fu3: 5 * DIA,
  retomarEm: 30 * DIA,
  maxMovimentosRegua: Number(process.env.AUTOMACAO_MAX_REGUA || 40),
};

// Mensagens aprovadas de cada follow-up (docs/bots.md). São a base da IA e o texto usado sem IA.
const MODELO_FOLLOWUP = {
  fu1: "Oi, {{contact.first_name}}! Retomando nossa conversa: separei uma informação sobre a avaliação que pode te ajudar a decidir o próximo passo.\nPosso te mandar?",
  fu2: "{{contact.first_name}}, uma dúvida que quase toda paciente tem nessa fase é se realmente vai precisar de cirurgia ou se existe outro caminho. A resposta costuma surpreender.\nQuer que eu te explique como o Dr. Rafael avalia isso?",
  fu3: "{{contact.first_name}}, antes de encerrar seu atendimento, tenho uma última informação que pode facilitar a sua decisão.\nTe mando?",
};
const OBJETIVO_FOLLOWUP = {
  fu1: 'Retomar a conversa (ela já falou com a Maria e parou de responder) abrindo uma curiosidade sobre a avaliação e pedindo um "sim" fácil.',
  fu2: 'Tocar na dúvida mais comum dessa fase (se vai precisar de cirurgia ou se há outro caminho) e oferecer explicar como o Dr. Rafael avalia.',
  fu3: 'Última mensagem antes de encerrar o atendimento: honesta, sem pressão, oferecendo uma última informação que facilita a decisão.',
};
const FIELD_FOLLOWUP_MSG = Number(process.env.KOMMO_FOLLOWUP_MSG_FIELD_ID) || null;

// Continuação aprovada para cada follow-up (docs/bots.md).
const CONTINUACAO = {
  fu1:
    'Na avaliação, o Dr. Rafael analisa seus sintomas, histórico e exames e te diz com clareza qual é o melhor caminho para o seu caso. É o passo que tira a dúvida de vez. Você prefere presencial ou online?',
  fu2:
    'Nem toda paciente precisa operar no primeiro momento. Só a avaliação individualizada confirma o diagnóstico e a melhor conduta, e é isso que o Dr. Rafael faz na consulta, com calma. Quer que eu veja um horário pra você?',
  fu3:
    'Mostre o que facilita a decisão (formas de pagamento da consulta, avaliação online para quem mora longe, o que a consulta inclui) e mande 2 ou 3 opções de horário.',
};

const fieldValue = (lead, id) => {
  const f = (lead.custom_fields_values || []).find((c) => c.field_id === id);
  return f && f.values && f.values[0] ? f.values[0].value : null;
};
const tagsOf = (lead) => (lead._embedded?.tags || []).map((t) => t.name);
/** Primeiro nome apresentável ("MARIA" → "Maria"); vazio quando o nome é de sistema ("Lead #123", "Consulta · …"). */
const nomeDe = (lead) => {
  const bruto = (lead._embedded?.contacts?.[0]?.name || lead.name || '').trim();
  const primeiro = bruto.split(/\s+/)[0] || '';
  if (!primeiro || /^(lead|consulta|paciente|pacienta|sem)$/i.test(primeiro) || /[#\d@·]/.test(primeiro)) return '';
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
};

/** Etapas de cada funil comercial, achadas pelo nome (não depende de id). */
async function etapasDosFunis(kommo, pipelineIds) {
  const out = new Map();
  for (const pid of pipelineIds) {
    const ctx = await resolvePipeline(kommo, { pipelineId: pid });
    const achar = (re) => ctx.statuses.find((s) => re.test(normalize(s.name)));
    out.set(pid, {
      nome: ctx.pipeline.name,
      novo: ctx.novos,
      qualificado: ctx.qualificados,
      interesse: ctx.interesse,
      retomar: achar(/retomar depois|nutricao/),
      fu1: achar(/follow-up 1|follow up 1/),
      fu2: achar(/follow-up 2|follow up 2/),
      fu3: achar(/follow-up 3|follow up 3/),
      agendada: ctx.apnStatuses[0] || null,
      abertas: new Set(ctx.statuses.filter((s) => s.id !== WON && s.id !== LOST).map((s) => s.id)),
      nomes: new Map(ctx.statuses.map((s) => [s.id, s.name])),
    });
  }
  return out;
}

/** Última mensagem (entrada/saída) por lead, a partir dos eventos do chat. */
function ultimaMensagemPorLead(eventos) {
  const map = new Map();
  for (const e of eventos) {
    if (e.entity_type !== 'lead') continue;
    const atual = map.get(e.entity_id);
    if (!atual || e.created_at > atual.at) map.set(e.entity_id, { at: e.created_at, entrada: e.type === 'incoming_chat_message' });
  }
  return map;
}

/** Quando o lead entrou na etapa atual (último evento de mudança de etapa para ela). */
function entradaNaEtapa(eventos) {
  const map = new Map();
  for (const e of eventos) {
    const st = e.value_after?.[0]?.lead_status?.id;
    if (!st) continue;
    const k = `${e.entity_id}:${st}`;
    if (!map.has(k) || e.created_at > map.get(k)) map.set(k, e.created_at);
  }
  return map;
}

/** Último evento de entrada em cada etapa (com quem moveu e de onde veio). */
function ultimaEntradaDetalhada(eventos) {
  const map = new Map();
  for (const e of eventos) {
    const st = e.value_after?.[0]?.lead_status?.id;
    if (!st) continue;
    const k = `${e.entity_id}:${st}`;
    if (!map.has(k) || e.created_at > map.get(k).at) {
      map.set(k, { at: e.created_at, by: e.created_by, de: e.value_before?.[0]?.lead_status?.id || null });
    }
  }
  return map;
}

/** Sugestão de mensagem para retomar o contato: IA (Claude) quando há chave, senão o roteiro da objeção. */
async function sugestaoRetomada(lead, { ia } = {}) {
  const resumo = FIELD_RESUMO ? fieldValue(lead, FIELD_RESUMO) : null;
  const objecaoCampo = FIELD_OBJECAO ? (lead.custom_fields_values || []).find((c) => c.field_id === FIELD_OBJECAO)?.values?.[0] : null;
  const objecaoEnum = objecaoCampo ? objecaoCampo.value : null;
  const classificacao = FIELD_CLASSIFICACAO ? fieldValue(lead, FIELD_CLASSIFICACAO) : null;
  const nome = nomeDe(lead) || 'tudo bem';
  if (ia) {
    try {
      const texto = await ia({
        tarefa: 'retomar contato',
        objetivo: 'A paciente pediu para falar depois e chegou a data combinada. Retome com leveza e ofereça o próximo passo (avaliação com o Dr. Rafael).',
        nome,
        resumo,
        objecao: objecaoEnum,
        classificacao,
        tags: tagsOf(lead),
      });
      if (mensagemSegura(texto)) return { fonte: 'IA', texto };
    } catch (err) {
      console.warn(`[automacao] IA indisponível (${err.message}); usando roteiro.`);
    }
  }
  // Objeção registrada (campo de lista) → 1ª objeção do Alice Bot mapeada para esse item.
  let obj = null;
  if (objecaoCampo && objecaoCampo.enum_id) {
    const mapa = JSON.parse(process.env.KOMMO_OBJECAO_ENUMS || '{}');
    const id = Object.keys(mapa).find((k) => Number(mapa[k]) === Number(objecaoCampo.enum_id));
    obj = id ? OBJECTIONS.find((o) => o.id === id) : null;
  }
  if (obj) return { fonte: 'roteiro da objeção', texto: `Oi, ${nome}! ${obj.passos.acolher} ${obj.passos.conduzir}` };
  return {
    fonte: 'roteiro',
    texto: `Oi, ${nome}! Retomando nossa conversa: abriram novos horários de avaliação com o Dr. Rafael. Faz sentido eu separar um pra você?`,
  };
}

/** Barra o que não pode ir para a paciente sem revisão (promessa, diagnóstico, preço, pressão). */
function mensagemSegura(texto) {
  if (!texto || texto.length > 420 || texto.split('\n').length > 5) return false;
  const proibido = /garant|\bcura\b|curar|milagre|promo|desconto|r\$|\breais\b|\d{3,}|precisa operar|vai precisar operar|com certeza|voc[eê] tem lipedema|seu lipedema|diagn[oó]stic|resultado|ultim[ao]s? vagas?|s[oó] hoje|corre|urgente|http|www\./i;
  return !proibido.test(texto);
}

/** Mensagem do follow-up para esta paciente: IA personalizada (com trava de segurança) ou a mensagem aprovada. */
async function mensagemFollowUp(lead, etapa, { ia } = {}) {
  const nome = nomeDe(lead);
  const modelo = MODELO_FOLLOWUP[etapa].replace(/\{\{contact\.first_name\}\}/g, nome || '').replace(/^, /, '').replace(/Oi, !/, 'Oi!').replace(/^./, (c) => c.toUpperCase());
  if (ia) {
    try {
      const texto = await ia({
        tarefa: 'follow-up',
        objetivo: OBJETIVO_FOLLOWUP[etapa],
        mensagem_modelo_aprovada: modelo,
        nome,
        resumo: FIELD_RESUMO ? fieldValue(lead, FIELD_RESUMO) : null,
        objecao: FIELD_OBJECAO ? fieldValue(lead, FIELD_OBJECAO) : null,
        classificacao: FIELD_CLASSIFICACAO ? fieldValue(lead, FIELD_CLASSIFICACAO) : null,
        tags: tagsOf(lead),
      });
      if (mensagemSegura(texto)) return { fonte: 'IA', texto };
    } catch (err) {
      console.warn(`[automacao] IA indisponível (${err.message}); usando a mensagem aprovada.`);
    }
  }
  return { fonte: 'aprovada', texto: modelo };
}

/**
 * IA opcional para escrever as mensagens. Devolve uma função (contexto) => texto, ou null.
 *   GEMINI_API_KEY    → Google Gemini (tem plano gratuito, aistudio.google.com)
 *   ANTHROPIC_API_KEY → Claude (pago por uso)
 * No plano gratuito do Gemini o Google pode usar o conteúdo para melhorar os produtos dele, então
 * NÃO mandamos dados de saúde (resumo da conversa, tags): só o primeiro nome, objeção e classificação.
 */
function criarIA() {
  const system =
    'Você é a Maria, consultora comercial (SDR) da Clínica Blue, do Dr. Rafael Erthal, cirurgião plástico com foco em lipedema. ' +
    'Escreva UMA mensagem de WhatsApp em português do Brasil para uma paciente que já conversou com você e parou de responder. ' +
    'Fale em primeira pessoa como a Maria, sem se apresentar e sem falar "a Maria". No máximo 3 linhas curtas. ' +
    'Tom profissional, humano, acolhedor e prospectivo: desperte curiosidade ou dê um próximo passo claro e termine com uma pergunta fácil de responder (um "sim"). ' +
    'Use o objetivo e a mensagem modelo aprovada como base; personalize com os dados do lead só quando fizer sentido, sem citar dados sensíveis de saúde. ' +
    'Proibido: diagnosticar, prometer resultado, dizer que ela precisa operar, falar de preço, valores, datas, promoções, urgência ou links. ' +
    'Responda só com o texto da mensagem.';
  if (process.env.GEMINI_API_KEY) return criarGemini(system);
  if (process.env.ANTHROPIC_API_KEY) return criarClaude(system);
  return null;
}

function criarGemini(system) {
  const modelo = process.env.GEMINI_MODELO || 'gemini-2.5-flash';
  return async (ctx) => {
    const seguro = { ...ctx, resumo: undefined, tags: undefined };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: `Contexto (campos podem estar vazios):\n${JSON.stringify(seguro, null, 2)}` }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || '').join('').trim() || null;
  };
}

function criarClaude(system) {
  const mod = require('@anthropic-ai/sdk');
  const Anthropic = mod.default || mod;
  const client = new Anthropic();
  return async (ctx) => {
    const res = await client.beta.messages.create({
      model: process.env.AUTOMACAO_IA_MODELO || 'claude-opus-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: `Contexto (campos podem estar vazios):\n${JSON.stringify(ctx, null, 2)}` }],
    });
    if (res.stop_reason === 'refusal') return null;
    return res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  };
}

/**
 * Calcula (e, com apply, grava) as ações. Devolve o resumo do que fez.
 * @param {object} kommo cliente do kommoClient
 */
async function executarAutomacao(kommo, { apply = false, now = Math.floor(Date.now() / 1000), log = console.log, ia = criarIA() } = {}) {
  const pipelines = JSON.parse(process.env.KOMMO_METRICS_PIPELINES || '{}');
  const pipelineIds = Object.keys(pipelines).map(Number);
  if (!pipelineIds.length) throw new Error('KOMMO_METRICS_PIPELINES vazio: não sei quais funis automatizar.');
  const etapas = await etapasDosFunis(kommo, pipelineIds);

  const [leads, chat, mudancas, tarefas] = await Promise.all([
    kommo.listAll('/leads', { embeddedKey: 'leads', params: { 'filter[pipeline_id]': pipelineIds, with: 'contacts' } }),
    kommo.listAll('/events', {
      embeddedKey: 'events',
      limit: 100,
      params: { 'filter[type]': ['incoming_chat_message', 'outgoing_chat_message'], 'filter[created_at][from]': now - 14 * DIA },
    }),
    kommo.listAll('/events', {
      embeddedKey: 'events',
      limit: 100,
      params: { 'filter[type]': 'lead_status_changed', 'filter[created_at][from]': now - 30 * DIA },
    }),
    kommo.listAll('/tasks', { embeddedKey: 'tasks', params: { 'filter[is_completed]': 0, 'filter[entity_type]': 'leads' } }),
  ]);
  const ultima = ultimaMensagemPorLead(chat);
  const entrada = entradaNaEtapa(mudancas);
  const entradaDet = ultimaEntradaDetalhada(mudancas);
  const tarefasAbertas = new Map();
  for (const t of tarefas) {
    if (!tarefasAbertas.has(t.entity_id)) tarefasAbertas.set(t.entity_id, []);
    tarefasAbertas.get(t.entity_id).push(t);
  }

  const patches = new Map(); // leadId → patch
  const patchDe = (l) => {
    if (!patches.has(l.id)) patches.set(l.id, { id: l.id });
    return patches.get(l.id);
  };
  const setTags = (l, fn) => {
    const antes = tagsOf(l);
    const depois = new Set(antes);
    fn(depois);
    if (depois.size !== antes.length || antes.some((t) => !depois.has(t))) {
      patchDe(l)._embedded = { tags: [...depois].map((name) => ({ name })) };
    }
  };
  const mover = (l, status, motivo) => {
    Object.assign(patchDe(l), { pipeline_id: l.pipeline_id, status_id: status.id });
    resumo.movidos.push({ id: l.id, de: l.status_id, para: status.name, motivo });
  };
  const novasTarefas = [];
  const concluir = [];
  const notas = [];
  const resumo = { pendentes: 0, respondidas: 0, movidos: [], tarefasCriadas: 0, tarefasConcluidas: 0, retomadas: 0, desfeitos48h: 0, mensagens: [] };

  // O robô da etapa envia o campo "Follow-up · mensagem": grava junto com a mudança de etapa (mesmo PATCH).
  const gravarMensagem = async (l, etapa) => {
    const m = await mensagemFollowUp(l, etapa, { ia });
    resumo.mensagens.push({ id: l.id, etapa, fonte: m.fonte });
    if (!FIELD_FOLLOWUP_MSG) return;
    const p = patchDe(l);
    p.custom_fields_values = [...(p.custom_fields_values || []), { field_id: FIELD_FOLLOWUP_MSG, values: [{ value: m.texto }] }];
  };

  let movRegua = 0;
  for (const l of leads) {
    const e = etapas.get(l.pipeline_id);
    if (!e || l.status_id === WON || l.status_id === LOST || l.is_deleted) continue;
    const msg = ultima.get(l.id);
    const tags = tagsOf(l);
    const abertas = tarefasAbertas.get(l.id) || [];
    const tarefaResponder = abertas.filter((t) => (t.text || '').includes(TAREFA_RESPONDER));
    const pendente = Boolean(msg && msg.entrada && now - msg.at >= REGRA.esperaParaPendente);
    const naRegua = [e.fu1, e.fu2, e.fu3, e.retomar].filter(Boolean).find((s) => s.id === l.status_id);

    // 5. Guarda da "Consulta agendada": só entra com pagamento (ou movido por uma pessoa).
    if (e.agendada && l.status_id === e.agendada.id) {
      const ent = entradaDet.get(`${l.id}:${l.status_id}`);
      const pago = tags.includes(TAG_CONSULTA_PAGA) || (FIELD_PAGAMENTO && fieldValue(l, FIELD_PAGAMENTO));
      if (ent && !ent.by && !pago) {
        const volta = (ent.de && e.abertas.has(ent.de) && ent.de !== e.agendada.id && { id: ent.de, name: e.nomes.get(ent.de) }) || e.qualificado;
        if (volta) {
          mover(l, volta, 'movido para "Consulta agendada" por regra automática, sem pagamento');
          setTags(l, (t) => t.add(TAG_48H));
          notas.push({ leadId: l.id, text: 'Voltou da "Consulta agendada": foi movido por uma regra automática do Kommo (ex.: 48h), sem pagamento confirmado. Se a consulta foi paga, mova de novo e preencha a "Data do pagamento".' });
          resumo.desfeitos48h += 1;
          continue;
        }
      }
    }

    // 1 e 2. Resposta pendente de verdade.
    if (pendente) {
      resumo.pendentes += 1;
      setTags(l, (t) => t.add(TAG_PENDENTE));
      if (!tarefaResponder.length) {
        const hora = new Date(msg.at * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
        novasTarefas.push({
          text: `${TAREFA_RESPONDER} (mensagem sem resposta desde ${hora})`,
          complete_till: Math.max(now + 30 * 60, msg.at + 30 * 60),
          entity_id: l.id,
          entity_type: 'leads',
          task_type_id: 1,
          responsible_user_id: l.responsible_user_id,
        });
      }
      if (naRegua && e.interesse) {
        const qual = Object.entries({ fu1: e.fu1, fu2: e.fu2, fu3: e.fu3 }).find(([, s]) => s && s.id === l.status_id);
        mover(l, e.interesse, `respondeu em "${naRegua.name}"`);
        setTags(l, (t) => {
          t.add(TAG_PENDENTE);
          t.add(TAG_RESPONDEU);
        });
        const cont = qual ? CONTINUACAO[qual[0]] : null;
        notas.push({
          leadId: l.id,
          text: `↩️ A paciente respondeu na etapa "${naRegua.name}" e voltou para a Maria.${cont ? `\n\n💡 Resposta sugerida:\n${cont}` : ''}`,
        });
      }
      continue;
    }

    // Respondida: tira a tag e conclui a tarefa de responder.
    if (msg && !msg.entrada) {
      if (tags.includes(TAG_PENDENTE)) {
        resumo.respondidas += 1;
        setTags(l, (t) => t.delete(TAG_PENDENTE));
      }
      for (const t of tarefaResponder) concluir.push({ id: t.id, is_completed: true, result: { text: 'Respondida pela equipe (automático).' } });
    }
    if (tags.includes(TAG_OPT_OUT)) continue;

    // 3. Régua de follow-up.
    const naEtapaDesde = entrada.get(`${l.id}:${l.status_id}`) || l.updated_at;
    const calado = (desde) => !msg || !msg.entrada || msg.at < desde; // sem mensagem da paciente desde "desde"
    const podeMover = () => movRegua < REGRA.maxMovimentosRegua;
    if (e.fu1 && [e.qualificado?.id, e.interesse?.id].includes(l.status_id) && msg && !msg.entrada) {
      const parado = now - msg.at;
      if (parado >= REGRA.paradoParaFollowUp && parado <= REGRA.janelaConversaRecente && podeMover()) {
        mover(l, e.fu1, 'conversa parada há 1 dia (última mensagem foi nossa)');
        await gravarMensagem(l, 'fu1');
        movRegua += 1;
      }
    } else if (e.fu1 && l.status_id === e.fu1.id && now - naEtapaDesde >= REGRA.fu1 && calado(naEtapaDesde) && e.fu2 && podeMover()) {
      mover(l, e.fu2, '2 dias sem resposta ao follow-up 1');
      await gravarMensagem(l, 'fu2');
      movRegua += 1;
    } else if (e.fu2 && l.status_id === e.fu2.id && now - naEtapaDesde >= REGRA.fu2 && calado(naEtapaDesde) && e.fu3 && podeMover()) {
      mover(l, e.fu3, '4 dias sem resposta ao follow-up 2');
      await gravarMensagem(l, 'fu3');
      movRegua += 1;
    } else if (e.fu3 && l.status_id === e.fu3.id && now - naEtapaDesde >= REGRA.fu3 && calado(naEtapaDesde) && e.retomar) {
      mover(l, e.retomar, '5 dias sem resposta ao follow-up 3');
      setTags(l, (t) => t.add(TAG_SEM_RESPOSTA));
      patchDe(l).custom_fields_values = [{ field_id: FIELD_PROXIMA_ACAO_DATA, values: [{ value: now + REGRA.retomarEm }] }];
    }

    // 4. Retomar depois.
    if (e.retomar && l.status_id === e.retomar.id) {
      const data = Number(fieldValue(l, FIELD_PROXIMA_ACAO_DATA)) || null;
      if (!data) {
        patchDe(l).custom_fields_values = [{ field_id: FIELD_PROXIMA_ACAO_DATA, values: [{ value: now + REGRA.retomarEm }] }];
      } else if (data <= now && e.interesse) {
        resumo.retomadas += 1;
        mover(l, e.interesse, 'chegou a data de retomar');
        if (!abertas.some((t) => (t.text || '').includes(TAREFA_RETOMAR))) {
          novasTarefas.push({
            text: TAREFA_RETOMAR,
            complete_till: now + 4 * 3600,
            entity_id: l.id,
            entity_type: 'leads',
            task_type_id: 1,
            responsible_user_id: l.responsible_user_id,
          });
        }
        const s = await sugestaoRetomada(l, { ia });
        notas.push({ leadId: l.id, text: `🔁 Hora de retomar o contato.\n\n💡 Mensagem sugerida (${s.fonte}):\n${s.texto}` });
      }
    }
  }

  resumo.tarefasCriadas = novasTarefas.length;
  resumo.tarefasConcluidas = concluir.length;
  resumo.atualizacoes = patches.size;
  log(
    `Automação: ${resumo.pendentes} aguardando resposta · ${resumo.respondidas} respondidas · ${resumo.movidos.length} movidos · ` +
      `${novasTarefas.length} tarefas novas · ${concluir.length} concluídas · ${resumo.retomadas} retomadas · ${resumo.desfeitos48h} desfeitos (regra 48h)`
  );
  for (const m of resumo.movidos) log(`  lead ${m.id} → ${m.para} (${m.motivo})`);

  if (apply) {
    if (patches.size) await kommo.updateLeads([...patches.values()], 50);
    for (let i = 0; i < novasTarefas.length; i += 50) await kommo.request('post', '/tasks', { data: novasTarefas.slice(i, i + 50) });
    for (let i = 0; i < concluir.length; i += 50) await kommo.request('patch', '/tasks', { data: concluir.slice(i, i + 50) });
    if (notas.length) await kommo.addLeadNotesBulk(notas, 25);
  }
  return resumo;
}

module.exports = { criarIA, executarAutomacao, ultimaMensagemPorLead, entradaNaEtapa, sugestaoRetomada, mensagemFollowUp, mensagemSegura, MODELO_FOLLOWUP, REGRA, TAG_PENDENTE, TAREFA_RESPONDER };
