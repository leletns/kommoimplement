// Botão "Preencher cadastro" — use na tela de novo paciente do AmigoClinic ou de novo cliente do DocSignature.
// Pega a ficha copiada (botão "Copiar ficha" no Kommo) ou busca a Ficha Blue pelo nome/celular, para quem não usa o Kommo.
// Preenche os campos pelo nome que aparece na tela. Não salva sozinho.
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
    // Sem ficha copiada: busca pelo nome/celular/e-mail no servidor da Ficha Blue (quem não usa o Kommo) ou cola o texto.
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('blueFichaCfg') || '{}'); } catch (e) { cfg = {}; }
    const inp = 'style="width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #dbe4f0;border-radius:8px;font:13px Arial;margin-top:4px"';
    const btn = (id, t, cor) => '<button id="' + id + '" style="margin-top:8px;border:0;background:' + (cor || '#13294a') + ';color:#fff;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:bold">' + t + '</button>';
    const c = caixa('<b>De qual paciente é o cadastro?</b>' +
      '<input id="bp-q" ' + inp + ' placeholder="Nome, celular ou e-mail">' +
      (cfg.site && cfg.senha ? '' : '<div style="font-size:12px;color:#5b6b82;margin-top:8px">Só na primeira vez (fica salvo neste navegador):</div><input id="bp-site" ' + inp + ' placeholder="Endereço da Ficha Blue (https://…)" value="' + (cfg.site || '') + '"><input id="bp-senha" type="password" ' + inp + ' placeholder="Senha da equipe">') +
      btn('bp-buscar', '🔎 Buscar ficha') + '<div id="bp-res" style="margin-top:8px;font-size:13px"></div>' +
      '<details style="margin-top:8px;font-size:12px;color:#5b6b82"><summary style="cursor:pointer">Ou colar a ficha copiada</summary><textarea id="bp-in" style="width:100%;height:70px;margin-top:6px"></textarea>' + btn('bp-ok', 'Preencher com o texto colado', '#2e9e5f') + '</details>');
    const $c = (s) => c.querySelector(s);
    $c('#bp-q').focus();
    d = await new Promise((res) => {
      $c('#bp-ok').onclick = () => { try { res(JSON.parse($c('#bp-in').value)); } catch (e) { $c('#bp-res').textContent = 'Não entendi o texto colado.'; } };
      const buscar = async () => {
        if ($c('#bp-site')) {
          cfg = { site: $c('#bp-site').value.trim().replace(/\/+$/, ''), senha: $c('#bp-senha').value };
          try { localStorage.setItem('blueFichaCfg', JSON.stringify(cfg)); } catch (e) { /* ok */ }
        }
        const res2 = $c('#bp-res');
        res2.textContent = 'Buscando…';
        try {
          const r = await fetch(cfg.site + '/api/ficha-busca?q=' + encodeURIComponent($c('#bp-q').value.trim()), { headers: { 'x-painel-senha': cfg.senha } });
          if (r.status === 401) { try { localStorage.removeItem('blueFichaCfg'); } catch (e) { /* ok */ } res2.textContent = 'Senha incorreta. Feche e clique de novo no botão.'; return; }
          const j = await r.json();
          if (!j.ok) { res2.textContent = j.erro || 'Não consegui buscar.'; return; }
          if (!j.fichas.length) { res2.innerHTML = 'Nenhuma Ficha Blue encontrada' + (j.semFicha ? ' (achei a paciente, mas ela ainda não enviou a ficha)' : '') + '.'; return; }
          res2.innerHTML = j.fichas.map((f, i) => '<button data-i="' + i + '" style="display:block;width:100%;text-align:left;margin-top:6px;border:1px solid #dbe4f0;background:#f4f8fd;border-radius:8px;padding:8px;cursor:pointer"><b>' +
            String(f.nome).replace(/</g, '&lt;') + '</b><br><span style="font-size:12px;color:#5b6b82">' + [f.dados.cpf, f.dados.telefone, f.recebidaEm ? 'enviada em ' + new Date(f.recebidaEm * 1000).toLocaleDateString('pt-BR') : ''].filter(Boolean).join(' · ').replace(/</g, '&lt;') + '</span></button>').join('');
          res2.querySelectorAll('button').forEach((bt) => { bt.onclick = () => res(j.fichas[Number(bt.dataset.i)].dados); });
        } catch (e) {
          // O site pode bloquear chamadas para fora: abre a busca da equipe em outra aba (copiar → clicar de novo aqui).
          res2.innerHTML = 'Este site não deixou buscar daqui. <a href="' + cfg.site + '/equipe?q=' + encodeURIComponent($c('#bp-q').value.trim()) + '" target="_blank" style="color:#2f6fb5;font-weight:bold">Abrir a busca de fichas</a>, clique em <b>Copiar ficha</b> e depois clique de novo em ✍️ Preencher cadastro.';
        }
      };
      $c('#bp-buscar').onclick = buscar;
      $c('#bp-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); });
    });
    if (!d || !d.nome) { caixa('Ficha sem nome. Confira e tente de novo.'); return; }
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const visivel = (el) => el.offsetParent !== null && !el.disabled && !el.readOnly && el.type !== 'hidden';
  const campos = [...document.querySelectorAll('input, textarea, select')].filter((c) => visivel(c) && !['radio', 'checkbox', 'button', 'submit'].includes(c.type) && !c.closest('#blue-preencher-box'));
  const rotuloDe = (el) => {
    const t = [el.getAttribute('aria-label'), el.placeholder, el.name];
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t.push(l.textContent); }
    const lp = el.closest('label'); if (lp) t.push(lp.textContent);
    const bloco = el.closest('[class*="form__field"], [class*="form-group"], [class*="form-field"]');
    if (bloco) {
      const r = [...bloco.querySelectorAll('label, span, p, div')].find((n) => !n.contains(el) && !n.querySelector('input, select, textarea') &&
        !n.closest('[class*="checkbox"], [class*="radio"]') && (/[a-zA-ZÀ-ú]{3,}/.test(n.textContent) || /^\s*(rg|uf)\s*\*?\s*$/i.test(n.textContent)) && n.textContent.length < 60);
      if (r) return norm([...t, r.textContent].filter(Boolean).join(' | '));
    }
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
      const ehData = el.type !== 'date' && /^\d{2}\/\d{2}\/\d{4}$/.test(v);
      const digitos = (x) => String(x).replace(/\D/g, '');
      el.focus();
      const confere = () => (el.type === 'date' ? false : (digitos(v).length >= 6 ? digitos(el.value).endsWith(digitos(v).slice(-6)) : el.value.trim() === String(v).trim()));
      if (el.type !== 'date') { el.select && el.select(); document.execCommand('insertText', false, v); }
      // Campo com máscara (CPF, celular, CEP) que recusa o valor de uma vez: digita caractere por caractere.
      if (el.type !== 'date' && !confere()) {
        el.select && el.select(); document.execCommand('delete');
        for (const ch of (digitos(v).length >= 6 ? digitos(v) : String(v))) document.execCommand('insertText', false, ch);
      }
      // Data com máscara que "come" as barras: tenta só os números.
      if (ehData && !/^\d{2}\/\d{2}\/\d{4}$/.test(el.value.trim())) { el.select && el.select(); document.execCommand('delete'); for (const ch of digitos(v)) document.execCommand('insertText', false, ch); }
      const certo = confere();
      if (!certo) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      }
    }
    ['input', 'change'].forEach((ev) => el.dispatchEvent(new Event(ev, { bubbles: true })));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
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
  const escolherNaBusca = async (el, termo) => {
    setValor(el, termo);
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: termo.slice(-1) }));
    await new Promise((r) => setTimeout(r, 900));
    const ops = [...document.querySelectorAll('[role="option"], .dropdown-menu li, [class*="typeahead"] li, [class*="typeahead"] a, [class*="dropdown"] li, ul li a')]
      .filter((o) => o.offsetParent !== null && !/^\s*novo\s*$/i.test(o.textContent) && raiz(o.textContent).length && norm(o.textContent).includes(norm(termo).slice(0, 5)));
    if (ops.length) { (ops[0].querySelector('a') || ops[0]).click(); return true; }
    const proto = HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true }));
    return false;
  };
  const soNumeros = (v) => String(v).replace(/\D/g, '');
  const celularBR = (v) => { let d = soNumeros(v); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : v; };
  // País pelo código: +55 (ou 10–11 dígitos sem código) é Brasil; +54, +598, +351, 00351… é de fora.
  const DDIS = ['1', '7', '20', '27', '30', '31', '32', '33', '34', '39', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '56', '57', '58', '61', '64', '65', '81', '82', '86', '90', '91', '212', '244', '258', '263', '351', '352', '353', '354', '370', '372', '380', '420', '502', '503', '504', '505', '506', '507', '591', '593', '595', '598', '971', '972', '974'];
  const telInfo = (v) => {
    const bruto = String(v || '').trim(); let dg = soNumeros(bruto);
    const internacional = /^\+/.test(bruto) || /^00\d/.test(dg);
    if (/^00/.test(dg)) dg = dg.slice(2);
    if (!internacional && (dg.length === 10 || dg.length === 11)) return { ddi: '55', nacional: dg };
    if (dg.startsWith('55') && (dg.length === 12 || dg.length === 13)) return { ddi: '55', nacional: dg.slice(2) };
    const ddi = ['3', '2', '1'].map((n) => dg.slice(0, +n)).find((c) => DDIS.includes(c));
    return ddi ? { ddi, nacional: dg.slice(ddi.length) } : { ddi: '55', nacional: dg };
  };
  const tel = d.telefone ? telInfo(d.telefone) : null;
  const PAIS = { 55: 'Brasil', 54: 'Argentina', 598: 'Uruguai', 595: 'Paraguai', 56: 'Chile', 591: 'Bolívia', 57: 'Colômbia', 51: 'Peru', 58: 'Venezuela', 593: 'Equador', 52: 'México', 1: 'Estados Unidos', 351: 'Portugal', 34: 'Espanha', 39: 'Itália', 33: 'França', 49: 'Alemanha', 44: 'Reino Unido', 41: 'Suíça', 61: 'Austrália', 263: 'Zimbábue' };
  if (tel && PAIS[tel.ddi]) d.nacionalidade = PAIS[tel.ddi];
  if (tel) d.telefone = tel.ddi === '55' ? celularBR(tel.nacional) : tel.nacional;
  // Escolhe o país (+54, +598…) no seletor de DDI ao lado do campo de celular.
  const escolherDDI = (campo) => {
    if (!tel || !campo) return true;
    let p = campo.parentElement, sel = null;
    for (let i = 0; i < 3 && p && !sel; i++, p = p.parentElement) sel = p.querySelector('select');
    if (sel) {
      const op = [...sel.options].find((o) => new RegExp('\\+' + tel.ddi + '(?!\\d)').test(o.textContent) || o.value === tel.ddi || o.value === '+' + tel.ddi);
      if (op) { sel.value = op.value; ['input', 'change'].forEach((ev) => sel.dispatchEvent(new Event(ev, { bubbles: true }))); return true; }
      return tel.ddi === '55';
    }
    return null; // sem seletor: o código vai junto no número
  };
  d.conheceu = d.indicacao ? 'Indicação: ' + d.indicacao : d.comoConheceu;
  // Nome de quem indicou: "Dr Bruno Montenegro", ou o que vem depois da vírgula em "indicação da minha endocrinologista, Ximene Antunes".
  const quemIndicou = (() => {
    if (d.indicacao) return d.indicacao.trim();
    const m = String(d.comoConheceu || '').match(/indica[cç][aã]o[^,]*,\s*(.+)$/i) || String(d.comoConheceu || '').match(/indica[cç][aã]o (?:d[aeo]s? )?((?:dr|dra)\.?\s.+)$/i);
    return m ? m[1].trim() : '';
  })();
  const fonteTxt = norm((d.comoConheceu || '') + ' ' + (d.indicacao ? 'indicacao' : ''));
  const categoria = /indic|recomend|referr/.test(fonteTxt) ? 'Indicação' : /insta/.test(fonteTxt) ? 'Instagram' : /google/.test(fonteTxt) ? 'Google' : /site/.test(fonteTxt) ? 'Site' : /facebook/.test(fonteTxt) ? 'Facebook' : /youtube/.test(fonteTxt) ? 'Youtube' : '';
  d.sexo = d.sexo || 'Feminino';
  if (d.plano && d.plano === d.plano.toLowerCase()) d.plano = d.plano.replace(/(^|\s)\S/g, (x) => x.toUpperCase());
  const texto = (c) => c.tagName !== 'SELECT';
  const poucos = campos.length <= 3;
  const checagem = poucos && /duplicidade|celular com ddd|tipo de busca/i.test(document.body.innerText);
  if (checagem) {
    const campoTel = acha(['celular', 'telefone', 'whatsapp'], null, texto);
    const mail = acha(['e mail', 'email']);
    let ok = false;
    if (campoTel) { const sd = escolherDDI(campoTel); ok = setValor(campoTel, sd === null || /^\+/.test(campoTel.value) ? '+' + tel.ddi + ' ' + soNumeros(tel.nacional) : d.telefone); }
    else if (mail) ok = setValor(mail, d.email);
    caixa(ok ? '<div style="font-weight:bold;font-size:15px">✅ ' + (campoTel ? 'Celular' : 'E-mail') + ' preenchido</div><div style="font-size:13px;margin-top:6px">Clique em <b>Validar e continuar</b>. Na próxima tela, clique de novo em <b>Preencher cadastro</b>.</div>' : 'Não achei o campo de celular ou e-mail nesta tela.');
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
    ['nacionalidade', ['nacionalidade']],
    ['conheceu', ['como nos conheceu', 'como conheceu', 'conheceu', 'origem', 'indicacao']],
  ];
  const feitos = [], faltou = [], avisos = [];
  for (const [k, pal, evitar, filtro] of MAPA) {
    if (!d[k]) continue;
    if (k === 'telefone' && campos.some((c) => soNumeros(c.value).endsWith(soNumeros(tel.nacional).slice(-8)))) { feitos.push(k); continue; } // já veio da etapa anterior
    const el = acha(pal, evitar, filtro);
    // Não apaga o que o sistema já completou pelo CEP com algo mais curto (ex.: "Rua").
    if (el && k === 'rua' && el.value && el.value.length >= String(d[k]).length) { usados.add(el); feitos.push(k); continue; }
    let valor = d[k];
    if (k === 'telefone' && el) { const sd = escolherDDI(el); if (sd === null && tel.ddi !== '55') valor = '+' + tel.ddi + ' ' + tel.nacional; if (sd === false) avisos.push('Escolha o país +' + tel.ddi + ' no campo Celular.'); }
    let ok;
    if (k === 'conheceu' && el && el.closest('[class*="typeahead"], [class*="autocomplete"]')) {
      // Amigo: "Como nos conheceu?" guarda quem indicou. Escolhe da lista; se não existir, deixa digitado e avisa (não cria sozinho).
      const termo = quemIndicou || categoria;
      ok = termo ? await escolherNaBusca(el, termo) : false;
      if (ok) feitos.push('conheceu');
      else if (termo) { setValor(el, termo); avisos.push('"' + termo + '" ainda não existe em Como nos conheceu: clique em <b>NOVO</b> ao lado do campo para cadastrar.'); }
      else faltou.push('conheceu');
      continue;
    }
    ok = el && setValor(el, valor);
    if (!ok && k === 'estadoCivil') ok = await escolherNaLista(['estado civil'], d[k]);
    if (!ok && k === 'sexo') {
      // Sexo em botões/rádios: clica no que diz "Feminino".
      const b = [...document.querySelectorAll('label, button, [role="radio"], span')].find((n) => n.children.length < 3 && norm(n.textContent) === 'feminino');
      if (b) { b.click(); ok = true; }
    }
    if (ok) feitos.push(k); else if (!['sexo', 'nomeContrato', 'nacionalidade'].includes(k)) faltou.push(k);
    if (k === 'cep' && el) await new Promise((r) => setTimeout(r, 1800)); // deixa o sistema completar o endereço pelo CEP
  }
  // Instagram, indicação e plano vão também em Observações quando não houver campo próprio.
  const obs = acha(['observac', 'anotac']);
  const extra = [!feitos.includes('instagram') && d.instagram ? 'Instagram: ' + d.instagram : '', (!feitos.includes('conheceu') || categoria === 'Indicação') && d.conheceu ? 'Como conheceu: ' + d.conheceu : '', !feitos.includes('plano') && d.plano ? 'Plano: ' + d.plano : '', d.objetivo ? 'Objetivo: ' + d.objetivo : ''].filter(Boolean).join(' · ');
  if (obs && extra && !obs.value) { setValor(obs, extra); feitos.push('observações'); ['instagram', 'conheceu', 'plano'].forEach((k) => { const i = faltou.indexOf(k); if (i >= 0) faltou.splice(i, 1); }); }
  caixa('<div style="font-weight:bold;font-size:15px">✅ ' + feitos.length + ' campos preenchidos <span style="font-weight:normal;font-size:11px;color:#8a97a8">v5</span></div>' +
    '<div style="font-size:12px;color:#5b6b82;margin:6px 0">Os campos preenchidos estão com borda verde. <b>Confira e clique em Salvar.</b></div>' +
    (avisos.length ? '<div style="font-size:13px;color:#b04848;margin-bottom:6px">' + avisos.join('<br>') + '</div>' : '') + (faltou.length ? '<div style="font-size:13px;color:#a46d1c">Preencha à mão: ' + faltou.map((k) => k + ': <b>' + String(d[k]).replace(/</g, '&lt;') + '</b>').join('<br>') + '</div>' : ''));
})();
