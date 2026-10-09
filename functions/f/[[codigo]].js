// /f/<código> → link pessoal (gerado pelo botão 📝): a ficha já sabe de qual lead é.
import { servirFicha } from '../_lib/pagina.js';

export const onRequest = (ctx) => servirFicha(ctx, { lang: new URL(ctx.request.url).searchParams.get('l') || '', ver: new URL(ctx.request.url).searchParams.get('v') === 'pla' ? 'pla' : 'lip' });
