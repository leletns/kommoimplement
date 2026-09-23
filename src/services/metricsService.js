'use strict';

/**
 * Consolida os KPIs comerciais a partir da API v4 do Kommo no formato exato do
 * objeto `PERIODS` do "Blue Painel Comercial v1 claro.dc.html":
 *
 *   { set: { label, range, leads, apn, consultas, cirurgias, vendas, receita, ads, cac,
 *            cm1, cm2, ticket, ciclo, leadsRenda, form, weeks, leadSeries, saleSeries,
 *            team: [{ name, role, leads, apn, sales, c1, c2, c3, revenue }],
 *            funnel: [{ label, count, value }] },
 *     ago: {...}, jul: {...} }
 *
 * Definições (ajustáveis pelo .env):
 *   - Funis: KOMMO_METRICS_PIPELINES (Comercial 1 e 2); o time do painel é um por funil.
 *   - Leads: leads criados no mês nesses funis.
 *   - Qualificados / APN: leads da safra do mês que chegaram na etapa (etapa atual ≥ etapa
 *     alvo, ganhos, ou evento de mudança de status para a etapa — cobre leads perdidos depois).
 *   - Consultas (CM1): ganhos (status 142 = "Consulta concluída") com fechamento no mês.
 *   - Cirurgias (CM2): leads que entraram em "7. Cirurgia confirmada" no mês. Sem essa etapa,
 *     tag/nome com cirurgia ou valor ≥ KOMMO_CIRURGIA_MIN_PRICE.
 *   - Receita: soma do valor (price) das consultas e cirurgias.
 *   - ADS: não existe no Kommo — vem de ADS_INVESTIMENTO_JSON ({"2026-09": 15034.66}).
 */

const config = require('../config');
const { resolvePipeline, WON, LOST } = require('./pipelineResolver');
const { normalize } = require('./aliceEngine');

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const CIRURGIA_MIN_PRICE = Number(process.env.KOMMO_CIRURGIA_MIN_PRICE || 10000);
const CIRURGIA_REGEX = /cirurg|lipedefinition|sublift|lipo ?hd|mastopexia|abdominoplastia|mamoplastia/;
const RENDA_FIELD_ID = process.env.KOMMO_RENDA_FIELD_ID ? Number(process.env.KOMMO_RENDA_FIELD_ID) : null;

function parseJsonEnv(name) {
  try {
    return process.env[name] ? JSON.parse(process.env[name]) : {};
  } catch {
    console.warn(`[metrics] ${name} não é um JSON válido; ignorando.`);
    return {};
  }
}

// ─── Formatação pt-BR (mesmo padrão dos dados de exemplo do painel) ──────────────

const int = (n) => Math.round(n || 0).toLocaleString('pt-BR');
const brl = (n) => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR');
const brlCents = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '0.0') + '%';
const pad = (n) => String(n).padStart(2, '0');
const dateBR = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

