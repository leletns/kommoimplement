'use strict';

const path = require('path');

require('dotenv').config();
// IDs da conta (não secretos, versionados). Não sobrescreve o que veio do .env / Netlify.
// No Netlify Functions o código vem empacotado: procura também a partir da pasta do projeto.
const CONTA_ENV = [path.resolve(__dirname, '..', 'config', 'conta.env'), path.resolve(process.cwd(), 'config', 'conta.env')].find((p) =>
  require('fs').existsSync(p)
) || path.resolve(__dirname, '..', 'config', 'conta.env');
require('dotenv').config({ path: CONTA_ENV });

// Se uma variável JSON chegou quebrada (ex.: o import do painel do Netlify tirou as aspas),
// usa o valor versionado em config/conta.env em vez de falhar ou calcular errado.
(() => {
  let conta = {};
  try {
    conta = require('dotenv').parse(require('fs').readFileSync(CONTA_ENV));
  } catch {
    return;
  }
  for (const key of ['KOMMO_METRICS_PIPELINES', 'KOMMO_CLASSIFICACAO_ENUMS', 'KOMMO_OBJECAO_ENUMS']) {
    const v = process.env[key];
    if (!v) continue;
    try {
      JSON.parse(v);
    } catch {
      console.warn(`[config] ${key} não é um JSON válido; usando o valor de config/conta.env.`);
      if (conta[key]) process.env[key] = conta[key];
    }
  }
})();

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
    statusInteresseId: optionalInt(process.env.KOMMO_STATUS_INTERESSE_ID),
    classificacaoFieldId: optionalInt(process.env.KOMMO_CLASSIFICACAO_FIELD_ID),
    classificacaoEnums: (() => {
      try {
        return JSON.parse(process.env.KOMMO_CLASSIFICACAO_ENUMS || '{}');
      } catch {
        return {};
      }
    })(),
    objecaoFieldId: optionalInt(process.env.KOMMO_OBJECAO_FIELD_ID),
    resumoFieldId: optionalInt(process.env.KOMMO_RESUMO_FIELD_ID),
    pagamentoFieldId: optionalInt(process.env.KOMMO_PAGAMENTO_FIELD_ID),
    consultaFieldId: optionalInt(process.env.KOMMO_CONSULTA_FIELD_ID),
    consultaEventosDesde: process.env.KOMMO_CONSULTA_EVENTOS_DESDE || null,
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
