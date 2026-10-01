// Ficha Blue no Cloudflare Pages: peças comuns às duas funções (/api/ficha e /api/ficha-link).
// Variáveis (Cloudflare → Pages → Settings → Variables and Secrets, tipo "Secret"):
//   KOMMO_TOKEN (obrigatório), KOMMO_SUBDOMAIN (padrão comercialblueclinica), AMIGO_TOKEN (opcional),
//   FICHA_SEGREDO (recomendado: assina os links), FICHA_SENHA (senha do botão "Link da ficha").

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

/** Token colado com quebra de linha, espaço invisível, aspas ou "Bearer": fica só o que um token tem (letras, números, . _ -). */
export const tokenLimpo = (t) => String(t || '').replace(/^\s*Bearer\s+/i, '').replace(/[^A-Za-z0-9._-]/g, '');

/** Cliente Kommo mínimo com fetch (mesma interface `request(metodo, url, { data })` usada por fichaBlue.js). */
export function kommoFetch(env) {
  const token = tokenLimpo(env.KOMMO_TOKEN);
  const base = env.KOMMO_BASE_URL || `https://${env.KOMMO_SUBDOMAIN || 'comercialblueclinica'}.kommo.com/api/v4`;
  return {
    async request(method, url, { data } = {}) {
      for (let tentativa = 0; ; tentativa++) {
        const r = await fetch(base + url, {
          method: method.toUpperCase(),
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
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

/** Compara a senha sem vazar tempo. */
export const igual = (a, b) => {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
};

/** CORS só para as telas onde os botões rodam: Kommo da clínica, AmigoClinic e DocSignature. */
export function corsDe(request, env) {
  const origem = request.headers.get('origin') || '';
  const kommo = `https://${env.KOMMO_SUBDOMAIN || 'comercialblueclinica'}.kommo.com`;
  const ok = origem === kommo || /^https:\/\/([a-z0-9-]+\.)*(amigoapp\.com\.br|amigotech\.com\.br|docsignature\.com\.br)$/.test(origem);
  return ok ? { 'access-control-allow-origin': origem, 'access-control-allow-headers': 'x-painel-senha, content-type', 'access-control-allow-methods': 'GET, OPTIONS', vary: 'origin' } : {};
}

export const senhaOk = (request, env) => {
  const senha = env.FICHA_SENHA || env.PAINEL_SENHA;
  return !!senha && igual(request.headers.get('x-painel-senha') || '', senha);
};
