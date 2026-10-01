// Automação da Maria no Kommo, a cada 15 minutos (ver src/services/automacaoMaria.js):
// respostas pendentes de verdade, régua de follow-up, "Retomar depois" e sugestão de mensagem com IA.
// Precisa de KOMMO_TOKEN disponível para Functions. Para pausar: AUTOMACAO_KOMMO=0.
// Opcional: ANTHROPIC_API_KEY para a sugestão de mensagem com IA.
import automacao from '../../src/services/automacaoMaria.js';
import kommoClient from '../../src/services/kommoClient.js';

export default async () => {
  if (process.env.AUTOMACAO_KOMMO === '0') {
    console.log('Automação pausada (AUTOMACAO_KOMMO=0).');
    return new Response('pausada', { status: 200 });
  }
  if (!process.env.KOMMO_TOKEN) {
    console.log('KOMMO_TOKEN não disponível para Functions; automação não rodou.');
    return new Response('sem token', { status: 200 });
  }
  const resumo = await automacao.executarAutomacao(kommoClient.getKommoClient(), { apply: true });
  return new Response(JSON.stringify(resumo), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const config = { schedule: '*/15 * * * *' };
