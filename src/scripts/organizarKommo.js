#!/usr/bin/env node
'use strict';

/**
 * Organização da conta comercialblueclinica.kommo.com
 *
 * Etapas (rodam nesta ordem; cada uma pode ser chamada sozinha com --etapas):
 *   backup     Salva funis, campos, templates, tarefas e leads (id/funil/etapa/tags/campos) em backups/
 *   funis      Comercial 1 e Comercial 2 com as MESMAS 8 etapas (jornada completa num funil só);
 *              apaga o funil vazio "Alice - Blue"
 *   campos     Card enxuto: aba principal com o que a comercial preenche, aba "Qualificação (Alice)"
 *              com o que é automático, aba "Financeiro"; remove campos nunca usados; corrige
 *              "Classificação" e "Dara e horário"
 *   tags       Padroniza temperatura (frio/ia-frio/morno/quente/muito_quente → lead_*) e região
 *   tarefas    Conclui as tarefas automáticas vencidas "NOVO LEAD CHEGOU"
 *   templates  Renomeia os templates por etapa da jornada e cria os 19 de objeção (5 passos)
 *
 * Uso:
 *   node src/scripts/organizarKommo.js                      # simula tudo (não grava)
 *   node src/scripts/organizarKommo.js --aplicar            # aplica tudo (faz backup antes)
 *   node src/scripts/organizarKommo.js --etapas campos,tags --aplicar
 */

const fs = require('fs');
const path = require('path');
const { getKommoClient } = require('../services/kommoClient');
const { OBJECTIONS } = require('../services/aliceEngine');

// ─── Plano da conta ────────────────────────────────────────────────────────────

const PIPE_C1 = 13604187;
const PIPE_C2 = 13687203;
const PIPE_ALICE_VAZIO = 14507315;

/** Estrutura padrão dos funis comerciais (a mesma para Comercial 1 e 2). */
const ETAPAS = [
  { key: 'novo', name: '1. Novo · boas-vindas', color: '#fffeb2' },
  { key: 'qualificado', name: '2. Qualificado', color: '#ffeab2' },
  { key: 'negociacao', name: '3. Interesse em agendar · Maria', color: '#ffdc7f' },
  { key: 'agendada', name: '4. Consulta agendada', color: '#98cbff' },
  { key: 'realizada', name: '5. Consulta realizada', color: '#c1e0ff' },
  { key: 'oportunidade', name: '6. Oportunidade cirúrgica', color: '#f3beff' },
  { key: 'cirurgia', name: '7. Cirurgia confirmada', color: '#87f2c0' },
  { key: 'nutricao', name: '8. Nutrição · retomar depois', color: '#e6e8ea' },
];

/** Etapa antiga → etapa padrão. Etapas antigas que caem na mesma chave têm os leads unificados. */
const MAPA_ETAPAS = {
  [PIPE_C1]: {
    name: 'Comercial 1',
    map: {
      104983955: 'novo', // Qualificação Bot
      104983959: 'qualificado', // Qualificado
      106593295: 'negociacao', // Em Negociação
      104983967: 'agendada', // Agendamento Confirmado
      104983971: 'realizada', // Consulta Realizada
      105634691: 'oportunidade', // Oportunidade Cirúrgica
      111694343: 'cirurgia', // Cirurgia Confirmada
      111694511: 'nutricao', // Nutrição
    },
  },
  [PIPE_C2]: {
    name: 'Comercial 2',
    map: {
      105629575: 'negociacao', // Oferta feita (oferta de consulta já enviada)
      105629571: 'negociacao', // Contato inicial
      105629579: 'negociacao', // Negociação
    },
  },
};

const NOMES_FINAIS = { 142: '✅ Consulta concluída (ganho)', 143: '❌ Perdido' };

