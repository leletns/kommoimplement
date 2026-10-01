// Botão "Link da ficha" — use com o lead aberto no Kommo. Gera o link pessoal da Ficha Blue e a mensagem pronta para copiar.
// Na primeira vez pede o endereço do painel no Netlify e a senha do painel (ficam guardados só neste navegador).
(async () => {
  const id = (location.pathname.match(/leads\/detail\/(\d+)/) || [])[1];
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:400px;max-height:90vh;overflow:auto;background:#fff;color:#13294a;border:2px solid #2f6fb5;border-radius:14px;padding:16px;font:14px/1.45 Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)';
  document.body.appendChild(box);
  const inp = 'style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #dbe4f0;border-radius:8px;font:13px Arial"';
  const btn = (id, txt, cor) => '<button id="' + id + '" style="border:0;background:' + (cor || '#13294a') + ';color:#fff;border-radius:8px;padding:9px;cursor:pointer;font-weight:bold;width:100%;margin-top:8px">' + txt + '</button>';
  const fechar = '<div style="text-align:right;margin-top:8px"><button id="lf-x" style="border:0;background:#eaf2fb;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>';
  const $ = (s) => box.querySelector(s);
  const mostrar = (html) => { box.innerHTML = '<div style="font-weight:bold;font-size:15px;margin-bottom:8px">📝 Link da ficha</div>' + html + fechar; $('#lf-x').onclick = () => box.remove(); };
  if (!id) { mostrar('Abra o card da paciente no Kommo e clique de novo.'); return; }
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('blueFichaCfg') || '{}'); } catch (e) { cfg = {}; }
  if (!cfg.site || !cfg.senha) {
    mostrar('<div style="font-size:12px;color:#5b6b82">Só na primeira vez. Fica guardado neste navegador.</div>' +
      '<label style="display:block;margin-top:8px;font-size:12px">Endereço do painel (Netlify)<input id="lf-site" ' + inp + ' placeholder="https://….netlify.app" value="' + (cfg.site || '') + '"></label>' +
      '<label style="display:block;margin-top:8px;font-size:12px">Senha do painel<input id="lf-senha" type="password" ' + inp + '></label>' + btn('lf-salvar', 'Salvar e gerar link'));
    await new Promise((res) => { $('#lf-salvar').onclick = res; });
    cfg = { site: $('#lf-site').value.trim().replace(/\/+$/, ''), senha: $('#lf-senha').value };
    try { localStorage.setItem('blueFichaCfg', JSON.stringify(cfg)); } catch (e) { /* ok */ }
  }
  mostrar('Gerando o link…');
  let nome = '', lang = 'pt', ver = 'lip';
  try {
    const j = await (await fetch('/api/v4/leads/' + id + '?with=contacts', { credentials: 'include' })).json();
    nome = String(((j.custom_fields_values || []).find((f) => f.field_id === 3837314) || { values: [{}] }).values[0].value || '');
    if (/pl[aá]stic|mama|abdomin|lipo(?!ed)/i.test(JSON.stringify(j._embedded && j._embedded.tags || []) + ' ' + (j.name || ''))) ver = 'pla';
    const ct = j._embedded && j._embedded.contacts && j._embedded.contacts[0];
    if (ct) {
      const c = await (await fetch('/api/v4/contacts/' + ct.id, { credentials: 'include' })).json();
      if (!nome) nome = (c.first_name || c.name || '').trim().split(/\s+/)[0];
      const tel = String(((c.custom_fields_values || []).find((f) => f.field_code === 'PHONE') || { values: [{}] }).values[0].value || '');
      const dg = tel.replace(/\D/g, '');
      if (/^\+/.test(tel.trim()) && !dg.startsWith('55')) lang = /^(54|598|595|56|591|57|51|58|593|52|34|50\d)/.test(dg) ? 'es' : 'en';
    }
  } catch (e) { /* segue com o padrão */ }
  nome = nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : '';
  let url = '';
  try {
    const r = await fetch(cfg.site + '/api/ficha-link?lead=' + id, { headers: { 'x-painel-senha': cfg.senha } });
    if (r.status === 401) { try { localStorage.removeItem('blueFichaCfg'); } catch (e) { /* ok */ } mostrar('Senha do painel incorreta. Clique de novo no botão e digite a senha certa.'); return; }
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro || r.status);
    url = j.url;
  } catch (e) {
    try { localStorage.removeItem('blueFichaCfg'); } catch (e2) { /* ok */ }
    mostrar('Não consegui gerar o link (' + String(e.message || e).slice(0, 80) + '). Confira o endereço do painel e clique de novo.');
    return;
  }
  const montar = () => {
    const l = $('#lf-lang').value, v = $('#lf-ver').value, n = $('#lf-nome').value.trim();
    const link = url + (v === 'pla' || l !== 'pt' ? '?' + [v === 'pla' ? 'v=pla' : '', l !== 'pt' ? 'l=' + l : ''].filter(Boolean).join('&') : '');
    if (l === 'es') return '¡Hola' + (n ? ', ' + n : '') + '! 💙\nPara que el Dr. Rafael llegue a tu consulta conociendo tu historia, completa tu ficha (toma 3 minutos). Es un enlace solo tuyo y seguro:\n' + link;
    if (l === 'en') return 'Hi' + (n ? ', ' + n : '') + '! 💙\nSo Dr. Rafael can meet you already knowing your story, please fill in your form (takes 3 minutes). It is a secure link just for you:\n' + link;
    return 'Olá' + (n ? ', ' + n : '') + '! 💙\nPara o Dr. Rafael já chegar à sua consulta conhecendo a sua história, preencha a sua ficha (leva 3 minutos). É um link só seu e seguro:\n' + link + '\n\nAssim que você enviar, o seu cadastro fica pronto aqui na clínica.';
  };
  mostrar('<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:#5b6b82">' +
    '<label>Primeiro nome<input id="lf-nome" ' + inp + ' value="' + nome.replace(/"/g, '') + '"></label>' +
    '<label>Idioma<select id="lf-lang" ' + inp + '><option value="pt">Português</option><option value="es">Espanhol</option><option value="en">Inglês</option></select></label>' +
    '<label style="grid-column:1/3">Ficha<select id="lf-ver" ' + inp + '><option value="lip">Lipedema</option><option value="pla">Plástica</option></select></label></div>' +
    '<textarea id="lf-msg" style="width:100%;box-sizing:border-box;height:150px;margin-top:10px;font:13px/1.4 Arial;border:1px solid #dbe4f0;border-radius:8px;padding:8px"></textarea>' +
    btn('lf-copiar', 'Copiar mensagem com o link') + '<div id="lf-ok" style="font-size:12px;color:#1f7d52;margin-top:6px;min-height:16px"></div>');
  $('#lf-lang').value = lang; $('#lf-ver').value = ver;
  const gerar = () => { $('#lf-msg').value = montar(); };
  ['#lf-lang', '#lf-ver'].forEach((s) => $(s).addEventListener('change', gerar));
  $('#lf-nome').addEventListener('input', gerar);
  $('#lf-copiar').onclick = async () => {
    try { await navigator.clipboard.writeText($('#lf-msg').value); $('#lf-ok').textContent = '✅ Copiada. Cole no chat (Ctrl+V ou ⌘V).'; }
    catch (e) { $('#lf-msg').focus(); $('#lf-msg').select(); $('#lf-ok').textContent = 'Selecionei o texto: aperte Ctrl+C (ou ⌘C no Mac).'; }
  };
  gerar();
})();
