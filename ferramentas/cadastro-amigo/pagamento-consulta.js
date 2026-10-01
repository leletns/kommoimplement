// Confere o pagamento da consulta antes de confirmar: integral, só a reserva (50%) ou nada.
// Fontes, da mais confiável para a menos: nota "💳 Comprovantes" (grupo de pagamentos), valor do lead
// e a conversa (oferta integral/reserva, comprovantes recebidos e agradecidos, pedido da segunda parte).
// Usado pelo botão "Confirmar consulta" e testado no Node.
function avaliarPagamento({ price = 0, pagoEm = null, notas = [], msgs = [] } = {}) {
  const valor = (s) => { const m = /\d[\d.]*(?:,\d{1,2})?/.exec(String(s)); return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) || 0 : 0; };
  const dia = (ts) => { const d = new Date(ts * 1000); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); };
  const provas = [];
  const vistos = new Set();
  msgs = msgs.filter((m) => { const k = m.t + '|' + m.ts + '|' + (m.tipo || '') + '|' + (m.texto || ''); if (vistos.has(k)) return false; vistos.add(k); return true; }).sort((a, b) => a.ts - b.ts);
  const enviadas = msgs.filter((m) => m.t === 90), recebidas = msgs.filter((m) => m.t === 89);

  // 1) Nota dos comprovantes (a mais nova)
  let nota = null;
  for (const n of notas.slice().sort((a, b) => b.ts - a.ts)) {
    const m = /💳 Comprovantes: pago R\$\s?([\d.,]+)(?: de R\$\s?([\d.,]+) · falta R\$\s?([\d.,]+))?/.exec(n.text || '');
    if (m) { nota = { ts: n.ts, pago: valor(m[1]), total: m[2] ? valor(m[2]) : valor(m[1]), falta: m[3] ? valor(m[3]) : 0 }; break; }
  }
  if (nota) provas.push('Comprovantes (nota de ' + dia(nota.ts) + '): pago R$ ' + nota.pago.toLocaleString('pt-BR') + (nota.falta ? ' de R$ ' + nota.total.toLocaleString('pt-BR') : ''));

  // 2) Conversa: valor oferecido, escolha da paciente, comprovantes
  let oferta = null, oferecidaEm = 0;
  for (const m of enviadas) {
    const i = /integral (?:de )?\*?R\$\s?([\d.,]+)/i.exec(m.texto || '') || (!/cirurgi|procedimento|plano cir/i.test(m.texto || '') && /investimento[^\n]{0,80}?R\$\s?([\d.,]+)/i.exec(m.texto || ''));
    if (i) { oferta = valor(i[1]); oferecidaEm = m.ts; }
  }
  if (oferta) provas.push('Valor oferecido na conversa: R$ ' + oferta.toLocaleString('pt-BR') + ' (' + dia(oferecidaEm) + ')');
  const depois = (ts) => (m) => m.ts > ts;
  let escolha = '';
  for (const m of recebidas.filter(depois(oferecidaEm))) {
    const t = (m.texto || '').toLowerCase();
    if (/metade|50 ?%|reserva|sinal|primeira parte|parte agora|parcial|restante|uma agora e outra|outra (parte )?no dia|resto no dia|no dia da consulta/.test(t)) escolha = 'reserva';
    else if (/integral|valor total|tudo de uma vez|pagar tudo/.test(t)) escolha = 'integral';
  }
  if (escolha) provas.push('A paciente escolheu: ' + (escolha === 'integral' ? 'pagamento integral' : 'reserva de 50%'));
  // Comprovantes: foto/arquivo (ou "paguei", "comprovante") da paciente depois dos dados de pagamento (Pix, link do cartão).
  const instrucoes = enviadas.filter((m) => /chave pix|userede\.com|link (de|para o) pagamento|dados do pix|ap[oó]s realizar o pagamento|envie o comprovante|segunda parte/i.test(m.texto || ''));
  // Fotos do corpo, exames e PDFs também chegam como foto/arquivo: só conta como comprovante se a equipe não pediu
  // exame/foto nas 24h antes, se não for uma rajada (3+ arquivos em 10 min) ou se a paciente escreveu "comprovante/paguei".
  const pediuDocs = (ts) => enviadas.some((m) => m.ts <= ts && ts - m.ts < 86400 && /(envi|mand|encaminh)\w*[^.?!\n]{0,60}(exames?\b|sangue|laudos?|resultados?|fotos?\b|pdf)|(possui|tem|teria)[^?\n]{0,40}(exames?\b|laudos?)|(tirar|tire|tirad)[^.?!\n]{0,30}fotos?|fotos?[^.?!\n]{0,30}(tirad|envi)/i.test(m.texto || '') && !/pedidos? de exame|comprovante/i.test(m.texto || ''));
  const emRajada = (m) => recebidas.filter((x) => (x.tipo === 'picture' || x.tipo === 'file') && Math.abs(x.ts - m.ts) < 600).length >= 3;
  const rajada = (m) => emRajada(m) || recebidas.some((x) => x.ts < m.ts && m.ts - x.ts < 86400 && emRajada(x));
  const ambiguos = [];
  const candidatos = recebidas.filter((m) => {
    const anexo = m.tipo === 'picture' || m.tipo === 'file' || /userede\.com/i.test(m.texto || '');
    const fala = /comprovante|paguei|pagamento (feito|realizado|efetuado)|pix (feito|enviado)|transferi/i.test(m.texto || '');
    if (!(anexo || fala) || !instrucoes.some((i) => m.ts > i.ts && m.ts - i.ts < 5 * 86400)) return false;
    if (fala || /userede\.com/i.test(m.texto || '')) return true;
    if (rajada(m) || pediuDocs(m.ts)) { ambiguos.push(m); return false; }
    return true;
  });
  const links = instrucoes.filter((m) => /userede\.com|link (de|para o) pagamento/i.test(m.texto || '') && m.ts > oferecidaEm);
  const pix = instrucoes.filter((m) => /chave pix|dados do pix/i.test(m.texto || '') && m.ts > oferecidaEm);
  if (links.length) provas.push('Link de pagamento (cartão) enviado: ' + [...new Set(links.map((m) => dia(m.ts)))].join(', '));
  if (pix.length) provas.push('Dados do Pix enviados: ' + [...new Set(pix.map((m) => dia(m.ts)))].join(', '));
  const agradeceu = (ts) => enviadas.some((m) => m.ts > ts && m.ts - ts < 2 * 86400 && /obrigad[ao] (por|pelo)|recebi|recebemos|confirmad/i.test(m.texto || ''));
  const recibos = candidatos.filter((m, i, a) => !a.slice(0, i).some((x) => m.ts - x.ts < 6 * 3600));
  if (recibos.length) provas.push('Comprovante(s) na conversa: ' + recibos.map((m) => dia(m.ts) + (agradeceu(m.ts) ? ' (equipe agradeceu)' : '')).join(', '));
  const pedidoSegunda = enviadas.filter((m) => /segunda parte|restante|valor que falta/i.test(m.texto || '') && !/integral/i.test(m.texto || '')).pop();
  const anexosDepoisDoPedido = pedidoSegunda ? recebidas.filter((m) => m.ts > pedidoSegunda.ts && (m.tipo === 'picture' || m.tipo === 'file' || /comprovante|paguei|pago|feito|pix/i.test(m.texto || ''))) : [];
  if (pedidoSegunda) provas.push('Segunda parte pedida em ' + dia(pedidoSegunda.ts) + (anexosDepoisDoPedido.length ? '; a paciente mandou comprovante/arquivo em ' + dia(anexosDepoisDoPedido[0].ts) : '; sem comprovante depois disso'));
  if (price) provas.push('Valor no lead: R$ ' + Number(price).toLocaleString('pt-BR') + (pagoEm ? ' · pagamento registrado em ' + dia(pagoEm) : ''));

  // 3) Decisão
  const total = (nota && nota.total) || oferta || 0;
  let pago = nota ? nota.pago : 0;
  if (!nota && price && pagoEm) pago = Number(price);
  // Só pela conversa, sem a nota do grupo: integral apenas com prova clara (escolheu integral, ou comprovante depois do pedido da 2ª parte).
  let duvida = '';
  const pelaConversa = !nota && !pago && recibos.length && total;
  if (pelaConversa) {
    const segundaPaga = pedidoSegunda && recibos.some((m) => m.ts > pedidoSegunda.ts);
    const talvezSegunda = pedidoSegunda && !segundaPaga && ambiguos.some((m) => m.ts > pedidoSegunda.ts);
    if (talvezSegunda) { pago = total / 2; duvida = 'Pediram a segunda parte e depois a paciente mandou fotos/arquivos, mas podem ser exames ou fotos do corpo. Confira se ela pagou.'; }
    else if (segundaPaga || (escolha === 'integral' && recibos.length === 1)) pago = total;
    else if (escolha === 'reserva' && recibos.length === 1) pago = total / 2;
    if (!duvida && pago === 0) { pago = total / 2; duvida = recibos.length > 1 ? 'Achei ' + recibos.length + ' envios que parecem comprovante, mas a segunda parte não foi pedida antes. Confira se ela já pagou tudo.' : 'Achei 1 comprovante, mas a conversa não diz se foi integral ou só a reserva (R$ ' + (total / 2).toLocaleString('pt-BR') + '). O mais comum é a reserva: deixei marcado pedir a segunda parte. Confira.'; }
  }
  // Algo novo depois da nota: novo comprovante agradecido ou arquivo depois do pedido da segunda parte
  const novoDepoisDaNota = nota && nota.falta > 0 && (recibos.some((m) => m.ts > nota.ts + 3600) || anexosDepoisDoPedido.some((m) => m.ts > nota.ts));
  const falta = total && pago ? Math.max(0, Math.round(total - pago)) : 0;

  if (!pago && !recibos.length) return { status: 'sem_pagamento', total, pago: 0, falta: total, provas, texto: 'Não achei pagamento desta consulta. Confira antes de confirmar.' };
  if (novoDepoisDaNota) return { status: 'conferir', total, pago, falta, provas, texto: 'Faltava R$ ' + falta.toLocaleString('pt-BR') + ', mas chegou um comprovante depois. Confira se é a segunda parte.', sugestao: 'nao' };
  if (duvida) return { status: 'conferir', sugestao: 'falta', total, pago, falta, provas, texto: duvida };
  if (!total) return { status: 'conferir', sugestao: 'nao', total, pago, falta: 0, provas, texto: pago ? 'Achei pagamento de R$ ' + Number(pago).toLocaleString('pt-BR') + ', mas não o valor total da consulta. Confira se foi integral.' : 'Achei comprovante na conversa, mas não o valor da consulta. Confira se foi integral ou só a reserva.' };
  if (falta > 0) return { status: 'falta', total, pago, falta, provas, texto: 'Pagou R$ ' + Number(pago).toLocaleString('pt-BR') + ' de R$ ' + total.toLocaleString('pt-BR') + '. Falta a segunda parte: R$ ' + falta.toLocaleString('pt-BR') + '.' + (nota ? '' : ' (pela conversa: a segunda parte pode ter sido paga fora do chat, confira no grupo de pagamentos)'), certeza: nota ? 'alta' : 'media' };
  return { status: 'integral', total, pago, falta: 0, provas, texto: 'Consulta paga por completo (R$ ' + total.toLocaleString('pt-BR') + ').' + (nota ? '' : ' (pela conversa: confira no grupo de pagamentos)'), certeza: nota ? 'alta' : 'media' };
}
if (typeof module !== 'undefined') module.exports = { avaliarPagamento };
