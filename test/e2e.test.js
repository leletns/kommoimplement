'use strict';

/**
 * Teste ponta a ponta contra um Kommo falso (Express local):
 *   - GET /api/metrics devolve o formato PERIODS e o painel renderiza com ele
 *   - retroativo.js aplica tags/etapa/nota via PATCH e POST, sobrevivendo a um 429
 *   - webhook do Kommo (form-urlencoded) é aceito
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const express = require('express');
const { execFile } = require('child_process');

const now = Math.floor(Date.now() / 1000);
const DAY = 86400;
// Datas sempre dentro do mês corrente (o teste não quebra nos dias 1 e 2 do mês).
const monthStart = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
const recent = (days) => Math.max(monthStart + 3600, now - days * DAY);
const PIPE = 555;
const statuses = [
  { id: 1, name: 'Leads de entrada', sort: 10, type: 1 },
  { id: 2, name: 'Novos', sort: 20, type: 0 },
  { id: 3, name: 'Qualificados', sort: 30, type: 0 },
  { id: 4, name: 'APN Agendada', sort: 40, type: 0 },
  { id: 5, name: 'Consulta realizada', sort: 50, type: 0 },
  { id: 142, name: 'Ganho', sort: 10000, type: 0 },
  { id: 143, name: 'Perdido', sort: 11000, type: 0 },
];
const lead = (id, status_id, extra = {}) => ({
  id, name: `Lead ${id}`, status_id, pipeline_id: PIPE, price: 0, responsible_user_id: 11,
  created_at: recent(2), updated_at: recent(1), closed_at: null, _embedded: { tags: [] }, ...extra,
});
const leads = [
  lead(1001, 2, { name: 'Paciente quente' }),
  lead(1002, 2),
  lead(1003, 4, { responsible_user_id: 12 }),
  lead(1004, 142, { price: 45000, closed_at: recent(1), _embedded: { tags: [{ name: 'LipeDefinition' }] } }),
  lead(1005, 142, { price: 1200, closed_at: recent(1), responsible_user_id: 12 }),
  lead(1006, 143),
  lead(1007, 5, { _embedded: { tags: [{ name: 'Lipedema' }] } }),
];
const notes = {
  1001: ['Tenho lipedema com diagnóstico confirmado, muita dor e hematomas', 'Quero agendar a consulta, qual o valor?', 'Penso em cirurgia'],
};

function startFakeKommo() {
  const app = express();
  app.use(express.json());
  const received = { patches: [], notes: [], singleNotes: [], hits: 0 };
  let throttledOnce = false;
  app.use((req, res, next) => {
    received.hits += 1;
    assert.strictEqual(req.get('authorization'), 'Bearer test-token');
    if (!throttledOnce && req.method === 'PATCH') {
      throttledOnce = true;
      return res.status(429).set('Retry-After', '0').json({ title: 'Too Many Requests' });
    }
    next();
  });
  const r = express.Router();
  r.get('/account', (req, res) => res.json({ id: 1, name: 'Blue Clínica' }));
  r.get('/leads/pipelines', (req, res) => res.json({ _embedded: { pipelines: [{ id: PIPE, name: 'Comercial', is_main: true, _embedded: { statuses } }] } }));
  r.get('/users', (req, res) => res.json({ _embedded: { users: [{ id: 11, name: 'Lya' }, { id: 12, name: 'Sara' }] } }));
  r.get('/events', (req, res) => res.json({ _embedded: { events: [{ entity_id: 1006, type: 'lead_status_changed', value_after: [{ lead_status: { id: 4, pipeline_id: PIPE } }] }] } }));
  r.get('/leads', (req, res) => {
    const page = Number(req.query.page || 1);
    if (page > 1) return res.status(204).end();
    let list = leads;
    const f = req.query.filter || {};
    if (f.closed_at) list = list.filter((l) => l.closed_at && l.closed_at >= Number(f.closed_at.from));
    res.json({ _embedded: { leads: list }, _links: {} });
  });
  r.get('/leads/notes', (req, res) => {
    const ids = [].concat(req.query.filter?.entity_id || []).map(Number);
    const list = ids.flatMap((id) => (notes[id] || []).map((text) => ({ entity_id: id, note_type: 'common', params: { text } })));
    if (!list.length || Number(req.query.page) > 1) return res.status(204).end();
    res.json({ _embedded: { notes: list } });
  });
  r.patch('/leads', (req, res) => { received.patches.push(...req.body); res.json({ _embedded: { leads: req.body.map((l) => ({ id: l.id })) } }); });
  r.post('/leads/notes', (req, res) => { received.notes.push(...req.body); res.json({ _embedded: { notes: [] } }); });
  r.post('/leads/:id/notes', (req, res) => { received.singleNotes.push({ id: req.params.id, body: req.body }); res.json({}); });
  app.use('/api/v4', r);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, received, url: `http://127.0.0.1:${server.address().port}/api/v4` }));
  });
}

test('fluxo completo contra Kommo falso', async (t) => {
  const kommo = await startFakeKommo();
  process.env.KOMMO_BASE_URL = kommo.url;
  process.env.KOMMO_TOKEN = 'test-token';
  process.env.KOMMO_MIN_INTERVAL_MS = '20';
  process.env.WEBHOOK_SECRET = 's3cret';
  process.env.SUPABASE_URL = '';
  process.env.ADS_INVESTIMENTO_JSON = '{}';
  // Isola o teste do .env local (dotenv não sobrescreve variáveis já definidas).
  for (const k of ['KOMMO_METRICS_PIPELINES', 'KOMMO_CLASSIFICACAO_ENUMS', 'KOMMO_OBJECAO_ENUMS', 'KOMMO_STATUS_INTERESSE_ID', 'KOMMO_CLASSIFICACAO_FIELD_ID', 'KOMMO_OBJECAO_FIELD_ID', 'KOMMO_RESUMO_FIELD_ID', 'KOMMO_PIPELINE_ID', 'KOMMO_STATUS_QUALIFICADOS_ID', 'KOMMO_STATUS_NOVOS_ID', 'KOMMO_APN_STATUS_IDS', 'KOMMO_SCORE_FIELD_ID', 'KOMMO_RENDA_FIELD_ID', 'KOMMO_TEAM_ROLES_JSON', 'SUPABASE_SERVICE_ROLE_KEY']) {
    process.env[k] = '';
  }
  const app = require('../src/server');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); kommo.server.close(); });

  let metrics;
  await t.test('GET /api/metrics devolve o formato PERIODS', async () => {
    const res = await fetch(`${base}/api/metrics`);
    assert.strictEqual(res.status, 200);
    metrics = await res.json();
    const keys = Object.keys(metrics).filter((k) => k !== '_meta');
    assert.strictEqual(keys.length, 3);
    assert.ok(metrics._meta.generatedAt);
    const cur = metrics[keys[0]];
    for (const k of ['label', 'range', 'leads', 'apn', 'consultas', 'cirurgias', 'vendas', 'receita', 'ads', 'cac', 'cm1', 'cm2', 'ticket', 'ciclo', 'leadsRenda', 'form']) {
      assert.strictEqual(typeof cur[k], 'string', k);
    }
    assert.match(cur.range, /^\d{2}\/\d{2}\/\d{4} — \d{2}\/\d{2}\/\d{4}$/);
    assert.strictEqual(cur.leads, '7');
    assert.strictEqual(cur.vendas, '2');
    assert.strictEqual(cur.receita, 'R$ 46.200');
    assert.strictEqual(cur.cirurgias, '1');
    assert.strictEqual(cur.consultas, '1');
    // APN: 1003 (etapa), 1007 (etapa posterior), 1004/1005 (ganhos), 1006 (perdido mas passou por APN)
    assert.strictEqual(cur.apn, '5');
    assert.deepStrictEqual(cur.funnel.map((f) => f.label), ['Leads', 'Qualificados', 'APN agendadas', 'Consultas vendidas', 'Cirurgias vendidas']);
    assert.strictEqual(cur.team[0].name, 'Lya');
    assert.strictEqual(typeof cur.team[0].revenue, 'number');
    assert.strictEqual(cur.leadSeries.length, cur.weeks.length);
    assert.strictEqual((await fetch(`${base}/api/metrics`)).headers.get('x-metrics-cache'), 'HIT');
  });

  await t.test('o script do painel renderiza com os dados da API', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'Blue Painel Comercial v1 claro.dc.html'), 'utf8');
    const script = html.split('<script type="text/x-dc"')[1].split('>').slice(1).join('>').split('</script>')[0];
    const sandbox = {
      DCLogic: class { setState(p) { this.state = { ...this.state, ...p }; } },
      React: { createElement: (...a) => a },
      window: { addEventListener() {}, innerWidth: 1400 },
      document: { querySelector: () => null },
      location: { protocol: 'http:' },
      requestAnimationFrame() {}, setTimeout() {}, setInterval() { return 1; }, clearInterval() {},
      console,
      fetch: (url) => fetch(base + url),
    };
    vm.runInNewContext(`${script}\nthis.Component = Component; this.PERIODS = PERIODS;`, sandbox);
    const c = new sandbox.Component();
    c.props = {};
    await c.loadMetrics(false);
    const months = Object.keys(metrics).filter((k) => k !== '_meta');
    assert.deepStrictEqual(Object.keys(sandbox.PERIODS), months);
    assert.strictEqual(c.state.period, months[0]);
    const vals = c.renderVals();
    assert.strictEqual(vals.periodTabs.length, 3);
    assert.strictEqual(vals.kpis[0].value, 'R$ 46.200');
    for (const s of vals.funnel) assert.ok(!/NaN|Infinity/.test(s.width + s.conv), JSON.stringify(s));
    for (const r of vals.team) assert.ok(!/NaN|Infinity/.test(r.share), r.share);
    c.setState({ period: months[2] }); // mês vazio não pode quebrar o painel
    const empty = c.renderVals();
    assert.ok(!JSON.stringify(empty.funnel).includes('NaN'));
    assert.ok(!JSON.stringify(empty.chart).includes('NaN'));
  });

  await t.test('o painel v2 renderiza com os dados reais (sem NaN, com time por funil)', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'Blue Painel Comercial.dc.html'), 'utf8');
    const script = html.split('<script type="text/x-dc"')[1].split('>').slice(1).join('>').split('</script>')[0];
    const store = {};
    const sandbox = {
      DCLogic: class { setState(p) { this.state = { ...this.state, ...p }; } },
      React: { createElement: (...a) => a },
      window: { addEventListener() {}, innerWidth: 1400 },
      document: { querySelector: () => null },
      location: { protocol: 'http:' },
      localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
      requestAnimationFrame() {}, setTimeout() {}, setInterval() { return 1; }, clearInterval() {},
      FileReader: class {}, console,
      fetch: (url) => fetch(base + url),
    };
    vm.runInNewContext(`${script}\nthis.Component = Component; this.PERIODS = PERIODS;`, sandbox);
    const c = new sandbox.Component();
    c.props = {};
    await c.loadData(false);
    const months = Object.keys(metrics).filter((k) => k !== '_meta');
    assert.deepStrictEqual(Object.keys(sandbox.PERIODS), months);
    for (const m of months) {
      c.setState({ period: m });
      for (const nav of ['Painel', 'Equipe', 'Conexões']) {
        c.setState({ nav });
        const v = c.renderVals();
        const json = JSON.stringify({ ...v, chart: undefined });
        assert.ok(!/NaN|Infinity|undefined/.test(json), `${m}/${nav}: ${json.match(/.{40}(NaN|Infinity|undefined).{20}/)?.[0]}`);
        assert.ok(!JSON.stringify(v.chart).includes('NaN'));
      }
    }
    c.setState({ period: months[0], nav: 'Painel' });
    const v = c.renderVals();
    assert.strictEqual(v.receita, 'R$ 46.200');
    assert.match(v.receitaSub, /1 consultas e 1 cirurgias/);
    assert.strictEqual(v.periodTabs.length, 3);
  });

  await t.test('webhook exige token e aceita payload form-urlencoded do Kommo', async () => {
    const form = 'leads[status][0][id]=1003&leads[status][0][status_id]=5&leads[status][0][old_status_id]=4&leads[status][0][pipeline_id]=555';
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    assert.strictEqual((await fetch(`${base}/api/webhooks/kommo`, { method: 'POST', headers, body: form })).status, 401);
    assert.strictEqual((await fetch(`${base}/api/webhooks/kommo?token=s3cret`, { method: 'POST', headers, body: form })).status, 200);
  });

  await t.test('webhook de grupo do WhatsApp vira nota no lead', async () => {
    const body = { isGroup: true, phone: 'g-e2e', chatName: 'Pós-op #1003', senderName: 'Ana', text: { message: 'Olá equipe' }, messageId: 'E2E-1' };
    const res = await fetch(`${base}/api/webhooks/whatsapp-groups?token=s3cret`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.strictEqual(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(kommo.received.singleNotes[0].id, '1003');
    assert.match(kommo.received.singleNotes[0].body[0].params.text, /Olá equipe/);
  });

  await t.test('retroativo aplica tags, etapa e nota (e sobrevive a 429)', async () => {
    const cwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'retro-'));
    const { stdout } = await new Promise((resolve, reject) => {
      execFile(process.execPath, [path.join(__dirname, '..', 'src/scripts/retroativo.js')], { cwd, env: process.env }, (err, stdout, stderr) =>
        err ? reject(new Error(stderr || err.message)) : resolve({ stdout }));
    });
    assert.match(stdout, /Concluído/);
    const byId = new Map(kommo.received.patches.map((p) => [p.id, p]));
    assert.ok(!byId.has(1004) && !byId.has(1006), 'ganhos/perdidos não são alterados');
    const hot = byId.get(1001);
    assert.deepStrictEqual(hot._embedded.tags.map((t) => t.name), ['lead_quente', 'handoff_maria', 'follow_up_day2', 'alice_bot_finalizado']);
    assert.strictEqual(hot.status_id, 3, 'sem etapa "Interesse em agendar", quente vai para QUALIFICADOS');
    const cold = byId.get(1002);
    assert.ok(cold._embedded.tags.some((t) => t.name === 'lead_fria'));
    assert.strictEqual(cold.status_id, undefined, 'fria já está em NOVOS');
    assert.strictEqual(byId.get(1007).status_id, undefined, 'nunca volta etapa');
    assert.ok(byId.get(1007)._embedded.tags.some((t) => t.name === 'Lipedema'), 'mantém tags existentes');
    assert.strictEqual(kommo.received.notes.length, 4);
    assert.match(kommo.received.notes[0].params.text, /Alice Bot/);
  });
});
