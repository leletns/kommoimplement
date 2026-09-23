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

  // Diagnóstico (sem mostrar valores secretos): o log do Netlify diz exatamente o que falta.
  console.log(`Node ${process.version} · conta ${config.kommo.subdomain}`);
  const token = (process.env.KOMMO_TOKEN || '').trim();
  if (!token) {
    throw new Error(
      'KOMMO_TOKEN não chegou ao build. No Netlify: Site configuration → Environment variables → KOMMO_TOKEN, ' +
        'com o escopo "Builds" marcado (e o valor para o contexto "Production"). Depois, rode um novo deploy.'
    );
  }
  if (token.split('.').length !== 3) {
    throw new Error(`KOMMO_TOKEN não parece um token do Kommo (${token.length} caracteres, esperado JWT com 3 partes). Cole o token inteiro, sem aspas nem espaços.`);
  }
  console.log(`KOMMO_TOKEN presente (${token.length} caracteres)`);

  const kommo = getKommoClient();
  try {
    const account = await kommo.getAccount();
    console.log(`Kommo OK: conta "${account.name}"`);
  } catch (err) {
    if (err.status === 401) throw new Error('O Kommo recusou o token (401): token inválido, revogado ou de outra conta. Gere um novo e atualize KOMMO_TOKEN.');
    if (err.status === 402 || err.status === 403) throw new Error(`O Kommo bloqueou o acesso (${err.status}): verifique o plano/assinatura ou as permissões da integração.`);
    throw new Error(`Não foi possível falar com o Kommo: ${err.message}`);
  }
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