// Campos: aba principal (o que a comercial preenche), Alice (automático), Financeiro.
const CAMPOS_PRINCIPAL = [3837314, 3837316, 3837318, 3837320, 3837322, 3728946, 3728948, 3839456, 3839458, 3728956];
const CAMPOS_ALICE = [3837342, 3837344, 3837346, 3839836, 3837326, 3837328, 3837330, 3837336, 3837338, 3837334, 3728944, 3728942, 3837352, 3837354, 3839690, 3837356];
const CAMPOS_FINANCEIRO = [3728962, 3728960];
/** Nunca preenchidos em nenhum dos 4.421 leads (conferido em 23/09/2026). */
const CAMPOS_REMOVER = [3728950, 3728952, 3728954, 3728958, 3728964, 3837324, 3837332, 3837340, 3837348, 3837350, 3839454, 3839460];
const RENOMEAR_CAMPOS = { 3728948: 'Data e horário da consulta' };
const CLASSIFICACAO = {
  id: 3837344,
  enums: [
    // Sem emoji: o Kommo grava vazia a opção que tem emoji como 🔥/🌤 (por isso havia opções em branco).
    { id: 735973966, value: 'Fria (0–39)', sort: 1 },
    { id: 735973968, value: 'Morna (40–69)', sort: 2 },
    { id: 735973972, value: 'Quente (70–100)', sort: 3 },
  ],
};

const TAGS_TROCAR = {
  frio: 'lead_fria',
  'ia-frio': 'lead_fria',
  morno: 'lead_morna',
  quente: 'lead_quente',
  muito_quente: 'lead_quente',
  alice_rj: 'rj',
  alice_sp: 'sp',
  alice_internacional: 'internacional',
};

const TEMPLATES_NOMES = {
  42732: '09 Follow-up · Resgate lead quente',
  43376: '09 Follow-up · Resgate SP',
  43684: '07 Pré-consulta · Confirmação da consulta (Letícia)',
  43686: '09 Follow-up · Resgate lead fria (Letícia)',
  43688: '04 Objeção · Deixar para depois',
  43690: '06 Pagamento · Chave Pix',
  43692: '03 Apresentação · Antes e depois (Instagram)',
  43716: '01 Abertura · Boas-vindas',
  43718: '07 Pré-consulta · Lembrete de consulta',
  43720: '06 Pagamento · 2ª parte',
  43722: '08 Pós-consulta · Consulta de retorno',
  43724: '09 Follow-up · Motivo da desistência',
  43726: '05 Agendamento · Convite para agendar',
  43728: '03 Apresentação · Blue Clínica',
  43732: '05 Agendamento · Dados para cadastro',
  43736: '07 Pré-consulta · Lista de exames',
  43738: '07 Pré-consulta · Questionário anamnese (link)',
  43740: '01 Abertura · Tráfego pago',
  43742: '04 Objeção · Investimento alto',
  43744: '03 Apresentação · LipeDefinition',
  43746: '02 Qualificação · Como nos encontrou',
  43748: '02 Qualificação · Qual seu nome',
  43750: '03 Apresentação · Atendimento em Goiânia',
  44964: '09 Follow-up · Retomada pós-feriado',
  44966: '09 Follow-up · Retomada pós-feriado (ES)',
  44968: '09 Follow-up · Retomada pós-feriado (EN)',
  44970: '01 Abertura · Bom dia pós-feriado (Letícia)',
  44972: '01 Abertura · Bom dia pós-feriado (ES)',
  44974: '01 Abertura · Bom dia pós-feriado (EN)',
  44976: '01 Abertura · Boa tarde pós-feriado (Letícia)',
  44978: '01 Abertura · Como posso ajudar',
  44982: '09 Follow-up · Resgate lead SP (Letícia)',
  44986: '10 Endereço · São Paulo',
  44988: '07 Pré-consulta · Termo de autorização',
  44990: '03 Apresentação · Teleconsulta (o que avalia)',
  44992: '07 Pré-consulta · Instruções para fotos',
  44994: '07 Pré-consulta · Lembrete de consulta (REVISAR: nome fixo "Amanda")',
  45006: '06 Pagamento · Valor da consulta (R$ 1.800)',
  45008: '02 Qualificação · Empatia (relato comum)',
  45010: '01 Abertura · Bom dia (curto)',
  45012: '02 Qualificação · Como nos encontrou (curto)',
  45014: '02 Qualificação · Fico feliz que nos encontrou',
  45016: '02 Qualificação · Vamos mudar essa realidade',
  45018: '01 Abertura · Apresentação (Letícia)',
  45020: '04 Objeção · Plano de saúde',
  45022: '05 Agendamento · Como funciona',
  45024: '03 Apresentação · O que a consulta inclui',
  45026: '02 Qualificação · Diagnóstico ou suspeita?',
  45028: '04 Objeção · Mora fora do Rio',
  45030: '01 Abertura · Apresentação Maria (bom dia)',
  45034: '07 Pré-consulta · Próximos passos após agendar',
  45036: '01 Abertura · Pós fim de semana',
  45038: '08 Cirurgia · Logística para quem vem de fora',
  45040: '02 Qualificação · Muitas pacientes na região',
  45046: '08 Cirurgia · Valor varia (Dr. Rafael)',
  45052: '03 Apresentação · Sobre o Dr. Rafael',
  45056: '03 Apresentação · Posso enviar o que a consulta inclui?',
  45060: '09 Follow-up · Retomada de janeiro (REVISAR: nome fixo "Juliene")',
  45062: '02 Qualificação · Que bom que nos encontrou',
  45064: '07 Pré-consulta · Confirmar consulta (Maria)',
  45066: '07 Pré-consulta · Envio dos pedidos de exame',
  45068: '09 Follow-up · Retomada início do ano',
  45070: '09 Follow-up · Lead morna',
  45072: '02 Qualificação · Empatia (obrigada por compartilhar)',
  45074: '03 Apresentação · Celulite x lipedema',
  45076: '08 Cirurgia · Hospitais',
  45078: '01 Abertura · Bom dia, como está?',
  45080: '04 Objeção · Deixar para depois (REVISAR: nome fixo "Sueda")',
  45082: '03 Apresentação · Goiânia agenda fechada',
  45506: '01 Abertura · Prospecção bom dia (Maria)',
  45508: '06 Pagamento · Reserva da consulta (RJ)',
  45522: '01 Abertura · Prospecção boa tarde (Maria)',
  45528: '03 Apresentação · Consulta presencial',
  45530: '03 Apresentação · Teleconsulta',
  45534: '01 Abertura · Anúncio (EN)',
  45536: '05 Agendamento · Dados + formulário de cadastro',
  45564: '04 Objeção · Alternativa Dr. Leonardo (REVISAR: nome fixo "Flavia")',
  45578: '10 Endereço · Rio de Janeiro (Barra)',
  45650: '07 Pré-consulta · Bioimpedância e fotos',
  46018: '05 Agendamento · Dados para cadastro (EN)',
  46020: '05 Agendamento · Dados para cadastro (ES)',
  46022: '01 Abertura · Bom dia (EN)',
  46024: '01 Abertura · Boa tarde (EN)',
  46026: '01 Abertura · Boa tarde (ES)',
  46028: '06 Pagamento · Reserva da consulta (EN)',
  46030: '06 Pagamento · Reserva da consulta (ES)',
  46032: '06 Pagamento · Reserva da consulta (plástica)',
  46278: '06 Pagamento · Reserva da consulta (SP)',
  46592: '08 Cirurgia · Valor varia (Dr. Leonardo)',
  46718: '04 Objeção · Alternativa Dra. Lorena',
  47048: '08 Pós-consulta · Feedback',
  47216: '05 Agendamento · Dados + formulário (plástica)',
  47402: '07 Pré-consulta · Termo de autorização (EN)',
  47404: '07 Pré-consulta · Termo de autorização (ES)',
  47422: '01 Abertura · Mensagem de espera',
  47438: '03 Apresentação · Consulta presencial SP',
  47574: '05 Agendamento · Dados + formulário (EN)',
  47728: '01 Abertura · Bom dia (ES)',
  47998: '07 Pré-consulta · Formulário (EN, link)',
  48300: '07 Pré-consulta · Formulário plástica (link)',
  49914: '03 Apresentação · Passo a passo plástica',
  49916: '05 Agendamento · Manhã ou tarde?',
  50382: '06 Pagamento · Reserva da consulta (Dr. Leonardo)',
  51114: '09 Follow-up · Reativação 2026',
};

