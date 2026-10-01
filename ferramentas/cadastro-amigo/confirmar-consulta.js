// Botão "Confirmar consulta" — use com o lead aberto no Kommo, 1 ou 2 dias antes da consulta.
// Monta a mensagem de confirmação (nome, dia da semana, hora, endereço certo) e as mensagens de apoio para copiar:
// presencial → orientações da bioimpedância; teleconsulta → pedido das fotos (e lembrete de anexar o PDF); termo → texto + link do DocSignature.
(async () => {
  /*PAGAMENTO*/
  const CAMPO_PAGAMENTO = 3728960;
  const CAMPO_CONSULTA = 3728948, CAMPO_MODALIDADE = 3837322, CAMPO_PRIMEIRO_NOME = 3837314;
  const id = (location.pathname.match(/leads\/detail\/(\d+)/) || [])[1];
  let nome = '', quando = null, modalidade = '', lang = 'pt', price = 0, pagoEm = null;
  if (id) {
    try {
      const j = await (await fetch('/api/v4/leads/' + id + '?with=contacts', { credentials: 'include' })).json();
      const cf = (fid) => ((j.custom_fields_values || []).find((f) => f.field_id === fid) || { values: [{}] }).values[0];
      const v = cf(CAMPO_CONSULTA).value; if (v) quando = new Date(Number(v) * 1000);
      modalidade = String(cf(CAMPO_MODALIDADE).value || '');
      nome = String(cf(CAMPO_PRIMEIRO_NOME).value || '');
      price = Number(j.price) || 0; pagoEm = Number(cf(CAMPO_PAGAMENTO).value) || null;
      const ct = j._embedded && j._embedded.contacts && j._embedded.contacts[0];
      if (ct) {
        const c = await (await fetch('/api/v4/contacts/' + ct.id, { credentials: 'include' })).json();
        if (!nome) nome = (c.first_name || c.name || '').trim().split(/\s+/)[0];
        const tel = String(((c.custom_fields_values || []).find((f) => f.field_code === 'PHONE') || { values: [{}] }).values[0].value || '');
        const dg = tel.replace(/\D/g, '');
        if (/^\+/.test(tel.trim()) && !dg.startsWith('55')) lang = /^(54|598|595|56|591|57|51|58|593|52|34|50\d)/.test(dg) ? 'es' : 'en';
      }
    } catch (e) { /* preenche à mão */ }
  }
  // Pagamento: nota dos comprovantes + conversa (só leitura, com a sua sessão)
  const notas = [], msgs = [];
  if (id) {
    try {
      const n = await (await fetch('/api/v4/leads/' + id + '/notes?limit=100&order[id]=desc', { credentials: 'include' })).json();
      for (const x of (n && n._embedded && n._embedded.notes) || []) notas.push({ ts: x.created_at, text: (x.params && x.params.text) || '' });
    } catch (e) { /* sem notas */ }
    try {
      let url = location.origin + '/ajax/v3/leads/' + id + '/events_timeline?limit=100', pag = 0;
      while (url && pag < 15) {
        const r = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }, credentials: 'include' });
        if (!r.ok) break;
        const j = await r.json();
        const items = (j._embedded && j._embedded.items) || [];
        for (const it of items) {
          const m = it.data && typeof it.data.message === 'object' && it.data.message;
          if ((it.type === 89 || it.type === 90) && m) msgs.push({ t: it.type, ts: it.date_create, tipo: m.type || 'text', texto: m.text || '' });
        }
        let prev = j._links && j._links.prev; prev = prev && typeof prev === 'object' ? prev.href : prev;
        url = prev && items.length ? new URL(prev, location.origin).href : null;
        pag++;
      }
    } catch (e) { /* sem conversa */ }
  }
  let pg = null;
  nome = nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : '';
  const pad = (n) => String(n).padStart(2, '0');
  const iso = quando ? quando.getFullYear() + '-' + pad(quando.getMonth() + 1) + '-' + pad(quando.getDate()) : '';
  const hora = quando ? pad(quando.getHours()) + ':' + pad(quando.getMinutes()) : '';
  let local = /tele/i.test(modalidade) ? 'tele' : /paulo|sp\b/i.test(modalidade) ? 'sp' : 'rj';
  // Modalidade sem cidade no Kommo: descobre o local pela conversa. Cidade/endereço citados valem mais que o valor
  // (a mensagem padrão de pagamento às vezes sai com R$ 1.800 mesmo para SP).
  let localDeduzido = '';
  if (!/tele|paulo|\bsp\b|rio|\brj\b|barra/i.test(modalidade)) {
    let porCidade = '', porValor = '';
    for (const m of msgs.filter((x) => x.t === 90).sort((a, b) => a.ts - b.ts)) {
      const t = m.texto || '';
      if (/cirurgi|\bmil\b/i.test(t)) continue;
      if (/teleconsulta|google meet|consulta (online|on-line)/i.test(t)) porCidade = 'tele';
      else if (/alameda campinas|jardim paulista|(consulta|investimento|atendimento|agenda)[^\n]{0,120}s[aã]o paulo/i.test(t)) porCidade = 'sp';
      else if (/jos[eé] silva de azevedo|barra da tijuca|(consulta|investimento|atendimento|agenda)[^\n]{0,120}rio de janeiro/i.test(t)) porCidade = 'rj';
      else if (/2\.?200/.test(t)) porValor = 'sp';
      else if (/1\.?800/.test(t)) porValor = 'rj';
    }
    localDeduzido = porCidade || porValor;
    if (localDeduzido) local = localDeduzido;
  }

  const END = {
    rj: 'Av. José Silva de Azevedo Neto, 200 - SL 107/108 - Bloco 7 - Barra da Tijuca, Rio de Janeiro - RJ, 22775-056, Brasil',
    sp: 'Alameda Campinas, 977 - 8º andar / conjunto 82 - Jardim Paulista, São Paulo - SP (estacionamento terceirizado no local)',
  };
  const SEM = { pt: ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'], es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
  /*BIO*/
  const FOTOS = {
    pt: (prazo) => '*📸 Fotos para a sua teleconsulta*\n' +
      'Para a avaliação, o Dr. Rafael precisa de algumas fotos suas. Estou te enviando um PDF com o passo a passo das posições.\n\n' +
      'Peço, por gentileza, que envie as fotos por aqui ' + (prazo || 'até o dia anterior à consulta') + '.\n' +
      '• Use biquíni ou roupa íntima *preta* de modelo menor;\n• Ambiente bem iluminado e fundo neutro (parede lisa);\n• Corpo inteiro no enquadramento, sem filtros.\n\n' +
      'As fotos ficam guardadas com sigilo no seu prontuário. Qualquer dúvida estou à disposição 💙',
    es: (prazo) => '*📸 Fotos para tu teleconsulta*\n' +
      'Para la evaluación, el Dr. Rafael necesita algunas fotos tuyas. Te envío un PDF con el paso a paso de las posiciones.\n\n' +
      'Por favor, envíanos las fotos por aquí ' + (prazo || 'hasta el día anterior a la consulta') + '.\n' +
      '• Usa bikini o ropa interior *negra* de modelo pequeño;\n• Lugar bien iluminado y fondo neutro (pared lisa);\n• Cuerpo entero en la foto, sin filtros.\n\n' +
      'Las fotos se guardan con total confidencialidad en tu historia clínica. Cualquier duda, estoy a tu disposición 💙',
    en: (prazo) => '*📸 Photos for your online consultation*\n' +
      'For the assessment, Dr. Rafael needs a few photos of you. I am sending you a PDF with the step-by-step positions.\n\n' +
      'Please send the photos here ' + (prazo || 'by the day before your consultation') + '.\n' +
      '• Wear a *black* bikini or small black underwear;\n• Well-lit room with a plain background;\n• Full body in the frame, no filters.\n\n' +
      'Your photos are stored confidentially in your medical record. Any questions, I am here to help 💙',
  };
  const TERMO_L = {
    pt: 'Estou encaminhando o termo de consentimento para autorização do uso e armazenamento dos seus dados pessoais, exclusivamente para fins de atendimento, prontuário, contato e procedimentos relacionados ao acompanhamento profissional. Qualquer dúvida estou à disposição 💙',
    es: 'Te envío el término de consentimiento para autorizar el uso y almacenamiento de tus datos personales, exclusivamente para fines de atención, historia clínica, contacto y procedimientos relacionados con el seguimiento profesional. Para firmarlo, solo tienes que abrir el enlace. Cualquier duda, estoy a tu disposición 💙',
    en: 'I am sending you the consent form authorizing the use and storage of your personal data, exclusively for care, medical records, contact and procedures related to your follow-up. To sign it, just open the link. Any questions, I am here to help 💙',
  };
  const prazoFotos = (l, d) => {
    if (!d) return '';
    // prazo = véspera da consulta; se a véspera já é hoje (ou passou), pede ainda hoje
    const [y, m, dd] = d.split('-').map(Number), v = new Date(y, m - 1, dd - 1), hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    if (v <= hoje) return { pt: 'ainda hoje, se possível', es: 'hoy mismo, si es posible', en: 'today, if possible' }[l];
    const dm = pad(v.getDate()) + '/' + pad(v.getMonth() + 1) + ' (' + SEM[l][v.getDay()] + ')';
    return { pt: 'até ', es: 'hasta el ', en: 'by ' }[l] + dm;
  };

  const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const SEGUNDA = {
    pt: (v) => '\nPodemos aproveitar e já concluir a segunda parte do seu pagamento' + (v ? ' (' + brl(v) + ')' : '') + '? Te envio a chave Pix ou o link do cartão, como preferir. 💙\n',
    es: (v) => '\n¿Aprovechamos para completar la segunda parte de tu pago' + (v ? ' (' + brl(v) + ')' : '') + '? Te envío los datos de Pix o el enlace para tarjeta, como prefieras. 💙\n',
    en: (v) => '\nCould we also complete the second part of your payment' + (v ? ' (' + brl(v) + ')' : '') + '? I can send you the Pix details or a card payment link, whichever you prefer. 💙\n',
  };
  const montar = (l, n, d, h, loc, exames, falta) => {
    let quandoTxt = '', horaTxt = '';
    if (d) {
      const [y, m, dd] = d.split('-').map(Number);
      const dia = new Date(y, m - 1, dd), hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const dif = Math.round((dia - hoje) / 864e5), dm = pad(dd) + '/' + pad(m), sem = SEM[l][dia.getDay()];
      const rel = { pt: ['hoje', 'amanhã'], es: ['hoy', 'mañana'], en: ['today', 'tomorrow'] }[l];
      quandoTxt = (dif === 0 || dif === 1 ? rel[dif] + ' ' : (l === 'pt' ? 'no dia ' : l === 'es' ? 'el día ' : 'on ')) + dm + ' (' + sem + ')';
    }
    if (h) horaTxt = l === 'pt' ? h.replace(':', 'h') : h + (l === 'en' ? ' (Brasília time)' : ' (hora de Brasilia)');
    if (l === 'pt') {
      return 'Olá, ' + (n || '[nome]') + '! Como você está? 😊\n\n' +
        'Gostaria de confirmar a sua ' + (loc === 'tele' ? 'teleconsulta' : 'consulta') + ' com o Dr. Rafael Erthal, ' + (quandoTxt || '[dia]') + ', às *' + (horaTxt || '[hora]') + '*?\n' +
        (loc === 'tele' ? 'A consulta é online, pelo Google Meet. Perto do horário, a nossa concierge Helen te envia o link. 💻\n'
          : '📍 Endereço: ' + END[loc] + '\n') +
        (exames ? '\nAproveitando, consegue me enviar o resultado dos seus exames por aqui? Assim já deixamos tudo no seu prontuário. 💙\n' : '') +
        (falta !== null ? SEGUNDA.pt(falta) : '') +
        (loc !== 'tele' ? '\nEm seguida, enviarei as orientações para a realização do seu exame de bioimpedância. Peço, por gentileza, que leia as instruções com atenção para garantir um resultado mais preciso.'
          : '\nEm seguida, enviarei o guia em PDF para as fotos da sua avaliação. 📸');
    }
    if (l === 'es') {
      return '¡Hola, ' + (n || '[nombre]') + '! ¿Cómo estás? 😊\n\n' +
        '¿Podemos confirmar tu ' + (loc === 'tele' ? 'teleconsulta' : 'consulta') + ' con el Dr. Rafael Erthal, ' + (quandoTxt || '[día]') + ', a las *' + (horaTxt || '[hora]') + '*?\n' +
        (loc === 'tele' ? 'La consulta es online, por Google Meet. Cerca del horario, nuestra concierge Helen te enviará el enlace. 💻\n' : '📍 Dirección: ' + END[loc].replace('estacionamento terceirizado no local', 'estacionamiento en el lugar') + '\n') +
        (exames ? '\n¿Podrías enviarnos por aquí los resultados de tus exámenes? Así los guardamos en tu historia clínica. 💙\n' : '') +
        (falta !== null ? SEGUNDA.es(falta) : '') +
        (loc === 'tele' ? '\nEn seguida te envío la guía en PDF para las fotos de tu evaluación. 📸' : '\nEn seguida te envío las indicaciones para tu examen de bioimpedancia. Te pido que las leas con atención para que el resultado sea más preciso.');
    }
    return 'Hi, ' + (n || '[name]') + '! How are you? 😊\n\n' +
      'Could you please confirm your ' + (loc === 'tele' ? 'online consultation' : 'consultation') + ' with Dr. Rafael Erthal ' + (quandoTxt || '[day]') + ' at *' + (horaTxt || '[time]') + '*?\n' +
      (loc === 'tele' ? 'It will take place on Google Meet. Our concierge Helen will send you the link close to the time. 💻\n' : '📍 Address: ' + END[loc].replace('estacionamento terceirizado no local', 'parking available on site') + '\n') +
      (exames ? '\nCould you also send us your test results here, so we can add them to your medical record? 💙\n' : '') +
      (falta !== null ? SEGUNDA.en(falta) : '') +
      (loc === 'tele' ? '\nNext, I will send you the PDF guide for the photos for your assessment. 📸' : '\nNext, I will send you the instructions for your bioimpedance test. Please read them carefully so the result is as accurate as possible.');
  };

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:400px;max-height:90vh;overflow:auto;background:#fff;color:#13294a;border:2px solid #2e9e5f;border-radius:14px;padding:16px;font:14px/1.45 Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)';
  const inp = 'style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #dbe4f0;border-radius:8px;font:13px Arial"';
  const CORES = { integral: ['#e9f6ef', '#1f7d52', '✅'], falta: ['#faf1e2', '#a46d1c', '🟠'], conferir: ['#fff7d6', '#8a6d00', '⚠️'], sem_pagamento: ['#fbeceb', '#b04848', '⛔'] };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  box.innerHTML = '<div style="font-weight:bold;font-size:15px;margin-bottom:8px">✅ Confirmar consulta</div>' +
    '<div id="cf-pgbox" style="border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:13px"><div id="cf-pginfo"></div>' +
    '<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:8px;margin-top:8px;color:#5b6b82;font-size:12px">' +
    '<label>Na mensagem<select id="cf-pag" ' + inp + '><option value="integral">Pago integral (não falar de pagamento)</option><option value="falta">Pedir a segunda parte</option><option value="nao">Não confirmei ainda</option></select></label>' +
    '<label>Valor que falta<input id="cf-falta" inputmode="decimal" ' + inp + ' value=""></label></div></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:#5b6b82">' +
    '<label>Primeiro nome<input id="cf-nome" ' + inp + ' value="' + nome.replace(/"/g, '') + '"></label>' +
    '<label>Idioma<select id="cf-lang" ' + inp + '><option value="pt">Português</option><option value="es">Espanhol</option><option value="en">Inglês</option></select></label>' +
    '<label>Data<input id="cf-data" type="date" ' + inp + ' value="' + iso + '"></label>' +
    '<label>Hora<input id="cf-hora" type="time" ' + inp + ' value="' + hora + '"></label>' +
    '<label>Local<select id="cf-local" ' + inp + '><option value="rj">Rio (Barra)</option><option value="sp">São Paulo (Jardins)</option><option value="tele">Teleconsulta</option></select></label>' +
    '<label style="align-self:end"><input id="cf-exames" type="checkbox" checked> Pedir resultado dos exames</label>' +
    '<label style="grid-column:1/3">Link do termo (DocSignature)<input id="cf-link" placeholder="cole aqui o link do termo" ' + inp + '></label></div>' +
    '<textarea id="cf-msg" style="width:100%;box-sizing:border-box;height:200px;margin-top:10px;font:13px/1.4 Arial;border:1px solid #dbe4f0;border-radius:8px;padding:8px"></textarea>' +
    '<div style="display:grid;gap:6px;margin-top:8px">' +
    '<button id="cf-c1" style="border:0;background:#13294a;color:#fff;border-radius:8px;padding:9px;cursor:pointer;font-weight:bold">1. Copiar confirmação</button>' +
    '<button id="cf-c2" style="border:0;background:#e9f6ef;color:#1f7d52;border-radius:8px;padding:9px;cursor:pointer;font-weight:bold">2. Copiar orientações da bioimpedância</button>' +
    '<button id="cf-c3" style="border:0;background:#eaf2fb;color:#2f6fb5;border-radius:8px;padding:9px;cursor:pointer;font-weight:bold">3. Copiar termo com o link</button></div>' +
    '<div id="cf-ok" style="font-size:12px;color:#1f7d52;margin-top:6px;min-height:16px"></div>' +
    '<div style="text-align:right"><button id="cf-x" style="border:0;background:#eaf2fb;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>';
  document.body.appendChild(box);
  const $ = (s) => box.querySelector(s);
  $('#cf-lang').value = lang; $('#cf-local').value = local;
  // O valor da consulta depende do local (Rio R$ 1.800, SP R$ 2.200): recalcula quando o local muda.
  const avaliar = () => {
    pg = avaliarPagamento({ price, pagoEm, notas, msgs, local: $('#cf-local').value });
    if (localDeduzido && $('#cf-local').value === localDeduzido) pg.provas.unshift('Local tirado da conversa (o campo Modalidade está sem cidade): ' + { rj: 'Rio', sp: 'São Paulo', tele: 'teleconsulta' }[localDeduzido] + '. Confira.');
    const cor = CORES[pg.status];
    $('#cf-pgbox').style.background = cor[0]; $('#cf-pgbox').style.color = cor[1];
    $('#cf-pginfo').innerHTML = '<b>' + cor[2] + ' Pagamento:</b> ' + esc(pg.texto) +
      (pg.provas.length ? '<details style="margin-top:6px;color:#3a4760"><summary style="cursor:pointer">Ver de onde tirei isso</summary><ul style="margin:6px 0 0;padding-left:18px">' + pg.provas.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></details>' : '');
    $('#cf-pag').value = pg.status === 'integral' ? 'integral' : pg.status === 'falta' ? 'falta' : pg.sugestao || 'nao';
    $('#cf-falta').value = pg.falta ? String(pg.falta).replace('.', ',') : '';
  };
  avaliar();
  $('#cf-local').addEventListener('change', avaliar);
  const gerar = () => {
    const l = $('#cf-lang').value, loc = $('#cf-local').value;
    const pede = $('#cf-pag').value === 'falta';
    $('#cf-falta').parentElement.style.visibility = pede ? '' : 'hidden';
    const falta = pede ? Number(String($('#cf-falta').value).replace(/\./g, '').replace(',', '.')) || 0 : null;
    $('#cf-msg').value = montar(l, $('#cf-nome').value.trim(), $('#cf-data').value, $('#cf-hora').value, loc, $('#cf-exames').checked, falta);
    // presencial: bioimpedância; teleconsulta: pedido das fotos (os dois em PT/ES/EN)
    $('#cf-c2').textContent = loc === 'tele' ? '2. Copiar pedido das fotos (depois anexe o PDF)' : '2. Copiar orientações da bioimpedância';
  };
  const copiar = async (t, qual, extra) => {
    try { await navigator.clipboard.writeText(t); $('#cf-ok').textContent = '✅ ' + qual + ' copiada. Cole no chat (Ctrl+V).' + (extra ? ' ' + extra : ''); }
    catch (e) { const ta = $('#cf-msg'); ta.value = t; ta.focus(); ta.select(); $('#cf-ok').textContent = 'Selecionei o texto: aperte Ctrl+C.'; }
  };
  ['#cf-nome', '#cf-data', '#cf-hora', '#cf-falta'].forEach((s) => $(s).addEventListener('input', gerar));
  ['#cf-lang', '#cf-local', '#cf-exames', '#cf-pag'].forEach((s) => $(s).addEventListener('change', gerar));
  // Trava contra erro: sem pagamento conferido, o primeiro clique só avisa.
  let avisou = false;
  $('#cf-c1').onclick = () => {
    if ($('#cf-pag').value === 'nao' && !avisou) {
      avisou = true; $('#cf-ok').style.color = '#b04848';
      $('#cf-ok').textContent = 'O pagamento não está conferido. Escolha "Pago integral" ou "Pedir a segunda parte" acima, ou clique de novo para copiar assim mesmo.';
      return;
    }
    $('#cf-ok').style.color = '#1f7d52';
    copiar($('#cf-msg').value, 'Confirmação');
  };
  $('#cf-c2').onclick = () => {
    const l = $('#cf-lang').value;
    if ($('#cf-local').value === 'tele') copiar(FOTOS[l](prazoFotos(l, $('#cf-data').value)), 'Mensagem das fotos', '📎 Agora anexe o PDF das fotos no chat.');
    else copiar(BIO[l], 'Orientação');
  };
  $('#cf-c3').onclick = () => {
    const link = $('#cf-link').value.trim();
    if (!/^https?:\/\//i.test(link)) { $('#cf-ok').style.color = '#b42318'; $('#cf-ok').textContent = 'Cole primeiro o link do termo do DocSignature no campo acima.'; $('#cf-link').focus(); return; }
    $('#cf-ok').style.color = '#1f7d52';
    copiar(TERMO_L[$('#cf-lang').value] + '\n\n👉 ' + link, 'Mensagem do termo');
  };
  $('#cf-x').onclick = () => box.remove();
  gerar();
})();
