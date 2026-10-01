// Link fixo da ficha de lipedema: /lipedema, /lipedema/en, /lipedema/es.
// A ficha é ligada ao lead pelo celular/e-mail que a paciente preencher.
import { servirFicha } from '../_lib/pagina.js';

export const onRequest = (ctx) => servirFicha(ctx, { ver: 'lip', lang: [].concat(ctx.params.l || [])[0] || 'pt' });
