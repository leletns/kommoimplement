#!/usr/bin/env node
'use strict';

/**
 * Gera o site estático do painel para o Netlify (pasta site/):
 *   site/index.html         ← "Blue Painel Comercial v1 claro.dc.html"
 *   site/support.js         ← runtime do painel (se estiver na raiz do projeto)
 *   site/api/metrics.json   ← KPIs do Kommo no formato PERIODS (o painel busca /api/metrics)
 *
 * Roda no build do Netlify com KOMMO_TOKEN nas variáveis do site: o token fica só no
 * servidor de build e nunca vai para o HTML publicado. Se o Kommo falhar, o build falha
 * e o Netlify mantém no ar a última versão boa.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getKommoClient } = require('../services/kommoClient');
const { buildMetrics } = require('../services/metricsService');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'site');
const DASHBOARD = 'Blue Painel Comercial.dc.html';

async function main() {
  const started = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'api'), { recursive: true });

  fs.copyFileSync(path.join(ROOT, DASHBOARD), path.join(OUT, 'index.html'));
  if (fs.existsSync(path.join(ROOT, 'support.js'))) {
    fs.copyFileSync(path.join(ROOT, 'support.js'), path.join(OUT, 'support.js'));
  } else {
    console.warn('⚠️  support.js não está na raiz do projeto: o painel não renderiza sem ele.');
  }

  const kommo = getKommoClient();
  const metrics = await buildMetrics(kommo);
  fs.writeFileSync(path.join(OUT, 'api', 'metrics.json'), JSON.stringify(metrics));

  const atual = Object.values(metrics)[0];
  console.log(`✅ Painel gerado em ${((Date.now() - started) / 1000).toFixed(0)}s · ${kommo.stats.requests} chamadas ao Kommo (${config.kommo.subdomain})`);
  console.log(`   ${atual.label}: ${atual.leads} leads · ${atual.apn} APN · ${atual.vendas} vendas · ${atual.receita}`);
}

main().catch((err) => {
  console.error('❌ Não foi possível gerar o painel:', err.message);
  process.exit(1);
});
