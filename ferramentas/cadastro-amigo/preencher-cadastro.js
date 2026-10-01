// Botão "Preencher cadastro" — use na tela de novo paciente do AmigoClinic ou de novo cliente do DocSignature.
// Pega a ficha copiada pelo botão "Copiar ficha" e preenche os campos pelo nome que aparece na tela. Não salva sozinho.
(async () => {
  const caixa = (html) => {
    let c = document.getElementById('blue-preencher-box');
    if (!c) { c = document.createElement('div'); c.id = 'blue-preencher-box'; c.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:340px;max-height:85vh;overflow:auto;background:#fff;color:#13294a;border:2px solid #2e9e5f;border-radius:14px;padding:16px;font:14px/1.45 Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)'; document.body.appendChild(c); }
    c.innerHTML = html + '<div style="margin-top:10px;text-align:right"><button id="bp-x" style="border:0;background:#e9f6ef;color:#13294a;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>';
    c.querySelector('#bp-x').onclick = () => c.remove();
    return c;
  };
  let d = null;
  try { d = JSON.parse(await navigator.clipboard.readText()); } catch (e) { /* pede para colar */ }
  if (!d || !d.nome) {
    const c = caixa('<b>Cole aqui a ficha copiada no Kommo</b> (Ctrl+V):<textarea id="bp-in" style="width:100%;height:90px;margin-top:8px"></textarea><button id="bp-ok" style="margin-top:8px;border:0;background:#13294a;color:#fff;border-radius:8px;padding:8px 14px;cursor:pointer">Preencher</button>');
    await new Promise((res) => { c.querySelector('#bp-ok').onclick = res; c.querySelector('#bp-in').focus(); });
    try { d = JSON.parse(c.querySelector('#bp-in').value); } catch (e) { caixa('Não entendi o texto colado. Copie de novo pelo botão <b>Copiar ficha</b> no Kommo.'); return; }
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const visivel = (el) => el.offsetParent !== null && !el.disabled && !el.readOnly && el.type !== 'hidden';
  const campos = [...document.querySelectorAll('input, textarea, select')].filter(visivel);
  const rotuloDe = (el) => {
    const t = [el.getAttribute('aria-label'), el.placeholder, el.name, el.id];
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t.push(l.textContent); }
    const lp = el.closest('label'); if (lp) t.push(lp.textContent);
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++, p = p.parentElement) { const l = p.querySelector('label, .label, [class*="label"], span, p'); if (l && !l.contains(el) && l.textContent.length < 60) { t.push(l.textContent); break; } }
    return norm(t.filter(Boolean).join(' | '));
  };
  const usados = new Set();
  const acha = (palavras, evitar) => campos.find((el) => !usados.has(el) && palavras.some((p) => rotuloDe(el).includes(p)) && !(evitar || []).some((e) => rotuloDe(el).includes(e)));
  const setValor = (el, v) => {
    if (el.tagName === 'SELECT') {
      const alvo = norm(v);
      const op = [...el.options].find((o) => norm(o.textContent) === alvo) || [...el.options].find((o) => alvo && (norm(o.textContent).includes(alvo) || alvo.includes(norm(o.textContent))) && norm(o.textContent));
      if (!op) return false;
      el.value = op.value;
    } else {
      if (el.type === 'date' && /^\d{2}\/\d{2}\/\d{4}$/.test(v)) v = v.split('/').reverse().join('-');
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    }
    ['input', 'change', 'blur'].forEach((ev) => el.dispatchEvent(new Event(ev, { bubbles: true })));
    el.style.outline = '2px solid #2e9e5f';
    usados.add(el);
    return true;
  };
  const MAPA = [
    ['cep', ['cep', 'codigo postal', 'zip']],
    ['nome', ['nome completo', 'nome do paciente', 'nome do cliente', 'nome'], ['social', 'mae', 'pai', 'responsavel', 'usuario', 'fantasia']],
    ['cpf', ['cpf', 'documento']],
    ['rg', ['rg', 'identidade']],
    ['nascimento', ['nascimento', 'data de nasc']],
    ['profissao', ['profissao', 'ocupacao']],
    ['estadoCivil', ['estado civil']],
    ['telefone', ['celular', 'whatsapp', 'telefone', 'fone']],
    ['email', ['e mail', 'email']],
    ['instagram', ['instagram']],
    ['rua', ['logradouro', 'endereco', 'rua']],
    ['numero', ['numero', 'n ']],
    ['complemento', ['complemento']],
    ['comoConheceu', ['como conheceu', 'origem', 'indicacao']],
  ];
  const feitos = [], faltou = [];
  for (const [k, pal, evitar] of MAPA) {
    if (!d[k]) continue;
    const el = acha(pal, evitar);
    if (el && setValor(el, d[k])) feitos.push(k); else faltou.push(k);
    if (k === 'cep' && el) await new Promise((r) => setTimeout(r, 1500)); // deixa o sistema completar o endereço pelo CEP
  }
  // Instagram, indicação e plano vão também em Observações quando não houver campo próprio.
  const obs = acha(['observac', 'anotac']);
  const extra = [!feitos.includes('instagram') && d.instagram ? 'Instagram: ' + d.instagram : '', d.indicacao ? 'Indicação: ' + d.indicacao : '', d.plano ? 'Plano: ' + d.plano : '', d.objetivo ? 'Objetivo: ' + d.objetivo : ''].filter(Boolean).join(' · ');
  if (obs && extra && !obs.value) { setValor(obs, extra); feitos.push('observações'); const i = faltou.indexOf('instagram'); if (i >= 0) faltou.splice(i, 1); }
  caixa('<div style="font-weight:bold;font-size:15px">✅ ' + feitos.length + ' campos preenchidos</div>' +
    '<div style="font-size:12px;color:#5b6b82;margin:6px 0">Os campos preenchidos estão com borda verde. <b>Confira e clique em Salvar.</b></div>' +
    (faltou.length ? '<div style="font-size:13px;color:#a46d1c">Preencha à mão: ' + faltou.map((k) => k + ': <b>' + String(d[k]).replace(/</g, '&lt;') + '</b>').join('<br>') + '</div>' : ''));
})();
