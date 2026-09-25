'use strict';

/**
 * Alice Bot — régua de qualificação e triagem (Manual Comercial Blue).
 *
 *   Score >= 70  → lead_quente + handoff_maria + follow_up_day2 → INTERESSE EM AGENDAR (Maria assume)
 *   Score 40–69  → lead_morna  + follow_up_day2                 → QUALIFICADOS
 *   Score <  40  → lead_fria   + follow_up_day2                 → NOVOS
 *
 * O score (0–100) é uma soma de sinais explicáveis extraídos do texto do lead
 * (nome, tags, notas, campos) e do comportamento no funil. Cada sinal aparece no
 * `breakdown`, que vai para a nota no Kommo, para o time saber por que a lead
 * recebeu aquela nota.
 *
 * Objeções: 19 objeções do atendimento com a metodologia dos 5 passos
 * (Acolher → Investigar → Compreender → Reposicionar → Conduzir). Os textos seguem
 * as regras de segurança médica da Blue Clínica: nunca diagnosticar, nunca prometer
 * resultado e sempre conduzir para avaliação individualizada.
 */

const TAGS = Object.freeze({
  FINALIZADO: 'alice_bot_finalizado',
  FOLLOW_UP: 'follow_up_day2',
  QUENTE: 'lead_quente',
  HANDOFF: 'handoff_maria',
  MORNA: 'lead_morna',
  FRIA: 'lead_fria',
});

const TEMPERATURE_TAGS = [TAGS.QUENTE, TAGS.MORNA, TAGS.FRIA, TAGS.HANDOFF];

const FRASE_SEGURANCA =
  'Apenas uma avaliação médica individualizada pode confirmar diagnóstico, estágio e melhor conduta para o seu caso.';

/** minúsculas, sem acento, espaços normalizados */
function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Sinais de qualificação ────────────────────────────────────────────────────
// Cada grupo soma `points` por gatilho encontrado, limitado a `cap`.

const SIGNAL_GROUPS = [
  {
    id: 'sintomas',
    label: 'Sintomas relatados',
    points: 6,
    cap: 24,
    patterns: [
      /\bdor(es)?\b/,
      /peso nas pernas|pernas? pesad/,
      /hematoma|roxo|roxinh/,
      /incha(co|da|m|r)/,
      /desproporc/,
      /sensibilidade|sensivel ao toque/,
      /nao (consigo )?emagrec|nao (sai|diminui|muda)/,
      /cansaco nas pernas|pernas? cansad/,
    ],
  },
  {
    id: 'diagnostico',
    label: 'Diagnóstico / suspeita de lipedema',
    points: 0,
    cap: 12,
    weighted: [
      [/diagnostico (confirmado|de lipedema)|tenho lipedema|fui diagnosticad|laudo/, 12],
      [/lipedema|suspeit/, 6],
    ],
  },
  {
    id: 'intencao',
    label: 'Intenção de avançar',
    points: 0,
    cap: 35,
    weighted: [
      [/agendar|agendamento|marcar (a |uma )?consulta|horario|disponibilidade|agenda/, 14],
      [/\bconsulta\b|avaliacao/, 6],
      [/cirurgia|operar|lipedefinition|lipoaspira/, 10],
      [/valor|preco|investimento|quanto custa|orcamento|parcel/, 8],
      [/sublift|celulite profunda|furinhos|irregularidade/, 5],
      [/quero (fazer|marcar|agendar)|tenho interesse|pode me passar/, 8],
    ],
  },
  {
    id: 'desinteresse',
    label: 'Sinais de desinteresse',
    points: 0,
    cap: -30,
    weighted: [
      [/sem interesse|nao tenho interesse|nao quero mais|desisti|pare de (me )?mandar|numero errado|engano/, -30],
      [/so (estava )?pesquisando|so curiosidade|talvez (no|ano) que vem/, -10],
    ],
  },
];

function scoreGroup(group, text) {
  const hits = [];
  let total = 0;
  if (group.patterns) {
    for (const re of group.patterns) {
      if (re.test(text)) {
        hits.push(re.source);
        total += group.points;
      }
    }
  }
  if (group.weighted) {
    for (const [re, pts] of group.weighted) {
      if (re.test(text)) {
        hits.push(re.source);
        total += pts;
      }
    }
  }
  const capped = group.cap < 0 ? Math.max(total, group.cap) : Math.min(total, group.cap);
  return { total: capped, hits };
}

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));
const DAY = 24 * 60 * 60 * 1000;

