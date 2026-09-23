'use strict';

/**
 * Resolve o funil e as etapas usadas pela Alice e pelo dashboard.
 *
 * IDs explícitos no .env têm prioridade; sem eles, as etapas são encontradas pelo
 * nome no funil (Qualificados, Novos, Agendamento/APN). Status 142 = ganho, 143 = perdido.
 */

const config = require('../config');
const { normalize } = require('./aliceEngine');

const WON = 142;
const LOST = 143;

function findStatus(statuses, regex) {
  return statuses
    .filter((s) => s.id !== WON && s.id !== LOST && regex.test(normalize(s.name)))
    .sort((a, b) => a.sort - b.sort)[0];
}

async function resolvePipeline(kommo) {
  const pipelines = await kommo.getPipelines();
  if (!pipelines.length) throw new Error('Nenhum funil encontrado na conta Kommo.');

  const pipeline =
    (config.kommo.pipelineId && pipelines.find((p) => p.id === config.kommo.pipelineId)) ||
    pipelines.find((p) => p.is_main) ||
    pipelines[0];
  if (config.kommo.pipelineId && pipeline.id !== config.kommo.pipelineId) {
    throw new Error(`KOMMO_PIPELINE_ID=${config.kommo.pipelineId} não existe na conta.`);
  }

  const statuses = (pipeline._embedded?.statuses || []).slice().sort((a, b) => a.sort - b.sort);
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const sortById = new Map(statuses.map((s) => [s.id, s.sort]));
  // type 1 = "Leads de entrada" (incoming/unsorted)
  const open = statuses.filter((s) => s.id !== WON && s.id !== LOST && s.type !== 1);

  const pick = (id, regex, fallback) => (id && byId.get(id)) || findStatus(statuses, regex) || fallback;

  const novos = pick(config.kommo.statusNovosId, /\bnovo/, open[0]);
  const qualificados = pick(config.kommo.statusQualificadosId, /qualific/, null);

  let apnStatuses = config.kommo.apnStatusIds.map((id) => byId.get(id)).filter(Boolean);
  if (!apnStatuses.length) {
    apnStatuses = statuses.filter((s) => s.id !== WON && s.id !== LOST && /agend|\bapn\b/.test(normalize(s.name)));
  }
  const apnSort = apnStatuses.length ? Math.min(...apnStatuses.map((s) => s.sort)) : null;

  if (!qualificados) {
    console.warn('[pipeline] Etapa "Qualificados" não encontrada. Defina KOMMO_STATUS_QUALIFICADOS_ID no .env.');
  }

  return {
    pipeline,
    pipelines,
    statuses,
    byId,
    sortById,
    novos,
    qualificados,
    apnStatuses,
    stages: {
      sortById,
      qualificadosSort: qualificados ? qualificados.sort : null,
      apnSort,
    },
    WON,
    LOST,
  };
}

module.exports = { resolvePipeline, WON, LOST };