/** Textos dos 2 robôs (docs/bots.md). Ficam também como templates para a comercial usar no chat. */
// Voz da Alice (Manual Comercial Blue): "Não pressionamos. Não abandonamos. Entendemos, acolhemos e conduzimos."
const BOT_TEMPLATES = [
  {
    name: '00 Alice · Boas-vindas',
    content:
      'Oi! Que alegria receber sua mensagem 💙\n' +
      'Eu sou a Alice, assistente de relacionamento do Dr. Rafael Erthal, aqui na Clínica Blue.\n' +
      '\n' +
      'Pode ficar tranquila: por aqui a gente escuta com calma, sem pressa e sem julgamento.\n' +
      '\n' +
      'Para a Maria, nossa consultora, já chegar sabendo como cuidar de você, me conta rapidinho:\n' +
      '\n' +
      '1️⃣ Como você gostaria de ser chamada?\n' +
      '2️⃣ De qual cidade você fala?\n' +
      '3️⃣ O que te trouxe até o Dr. Rafael? (lipedema, dor ou inchaço nas pernas, cirurgia plástica, contorno corporal…)\n' +
      '4️⃣ Você já tem diagnóstico de lipedema ou seria sua primeira avaliação?\n' +
      '\n' +
      'Pode responder do seu jeito, até por áudio 😊\n' +
      'A Maria vai falar com você pessoalmente em breve (de segunda a sexta, das 9h às 17h30). 💙',
  },
  {
    name: '00 Alice · Follow-up dia 2',
    content:
      'Oi, {{contact.first_name}}! Aqui é a Alice, assistente de relacionamento do Dr. Rafael Erthal 💙\n' +
      'Passei só para saber como você está e se ficou alguma dúvida sobre a avaliação.\n' +
      '\n' +
      'Sem pressa, tá? Quando fizer sentido para você, a Maria vê os melhores horários na agenda do Dr. Rafael.',
  },
  {
    name: '00 Alice · Follow-up último contato',
    content:
      'Oi, {{contact.first_name}}, é a Alice, do Dr. Rafael Erthal 💙\n' +
      'Não quero ser inconveniente, então vou pausar nosso contato por aqui.\n' +
      '\n' +
      'Mas fica o recado: quando você quiser retomar, a gente vai estar aqui para te acolher, do ponto em que paramos. Um abraço carinhoso!',
  },
];

/** Mensagem pronta a partir do roteiro de 5 passos (acolher + compreender + reposicionar + conduzir). */
function objectionTemplate(o) {
  return {
    name: `04 Objeção · ${o.titulo} (5 passos)`,
    content: `${o.passos.acolher} ${o.passos.compreender}\n\n${o.passos.reposicionar}\n\n${o.passos.conduzir}`,
  };
}

// ─── Execução ─────────────────────────────────────────────────────────────────

const log = (...m) => console.log(...m);
const title = (t) => log(`\n━━ ${t} ${'━'.repeat(Math.max(0, 60 - t.length))}`);

function parseArgs(argv) {
  const all = ['backup', 'funis', 'campos', 'tags', 'tarefas', 'templates'];
  const args = { apply: false, steps: all };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--aplicar') args.apply = true;
    else if (argv[i] === '--etapas') args.steps = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`Opção desconhecida: ${argv[i]}`);
  }
  for (const s of args.steps) if (!all.includes(s)) throw new Error(`Etapa desconhecida: ${s}`);
  if (args.apply && !args.steps.includes('backup')) args.steps.unshift('backup');
  return args;
}