/**
 * Calcula o score de qualificação (0–100).
 *
 * @param {object} input
 * @param {object} input.lead     Lead do Kommo (API v4) — usa name, price, updated_at, status_id, _embedded.tags, custom_fields_values
 * @param {Array}  [input.notes]  Notas do lead (API v4) — usa params.text
 * @param {object} [input.stages] { qualificadosSort, apnSort, sortById: Map<statusId, sort> } para pontuar progresso no funil
 * @param {number} [input.now]    timestamp (ms) — injetável para testes
 */
function calculateScore({ lead, notes = [], stages = null, now = Date.now() }) {
  const breakdown = [];
  const add = (label, points, detail) => {
    if (points) breakdown.push({ label, points, detail });
    return points;
  };

  const text = normalize(buildCorpus(lead, notes));
  let score = add('Base', 10);

  for (const group of SIGNAL_GROUPS) {
    const { total, hits } = scoreGroup(group, text);
    score += add(group.label, total, hits.length ? `${hits.length} gatilho(s)` : undefined);
  }

  if (Number(lead.price) > 0) score += add('Valor de negócio informado', 8);

  const noteCount = notes.filter((n) => n?.params?.text).length;
  if (noteCount >= 10) score += add('Engajamento alto (10+ interações)', 10);
  else if (noteCount >= 3) score += add('Engajamento (3+ interações)', 5);

  const updatedAt = Number(lead.updated_at) * 1000;
  if (updatedAt) {
    const age = now - updatedAt;
    if (age <= 7 * DAY) score += add('Interação nos últimos 7 dias', 8);
    else if (age <= 30 * DAY) score += add('Interação nos últimos 30 dias', 4);
    else if (age > 180 * DAY) score += add('Sem interação há mais de 6 meses', -10);
  }

  if (stages && lead.status_id) {
    const sort = stages.sortById?.get(Number(lead.status_id));
    if (Number(lead.status_id) === 142) score += add('Lead já convertida (ganho)', 25);
    else if (stages.apnSort != null && sort != null && sort >= stages.apnSort) score += add('Já chegou em APN / agendamento', 15);
    else if (stages.qualificadosSort != null && sort != null && sort >= stages.qualificadosSort) score += add('Já qualificada no funil', 10);
  }

  const objections = detectObjections(text, { normalized: true });
  return { score: clamp(score), breakdown, objections };
}

function buildCorpus(lead, notes) {
  const parts = [lead?.name];
  for (const tag of lead?._embedded?.tags || []) parts.push(tag.name);
  for (const field of lead?.custom_fields_values || []) {
    for (const v of field.values || []) {
      if (typeof v.value === 'string') parts.push(v.value);
      else if (v.enum_code || v.value != null) parts.push(String(v.value ?? v.enum_code));
    }
  }
  for (const note of notes) {
    // Não reaproveita notas geradas pela própria Alice (evita realimentar o score).
    const t = note?.params?.text;
    if (t && !t.startsWith('🤖 Alice Bot')) parts.push(t);
  }
  return parts.filter(Boolean).join(' \n ');
}

/** Classifica o score segundo a régua do Manual Comercial Blue. */
function classify(score) {
  if (score >= 70) return { temperatura: 'quente', tag: TAGS.QUENTE, stage: 'INTERESSE_AGENDAR' };
  if (score >= 40) return { temperatura: 'morna', tag: TAGS.MORNA, stage: 'QUALIFICADOS' };
  return { temperatura: 'fria', tag: TAGS.FRIA, stage: 'NOVOS' };
}

/**
 * Combina as tags atuais do lead com as da Alice. Remove temperaturas antigas
 * (uma lead não pode ser quente e fria ao mesmo tempo) e mantém todas as demais.
 */
function mergeTags(currentTags, temperatureTag) {
  const names = (currentTags || []).map((t) => (typeof t === 'string' ? t : t.name)).filter(Boolean);
  const kept = names.filter((n) => !TEMPERATURE_TAGS.includes(n));
  const wanted = [temperatureTag, ...(temperatureTag === TAGS.QUENTE ? [TAGS.HANDOFF] : []), TAGS.FOLLOW_UP, TAGS.FINALIZADO];
  const result = [...kept];
  for (const t of wanted) if (!result.includes(t)) result.push(t);
  return result;
}

