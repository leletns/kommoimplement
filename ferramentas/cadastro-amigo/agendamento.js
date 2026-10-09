// Botão "Agendamento" — use com o lead aberto no Kommo depois que a paciente pagou.
// Monta, no estilo da equipe: a mensagem "consulta agendada" para a paciente (com o link fixo da pré-consulta), o texto do grupo de comprovantes, o título e a descrição do TimeTree,
// e mostra o comprovante que a paciente mandou na conversa para baixar e encaminhar. Só leitura: não grava nada.
(async () => {
  /*PARSER*/
  /*PAGAMENTO*/
  // Endereço da Ficha Blue (troque aqui quando o subdomínio ficha.clinicablue.com.br existir)
  const SITE = 'https://clinicablue.pages.dev';
  const CAMPO_CONSULTA = 3728948, CAMPO_MODALIDADE = 3837322, CAMPO_PRIMEIRO_NOME = 3837314, CAMPO_PAGAMENTO = 3728960, CAMPO_FONTE = 3839860;
  const id = (location.pathname.match(/leads\/detail\/(\d+)/) || [])[1];
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:430px;max-height:92vh;overflow:auto;background:#fff;color:#13294a;border:2px solid #13294a;border-radius:14px;padding:16px;font:14px/1.45 Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)';
  document.body.appendChild(box);
  const fechar = '<div style="text-align:right;margin-top:8px"><button id="ag-x" style="border:0;background:#eaf2fb;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>';
  const mostrar = (h) => { box.innerHTML = '<div style="font-weight:bold;font-size:15px;margin-bottom:8px">🧾 Agendamento</div>' + h + fechar; box.querySelector('#ag-x').onclick = () => box.remove(); };
  if (!id) { mostrar('Abra o card da paciente no Kommo e clique de novo.'); return; }
  mostrar('Lendo o lead, a ficha e a conversa…');

  const get = async (u) => (await fetch(u, { credentials: 'include' })).json();
  let lead = {}, contato = {}, notas = [], msgs = [];
  try { lead = await get('/api/v4/leads/' + id + '?with=contacts'); } catch (e) { /* segue */ }
  const cf = (fid) => ((lead.custom_fields_values || []).find((f) => f.field_id === fid) || { values: [{}] }).values[0];
  const ct = lead._embedded && lead._embedded.contacts && lead._embedded.contacts[0];
  try { if (ct) contato = await get('/api/v4/contacts/' + ct.id); } catch (e) { /* segue */ }
  // O Kommo troca as aspas da nota por &quot;: desfaz para ler o JSON da Ficha Blue
  try { const n = await get('/api/v4/leads/' + id + '/notes?limit=100&order[id]=desc'); notas = ((n && n._embedded && n._embedded.notes) || []).map((x) => ({ ts: x.created_at, text: String((x.params && x.params.text) || '').replace(/&quot;|&#0?34;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') })); } catch (e) { /* segue */ }
  try {
    let url = location.origin + '/ajax/v3/leads/' + id + '/events_timeline?limit=100', pag = 0;
    while (url && pag < 15) {
      const r = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }, credentials: 'include' });
      if (!r.ok) break;
      const j = await r.json();
      const items = (j._embedded && j._embedded.items) || [];
      for (const it of items) {
        const m = it.data && typeof it.data.message === 'object' && it.data.message;
        if ((it.type === 89 || it.type === 90) && m) msgs.push({ t: it.type, ts: it.date_create, tipo: m.type || 'text', texto: m.text || '', media: typeof m.media === 'string' ? m.media : '' });
      }
      let prev = j._links && j._links.prev; prev = prev && typeof prev === 'object' ? prev.href : prev;
      url = prev && items.length ? new URL(prev, location.origin).href : null;
      pag++;
    }
  } catch (e) { /* sem conversa */ }

  // Ficha: Ficha Blue (nota) > ficha mandada no WhatsApp > dados do contato
  let ficha = null;
  const nb = notas.find((n) => n.text.includes('FICHA_BLUE_JSON:'));
  if (nb) { try { ficha = JSON.parse(nb.text.split('FICHA_BLUE_JSON:')[1].trim()); } catch (e) { ficha = null; } }
  const fichaZap = !ficha && msgs.filter((m) => m.t === 89 && pareceFicha(m.texto)).sort((a, b) => b.ts - a.ts)[0];
  if (fichaZap) ficha = parseFicha(fichaZap.texto);
  const r = (ficha && ficha._ficha && ficha._ficha.r) || {};
  const tel = String(((contato.custom_fields_values || []).find((f) => f.field_code === 'PHONE') || { values: [{}] }).values[0].value || (ficha && ficha.telefone) || '');
  const dg = tel.replace(/\D/g, '');
  const lang = /^\+/.test(tel.trim()) && !dg.startsWith('55') ? (/^(54|598|595|56|591|57|51|58|593|52|34|50\d)/.test(dg) ? 'es' : 'en') : 'pt';
  const nomeProprio = (s) => String(s || '').trim().toLowerCase().replace(/(^|[\s'-])(\S)/g, (x, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (x) => x.toLowerCase());
  const nomeCompleto = nomeProprio((ficha && ficha.nome) || contato.name || lead.name || '');

  // Local, médico e tipo
  const modalidade = String(cf(CAMPO_MODALIDADE).value || '');
  let local = /tele/i.test(modalidade) ? 'tele' : /paulo|\bsp\b/i.test(modalidade) ? 'sp' : /rio|\brj\b|barra/i.test(modalidade) ? 'rj' : '';
  const enviadas = msgs.filter((m) => m.t === 90).sort((a, b) => a.ts - b.ts);
  if (!local) {
    let porCidade = '', porValor = '';
    for (const m of enviadas) {
      const t = m.texto;
      if (/cirurgi|\bmil\b/i.test(t)) continue;
      if (/teleconsulta|google meet|consulta (online|on-line)/i.test(t)) porCidade = 'tele';
      else if (/alameda campinas|jardim paulista|(consulta|investimento|atendimento|agenda)[^\n]{0,120}s[aã]o paulo/i.test(t)) porCidade = 'sp';
      else if (/jos[eé] silva de azevedo|barra da tijuca|(consulta|investimento|atendimento|agenda)[^\n]{0,120}rio de janeiro/i.test(t)) porCidade = 'rj';
      else if (/2\.?200/.test(t)) porValor = 'sp';
      else if (/1\.?800/.test(t)) porValor = 'rj';
    }
    local = porCidade || porValor || 'rj';
  }
  let medico = 'rafael';
  for (const m of enviadas) if (/(consulta|atendimento|agenda\w*|disponibilidade)[^\n]{0,80}dr\.?\s*(leonardo|rafael)/i.test(m.texto)) medico = /leonardo/i.test(m.texto.match(/dr\.?\s*(leonardo|rafael)/i)[0]) ? 'leo' : 'rafael';
  const tagsTxt = JSON.stringify((lead._embedded && lead._embedded.tags) || []) + ' ' + (lead.name || '');
  if (/leonardo/i.test(tagsTxt)) medico = 'leo';
  let tipo = ficha && ficha._ficha ? ficha._ficha.ver : /pl[aá]stic|abdomino|mamopl|rinopl/i.test(tagsTxt + ' ' + enviadas.slice(-40).map((m) => m.texto).join(' ')) && !/lipedema/i.test(tagsTxt) ? 'pla' : 'lip';

  const quando = Number(cf(CAMPO_CONSULTA).value) ? new Date(Number(cf(CAMPO_CONSULTA).value) * 1000) : null;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = quando ? quando.getFullYear() + '-' + pad(quando.getMonth() + 1) + '-' + pad(quando.getDate()) : '';
  const hora = quando ? pad(quando.getHours()) + ':' + pad(quando.getMinutes()) : '';
  const fonte = String(cf(CAMPO_FONTE).value || '').replace(/instragram/i, 'Instagram').replace(/^Indica[cç]ao$/i, 'Indicação');
  const como = (ficha && (ficha.comoConheceu || (ficha.indicacao ? 'Indicação - ' + ficha.indicacao : ''))) || fonte;
  const objetivo = r.quer || (ficha && ficha.objetivo) || '';
  const pg0 = avaliarPagamento({ price: Number(lead.price) || 0, pagoEm: Number(cf(CAMPO_PAGAMENTO).value) || null, notas, msgs, local: medico === 'leo' ? '' : local });

  const inp = 'style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #dbe4f0;border-radius:8px;font:13px Arial"';
  const ta = (id2, h) => '<textarea id="' + id2 + '" style="width:100%;box-sizing:border-box;height:' + h + 'px;font:13px/1.4 Arial;border:1px solid #dbe4f0;border-radius:8px;padding:8px"></textarea>';
  const btn = (id2, t, cor) => '<button id="' + id2 + '" style="width:100%;margin-top:6px;border:0;background:' + (cor || '#13294a') + ';color:#fff;border-radius:8px;padding:9px;cursor:pointer;font-weight:bold">' + t + '</button>';
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const recibos = (pg0.recibos || []).filter((x) => x.media);
  mostrar(
    '<div style="font-size:12px;color:#5b6b82;margin-bottom:6px">' + (nb ? '✅ Ficha Blue encontrada' : fichaZap ? '✅ Ficha do WhatsApp encontrada' : '⚠️ Sem ficha: usei os dados do contato') + ' · ' + esc(pg0.texto) + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#5b6b82">' +
    '<label style="grid-column:1/3">Nome completo<input id="ag-nome" ' + inp + ' value="' + esc(nomeCompleto) + '"></label>' +
    '<label>Telefone<input id="ag-tel" ' + inp + ' value="' + esc(tel) + '"></label>' +
    '<label>Tipo<select id="ag-tipo" ' + inp + '><option value="lip">Lipedema</option><option value="pla">Plástica</option></select></label>' +
    '<label>Local<select id="ag-local" ' + inp + '><option value="rj">Rio (Barra)</option><option value="sp">São Paulo</option><option value="tele">Teleconsulta</option></select></label>' +
    '<label>Médico<select id="ag-med" ' + inp + '><option value="rafael">Dr. Rafael</option><option value="leo">Dr. Leonardo</option></select></label>' +
    '<label>Data<input id="ag-data" type="date" ' + inp + ' value="' + iso + '"></label>' +
    '<label>Hora<input id="ag-hora" type="time" ' + inp + ' value="' + hora + '"></label>' +
    '<label>Pago (R$)<input id="ag-pago" inputmode="decimal" ' + inp + ' value="' + (pg0.pago || '') + '"></label>' +
    '<label>Valor da consulta (R$)<input id="ag-total" inputmode="decimal" ' + inp + ' value="' + (pg0.total || '') + '"></label>' +
    '<label style="grid-column:1/3">Como encontrou<input id="ag-como" ' + inp + ' value="' + esc(como) + '"></label>' +
    '<label style="grid-column:1/3">Objetivo da consulta<input id="ag-obj" ' + inp + ' value="' + esc(objetivo) + '"></label></div>' +
    (recibos.length ? '<div style="margin-top:8px;font-size:13px">🧾 Comprovante: ' + recibos.map((x) => '<a href="' + esc(x.media) + '" target="_blank" rel="noopener" style="color:#2f6fb5;font-weight:bold">' + new Date(x.ts * 1000).toLocaleDateString('pt-BR') + ' (abrir e salvar)</a>').join(' · ') + '</div>' : '') +
    '<div style="margin-top:10px;font-weight:bold;display:flex;justify-content:space-between;align-items:center">1. Mensagem para a paciente <select id="ag-lang" style="padding:3px 6px;border:1px solid #dbe4f0;border-radius:8px;font:12px Arial"><option value="pt">Português</option><option value="es">Espanhol</option><option value="en">Inglês</option></select></div>' + ta('ag-msg', 210) + '<div id="ag-pdf" style="display:none;margin:6px 0;padding:6px 8px;background:#fff6e5;border-radius:8px;font-size:12px">📎 Teleconsulta: depois da mensagem, anexe o <b>PDF de fotos</b> na conversa.</div>' + btn('ag-c0', 'Copiar mensagem para a paciente', '#1f7d52') +
    '<div style="margin-top:10px;font-weight:bold">2. Grupo de comprovantes</div>' + ta('ag-grupo', 150) + btn('ag-c1', 'Copiar texto do grupo') +
    '<div style="margin-top:10px;font-weight:bold">3. TimeTree</div><input id="ag-tt" ' + inp + '>' + btn('ag-c2', 'Copiar título', '#2f6fb5') + ta('ag-desc', 120) + btn('ag-c3', 'Copiar descrição', '#2f6fb5') +
    '<div id="ag-ok" style="font-size:12px;color:#1f7d52;margin-top:6px;min-height:16px"></div>');
  const $ = (s) => box.querySelector(s);
  $('#ag-tipo').value = tipo; $('#ag-local').value = local; $('#ag-med').value = medico; $('#ag-lang').value = lang;

  const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SEM = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (v) => Number(String(v || '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || 0;
  const END = {
    rj: 'Av. José Silva de Azevedo Neto, 200 - SL 107/108 - Bloco 7 - Barra da Tijuca, Rio de Janeiro - RJ',
    sp: 'Alameda Campinas, 977 - 8º andar / conjunto 82 - Jardim Paulista, São Paulo - SP',
  };
  const SEML = { pt: SEM, es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
  const agora = () => { const d = new Date(); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' às ' + pad(d.getHours()) + 'h' + pad(d.getMinutes()); };
  // Teleconsulta: aviso do PDF de fotos (a equipe anexa o PDF logo depois da mensagem)
  const FOTOS = {
    pt: (v) => '📸 Em seguida te envio um PDF com o passo a passo das fotos para a teleconsulta. Peço que envie as fotos por aqui ' + (v ? 'até ' + v : 'até o dia anterior à consulta') + ' (biquíni ou roupa íntima preta, ambiente bem iluminado, corpo inteiro e sem filtros). Elas ficam guardadas com sigilo no seu prontuário.',
    es: (v) => '📸 A continuación te envío un PDF con el paso a paso de las fotos para la teleconsulta. Por favor, envíalas por aquí ' + (v ? 'hasta el ' + v : 'hasta el día anterior a la consulta') + ' (bikini o ropa interior negra, lugar bien iluminado, cuerpo entero y sin filtros). Se guardan con total confidencialidad en tu historia clínica.',
    en: (v) => '📸 Next I will send you a PDF with the step-by-step photos for your online consultation. Please send the photos here ' + (v ? 'by ' + v : 'by the day before your consultation') + ' (black bikini or underwear, well-lit room, full body, no filters). They are stored confidentially in your medical record.',
  };
  const juntar = (linhas) => linhas.filter((x) => x !== null).filter((x, i, a) => x !== '' || (i > 0 && a[i - 1] !== '')).join('\n');
  // Mensagem "consulta agendada" com o link fixo da pré-consulta (ou o agradecimento, se a ficha já chegou)
  const mensagem = ({ nome, t, l, med, dia, dd, m, h, pago, total, lg }) => {
    const primeiro = nome.split(/\s+/)[0] || '';
    const dr = med === 'leo' ? 'Dr. Leonardo' : 'Dr. Rafael Erthal';
    const quando = dia ? SEML[lg][dia.getDay()] + ', ' + pad(dd) + '/' + pad(m) : '[dia]';
    const hora = h ? (lg === 'pt' ? h : h.replace('h', ':')) : '[hora]';
    const link = SITE + (t === 'pla' ? '/plastica' : '/lipedema') + (lg === 'pt' ? '' : '/' + lg);
    const falta = total && pago && pago < total ? total - pago : 0;
    const temFicha = !!(nb || fichaZap);
    const vesp = dia ? new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() - 1) : null;
    const fotos = l === 'tele' ? FOTOS[lg](vesp ? pad(vesp.getDate()) + '/' + pad(vesp.getMonth() + 1) : '') : '';
    if (lg === 'es') return juntar([
      '¡Perfecto, ' + primeiro + '! 💙', '', 'Tu ' + (l === 'tele' ? 'teleconsulta' : 'consulta') + ' con el ' + dr + ' está agendada:',
      '🗓️ ' + quando + ', a las *' + hora + '* (hora de Brasilia)',
      l === 'tele' ? '💻 Por Google Meet. Cerca del horario, nuestra concierge Helen te enviará el enlace.' : '📍 ' + END[l],
      pago ? (falta ? '💳 Recibimos tu pago de ' + brl(pago) + ' (reserva). El saldo de ' + brl(falta) + ' se paga el día de la consulta.' : '💳 Pago recibido (' + brl(pago) + '). ¡Gracias!') : '',
      fotos ? '' : null, fotos || null,
      '', temFicha ? 'Ya recibimos tu ficha de pre-consulta, ¡gracias! 🙏' : 'Para que el ' + dr + ' llegue a tu consulta conociendo tu historia, completa tu ficha de pre-consulta (toma unos 6 minutos). Es nuestro formulario oficial y seguro:\n👉 ' + link,
      '', 'Cualquier duda, estoy aquí.']);
    if (lg === 'en') return juntar([
      'Perfect, ' + primeiro + '! 💙', '', 'Your ' + (l === 'tele' ? 'online consultation' : 'consultation') + ' with ' + dr + ' is booked:',
      '🗓️ ' + quando + ' at *' + hora + '* (Brasília time)',
      l === 'tele' ? '💻 On Google Meet. Our concierge Helen will send you the link close to the time.' : '📍 ' + END[l],
      pago ? (falta ? '💳 We received your payment of ' + brl(pago) + ' (deposit). The remaining ' + brl(falta) + ' is paid on the day of your consultation.' : '💳 Payment received (' + brl(pago) + '). Thank you!') : '',
      fotos ? '' : null, fotos || null,
      '', temFicha ? 'We have already received your pre-consultation form, thank you! 🙏' : 'So that ' + dr + ' can meet you already knowing your story, please fill in your pre-consultation form (about 6 minutes). It is our official, secure form:\n👉 ' + link,
      '', 'Any questions, I am here to help.']);
    return juntar([
      'Perfeito, ' + primeiro + '! 💙', '', 'Sua ' + (l === 'tele' ? 'teleconsulta' : 'consulta') + ' com o ' + dr + ' está agendada:',
      '🗓️ ' + quando + ', às *' + hora + '*',
      l === 'tele' ? '💻 Pelo Google Meet. Perto do horário, a nossa concierge Helen te envia o link.' : '📍 ' + END[l] + (l === 'sp' ? ' (estacionamento no local)' : ''),
      pago ? (falta ? '💳 Recebemos o seu pagamento de ' + brl(pago) + ' (reserva). Os ' + brl(falta) + ' restantes são pagos no dia da consulta.' : '💳 Pagamento recebido (' + brl(pago) + '). Muito obrigada!') : '',
      fotos ? '' : null, fotos || null,
      '', temFicha ? 'Já recebemos a sua ficha de pré-consulta, obrigada! 🙏' : 'Para o ' + dr + ' já chegar à sua consulta conhecendo a sua história, preencha a sua ficha de pré-consulta (leva uns 6 minutos). É o nosso formulário oficial e seguro:\n👉 ' + link,
      '', 'Qualquer dúvida, estou por aqui.']);
  };
  const gerar = () => {
    const nome = $('#ag-nome').value.trim(), t = $('#ag-tipo').value, l = $('#ag-local').value, med = $('#ag-med').value;
    const tipoTxt = t === 'pla' ? 'Plástica' : 'Lipedema';
    const [y, m, dd] = ($('#ag-data').value || '').split('-').map(Number);
    const dia = y ? new Date(y, m - 1, dd) : null;
    const h = $('#ag-hora').value ? $('#ag-hora').value.replace(':', 'h') : '';
    const pago = num($('#ag-pago').value), total = num($('#ag-total').value);
    const pct = total ? Math.round((pago / total) * 100) : 0;
    const pagTxt = !pago ? 'aguardando pagamento' : total && pago < total ? brl(pago) + ' de ' + brl(total) : brl(pago) + ' (integral)';
    const quem = med === 'leo' ? 'Dr. Leonardo' : 'Dr. Rafael';
    const consulta = (l === 'tele' ? 'Teleconsulta' : 'Consulta' + (l === 'sp' ? ' (SP)' : '')) + (med === 'leo' ? ' com o Dr. Leonardo' : '') + ' - ' + tipoTxt + ' 1x';
    const como2 = $('#ag-como').value.trim(), obj = $('#ag-obj').value.trim() || (t === 'pla' ? 'Avaliação de cirurgia plástica' : 'Avaliar lipedema');
    $('#ag-grupo').value = [nome, 'Tel: ' + $('#ag-tel').value.trim(), como2 ? 'Ind: ' + como2 : '', 'Objetivo: ' + obj, consulta,
      '🗓️ ' + (dia ? SEM[dia.getDay()] + ', ' + pad(dd) + '/' + pad(m) + '/' + y : '[dia]') + ' às ' + (h || '[hora]'),
      'Pagamento: ' + pagTxt,
      nb || fichaZap ? 'Dados recebidos ✅' : 'Aguardando envio de dados',
      'Agendado em ' + agora()].filter(Boolean).join('\n');
    const curto = nome.split(/\s+/).filter(Boolean); const nomeCurto = curto.length > 1 ? curto[0] + ' ' + curto[curto.length - 1] : nome;
    $('#ag-pdf').style.display = l === 'tele' ? 'block' : 'none';
    $('#ag-msg').value = mensagem({ nome, t, l, med, dia, dd, m, h, pago, total, lg: $('#ag-lang').value });
    $('#ag-tt').value = (l === 'tele' ? '(Tele) ' : l === 'sp' ? '(SP) ' : '') + (med === 'leo' ? '(Dr. Leonardo) ' : '') + nomeCurto + ' - ' + tipoTxt;
    $('#ag-desc').value = ['Nome completo: ' + nome, 'Tel: ' + $('#ag-tel').value.trim(), 'Como encontrou o ' + quem + ': ' + (como2 || '-'), 'Objetivo da consulta: ' + obj,
      'Tipo da consulta: ' + (l === 'tele' ? 'Teleconsulta' : l === 'sp' ? 'Presencial São Paulo' : 'Presencial Rio (Barra)') + ' - ' + tipoTxt + (dia ? ' · ' + pad(dd) + '/' + pad(m) + ' (' + SEM[dia.getDay()] + ')' + (h ? ' às ' + h : '') : ''),
      'Pagamento: ' + (pago ? (pct ? pct + '% · ' : '') + pagTxt : 'aguardando pagamento')].join('\n');
  };
  const copiar = async (t, q) => {
    try { await navigator.clipboard.writeText(t); $('#ag-ok').textContent = '✅ ' + q + ' copiado. Cole no lugar certo (Ctrl+V / ⌘V).'; }
    catch (e) { $('#ag-ok').textContent = 'Selecione o texto e aperte Ctrl+C (⌘C no Mac).'; }
  };
  // Trocar local ou médico muda o valor da consulta (Rio R$ 1.800, SP R$ 2.200, Dr. Leonardo pelo valor da conversa)
  const revalor = () => {
    const p = avaliarPagamento({ price: Number(lead.price) || 0, pagoEm: Number(cf(CAMPO_PAGAMENTO).value) || null, notas, msgs, local: $('#ag-med').value === 'leo' ? '' : $('#ag-local').value });
    $('#ag-pago').value = p.pago || ''; $('#ag-total').value = p.total || '';
  };
  ['#ag-local', '#ag-med'].forEach((s2) => $(s2).addEventListener('change', revalor));
  box.querySelectorAll('input,select').forEach((el) => el.addEventListener('input', gerar));
  box.querySelectorAll('select').forEach((el) => el.addEventListener('change', gerar));
  $('#ag-c0').onclick = () => copiar($('#ag-msg').value, 'Mensagem para a paciente');
  $('#ag-c1').onclick = () => copiar($('#ag-grupo').value, 'Texto do grupo');
  $('#ag-c2').onclick = () => copiar($('#ag-tt').value, 'Título do TimeTree');
  $('#ag-c3').onclick = () => copiar($('#ag-desc').value, 'Descrição do TimeTree');
  gerar();
})();
