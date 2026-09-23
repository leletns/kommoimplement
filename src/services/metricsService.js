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
 *   - Leads: leads criados no mês (funil principal).
 *   - Qualificados / APN: leads da safra do mês que chegaram na etapa (etapa atual ≥ etapa
 *     alvo, ganhos, ou evento de mudança de status para a etapa — cobre leads perdidos depois).
 *   - Vendas / Receita: leads ganhos (status 142) com data de fechamento no mês.
 *   - Consulta × Cirurgia: tag/nome com "cirurgia|lipedefinition|sublift" ou valor ≥
 *     KOMMO_CIRURGIA_MIN_PRICE = cirurgia (CM2); demais = consulta (CM1).
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

/** Conjunto de status_id que cada evento de mudança de etapa levou o lead. */
function statusesEnteredByLead(events) {
  const map = new Map();
  for (const ev of events) {
    const id = ev.value_after?.[0]?.lead_status?.id;
    if (!id) continue;
    if (!map.has(ev.entity_id)) map.set(ev.entity_id, new Set());
    map.get(ev.entity_id).add(id);
  }
  return map;
}

function reachedStage(lead, targetSort, stageIds, ctx, entered) {
  if (targetSort == null) return false;
  if (lead.status_id === WON) return true;
  const sort = ctx.sortById.get(lead.status_id);
  if (lead.status_id !== LOST && sort != null && sort >= targetSort) return true;
  const history = entered.get(lead.id);
  return Boolean(history && [...history].some((id) => stageIds.has(id)));
}

/** Monta um período no formato do PERIODS a partir dos dados brutos. */
function buildPeriod(win, { created, won, ctx, entered, users }) {
  const inPipeline = (l) => !ctx.pipeline || l.pipeline_id === ctx.pipeline.id;
  const leads = created.filter((l) => inPipeline(l) && l.created_at >= win.from && l.created_at <= win.to);
  // Vendas contam todos os funis, a menos que KOMMO_PIPELINE_ID restrinja explicitamente.
  const salesInScope = config.kommo.pipelineId ? inPipeline : () => true;
  const sales = won.filter((l) => l.status_id === WON && salesInScope(l) && l.closed_at >= win.from && l.closed_at <= win.to);

  const qualSort = ctx.qualificados ? ctx.qualificados.sort : null;
  const qualIds = new Set(ctx.statuses.filter((s) => qualSort != null && s.sort >= qualSort && s.id !== LOST).map((s) => s.id));
  const apnIds = new Set(ctx.apnStatuses.map((s) => s.id));
  const apnSort = ctx.apnStatuses.length ? Math.min(...ctx.apnStatuses.map((s) => s.sort)) : null;

  const qualificados = leads.filter((l) => reachedStage(l, qualSort, qualIds, ctx, entered));
  const apn = leads.filter((l) => reachedStage(l, apnSort, apnIds, ctx, entered));
  const cirurgias = sales.filter(isCirurgia);
  const consultas = sales.filter((l) => !isCirurgia(l));

  const sum = (arr) => arr.reduce((a, l) => a + (Number(l.price) || 0), 0);
  const receita = sum(sales);
  const receitaCm1 = sum(consultas);
  const receitaCm2 = sum(cirurgias);

  const ads = Number(parseJsonEnv('ADS_INVESTIMENTO_JSON')[win.ym] || 0);
  const ciclos = sales.filter((l) => l.created_at && l.closed_at).map((l) => (l.closed_at - l.created_at) / 86400);
  const lastLead = leads.reduce((max, l) => Math.max(max, l.created_at), 0);

  const leadSeries = [0, 0, 0, 0, 0];
  const saleSeries = [0, 0, 0, 0, 0];
  leads.forEach((l) => (leadSeries[weekIndex(l.created_at)] += 1));
  sales.forEach((l) => (saleSeries[weekIndex(l.closed_at)] += 1));

  // Time comercial (responsável pelo lead no Kommo)
  const roles = parseJsonEnv('KOMMO_TEAM_ROLES_JSON');
  const rows = new Map();
  const row = (uid) => {
    if (!rows.has(uid)) {
      const user = users.get(uid);
      rows.set(uid, { name: user ? user.name : `Usuário ${uid}`, role: roles[uid] || 'Comercial', leads: 0, apn: 0, sales: 0, revenue: 0 });
    }
    return rows.get(uid);
  };
  leads.forEach((l) => (row(l.responsible_user_id).leads += 1));
  apn.forEach((l) => (row(l.responsible_user_id).apn += 1));
  sales.forEach((l) => {
    const r = row(l.responsible_user_id);
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
  };
}

async function fetchRaw(kommo, windows) {
  const from = Math.min(...windows.map((w) => w.from));
  const to = Math.max(...windows.map((w) => w.to));
  const ctx = await resolvePipeline(kommo);

  const [created, won, events, userList] = await Promise.all([
    kommo.listAll('/leads', {
      embeddedKey: 'leads',
      params: { 'filter[created_at][from]': from, 'filter[created_at][to]': to, 'filter[pipeline_id]': ctx.pipeline.id },
    }),
    kommo.listAll('/leads', {
      embeddedKey: 'leads',
      params: { 'filter[closed_at][from]': from, 'filter[closed_at][to]': to },
    }),
    kommo.listAll('/events', {
      embeddedKey: 'events',
      limit: 100,
      params: { 'filter[type]': 'lead_status_changed', 'filter[created_at][from]': from, 'filter[created_at][to]': to },
    }),
    kommo.getUsers().catch(() => []),
  ]);

  return { ctx, created, won, entered: statusesEnteredByLead(events), users: new Map(userList.map((u) => [u.id, u])) };
}

async function buildMetrics(kommo, { months = config.server.metricsMonths, now = new Date() } = {}) {
  const windows = monthWindows(months, now);
  const raw = await fetchRaw(kommo, windows);
  const periods = {};
  for (const win of windows) periods[win.key] = buildPeriod(win, raw);
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