/**
 * Avalia um lead e devolve o plano de ação (sem chamar a API).
 * `evaluateLead` é puro: quem aplica no Kommo é o retroativo / o webhook.
 */
function evaluateLead({ lead, notes, stages, now }) {
  const { score, breakdown, objections } = calculateScore({ lead, notes, stages, now });
  const classification = classify(score);
  const tags = mergeTags(lead?._embedded?.tags, classification.tag);
  return { leadId: lead.id, score, breakdown, objections, ...classification, tags };
}

/** Texto da nota registrada no card do lead. */
function buildNote(evaluation) {
  const lines = [
    `🤖 Alice Bot — qualificação automática`,
    `Score: ${evaluation.score}/100 → Lead ${evaluation.temperatura.toUpperCase()} (${evaluation.stage})`,
    `Tags: ${evaluation.tags.filter((t) => [...TEMPERATURE_TAGS, TAGS.FOLLOW_UP, TAGS.FINALIZADO].includes(t)).join(', ')}`,
    '',
    'Composição do score:',
    ...evaluation.breakdown.map((b) => `• ${b.label}: ${b.points > 0 ? '+' : ''}${b.points}${b.detail ? ` (${b.detail})` : ''}`),
  ];
  if (evaluation.objections.length) {
    lines.push('', 'Objeções identificadas (roteiro 5 passos):');
    for (const o of evaluation.objections) {
      lines.push(`▸ ${o.titulo}`);
      lines.push(`  1. Acolher: ${o.passos.acolher}`);
      lines.push(`  2. Investigar: ${o.passos.investigar}`);
      lines.push(`  3. Compreender: ${o.passos.compreender}`);
      lines.push(`  4. Reposicionar: ${o.passos.reposicionar}`);
      lines.push(`  5. Conduzir: ${o.passos.conduzir}`);
    }
  }
  lines.push('', 'Próximo passo: follow-up no dia 2 (follow_up_day2).');
  return lines.join('\n');
}

/** Resumo curto para o campo "Resumo Alice Bot" do card (a nota longa fica opcional). */
function buildSummary(evaluation, now = new Date()) {
  const quando = now.toLocaleDateString('pt-BR');
  const sinais = evaluation.breakdown
    .filter((b) => b.label !== 'Base' && b.points > 0)
    .map((b) => b.label.toLowerCase())
    .join(', ');
  const lines = [
    `Alice · ${quando} · Score ${evaluation.score}/100 · ${evaluation.temperatura.toUpperCase()}`,
    `Sinais: ${sinais || 'poucos sinais de interesse'}`,
  ];
  if (evaluation.objections.length) {
    lines.push(`Objeções: ${evaluation.objections.map((o) => o.titulo).join(', ')}`);
    const o = evaluation.objections[0];
    lines.push(`Sugestão (${o.titulo}): ${o.passos.acolher} ${o.passos.investigar}`);
  }
  lines.push(
    evaluation.temperatura === 'quente'
      ? 'Próximo passo: Maria assume e oferece horários de avaliação.'
      : evaluation.temperatura === 'morna'
        ? 'Próximo passo: follow-up no dia 2 esclarecendo dúvidas.'
        : 'Próximo passo: follow-up leve no dia 2; sem pressão.'
  );
  return lines.join('\n');
}

// ─── 19 objeções — metodologia dos 5 passos ─────────────────────────────────────

