// Link fixo da ficha de cirurgia plástica: /plastica, /plastica/en, /plastica/es.
import { servirFicha } from '../_lib/pagina.js';

export const onRequest = (ctx) => servirFicha(ctx, { ver: 'pla', lang: [].concat(ctx.params.l || [])[0] || 'pt' });
