// Botão "Mensagem do exame" — use com o lead aberto no Kommo, depois de gerar o pedido de exame.
// Monta a mensagem com o primeiro nome, a data da consulta e o prazo para enviar os resultados (10 dias antes).
(async () => {
  const CAMPO_CONSULTA = 3728948, CAMPO_MODALIDADE = 3837322, CAMPO_PRIMEIRO_NOME = 3837314;
  const id = (location.pathname.match(/leads\/detail\/(\d+)/) || [])[1];
  let nome = '', quando = null, modalidade = '', ddi = '55';
  if (id) {
    try {
      const j = await (await fetch('/api/v4/leads/' + id + '?with=contacts', { credentials: 'include' })).json();
      const cf = (fid) => ((j.custom_fields_values || []).find((f) => f.field_id === fid) || { values: [{}] }).values[0];
      const v = cf(CAMPO_CONSULTA).value; if (v) quando = new Date(Number(v) * 1000);
      modalidade = (cf(CAMPO_MODALIDADE).value || '') + '';
      nome = (cf(CAMPO_PRIMEIRO_NOME).value || '') + '';
      const ct = j._embedded && j._embedded.contacts && j._embedded.contacts[0];
      if (ct) {
        const c = await (await fetch('/api/v4/contacts/' + ct.id, { credentials: 'include' })).json();
        if (!nome) nome = (c.first_name || c.name || '').trim().split(/\s+/)[0];
        const tel = ((c.custom_fields_values || []).find((f) => f.field_code === 'PHONE') || { values: [{}] }).values[0].value || '';
        const dg = String(tel).replace(/\D/g, '');
        if (/^\+/.test(String(tel).trim()) && !dg.startsWith('55')) ddi = /^(54|598|595|56|591|57|51|58|593|52|34|506|507|502|503|504|505)/.test(dg) ? 'es' : 'en';
      }
    } catch (e) { /* preenche à mão na caixinha */ }
  }
  nome = nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : '';
  const pad = (n) => String(n).padStart(2, '0');
  const iso = quando ? quando.getFullYear() + '-' + pad(quando.getMonth() + 1) + '-' + pad(quando.getDate()) : '';
  const hora = quando ? pad(quando.getHours()) + ':' + pad(quando.getMinutes()) : '';
  const tele = /tele/i.test(modalidade);

  const TXT = {
    pt: (n, dataBr, horaTxt, prazo, perto, ehTele) =>
      'Oi, ' + (n || '[nome]') + '! Tudo bem? 💙\n\n' +
      'Segue o seu pedido de exames para a ' + (ehTele ? 'teleconsulta' : 'consulta') + ' com o Dr. Rafael Erthal' + (dataBr ? ', no dia *' + dataBr + (horaTxt ? ' às ' + horaTxt.replace(':', 'h').replace(/h00$/, 'h') : '') + '*' : '') + '.\n\n' +
      'Para a sua avaliação ser a mais completa possível:\n' +
      '♡ Realize todos os exames solicitados pelo Dr. Rafael;\n' +
      (perto ? '♡ Envie os resultados por aqui *o quanto antes*, até *' + prazo + '*, para salvarmos no seu prontuário;\n'
             : '♡ Envie os resultados por aqui até *' + prazo + '* (10 dias antes da consulta), para salvarmos no seu prontuário;\n') +
      '♡ Se tiver algum exame de imagem feito há menos de 12 meses, pode nos enviar o resultado, sem precisar repetir;\n' +
      '♡ O laboratório vai te orientar sobre o jejum e o preparo de cada exame;\n' +
      '♡ Se quiser antecipar sua consulta caso abra uma vaga, é só nos avisar e já ir adiantando os exames.\n\n' +
      (ehTele ? 'A teleconsulta acontece pelo Google Meet. Perto do horário, a nossa concierge Helen te envia o link. 💻\n\n' : '') +
      'Qualquer dúvida, estou por aqui! 💙',
    en: (n, dataBr, horaTxt, prazo, perto, ehTele) =>
      'Hi, ' + (n || '[name]') + '! I hope you are well 💙\n\n' +
      'Here is your lab test request for your ' + (ehTele ? 'online consultation' : 'consultation') + ' with Dr. Rafael Erthal' + (dataBr ? ' on *' + dataBr + (horaTxt ? ' at ' + horaTxt + ' (Brasília time)' : '') + '*' : '') + '.\n\n' +
      'To make your evaluation as complete as possible:\n' +
      '♡ Please complete all the tests requested by Dr. Rafael;\n' +
      (perto ? '♡ Send us the results here *as soon as possible*, by *' + prazo + '*, so we can add them to your medical record;\n'
             : '♡ Send us the results here by *' + prazo + '* (10 days before your consultation), so we can add them to your medical record;\n') +
      '♡ If you have any imaging exams from the last 12 months, you can send us the results instead of repeating them;\n' +
      '♡ The laboratory will guide you on fasting and preparation for each test.\n\n' +
      (ehTele ? 'Your online consultation will take place on Google Meet. Our concierge Helen will send you the link close to the time. 💻\n\n' : '') +
      'If you have any questions, I am here for you! 💙',
  };
  TXT.es = (n, dataBr, horaTxt, prazo, perto, ehTele) =>
      '¡Hola, ' + (n || '[nombre]') + '! ¿Cómo estás? 💙\n\n' +
      'Te envío tu pedido de exámenes para la ' + (ehTele ? 'teleconsulta' : 'consulta') + ' con el Dr. Rafael Erthal' + (dataBr ? ', el día *' + dataBr + (horaTxt ? ' a las ' + horaTxt + ' (hora de Brasilia)' : '') + '*' : '') + '.\n\n' +
      'Para que tu evaluación sea lo más completa posible:\n' +
      '♡ Realiza todos los exámenes solicitados por el Dr. Rafael;\n' +
      (perto ? '♡ Envíanos los resultados por aquí *lo antes posible*, hasta el *' + prazo + '*, para guardarlos en tu historia clínica;\n'
             : '♡ Envíanos los resultados por aquí hasta el *' + prazo + '* (10 días antes de la consulta), para guardarlos en tu historia clínica;\n') +
      '♡ Si tienes algún examen de imagen de los últimos 12 meses, puedes enviarnos el resultado sin necesidad de repetirlo;\n' +
      '♡ El laboratorio te indicará el ayuno y la preparación de cada examen.\n\n' +
      (ehTele ? 'La teleconsulta se realiza por Google Meet. Cerca del horario, nuestra concierge Helen te enviará el enlace. 💻\n\n' : '') +
      '¡Cualquier duda, estoy aquí! 💙';
  /*BIO*/

  const box = document.createElement('div');
  box.id = 'blue-exame-box';
  box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:400px;max-height:90vh;overflow:auto;background:#fff;color:#13294a;border:2px solid #2f6fb5;border-radius:14px;padding:16px;font:14px/1.45 Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)';
  const inp = 'style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #dbe4f0;border-radius:8px;font:13px Arial"';
  box.innerHTML = '<div style="font-weight:bold;font-size:15px;margin-bottom:8px">💌 Mensagem do pedido de exame</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:#5b6b82">' +
    '<label>Primeiro nome<input id="bx-nome" ' + inp + ' value="' + nome.replace(/"/g, '') + '"></label>' +
    '<label>Idioma<select id="bx-lang" ' + inp + '><option value="pt">Português</option><option value="es"' + (ddi === 'es' ? ' selected' : '') + '>Espanhol</option><option value="en"' + (ddi === 'en' ? ' selected' : '') + '>Inglês</option></select></label>' +
    '<label>Data da consulta<input id="bx-data" type="date" ' + inp + ' value="' + iso + '"></label>' +
    '<label>Hora<input id="bx-hora" type="time" ' + inp + ' value="' + hora + '"></label>' +
    '<label style="grid-column:1/-1"><input id="bx-tele" type="checkbox"' + (tele ? ' checked' : '') + '> Teleconsulta (sem bioimpedância)</label></div>' +
    '<textarea id="bx-msg" style="width:100%;box-sizing:border-box;height:260px;margin-top:10px;font:13px/1.4 Arial;border:1px solid #dbe4f0;border-radius:8px;padding:8px"></textarea>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
    '<button id="bx-c1" style="flex:1;border:0;background:#13294a;color:#fff;border-radius:8px;padding:9px;cursor:pointer;font-weight:bold">Copiar mensagem</button>' +
    '<button id="bx-c2" style="flex:1;border:0;background:#e9f6ef;color:#1f7d52;border-radius:8px;padding:9px;cursor:pointer;font-weight:bold">Copiar orientações da bioimpedância</button></div>' +
    '<div id="bx-ok" style="font-size:12px;color:#1f7d52;margin-top:6px;min-height:16px"></div>' +
    '<div style="font-size:11px;color:#8a97a8">Mande primeiro o PDF do pedido, depois a mensagem. Na consulta presencial, mande também as orientações da bioimpedância.</div>' +
    '<div style="text-align:right;margin-top:8px"><button id="bx-x" style="border:0;background:#eaf2fb;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>';
  document.body.appendChild(box);
  const $ = (s) => box.querySelector(s);
  const gerar = () => {
    const d = $('#bx-data').value, h = $('#bx-hora').value, tele2 = $('#bx-tele').checked;
    let dataBr = '', prazo = '[data]', perto = false;
    if (d) {
      const [y, m, dd] = d.split('-').map(Number);
      const cons = new Date(y, m - 1, dd);
      dataBr = pad(dd) + '/' + pad(m);
      const lim = new Date(cons); lim.setDate(lim.getDate() - 10);
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      if (lim < hoje) { perto = true; const l2 = new Date(cons); l2.setDate(l2.getDate() - 2); prazo = pad(l2.getDate()) + '/' + pad(l2.getMonth() + 1); }
      else prazo = pad(lim.getDate()) + '/' + pad(lim.getMonth() + 1);
    }
    $('#bx-msg').value = TXT[$('#bx-lang').value]($('#bx-nome').value.trim(), dataBr, h, prazo, perto, tele2);
    $('#bx-c2').style.display = tele2 ? 'none' : '';
  };
  const copiar = async (texto) => {
    try { await navigator.clipboard.writeText(texto); $('#bx-ok').textContent = '✅ Copiado! Cole no chat da paciente (Ctrl+V).'; }
    catch (e) { const t = $('#bx-msg'); t.value = texto; t.focus(); t.select(); $('#bx-ok').textContent = 'Selecionei o texto: aperte Ctrl+C.'; }
  };
  ['#bx-nome', '#bx-data', '#bx-hora', '#bx-tele', '#bx-lang'].forEach((s) => $(s).addEventListener('input', gerar));
  $('#bx-tele').addEventListener('change', gerar); $('#bx-lang').addEventListener('change', gerar);
  $('#bx-c1').onclick = () => copiar($('#bx-msg').value);
  $('#bx-c2').onclick = () => copiar(BIO[$('#bx-lang').value]);
  $('#bx-x').onclick = () => box.remove();
  gerar();
})();
