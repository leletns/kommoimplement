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
  const campos = [...document.querySelectorAll('input, textarea, select')].filter((c) => visivel(c) && !['radio', 'checkbox', 'button', 'submit'].includes(c.type) && !c.closest('#blue-preencher-box'));
  const rotuloDe = (el) => {
    const t = [el.getAttribute('aria-label'), el.placeholder, el.name];
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t.push(l.textContent); }
    const lp = el.closest('label'); if (lp) t.push(lp.textContent);
    // Texto curto mais próximo antes do campo (o rótulo que fica em cima dele na tela).
    let p = el.parentElement;
    for (let i = 0; i < 4 && p && t.length < 5; i++, p = p.parentElement) {
      const antes = [...p.querySelectorAll('label, span, p, div')].filter((n) => !n.contains(el) && !n.querySelector('input, select, textarea') &&
        (/[a-zA-ZÀ-ú]{3,}/.test(n.textContent) || /^\s*(rg|uf)\s*\*?\s*$/i.test(n.textContent)) && n.textContent.length < 60 && (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (antes.length) { t.push(antes[antes.length - 1].textContent); break; }
    }
    return norm(t.filter(Boolean).join(' | '));
  };
  const usados = new Set();
  const acha = (palavras, evitar, filtro) => {
    for (const p of palavras) {
      const el = campos.find((c) => !usados.has(c) && (!filtro || filtro(c)) && (' ' + rotuloDe(c) + ' ').includes(p) && !(evitar || []).some((e) => rotuloDe(c).includes(e)));
      if (el) return el;
    }
    return null;
  };
  const raiz = (s) => norm(s).replace(/\b(a|o)\b/g, '').trim().slice(0, 5); // "CASADA" e "Casado(a)" → "casad"
  const setValor = (el, v) => {
    if (el.tagName === 'SELECT') {
      const alvo = norm(v);
      const op = [...el.options].find((o) => norm(o.textContent) === alvo) || [...el.options].find((o) => alvo && norm(o.textContent) && raiz(o.textContent) === raiz(v));
      if (!op) return false;
      el.value = op.value;
    } else {
      if (el.type === 'date' && /^\d{2}\/\d{2}\/\d{4}$/.test(v)) v = v.split('/').reverse().join('-');
      const digitos = (x) => String(x).replace(/\D/g, '');
      el.focus();
      const confere = () => (el.type === 'date' ? false : (digitos(v).length >= 6 ? digitos(el.value).endsWith(digitos(v).slice(-6)) : el.value.trim() === String(v).trim()));
      if (el.type !== 'date') { el.select && el.select(); document.execCommand('insertText', false, v); }
      // Campo com máscara (CPF, celular, CEP) que recusa o valor de uma vez: digita caractere por caractere.
      if (el.type !== 'date' && !confere()) {
        el.select && el.select(); document.execCommand('delete');
        for (const ch of (digitos(v).length >= 6 ? digitos(v) : String(v))) document.execCommand('insertText', false, ch);
      }
      const certo = confere();
      if (!certo) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      }
    }
    ['input', 'change', 'blur'].forEach((ev) => el.dispatchEvent(new Event(ev, { bubbles: true })));
    el.style.outline = '2px solid #2e9e5f';
    usados.add(el);
    return true;
  };
  const escolherNaLista = async (palavras, valor) => {
    const rot = [...document.querySelectorAll('label, span, div, p')].find((n) => n.children.length < 2 && palavras.some((p) => norm(n.textContent) === p));
    if (!rot) return false;
    let alvo = rot.nextElementSibling || rot.parentElement.querySelector('[class*="select"], [role="combobox"], button');
    if (!alvo) return false;
    alvo.click(); (alvo.querySelector('input') || alvo).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    const op = [...document.querySelectorAll('[role="option"], li, [class*="option"]')].find((o) => o.children.length < 3 && raiz(o.textContent) === raiz(valor));
    if (!op) { document.body.click(); return false; }
    op.click(); return true;
  };
  const soNumeros = (v) => String(v).replace(/\D/g, '');
  const celularBR = (v) => { let d = soNumeros(v); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : v; };
  if (d.telefone && /^\+?55|^\d{10,11}$/.test(String(d.telefone).replace(/\s/g, ''))) d.telefone = celularBR(d.telefone);
  d.conheceu = d.indicacao ? 'Indicação: ' + d.indicacao : d.comoConheceu;
  d.sexo = d.sexo || 'Feminino';
  if (d.plano && d.plano === d.plano.toLowerCase()) d.plano = d.plano.replace(/(^|\s)\S/g, (x) => x.toUpperCase());
  const texto = (c) => c.tagName !== 'SELECT';
  const poucos = campos.length <= 3;
  const checagem = poucos && /duplicidade|celular com ddd|tipo de busca/i.test(document.body.innerText);
  if (checagem) {
    const tel = acha(['celular', 'telefone', 'whatsapp'], null, texto);
    const mail = acha(['e mail', 'email']);
    let ok = false;
    if (tel) { const dig = soNumeros(d.telefone).replace(/^55(?=\d{10,11}$)/, ''); ok = setValor(tel, /^\+/.test(tel.value) ? tel.value.trim().split(' ')[0] + ' ' + dig : d.telefone); }
    else if (mail) ok = setValor(mail, d.email);
    caixa(ok ? '<div style="font-weight:bold;font-size:15px">✅ ' + (tel ? 'Celular' : 'E-mail') + ' preenchido</div><div style="font-size:13px;margin-top:6px">Clique em <b>Validar e continuar</b>. Na próxima tela, clique de novo em <b>Preencher cadastro</b>.</div>' : 'Não achei o campo de celular ou e-mail nesta tela.');
    return;
  }
  d.nomeContrato = d.nome;
  const MAPA = [
    ['cep', ['cep', 'codigo postal', 'zip']],
    ['nome', ['nome completo', 'nome do paciente', 'nome do cliente', 'nome'], ['social', 'mae', 'pai', 'responsavel', 'usuario', 'fantasia']],
    ['nomeContrato', ['nome a ser usado', 'nome para contrato', 'contrato']],
    ['cpf', ['cpf']],
    ['rg', [' rg ', 'identidade']],
    ['nascimento', ['nascimento', 'data de nasc']],
    ['sexo', ['sexo', 'genero']],
    ['profissao', ['profissao', 'ocupacao']],
    ['estadoCivil', ['estado civil']],
    ['telefone', ['celular', 'whatsapp', 'telefone', 'fone'], null, (c) => texto(c) && !/\d{8}/.test(c.value.replace(/\D/g, ''))],
    ['email', ['e mail', 'email']],
    ['instagram', ['instagram']],
    ['rua', ['logradouro', 'endereco', 'rua'], ['numero', 'complemento', 'cep', 'bairro']],
    ['numero', ['numero'], ['celular', 'telefone', 'cpf', 'documento']],
    ['complemento', ['complemento']],
    ['plano', ['plano de saude', ' plano '], ['convenio', 'carteira', 'validade', 'matricula'], (c) => c.tagName !== 'SELECT'],
    ['conheceu', ['como nos conheceu', 'como conheceu', 'conheceu', 'origem', 'indicacao']],
  ];
  const feitos = [], faltou = [];
  for (const [k, pal, evitar, filtro] of MAPA) {
    if (!d[k]) continue;
    if (k === 'telefone' && campos.some((c) => soNumeros(c.value).endsWith(soNumeros(d[k]).slice(-8)))) { feitos.push(k); continue; } // já veio da etapa anterior
    const el = acha(pal, evitar, filtro);
    // Não apaga o que o sistema já completou pelo CEP com algo mais curto (ex.: "Rua").
    if (el && k === 'rua' && el.value && el.value.length >= String(d[k]).length) { usados.add(el); feitos.push(k); continue; }
    let ok = el && setValor(el, d[k]);
    if (!ok && k === 'estadoCivil') ok = await escolherNaLista(['estado civil'], d[k]);
    if (!ok && k === 'sexo') {
      // Sexo em botões/rádios: clica no que diz "Feminino".
      const b = [...document.querySelectorAll('label, button, [role="radio"], span')].find((n) => n.children.length < 3 && norm(n.textContent) === 'feminino');
      if (b) { b.click(); ok = true; }
    }
    if (ok) feitos.push(k); else if (k !== 'sexo' && k !== 'nomeContrato') faltou.push(k);
    if (k === 'cep' && el) await new Promise((r) => setTimeout(r, 1800)); // deixa o sistema completar o endereço pelo CEP
  }
  // Instagram, indicação e plano vão também em Observações quando não houver campo próprio.
  const obs = acha(['observac', 'anotac']);
  const extra = [!feitos.includes('instagram') && d.instagram ? 'Instagram: ' + d.instagram : '', !feitos.includes('conheceu') && d.conheceu ? 'Como conheceu: ' + d.conheceu : '', !feitos.includes('plano') && d.plano ? 'Plano: ' + d.plano : '', d.objetivo ? 'Objetivo: ' + d.objetivo : ''].filter(Boolean).join(' · ');
  if (obs && extra && !obs.value) { setValor(obs, extra); feitos.push('observações'); ['instagram', 'conheceu', 'plano'].forEach((k) => { const i = faltou.indexOf(k); if (i >= 0) faltou.splice(i, 1); }); }
  caixa('<div style="font-weight:bold;font-size:15px">✅ ' + feitos.length + ' campos preenchidos <span style="font-weight:normal;font-size:11px;color:#8a97a8">v3</span></div>' +
    '<div style="font-size:12px;color:#5b6b82;margin:6px 0">Os campos preenchidos estão com borda verde. <b>Confira e clique em Salvar.</b></div>' +
    (faltou.length ? '<div style="font-size:13px;color:#a46d1c">Preencha à mão: ' + faltou.map((k) => k + ': <b>' + String(d[k]).replace(/</g, '&lt;') + '</b>').join('<br>') + '</div>' : ''));
})();