function brlCompact(n) {
  if (n >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M';
  if (n >= 1e3) return 'R$ ' + (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'k';
  return brl(n);
}

/** Últimos `count` meses, do mais recente para o mais antigo (ordem das abas do painel). */
function monthWindows(count, now = new Date()) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
    out.push({
      key: MONTH_KEYS[start.getMonth()],
      ym: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`,
      label: `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`,
      range: `${dateBR(start)} — ${dateBR(end)}`,
      from: Math.floor(start.getTime() / 1000),
      to: Math.floor(end.getTime() / 1000),
    });
  }
  return out;
}

const weekIndex = (unix) => Math.min(4, Math.floor((new Date(unix * 1000).getDate() - 1) / 7));

function isCirurgia(lead) {
  const text = normalize([lead.name, ...(lead._embedded?.tags || []).map((t) => t.name)].join(' '));
  return CIRURGIA_REGEX.test(text) || Number(lead.price) >= CIRURGIA_MIN_PRICE;
}

function hasRenda(lead) {
  if (!RENDA_FIELD_ID) return false;
  const f = (lead.custom_fields_values || []).find((c) => c.field_id === RENDA_FIELD_ID);
  return Boolean(f && f.values && f.values.some((v) => v.value != null && v.value !== ''));
}

/** Para cada lead, as etapas em que entrou (evento lead_status_changed) e quando. */
function statusesEnteredByLead(events) {
  const map = new Map();
  for (const ev of events) {
    const id = ev.value_after?.[0]?.lead_status?.id;
    if (!id) continue;
    if (!map.has(ev.entity_id)) map.set(ev.entity_id, []);
    map.get(ev.entity_id).push({ id, at: ev.created_at });
  }
  return map;
}

/** Chegou na etapa: está nela ou depois (sem ter sido perdido), foi ganho, ou passou por ela. */
function reachedStage(lead, stage, ctxFor, entered) {
  const pctx = ctxFor(lead);
  const target = pctx && pctx[stage];
  if (!target || target.sort == null) return false;
  if (lead.status_id === WON) return true;
  const sort = pctx.sortById.get(lead.status_id);
  if (lead.status_id !== LOST && sort != null && sort >= target.sort) return true;
  return (entered.get(lead.id) || []).some((e) => target.ids.has(e.id));
}

/** Monta um período no formato do PERIODS a partir dos dados brutos. */
function buildPeriod(win, { created, won, ctxByPipeline, entered, users, cirurgiaLeads, teamPipelines }) {
  const inScope = (l) => ctxByPipeline.has(l.pipeline_id);
  const inWin = (t) => t >= win.from && t <= win.to;
  const ctxFor = (l) => ctxByPipeline.get(l.pipeline_id);
  const leads = created.filter((l) => inScope(l) && inWin(l.created_at));
  const ganhos = won.filter((l) => l.status_id === WON && inScope(l) && inWin(l.closed_at));

  const qualificados = leads.filter((l) => reachedStage(l, 'qualificados', ctxFor, entered));
  const apn = leads.filter((l) => reachedStage(l, 'apn', ctxFor, entered));

  // Cirurgia vendida = entrou em "7. Cirurgia confirmada" no mês. Sem essa etapa no funil,
  // cai na regra antiga (tag/nome de cirurgia ou valor alto no ganho).
  const hasCirurgiaStage = [...ctxByPipeline.values()].some((c) => c.cirurgia);
  let cirurgias;
  let consultas;
  if (hasCirurgiaStage) {
    const porEtapa = cirurgiaLeads.filter((l) =>
      (entered.get(l.id) || []).some((e) => ctxFor(l)?.cirurgia?.ids.has(e.id) && inWin(e.at))
    );
    // Ganho que é claramente cirurgia (valor alto / tag) continua contando como cirurgia.
    const ids = new Set(porEtapa.map((l) => l.id));
    cirurgias = [...porEtapa, ...ganhos.filter((l) => isCirurgia(l) && !ids.has(l.id))];
    consultas = ganhos.filter((l) => !isCirurgia(l) && !ids.has(l.id));
  } else {
    cirurgias = ganhos.filter(isCirurgia);
    consultas = ganhos.filter((l) => !isCirurgia(l));
  }
  const sales = [...consultas, ...cirurgias];

  const sum = (arr) => arr.reduce((a, l) => a + (Number(l.price) || 0), 0);
  const receitaCm1 = sum(consultas);
  const receitaCm2 = sum(cirurgias);
  const receita = receitaCm1 + receitaCm2;

  const ads = Number(parseJsonEnv('ADS_INVESTIMENTO_JSON')[win.ym] || 0);
  const ciclos = consultas.filter((l) => l.created_at && l.closed_at).map((l) => (l.closed_at - l.created_at) / 86400);
  const lastLead = leads.reduce((max, l) => Math.max(max, l.created_at), 0);

  const leadSeries = [0, 0, 0, 0, 0];
  const saleSeries = [0, 0, 0, 0, 0];
  leads.forEach((l) => (leadSeries[weekIndex(l.created_at)] += 1));
  consultas.forEach((l) => (saleSeries[weekIndex(l.closed_at)] += 1));
  cirurgias.forEach((l) => {
    const e = (entered.get(l.id) || []).find((x) => ctxFor(l)?.cirurgia?.ids.has(x.id) && inWin(x.at));
    saleSeries[weekIndex(e ? e.at : l.closed_at || l.updated_at)] += 1;
  });

  // Time comercial: por funil (Comercial 1 / Comercial 2) quando KOMMO_METRICS_PIPELINES
  // está definido; senão, pelo responsável do lead no Kommo.
  const roles = parseJsonEnv('KOMMO_TEAM_ROLES_JSON');
  const rows = new Map();
  const keyOf = (l) => (teamPipelines ? `p${l.pipeline_id}` : `u${l.responsible_user_id}`);
  const row = (l) => {
    const key = keyOf(l);
    if (!rows.has(key)) {
      const tp = teamPipelines && teamPipelines[l.pipeline_id];
      const user = users.get(l.responsible_user_id);
      rows.set(key, {
        pipelineId: teamPipelines ? l.pipeline_id : null,
        name: tp ? tp.name : user ? user.name : `Usuário ${l.responsible_user_id}`,
        role: tp ? tp.role : roles[l.responsible_user_id] || 'Comercial',
        leads: 0,
        apn: 0,
        sales: 0,
        revenue: 0,
      });
    }
    return rows.get(key);
  };
  if (teamPipelines) for (const pid of Object.keys(teamPipelines)) row({ pipeline_id: Number(pid) });
  leads.forEach((l) => (row(l).leads += 1));
  apn.forEach((l) => (row(l).apn += 1));
  sales.forEach((l) => {
    const r = row(l);
    r.sales += 1;
    r.revenue += Number(l.price) || 0;
  });
  const team = [...rows.values()]
    .map((r) => ({ ...r, c1: pct(r.apn, r.leads), c2: pct(r.sales, r.apn), c3: pct(r.sales, r.leads), revenue: Math.round(r.revenue) }))
    .sort((a, b) => b.revenue - a.revenue || b.sales - a.sales);

  return {
    label: win.label,
    range: win.range,
    leads: int(leads.length),
    apn: int(apn.length),
    consultas: int(consultas.length),
    cirurgias: int(cirurgias.length),
    vendas: int(sales.length),
    receita: brl(receita),
    ads: brlCents(ads),
    cac: sales.length && ads ? brl(ads / sales.length) : 'R$ 0',
    cm1: 'CM1 · ' + brl(receitaCm1),
    cm2: 'CM2 · ' + brl(receitaCm2),
    ticket: brl(sales.length ? receita / sales.length : 0),
    ciclo: `${ciclos.length ? Math.round(ciclos.reduce((a, b) => a + b, 0) / ciclos.length) : 0} dias`,
    leadsRenda: RENDA_FIELD_ID ? int(leads.filter(hasRenda).length) : '—',
    form: lastLead ? dateBR(new Date(lastLead * 1000)) : '—',
    weeks: ['S1', 'S2', 'S3', 'S4', 'S5'],
    leadSeries,
    saleSeries,
    team,
    funnel: [
      { label: 'Leads', count: leads.length, value: '—' },
      { label: 'Qualificados', count: qualificados.length, value: brlCompact(sum(qualificados)) + ' pipe' },
      { label: 'APN agendadas', count: apn.length, value: brlCompact(sum(apn)) + ' pipe' },
      { label: 'Consultas vendidas', count: consultas.length, value: brl(receitaCm1) },
      { label: 'Cirurgias vendidas', count: cirurgias.length, value: brl(receitaCm2) },
    ],
    // Valores numéricos (painel v2 formata no navegador).
    num: {
      leads: leads.length,
      qualificados: qualificados.length,
      apn: apn.length,
      consultas: consultas.length,
      cirurgias: cirurgias.length,
      vendas: sales.length,
      receita: Math.round(receita),
      receitaConsultas: Math.round(receitaCm1),
      receitaCirurgias: Math.round(receitaCm2),
      pipeQualificados: Math.round(sum(qualificados)),
      pipeApn: Math.round(sum(apn)),
      ads,
      // Ticket só sobre vendas com valor preenchido no Kommo (as sem valor distorceriam a média).
      ticket: sales.filter((l) => Number(l.price) > 0).length
        ? Math.round(receita / sales.filter((l) => Number(l.price) > 0).length)
        : 0,
      vendasSemValor: sales.filter((l) => !(Number(l.price) > 0)).length,
      cicloDias: ciclos.length ? Math.round(ciclos.reduce((a, b) => a + b, 0) / ciclos.length) : null,
    },
  };
}

/** Funis que entram nas métricas: KOMMO_METRICS_PIPELINES ({"id":{"name","role"}}) ou o funil principal. */
function metricsPipelines() {
  const tp = parseJsonEnv('KOMMO_METRICS_PIPELINES');
  return Object.keys(tp).length ? tp : null;
}

function stageInfo(statuses, list) {
  if (!list.length) return null;
  return { sort: Math.min(...list.map((s) => s.sort)), ids: new Set(list.map((s) => s.id)) };
}

async function fetchRaw(kommo, windows) {
  const from = Math.min(...windows.map((w) => w.from));
  const to = Math.max(...windows.map((w) => w.to));

  const teamPipelines = metricsPipelines();
  const ids = teamPipelines ? Object.keys(teamPipelines).map(Number) : [null];
  const ctxByPipeline = new Map();
  for (const id of ids) {
    const c = await resolvePipeline(kommo, id ? { pipelineId: id } : undefined);
    const after = (sort) => c.statuses.filter((s) => s.id !== LOST && s.sort >= sort);
    const cirurgiaStatus = c.statuses.find((s) => /cirurgia confirmada/.test(normalize(s.name)));
    ctxByPipeline.set(c.pipeline.id, {
      sortById: c.sortById,
      qualificados: c.qualificados ? stageInfo(c.statuses, after(c.qualificados.sort)) : null,
      apn: c.apnStatuses.length ? stageInfo(c.statuses, c.apnStatuses) : null,
      cirurgia: cirurgiaStatus ? stageInfo(c.statuses, [cirurgiaStatus]) : null,
    });
  }
  const pipelineIds = [...ctxByPipeline.keys()];

  const [created, won, events, userList] = await Promise.all([
    kommo.listAll('/leads', {
      embeddedKey: 'leads',
      params: { 'filter[created_at][from]': from, 'filter[created_at][to]': to, 'filter[pipeline_id]': pipelineIds },
    }),
    kommo.listAll('/leads', {
      embeddedKey: 'leads',
      params: { 'filter[closed_at][from]': from, 'filter[closed_at][to]': to, 'filter[pipeline_id]': pipelineIds },
    }),
    kommo.listAll('/events', {
      embeddedKey: 'events',
      limit: 100,
      params: { 'filter[type]': 'lead_status_changed', 'filter[created_at][from]': from, 'filter[created_at][to]': to },
    }),
    kommo.getUsers().catch(() => []),
  ]);
  const entered = statusesEnteredByLead(events);

  // Leads que entraram em "Cirurgia confirmada" no período (podem ter sido criados antes).
  const cirurgiaIds = new Set();
  for (const c of ctxByPipeline.values()) if (c.cirurgia) for (const id of c.cirurgia.ids) cirurgiaIds.add(id);
  const cirurgiaLeadIds = [...entered.entries()].filter(([, evs]) => evs.some((e) => cirurgiaIds.has(e.id))).map(([id]) => id);
  const cirurgiaLeads = [];
  for (let i = 0; i < cirurgiaLeadIds.length; i += 50) {
    cirurgiaLeads.push(
      ...(await kommo.listAll('/leads', { embeddedKey: 'leads', params: { 'filter[id]': cirurgiaLeadIds.slice(i, i + 50) } }))
    );
  }

  return {
    ctxByPipeline,
    created,
    won,
    entered,
    cirurgiaLeads: cirurgiaLeads.filter((l) => ctxByPipeline.has(l.pipeline_id)),
    users: new Map(userList.map((u) => [u.id, u])),
    teamPipelines,
  };
}

async function buildMetrics(kommo, { months = config.server.metricsMonths, now = new Date() } = {}) {
  const windows = monthWindows(months, now);
  const raw = await fetchRaw(kommo, windows);
  const periods = {};
  for (const win of windows) periods[win.key] = buildPeriod(win, raw);

  // Variação da receita contra o mês anterior (o mais antigo da janela fica sem comparação).
  const keys = windows.map((w) => w.key);
  keys.forEach((key, i) => {
    const prevKey = keys[i + 1];
    const cur = periods[key].num.receita;
    const prev = prevKey ? periods[prevKey].num.receita : null;
    const prevName = prevKey ? windows[i + 1].label.split(' ')[0].toLowerCase() : '';
    periods[key].delta = prev ? `${cur >= prev ? '+' : ''}${Math.round(((cur - prev) / prev) * 100)}% vs. ${prevName}` : '';
    periods[key].prev = prevKey ? { mes: prevName, receita: prev || 0 } : null;
  });

  // Metadados (o painel v1 ignora esta chave: não tem "funnel"/"team").
  periods._meta = {
    generatedAt: new Date().toISOString(),
    records: raw.created.length + raw.won.length,
    calls: kommo.stats ? kommo.stats.requests : null,
    pipelines: [...raw.ctxByPipeline.keys()].map((id) => ({
      id,
      name: raw.teamPipelines?.[id]?.name || null,
      role: raw.teamPipelines?.[id]?.role || null,
    })),
  };
  return periods;
}

// Cache em memória (padrão 60 s) com deduplicação de chamadas concorrentes.
function createMetricsCache(kommoFactory, ttlSeconds = config.server.metricsCacheSeconds) {
  let cached = null;
  let cachedAt = 0;
  let inflight = null;

  return async function getMetrics({ force = false } = {}) {
    const fresh = cached && Date.now() - cachedAt < ttlSeconds * 1000;
    if (fresh && !force) return { data: cached, cachedAt, fromCache: true };
    if (!inflight) {
      inflight = buildMetrics(kommoFactory())
        .then((data) => {
          cached = data;
          cachedAt = Date.now();
          return data;
        })
        .finally(() => {
          inflight = null;
        });
    }
    try {
      const data = await inflight;
      return { data, cachedAt, fromCache: false };
    } catch (err) {
      // Kommo fora do ar: devolve o último snapshot em vez de derrubar o painel.
      if (cached) return { data: cached, cachedAt, fromCache: true, stale: true, error: err.message };
      throw err;
    }
  };
}

module.exports = { buildMetrics, buildPeriod, monthWindows, createMetricsCache, isCirurgia };
