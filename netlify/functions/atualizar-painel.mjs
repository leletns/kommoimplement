// Refaz o build do painel de hora em hora, para os números do Kommo ficarem atualizados.
// Precisa da variável NETLIFY_BUILD_HOOK (Site configuration → Build & deploy → Build hooks).
export default async () => {
  const hook = process.env.NETLIFY_BUILD_HOOK;
  if (!hook) {
    console.log('NETLIFY_BUILD_HOOK não configurado; painel não será atualizado automaticamente.');
    return new Response('sem build hook', { status: 200 });
  }
  const res = await fetch(hook, { method: 'POST' });
  console.log(`build do painel solicitado: HTTP ${res.status}`);
  return new Response('ok', { status: 200 });
};

export const config = { schedule: '@hourly' };