async function backup(k) {
  title('Backup');
  const dir = path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const leads = [];
  for await (const { items } of k.paginate('/leads', { embeddedKey: 'leads' })) {
    for (const l of items) {
      leads.push({ id: l.id, pipeline_id: l.pipeline_id, status_id: l.status_id, tags: (l._embedded?.tags || []).map((t) => t.name), custom_fields_values: l.custom_fields_values });
    }
  }
  const snapshot = {
    at: new Date().toISOString(),
    pipelines: await k.getPipelines(),
    custom_fields: await k.listAll('/leads/custom_fields', { embeddedKey: 'custom_fields' }),
    field_groups: (await k.get('/leads/custom_fields/groups'))?._embedded?.custom_field_groups || [],
    templates: await k.listAll('/chats/templates', { embeddedKey: 'chat_templates' }),
    tasks_open: await k.listAll('/tasks', { embeddedKey: 'tasks', params: { 'filter[is_completed]': 0 } }),
    leads,
  };
  const file = path.join(dir, `kommo-${snapshot.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot));
  log(`💾 ${leads.length} leads, ${snapshot.custom_fields.length} campos, ${snapshot.templates.length} templates → ${path.relative(process.cwd(), file)}`);
  return snapshot;
}

async function funis(k, apply) {
  title('Funis');
  const pipelines = await k.getPipelines();
  for (const [pidStr, plan] of Object.entries(MAPA_ETAPAS)) {
    const pid = Number(pidStr);
    const pipe = pipelines.find((p) => p.id === pid);
    const statuses = pipe._embedded.statuses;
    log(`\n${pipe.name} (#${pid})`);
    if (pipe.name !== plan.name) {
      log(`  renomear funil "${pipe.name}" → "${plan.name}"`);
      if (apply) await k.request('patch', `/leads/pipelines/${pid}`, { data: { name: plan.name } });
    }

    // 1) Para cada etapa padrão, reaproveita a 1ª etapa antiga mapeada (renomeia) ou cria.
    const keep = {};
    for (const [oldId, key] of Object.entries(plan.map)) if (!keep[key]) keep[key] = Number(oldId);
    const target = {};
    for (const [i, etapa] of ETAPAS.entries()) {
      const sort = 20 + i * 10;
      const existing =
        statuses.find((s) => s.name === etapa.name) || (keep[etapa.key] && statuses.find((s) => s.id === keep[etapa.key]));
      if (existing) {
        target[etapa.key] = existing.id;
        if (existing.name !== etapa.name || existing.sort !== sort) {
          log(`  etapa "${existing.name}" → "${etapa.name}"`);
          if (apply) await k.request('patch', `/leads/pipelines/${pid}/statuses/${existing.id}`, { data: { name: etapa.name, sort } });
        }
      } else {
        log(`  + criar etapa "${etapa.name}"`);
        if (apply) {
          const res = await k.request('post', `/leads/pipelines/${pid}/statuses`, { data: [{ name: etapa.name, sort, color: etapa.color }] });
          target[etapa.key] = res._embedded.statuses[0].id;
        }
      }
    }

    // 2) Etapas antigas que foram unificadas: move os leads e apaga a etapa vazia.
    for (const [oldIdStr, key] of Object.entries(plan.map)) {
      const oldId = Number(oldIdStr);
      if (oldId === target[key] || !statuses.some((s) => s.id === oldId)) continue;
      const leads = await k.listAll('/leads', { embeddedKey: 'leads', params: { 'filter[statuses][0][pipeline_id]': pid, 'filter[statuses][0][status_id]': oldId } });
      const old = statuses.find((s) => s.id === oldId);
      log(`  mover ${leads.length} lead(s) de "${old?.name}" → "${ETAPAS.find((e) => e.key === key).name}" e apagar a etapa antiga`);
      if (apply) {
        if (leads.length) await k.updateLeads(leads.map((l) => ({ id: l.id, pipeline_id: pid, status_id: target[key] })));
        await k.request('delete', `/leads/pipelines/${pid}/statuses/${oldId}`);
      }
    }

    // 3) Garante a ordem 1→8. O Kommo reembaralha quando duas etapas disputam a mesma
    //    posição no meio da troca, então primeiro manda para posições temporárias livres.
    if (apply) {
      const fresh = () => k.getPipelines().then((ps) => ps.find((p) => p.id === pid)._embedded.statuses);
      const wrong = (sts) => ETAPAS.some((e, i) => {
        const st = sts.find((s) => s.id === target[e.key]);
        return st && (st.sort !== 20 + i * 10 || st.name !== e.name);
      });
      if (wrong(await fresh())) {
        for (const pass of [500, 20]) {
          for (const [i, etapa] of ETAPAS.entries()) {
            if (!target[etapa.key]) continue;
            // Sempre com o nome: um PATCH só com "sort" apaga o nome da etapa no Kommo.
            await k.request('patch', `/leads/pipelines/${pid}/statuses/${target[etapa.key]}`, { data: { name: etapa.name, sort: pass + i * 10 } });
          }
        }
        if (wrong(await fresh())) log('  ⚠️ a ordem das etapas não ficou 1→8; ajuste arrastando na tela do funil');
        else log('  ordem das etapas ajustada (1→8)');
      }
    }

    // 4) Etapas finais (ganho/perdido)
    for (const s of statuses.filter((x) => NOMES_FINAIS[x.id] && x.name !== NOMES_FINAIS[x.id])) {
      log(`  final "${s.name}" → "${NOMES_FINAIS[s.id]}"`);
      if (apply) {
        try {
          await k.request('patch', `/leads/pipelines/${pid}/statuses/${s.id}`, { data: { name: NOMES_FINAIS[s.id] } });
        } catch (e) {
          log(`    (o Kommo não deixa renomear ganho/perdido pela API; renomeie na tela do funil)`);
        }
      }
    }
  }

  const alice = pipelines.find((p) => p.id === PIPE_ALICE_VAZIO);
  if (alice) {
    const count = (await k.listAll('/leads', { embeddedKey: 'leads', params: { 'filter[pipeline_id]': PIPE_ALICE_VAZIO } })).length;
    if (count) log(`\n⚠️  "${alice.name}" tem ${count} lead(s); não será apagado.`);
    else {
      log(`\n🗑  apagar funil vazio "${alice.name}"`);
      if (apply) await k.request('delete', `/leads/pipelines/${PIPE_ALICE_VAZIO}`);
    }
  }
}

async function campos(k, apply) {
  title('Campos do card');
  const fields = await k.listAll('/leads/custom_fields', { embeddedKey: 'custom_fields' });
  const byId = new Map(fields.map((f) => [f.id, f]));
  const groups = (await k.get('/leads/custom_fields/groups'))?._embedded?.custom_field_groups || [];

  async function ensureGroup(name, sort) {
    const g = groups.find((x) => x.name === name);
    if (g) return g.id;
    log(`  + criar aba "${name}"`);
    if (!apply) return `nova:${name}`;
    const res = await k.request('post', '/leads/custom_fields/groups', { data: [{ name, sort }] });
    return res._embedded.custom_field_groups[0].id;
  }
  const gAlice = await ensureGroup('Qualificação (Alice)', 10);
  const gFin = await ensureGroup('Financeiro', 11);

  const updates = [];
  const place = (ids, groupId, label) => {
    for (const id of ids) {
      const f = byId.get(id);
      if (!f) continue;
      const current = f.group_id || 'default';
      if (groupId !== 'default' && current !== groupId) updates.push({ id, data: { group_id: groupId } });
      if (RENOMEAR_CAMPOS[id] && f.name !== RENOMEAR_CAMPOS[id]) updates.push({ id, data: { name: RENOMEAR_CAMPOS[id] } });
    }
    log(`  ${label}: ${ids.map((id) => RENOMEAR_CAMPOS[id] || byId.get(id)?.name).filter(Boolean).join(' · ')}`);
  };
  place(CAMPOS_PRINCIPAL, 'default', 'Principal (a comercial preenche)');
  place(CAMPOS_ALICE, gAlice, 'Qualificação (Alice)');
  place(CAMPOS_FINANCEIRO, gFin, 'Financeiro');
  log(`  ${updates.length} ajuste(s) de aba/nome`);

  const remove = CAMPOS_REMOVER.filter((id) => byId.has(id));
  log(`  🗑 remover (nunca usados): ${remove.map((id) => byId.get(id).name).join(' · ')}`);
  log(`  Classificação: ${CLASSIFICACAO.enums.map((e) => e.value).join(' / ')}`);

  if (!apply) return;
  for (const u of updates) {
    try {
      await k.request('patch', `/leads/custom_fields/${u.id}`, { data: u.data });
    } catch (e) {
      log(`    ⚠️ campo ${u.id}: ${e.message.slice(0, 160)}`);
    }
  }
  const cls = byId.get(CLASSIFICACAO.id);
  const clsOk = cls && CLASSIFICACAO.enums.every((e) => cls.enums?.some((x) => x.id === e.id && x.value === e.value)) && cls.enums.length === CLASSIFICACAO.enums.length;
  if (!clsOk) await k.request('patch', `/leads/custom_fields/${CLASSIFICACAO.id}`, { data: { enums: CLASSIFICACAO.enums } });
  for (const id of remove) await k.request('delete', `/leads/custom_fields/${id}`);
}

async function tags(k, apply) {
  title('Tags');
  const patches = [];
  const counts = {};
  for await (const { items } of k.paginate('/leads', { embeddedKey: 'leads' })) {
    for (const l of items) {
      const names = (l._embedded?.tags || []).map((t) => t.name);
      if (!names.some((n) => TAGS_TROCAR[n])) continue;
      const next = [];
      for (const n of names) {
        const to = TAGS_TROCAR[n] || n;
        if (TAGS_TROCAR[n]) counts[`${n} → ${to}`] = (counts[`${n} → ${to}`] || 0) + 1;
        if (!next.includes(to)) next.push(to);
      }
      // Uma temperatura só: fica a mais quente.
      const temps = ['lead_quente', 'lead_morna', 'lead_fria'].filter((t) => next.includes(t));
      const final = next.filter((t) => !temps.includes(t) || t === temps[0]);
      patches.push({ id: l.id, _embedded: { tags: final.map((name) => ({ name })) } });
    }
  }
  for (const [k2, v] of Object.entries(counts)) log(`  ${k2}: ${v}`);
  log(`  ${patches.length} leads atualizados`);
  if (apply && patches.length) await k.updateLeads(patches);
}

async function tarefas(k, apply) {
  title('Tarefas');
  const open = await k.listAll('/tasks', { embeddedKey: 'tasks', params: { 'filter[is_completed]': 0 } });
  const now = Date.now() / 1000;
  const auto = open.filter((t) => t.text.startsWith('NOVO LEAD CHEGOU') && t.complete_till < now);
  log(`  concluir ${auto.length} tarefas automáticas vencidas "NOVO LEAD CHEGOU" (ficam ${open.length - auto.length} tarefas reais)`);
  if (apply && auto.length) {
    const data = auto.map((t) => ({ id: t.id, is_completed: true, result: { text: 'Encerrada na organização do Kommo (aviso automático vencido).' } }));
    for (let i = 0; i < data.length; i += 50) await k.request('patch', '/tasks', { data: data.slice(i, i + 50) });
  }
}

async function templates(k, apply) {
  title('Templates');
  const list = await k.listAll('/chats/templates', { embeddedKey: 'chat_templates' });
  const renames = list.filter((t) => TEMPLATES_NOMES[t.id] && t.name !== TEMPLATES_NOMES[t.id]);
  log(`  renomear ${renames.length} templates (ex.: "${renames[0]?.name}" → "${TEMPLATES_NOMES[renames[0]?.id]}")`);
  const semMapa = list.filter((t) => !TEMPLATES_NOMES[t.id] && !/^(04 Objeção|00 Alice|00 Robô) ·/.test(t.name));
  if (semMapa.length) log(`  sem mapeamento (mantidos): ${semMapa.map((t) => t.name).join(' · ')}`);
  const novos = [...BOT_TEMPLATES, ...OBJECTIONS.map(objectionTemplate)].filter((n) => !list.some((t) => t.name === n.name));
  log(`  + criar ${novos.length} templates (3 dos robôs + objeções em 5 passos)`);
  if (!apply) return;
  let falhas = 0;
  for (const t of renames) {
    try {
      await k.request('patch', `/chats/templates/${t.id}`, { data: { name: TEMPLATES_NOMES[t.id], content: t.content } });
    } catch (e) {
      if (e.status === 403) {
        log('    ⚠️ o Kommo não deixa renomear templates pela API (403). Use docs/templates-renomear.md na tela.');
        break;
      }
      falhas += 1;
      if (falhas <= 3) log(`    ⚠️ template ${t.id}: ${e.message.slice(0, 200)}`);
    }
  }
  if (falhas) log(`    ${falhas} template(s) não renomeados`);
  for (let i = 0; i < novos.length; i += 10) await k.request('post', '/chats/templates', { data: novos.slice(i, i + 10) });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const k = getKommoClient();
  log(args.apply ? '⚙️  APLICANDO mudanças no Kommo' : '🧪 SIMULAÇÃO — nada será gravado (use --aplicar)');
  const steps = { backup, funis, campos, tags, tarefas, templates };
  for (const s of args.steps) await steps[s](k, args.apply);
  log(`\n✅ ${args.apply ? 'Organização aplicada' : 'Simulação concluída'} · ${k.stats.requests} chamadas · ${k.stats.retries} retries`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌', err.message);
    process.exit(1);
  });
}

module.exports = { ETAPAS, MAPA_ETAPAS, BOT_TEMPLATES, TEMPLATES_NOMES, objectionTemplate };
