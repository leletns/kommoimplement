'use strict';

/**
 * Servidor proxy + receptor de webhooks da integração Kommo da Blue Clínica.
 *
 *   GET  /                               → Blue Painel Comercial (HTML da raiz)
 *   GET  /api/metrics[?refresh=1]         → KPIs consolidados no formato PERIODS do painel
 *   GET  /api/health                     → status do servidor e do cache
 *   POST /api/webhooks/kommo             → espelho em tempo real no Supabase
 *   POST /api/webhooks/whatsapp-groups   → mensagens de grupos → nota no lead do Kommo
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { getKommoClient } = require('./services/kommoClient');
const { createMetricsCache } = require('./services/metricsService');
const { handleKommoWebhook, handleWhatsAppGroupWebhook } = require('./services/webhooks');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_FILE = 'Blue Painel Comercial.dc.html';

const app = express();
app.disable('x-powered-by');

app.use(
  cors({
    origin: config.server.corsOrigins.includes('*') ? true : config.server.corsOrigins,
  })
);
app.use(express.json({ limit: '5mb' }));
// O Kommo envia webhooks como application/x-www-form-urlencoded (leads[add][0][id]=…)
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path !== '/api/health') console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
// Só os arquivos do painel são servidos (nunca a raiz inteira, que tem o .env).

function sendRootFile(name) {
  return (req, res) => {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) return res.status(404).send(`${name} não encontrado na raiz do projeto.`);
    res.sendFile(file);
  };
}
app.get(['/', '/painel'], sendRootFile(DASHBOARD_FILE));
app.get('/painel-v1', sendRootFile('Blue Painel Comercial v1 claro.dc.html'));
app.get('/support.js', sendRootFile('support.js'));

// ─── Métricas ─────────────────────────────────────────────────────────────────

const getMetrics = createMetricsCache(getKommoClient);

app.get('/api/metrics', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const result = await getMetrics({ force });
    res.set('Cache-Control', 'no-store');
    res.set('X-Metrics-Generated-At', new Date(result.cachedAt).toISOString());
    res.set('X-Metrics-Cache', result.stale ? 'STALE' : result.fromCache ? 'HIT' : 'MISS');
    res.json(result.data);
  } catch (err) {
    console.error('[metrics]', err.message);
    res.status(err.status === 401 ? 502 : 503).json({ error: 'Não foi possível consolidar as métricas do Kommo.', detail: err.message });
  }
});

app.get('/api/health', (req, res) => {
  let kommo = null;
  try {
    kommo = getKommoClient().stats;
  } catch (err) {
    kommo = { error: err.message };
  }
  res.json({ ok: true, uptime: Math.round(process.uptime()), kommo, supabase: Boolean(config.supabase.url && config.supabase.serviceRoleKey) });
});

// ─── Webhooks ─────────────────────────────────────────────────────────────────

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Exige ?token=WEBHOOK_SECRET (ou header x-webhook-token) quando o segredo está definido. */
function requireWebhookToken(req, res, next) {
  if (!config.server.webhookSecret) return next();
  const token = req.query.token || req.get('x-webhook-token');
  if (!safeEqual(token, config.server.webhookSecret)) return res.status(401).json({ error: 'token inválido' });
  next();
}

/**
 * Responde 200 na hora e processa em segundo plano: o Kommo desativa webhooks que
 * demoram a responder, e os provedores de WhatsApp reenviam em timeout.
 */
function ackThenProcess(name, handler) {
  return (req, res) => {
    res.status(200).json({ received: true });
    const body = req.body;
    const query = req.query;
    setImmediate(async () => {
      try {
        const result = await handler(body, query);
        console.log(`[webhook:${name}]`, JSON.stringify(result));
      } catch (err) {
        console.error(`[webhook:${name}] erro:`, err.message);
      }
    });
  };
}

app.post(
  '/api/webhooks/kommo',
  requireWebhookToken,
  ackThenProcess('kommo', (body) => handleKommoWebhook(body, { kommo: getKommoClient() }))
);

app.post(
  '/api/webhooks/whatsapp-groups',
  requireWebhookToken,
  ackThenProcess('whatsapp', (body, query) =>
    handleWhatsAppGroupWebhook(body, { kommo: getKommoClient(), explicitLeadId: query.lead_id || body?.lead_id })
  )
);

app.use((req, res) => res.status(404).json({ error: 'rota não encontrada' }));

if (require.main === module) {
  if (!config.kommo.token) console.warn('⚠️  KOMMO_TOKEN vazio: /api/metrics e webhooks vão falhar até configurar o .env');
  if (!config.server.webhookSecret) console.warn('⚠️  WEBHOOK_SECRET vazio: webhooks aceitam qualquer chamada');
  app.listen(config.server.port, () => {
    console.log(`🚀 Blue · Kommo proxy em http://localhost:${config.server.port}`);
    console.log(`   Painel:   http://localhost:${config.server.port}/`);
    console.log(`   Métricas: http://localhost:${config.server.port}/api/metrics`);
  });
}

module.exports = app;
