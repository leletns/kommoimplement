// Ficha Blue no Cloudflare Pages: peças comuns às duas funções (/api/ficha e /api/ficha-link).
// Variáveis (Cloudflare → Pages → Settings → Variables and Secrets, tipo "Secret"):
//   KOMMO_TOKEN (obrigatório), KOMMO_SUBDOMAIN (padrão comercialblueclinica), AMIGO_TOKEN (opcional),
//   FICHA_SEGREDO (recomendado: assina os links), FICHA_SENHA (senha do botão "Link da ficha").

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

/** Cliente Kommo mínimo com fetch (mesma interface `request(metodo, url, { data })` usada por fichaBlue.js). */
export function kommoFetch(env) {
  const base = env.KOMMO_BASE_URL || `https://${env.KOMMO_SUBDOMAIN || 'comercialblueclinica'}.kommo.com/api/v4`;
  return {
    async request(method, url, { data } = {}) {
      for (let tentativa = 0; ; tentativa++) {
        const r = await fetch(base + url, {
          method: method.toUpperCase(),
          headers: { authorization: `Bearer ${env.KOMMO_TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
          body: data ? JSON.stringify(data) : undefined,
        });
        if (r.status === 204) return null;
        if (r.ok) return r.json();
        if ((r.status === 429 || r.status >= 500) && tentativa < 3) { await new Promise((ok) => setTimeout(ok, 1000 * 2 ** tentativa)); continue; }
        const e = new Error(`Kommo ${method.toUpperCase()} ${url}: ${r.status}`);
        e.status = r.status;
        throw e;
      }
    },
  };
}
