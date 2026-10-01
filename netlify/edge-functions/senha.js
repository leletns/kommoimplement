// Protege o painel com senha (receita e funil não devem ficar públicos).
// Defina PAINEL_SENHA nas variáveis do site; o usuário pode ser qualquer um (ex.: "blue").
export default async (request, context) => {
  const senha = Netlify.env.get('PAINEL_SENHA');
  if (!senha) return context.next();

  const [scheme, encoded] = (request.headers.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    let pass = '';
    try {
      pass = atob(encoded).split(':').slice(1).join(':');
    } catch {
      pass = '';
    }
    if (pass === senha) return context.next();
  }
  return new Response('Acesso restrito ao time Blue.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Painel Comercial Blue", charset="UTF-8"' },
  });
};

// A Ficha Blue é pública (a paciente abre pelo link pessoal); a segurança está no código assinado do link.
export const config = { path: '/*', excludedPath: ['/f/*', '/ficha/*', '/api/ficha', '/api/ficha-link'] };
