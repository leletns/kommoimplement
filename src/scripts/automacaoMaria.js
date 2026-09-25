#!/usr/bin/env node
'use strict';

/**
 * Roda a automação da Maria uma vez (a mesma que o Netlify roda a cada 15 minutos).
 *
 *   node src/scripts/automacaoMaria.js            # simula: mostra o que faria
 *   node src/scripts/automacaoMaria.js --aplicar  # grava no Kommo
 */

const { getKommoClient } = require('../services/kommoClient');
const { executarAutomacao } = require('../services/automacaoMaria');

const apply = process.argv.includes('--aplicar');
executarAutomacao(getKommoClient(), { apply })
  .then(() => console.log(apply ? '✅ Aplicado no Kommo.' : '🧪 Simulação: nada foi gravado. Rode com --aplicar.'))
  .catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });
