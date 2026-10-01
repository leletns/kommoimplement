// Serve a página da Ficha Blue (ficha/index.html) com a configuração da rota e cabeçalhos de segurança.
export const SEGURANCA = {
  'content-security-policy': [
    "default-src 'self'", "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
    "connect-src 'self' https://viacep.com.br", "frame-src https://challenges.cloudflare.com", "img-src 'self' data:",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'strict-transport-security': 'max-age=31536000',
  'x-robots-tag': 'noindex',
  'cache-control': 'no-store',
};

export async function servirFicha({ request, env }, { ver = 'lip', lang = '' } = {}) {
  const url = new URL(request.url);
  const pagina = await env.ASSETS.fetch(new URL('/', url));
  const cfg = { ver, lang: ['pt', 'es', 'en'].includes(lang) ? lang : '', turnstile: env.TURNSTILE_SITE_KEY || '' };
  const html = (await pagina.text())
    .replaceAll('__ORIGEM__', url.origin)
    .replace('/*FICHA_CFG*/', `window.FICHA_CFG=${JSON.stringify(cfg)};`);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', ...SEGURANCA } });
}
