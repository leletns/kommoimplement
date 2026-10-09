// Botão "Copiar ficha" — use com o lead aberto no Kommo.
// Usa a Ficha Blue (nota com FICHA_BLUE_JSON) se a paciente já preencheu pelo link; senão lê o chat do lead,
// acha a última ficha que a paciente mandou, organiza e copia.
(async () => {
  /*PARSER*/
  const id = (location.pathname.match(/leads\/detail\/(\d+)/) || [])[1];
  const caixa = (html) => {
    let c = document.getElementById('blue-ficha-box');
    if (!c) {
      c = document.createElement('div');
      c.id = 'blue-ficha-box';
      c.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:360px;max-height:85vh;overflow:auto;background:#fff;color:#13294a;border:2px solid #2f6fb5;border-radius:14px;padding:16px;font:14px/1.45 Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)';
      document.body.appendChild(c);
    }
    c.innerHTML = html + '<div style="margin-top:10px;text-align:right"><button id="bf-x" style="border:0;background:#eaf2fb;color:#13294a;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>';
    c.querySelector('#bf-x').onclick = () => c.remove();
    return c;
  };
  if (!id) { caixa('<b>Abra o card do lead no Kommo</b> e clique de novo.'); return; }
  caixa('Lendo a ficha do lead ' + id + '…');
  let fichaBlue = null;
  try {
    const n = await (await fetch('/api/v4/leads/' + id + '/notes?limit=50&order[id]=desc', { credentials: 'include' })).json();
    const nota = ((n && n._embedded && n._embedded.notes) || []).find((x) => x.params && /FICHA_BLUE_JSON:/.test(x.params.text || ''));
    // O Kommo troca as aspas da nota por &quot;: desfaz antes de ler
    if (nota) fichaBlue = JSON.parse(String(nota.params.text).replace(/&quot;|&#0?34;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').split('FICHA_BLUE_JSON:')[1].trim());
  } catch (e) { /* segue pela conversa */ }
  const msgs = [];
  let url = location.origin + '/ajax/v3/leads/' + id + '/events_timeline?limit=100', pag = 0;
  while (!fichaBlue && url && pag < 30) {
    const r = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }, credentials: 'include' });
    if (!r.ok) { caixa('Não consegui ler a conversa (erro ' + r.status + '). Recarregue o Kommo e tente de novo.'); return; }
    const j = await r.json();
    const items = (j._embedded && j._embedded.items) || [];
    for (const it of items) {
      const m = it.data && it.data.message;
      if (it.type === 89 && m && m.text) msgs.push({ ts: it.date_create, text: m.text });
    }
    let prev = j._links && j._links.prev; prev = prev && typeof prev === 'object' ? prev.href : prev;
    url = prev && items.length ? new URL(prev, location.origin).href : null;
    pag++;
  }
  const fichas = msgs.filter((m) => pareceFicha(m.text)).sort((a, b) => b.ts - a.ts);
  if (!fichaBlue && !fichas.length) { caixa('<b>Não achei ficha nesta conversa.</b><br>A paciente ainda não mandou os dados (nome, CPF…).'); return; }
  const d = fichaBlue || parseFicha(fichas[0].text);
  d._lead = id;
  const json = JSON.stringify(d);
  let copiou = false;
  try { await navigator.clipboard.writeText(json); copiou = true; } catch (e) { /* sem permissão */ }
  window.__fichaBlue = d;
  try { localStorage.setItem('fichaBlue', json); } catch (e) { /* ok */ }
  const NOMES = { nome: 'Nome', cpf: 'CPF', rg: 'RG', nascimento: 'Nascimento', profissao: 'Profissão', estadoCivil: 'Estado civil', telefone: 'Telefone', email: 'E-mail', instagram: 'Instagram', rua: 'Endereço', numero: 'Número', complemento: 'Complemento', cep: 'CEP', comoConheceu: 'Como conheceu', indicacao: 'Indicação', objetivo: 'Objetivo', plano: 'Plano' };
  const linhas = Object.keys(NOMES).filter((k) => d[k]).map((k) => '<tr><td style="color:#5b6b82;padding:2px 8px 2px 0">' + NOMES[k] + '</td><td><b>' + String(d[k]).replace(/</g, '&lt;') + '</b></td></tr>').join('');
  const c = caixa('<div style="font-weight:bold;font-size:15px;margin-bottom:6px">' + (copiou ? '✅ Ficha copiada' : '📋 Ficha pronta') + (fichaBlue ? ' · Ficha Blue' : '') + '</div>' +
    '<div style="color:#5b6b82;font-size:12px;margin-bottom:8px">Confira e depois clique em <b>Preencher cadastro</b> no Amigo ou no DocSignature.</div>' +
    '<table style="border-collapse:collapse;font-size:13px">' + linhas + '</table>' +
    // Safari só deixa copiar com um clique: mostra o botão quando a cópia automática não funcionou.
    (copiou ? '' : '<button id="bf-copiar" style="margin-top:10px;width:100%;border:0;background:#13294a;color:#fff;border-radius:8px;padding:9px;cursor:pointer;font-weight:bold">Copiar ficha</button><textarea id="bf-json" style="width:100%;height:60px;margin-top:8px;font-size:11px">' + json.replace(/</g, '&lt;') + '</textarea>'));
  const bt = c.querySelector('#bf-copiar');
  if (bt) bt.onclick = async () => {
    try { await navigator.clipboard.writeText(json); bt.textContent = '✅ Copiada'; }
    catch (e) { const ta = c.querySelector('#bf-json'); ta.focus(); ta.select(); bt.textContent = 'Aperte ⌘C (Mac) ou Ctrl+C'; }
  };
})();
