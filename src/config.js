'use strict';

require('dotenv').config();

// Datas do painel (meses, semanas, "último formulário") no fuso da clínica.
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const optionalInt = (value) => (value ? int(value, null) : null);
const intList = (value) =>
  (value || '')
    .split(',')
    .map((v) => parseInt(v.trim(), 10))
    .filter(Number.isFinite);

const config = {
  kommo: {
    subdomain: process.env.KOMMO_SUBDOMAIN || 'comercialblueclinica',
    // Só para testes/homologação: sobrescreve https://{subdomain}.kommo.com/api/v4
    baseURL: process.env.KOMMO_BASE_URL || '',
    token: process.env.KOMMO_TOKEN || '',
    minIntervalMs: int(process.env.KOMMO_MIN_INTERVAL_MS, 250),
    maxConcurrency: int(process.env.KOMMO_MAX_CONCURRENCY, 4),
    maxRetries: int(process.env.KOMMO_MAX_RETRIES, 5),
    timeoutMs: int(process.env.KOMMO_TIMEOUT_MS, 30000),
    pipelineId: optionalInt(process.env.KOMMO_PIPELINE_ID),
    statusQualificadosId: optionalInt(process.env.KOMMO_STATUS_QUALIFICADOS_ID),
    statusNovosId: optionalInt(process.env.KOMMO_STATUS_NOVOS_ID),
    apnStatusIds: intList(process.env.KOMMO_APN_STATUS_IDS),
    scoreFieldId: optionalInt(process.env.KOMMO_SCORE_FIELD_ID),
  },
  server: {
    port: int(process.env.PORT, 3000),
    corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    metricsCacheSeconds: int(process.env.METRICS_CACHE_SECONDS, 60),
    metricsMonths: Math.max(1, int(process.env.METRICS_MONTHS, 3)),
  },
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
};

module.exports = config;
