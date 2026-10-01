// /f/<código> → a página da Ficha Blue, com o endereço do site nas tags de prévia (o WhatsApp exige link completo na imagem).
export async function onRequest({ request, env }) {
  const origem = new URL(request.url).origin;
  const pagina = await env.ASSETS.fetch(new URL('/', request.url));
  const html = (await pagina.text()).replaceAll('__ORIGEM__', origem);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