const OBJECTIONS = [
  {
    id: 'valor_consulta',
    titulo: 'Valor da consulta',
    gatilhos: [/(caro|valor|preco|quanto).{0,30}consulta|consulta.{0,30}(cara|valor|preco)/],
    passos: {
      acolher: 'Entendo, é natural querer entender o investimento antes de decidir.',
      investigar: 'Hoje, o que pesa mais para você: o valor em si ou entender o que está incluído na avaliação?',
      compreender: 'Faz sentido querer ter certeza de que a consulta vai realmente responder às suas dúvidas.',
      reposicionar: 'A consulta é uma avaliação especializada e individualizada com o Dr. Rafael: histórico, sintomas, fotos, exames e objetivos analisados com calma.',
      conduzir: 'Posso pedir para o time te passar o investimento atualizado e as opções disponíveis?',
    },
  },
  {
    id: 'valor_cirurgia',
    titulo: 'Valor da cirurgia',
    gatilhos: [/(caro|valor|preco|quanto custa|orcamento).{0,30}(cirurgia|operar|lipedefinition)|(cirurgia|lipedefinition).{0,30}(cara|valor|preco)/],
    passos: {
      acolher: 'É uma decisão importante e é ótimo que você esteja se planejando.',
      investigar: 'Você já tem uma indicação cirúrgica ou ainda está entendendo o seu caso?',
      compreender: 'Sem avaliação, qualquer valor seria só uma estimativa — e você merece um plano feito para você.',
      reposicionar: 'O orçamento cirúrgico depende do planejamento individual definido em consulta, considerando técnica, áreas e segurança.',
      conduzir: 'O primeiro passo é a avaliação com o Dr. Rafael. Quer que eu te explique como funciona?',
    },
  },
  {
    id: 'distancia',
    titulo: 'Mora longe / outra cidade',
    gatilhos: [/moro (longe|em outr|fora)|outra cidade|outro estado|fora do rio|distancia|viajar/],
    passos: {
      acolher: 'Que bom que você chegou até nós mesmo morando em outra cidade.',
      investigar: 'Você mora em qual cidade? Já pensou em como seria a sua vinda?',
      compreender: 'Organizar deslocamento e agenda é uma preocupação real.',
      reposicionar: 'Recebemos pacientes de outras cidades e do exterior, e o time ajuda a organizar a jornada.',
      conduzir: 'Posso te explicar as opções de avaliação para quem vem de fora?',
    },
  },
  {
    id: 'internacional',
    titulo: 'Paciente internacional',
    gatilhos: [/moro (no|na|nos|em) (exterior|eua|estados unidos|portugal|europa|canada)|exterior|abroad|international/],
    passos: {
      acolher: 'Será um prazer te atender, mesmo à distância.',
      investigar: 'Em qual país você está e qual seria o melhor período para vir ao Brasil?',
      compreender: 'Planejar uma viagem para cuidar da saúde exige previsibilidade.',
      reposicionar: 'A clínica recebe pacientes do exterior e orienta cada etapa da jornada.',
      conduzir: 'Posso encaminhar seu contato ao time que cuida de pacientes internacionais?',
    },
  },
  {
    id: 'medo_cirurgia',
    titulo: 'Medo de cirurgia',
    gatilhos: [/medo (de|da) (cirurgia|operar|anestesia)|tenho medo|receio de operar|inseguranca/],
    passos: {
      acolher: 'É totalmente compreensível sentir medo.',
      investigar: 'O que mais te preocupa: a anestesia, a recuperação ou o resultado?',
      compreender: 'A decisão cirúrgica precisa ser tomada com segurança e clareza.',
      reposicionar: 'A consulta serve justamente para avaliar se há indicação e quais caminhos fazem sentido — nem toda paciente precisa operar no primeiro momento.',
      conduzir: 'Quer entender como é feita essa avaliação com o Dr. Rafael?',
    },
  },
  {
    id: 'tempo_afastamento',
    titulo: 'Tempo de afastamento',
    gatilhos: [/afastamento|quantos dias (de )?(repouso|parad)|voltar (a|ao) trabalh|licenca/],
    passos: {
      acolher: 'Entendo, organizar trabalho e rotina é fundamental.',
      investigar: 'Como é a sua rotina hoje? Você trabalha presencialmente?',
      compreender: 'Você precisa de previsibilidade para se planejar.',
      reposicionar: 'O tempo de recuperação é individual e definido pelo médico conforme o planejamento do seu caso.',
      conduzir: 'Na consulta você recebe essa orientação personalizada. Posso te explicar os próximos passos?',
    },
  },
  {
    id: 'sem_diagnostico',
    titulo: 'Ainda sem diagnóstico',
    gatilhos: [/nao tenho diagnostico|sem diagnostico|nunca fui diagnosticad|nao sei se (e|tenho) lipedema/],
    passos: {
      acolher: 'Muitas pacientes chegam exatamente com essa dúvida.',
      investigar: 'Quais sinais te fizeram pensar em lipedema?',
      compreender: 'Depois de anos ouvindo que era só emagrecer, é natural querer respostas.',
      reposicionar: FRASE_SEGURANCA,
      conduzir: 'A consulta é o caminho para investigar isso com critério. Quer saber como funciona?',
    },
  },
  {
    id: 'lipedema_ou_gordura',
    titulo: 'Lipedema ou gordura localizada?',
    gatilhos: [/gordura localizada|e so gordura|sera que e lipedema|lipedema ou/],
    passos: {
      acolher: 'Essa é uma dúvida muito comum e importante.',
      investigar: 'Você sente dor, peso ou tem hematomas com facilidade nessas regiões?',
      compreender: 'Existem sinais específicos que precisam ser investigados por um especialista.',
      reposicionar: FRASE_SEGURANCA,
      conduzir: 'Posso te explicar como o Dr. Rafael avalia esses sinais?',
    },
  },
  {
    id: 'comparacao_medicos',
    titulo: 'Comparação com outros médicos',
    gatilhos: [/outro medico|outra clinica|outro cirurgiao|mais barato|orcamento (de|com) outr|comparando/],
    passos: {
      acolher: 'Faz todo sentido pesquisar antes de uma decisão tão importante.',
      investigar: 'O que é mais importante para você na escolha do especialista?',
      compreender: 'Você quer segurança de estar nas mãos certas.',
      reposicionar: 'O Dr. Rafael tem foco em lipedema e é criador da LipeDefinition® e do Sublift, com avaliação individualizada.',
      conduzir: 'Quer conhecer como é a jornada de avaliação aqui na Blue?',
    },
  },
  {
    id: 'promessas_exageradas',
    titulo: 'Desconfiança de promessas',
    gatilhos: [/promet|garant|milagre|sera que funciona|golpe|desconfi/],
    passos: {
      acolher: 'Sua cautela é muito saudável.',
      investigar: 'Você já teve alguma experiência que não correspondeu ao prometido?',
      compreender: 'Ninguém quer ser tratada com promessas vazias.',
      reposicionar: 'Aqui não trabalhamos com promessa de resultado: a conduta é definida com critério médico, após avaliação.',
      conduzir: 'Posso te explicar como é feita essa avaliação?',
    },
  },
  {
    id: 'resultado_artificial',
    titulo: 'Medo de resultado artificial',
    gatilhos: [/artificial|natural|ficar estranh|exagerad|deformad/],
    passos: {
      acolher: 'Entendo, você quer se reconhecer no espelho.',
      investigar: 'Qual resultado seria ideal para você?',
      compreender: 'Harmonia e naturalidade são expectativas legítimas.',
      reposicionar: 'O planejamento busca contorno e harmonia corporal, sempre alinhado às expectativas reais discutidas em consulta.',
      conduzir: 'Quer conversar sobre seus objetivos na avaliação?',
    },
  },
  {
    id: 'recuperacao_dificil',
    titulo: 'Medo de recuperação difícil',
    gatilhos: [/recuperacao|pos[- ]operatorio|dor depois|pos cirurgi|drenagem/],
    passos: {
      acolher: 'É natural se preocupar com o pós-operatório.',
      investigar: 'O que você já ouviu sobre recuperação que te deixou preocupada?',
      compreender: 'Saber o que esperar traz tranquilidade.',
      reposicionar: 'A clínica acompanha a paciente no pré e pós-operatório com orientação clara em cada etapa.',
      conduzir: 'Posso te contar como funciona esse acompanhamento?',
    },
  },
  {
    id: 'pele_irregular',
    titulo: 'Medo de pele irregular',
    gatilhos: [/pele (irregular|flacida|ondulad)|flacidez|medo de ficar (com a pele|flacid)/],
    passos: {
      acolher: 'Essa preocupação é muito comum e importante.',
      investigar: 'Hoje você já percebe irregularidades ou celulites profundas?',
      compreender: 'Você quer um resultado completo, não só redução de volume.',
      reposicionar: 'A avaliação considera qualidade de pele; em alguns casos o Sublift pode ser associado, conforme indicação médica.',
      conduzir: 'Quer que o Dr. Rafael avalie também essa questão?',
    },
  },
  {
    id: 'sublift_serve',
    titulo: 'Sublift serve para o meu caso?',
    gatilhos: [/sublift|celulite profunda|furinhos|celulite/],
    passos: {
      acolher: 'Ótima pergunta — muitas pacientes se incomodam com isso.',
      investigar: 'Suas celulites parecem superficiais ou são depressões mais profundas?',
      compreender: 'Cada pele e grau de celulite são diferentes.',
      reposicionar: 'O Sublift é a técnica autoral do Dr. Rafael para celulites profundas e irregularidades; a indicação depende de avaliação individualizada.',
      conduzir: 'Quer agendar uma avaliação para entender se faz sentido no seu caso?',
    },
  },
  {
    id: 'plano_saude',
    titulo: 'Plano de saúde / convênio',
    gatilhos: [/plano de saude|convenio|reembolso|unimed|amil|bradesco saude|sulamerica/],
    passos: {
      acolher: 'Entendo, é importante saber como funciona.',
      investigar: 'Você gostaria de verificar reembolso com o seu plano?',
      compreender: 'Faz parte do planejamento financeiro.',
      reposicionar: 'O atendimento é particular; o time pode orientar sobre documentação para você consultar reembolso junto ao seu plano, sem garantia de cobertura.',
      conduzir: 'Posso pedir para o time te enviar essas informações?',
    },
  },
  {
    id: 'decisao_compartilhada',
    titulo: 'Preciso pensar / falar com alguém',
    gatilhos: [/vou pensar|preciso pensar|falar com (meu|minha)|marido|esposo|familia|decidir depois/],
    passos: {
      acolher: 'Claro, é uma decisão importante e merece ser pensada com calma.',
      investigar: 'Ficou alguma dúvida que eu possa esclarecer para te ajudar nessa conversa?',
      compreender: 'Quer se sentir segura e ter o apoio de quem você ama.',
      reposicionar: 'A consulta é um passo de informação: você sai com clareza para decidir, sem compromisso de cirurgia.',
      conduzir: 'Posso te enviar um resumo de como funciona a avaliação para você compartilhar?',
    },
  },
  {
    id: 'sem_tempo',
    titulo: 'Falta de tempo / agenda',
    gatilhos: [/sem tempo|nao tenho tempo|correria|agenda (cheia|apertada)|mais pra frente|depois das ferias/],
    passos: {
      acolher: 'Entendo, a rotina é corrida mesmo.',
      investigar: 'Qual período seria mais tranquilo para você?',
      compreender: 'Cuidar de si precisa caber na sua vida.',
      reposicionar: 'O time busca horários que se encaixem na sua agenda e organiza a jornada com antecedência.',
      conduzir: 'Quer que eu verifique as próximas disponibilidades?',
    },
  },
  {
    id: 'forma_pagamento',
    titulo: 'Forma de pagamento / parcelamento',
    gatilhos: [/parcel|cartao|pix|boleto|forma de pagamento|a vista/],
    passos: {
      acolher: 'Ótimo que você já esteja pensando no planejamento.',
      investigar: 'Qual forma de pagamento seria mais confortável para você?',
      compreender: 'Ter opções facilita a decisão.',
      reposicionar: 'O time apresenta as formas de pagamento disponíveis de forma transparente.',
      conduzir: 'Posso pedir para te enviarem as opções atualizadas?',
    },
  },
  {
    id: 'consulta_online',
    titulo: 'Consulta online / teleconsulta',
    gatilhos: [/online|teleconsulta|videochamada|chamada de video|a distancia|remot/],
    passos: {
      acolher: 'Entendo, facilitaria muito a sua rotina.',
      investigar: 'Você mora longe ou é uma questão de agenda?',
      compreender: 'Você quer começar a jornada sem grandes deslocamentos.',
      reposicionar: 'O time orienta o formato de avaliação disponível para o seu caso, conforme o fluxo aprovado pela clínica.',
      conduzir: 'Quer que eu verifique as opções de avaliação para você?',
    },
  },
];

function detectObjections(text, { normalized = false } = {}) {
  const t = normalized ? text : normalize(text);
  return OBJECTIONS.filter((o) => o.gatilhos.some((re) => re.test(t))).map(({ id, titulo, passos }) => ({ id, titulo, passos }));
}

module.exports = {
  TAGS,
  TEMPERATURE_TAGS,
  OBJECTIONS,
  FRASE_SEGURANCA,
  normalize,
  calculateScore,
  classify,
  mergeTags,
  evaluateLead,
  buildNote,
  buildSummary,
  detectObjections,
};
