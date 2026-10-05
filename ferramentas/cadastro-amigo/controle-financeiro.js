// Botão "💰 Controle financeiro" — só da GESTÃO. Não tem relação com Copiar ficha / Preencher cadastro.
// No WhatsApp Web: lista os comprovantes (imagens) da conversa aberta → copia o escolhido → abre a página Controle financeiro (⌘V lá).
//   O WhatsApp bloqueia chamadas para outros sites (CSP) e isola janelas (COOP), por isso a imagem vai pela área de transferência.
// No AmigoApp → Pacientes: lê a paciente aberta na tela, compara com o comprovante em conciliação e manda a paciente conferida.
// Não salva nada no AmigoApp nem no WhatsApp. O lançamento só acontece depois do "Confirmar lançamento".
(async () => {
  /*COMPROVANTE*/
  const C = window.BlueComprovante;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('blueFinCfg') || '{}'); } catch (e) { cfg = {}; }
  const caixa = (html) => {
    let c = document.getElementById('blue-fin-box');
    if (!c) { c = document.createElement('div'); c.id = 'blue-fin-box'; c.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:360px;max-height:86vh;overflow:auto;background:#fff;color:#13294a;border:2px solid #1f7d52;border-radius:14px;padding:16px;font:14px/1.45 Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)'; document.body.appendChild(c); }
    c.innerHTML = '<div style="font-weight:bold;font-size:15px;margin-bottom:8px">💰 Controle financeiro <span style="font-weight:normal;font-size:11px;color:#8a97a8">gestão · v1</span></div>' + html + '<div style="margin-top:10px;text-align:right"><button id="bf-x" style="border:0;background:#e9f6ef;color:#13294a;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>';
    c.querySelector('#bf-x').onclick = () => c.remove();
    return c;
  };
  const inp = 'style="width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #dbe4f0;border-radius:8px;font:13px Arial;margin-top:4px"';
  const btn = (id, t, cor) => '<button id="' + id + '" style="margin-top:8px;border:0;background:' + (cor || '#13294a') + ';color:#fff;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:bold">' + t + '</button>';
  // Endereço do site (e, no AmigoApp, a senha da gestão): pedido só na primeira vez, guardado neste navegador.
  const pedirCfg = (precisaSenha) => new Promise((ok) => {
    const c = caixa('<div style="font-size:12px;color:#5b6b82">Só na primeira vez (fica salvo neste navegador):</div><input id="bf-site" ' + inp + ' placeholder="Endereço do site (https://…)" value="' + esc(cfg.site || '') + '">' +
      (precisaSenha ? '<input id="bf-senha" type="password" ' + inp + ' placeholder="Senha da gestão">' : '') + btn('bf-ok', 'Continuar'));
    c.querySelector('#bf-ok').onclick = () => {
      cfg.site = c.querySelector('#bf-site').value.trim().replace(/\/+$/, '');
      if (precisaSenha) cfg.senha = c.querySelector('#bf-senha').value;
      try { localStorage.setItem('blueFinCfg', JSON.stringify(cfg)); } catch (e) { /* ok */ }
      ok();
    };
  });
  const host = location.hostname;

  // ================= WhatsApp Web =================
  if (/(^|\.)whatsapp\.com$/.test(host)) {
    if (!cfg.site) await pedirCfg(false);
    const pagina = cfg.site + '/financeiro#whatsapp-colar';
    // Imagens de mensagens (blob:) — o visualizador aberto primeiro; ícones, figurinhas e fotos de perfil ficam de fora.
    const imgs = [...document.querySelectorAll('img[src^="blob:"]')].filter((i) => i.naturalWidth >= 200 && i.naturalHeight >= 200 && !i.closest('header') && !i.closest('#blue-fin-box'));
    const grande = imgs.slice().sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
    const naConversa = imgs.filter((i) => i.closest('#main') || i.closest('[data-id]'));
    const lista = [...new Set([...(grande && !naConversa.includes(grande) ? [grande] : []), ...naConversa.reverse()])].slice(0, 8);
    const c = caixa(lista.length
      ? '<div style="font-size:13px">Clique no comprovante (o mais recente primeiro):</div><div id="bf-l" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">' +
        lista.map((i, k) => '<button data-k="' + k + '" style="border:2px solid #dbe4f0;background:#f4f8fd;border-radius:10px;padding:4px;cursor:pointer"><img src="' + i.src + '" style="width:100%;height:120px;object-fit:cover;border-radius:6px"><div style="font-size:11px;color:#5b6b82">' + (i === grande && !naConversa.includes(i) ? 'imagem aberta' : 'na conversa') + '</div></button>').join('') + '</div>' +
        '<div style="font-size:12px;color:#5b6b82;margin-top:8px">Comprovante em PDF: baixe pelo WhatsApp e arraste na página.</div>' + btn('bf-abrir', 'Abrir sem comprovante', '#2f6fb5')
      : '<div style="font-size:13px">Não achei imagem nesta conversa. Abra a conversa com o comprovante (ou clique na imagem para ampliar) e clique de novo no botão. PDF: baixe e arraste na página.</div>' + btn('bf-abrir', 'Abrir Controle financeiro', '#2f6fb5'));
    c.querySelector('#bf-abrir').onclick = () => window.open(cfg.site + '/financeiro#whatsapp', 'blueFinanceiro');
    c.querySelectorAll('#bf-l button').forEach((b) => {
      b.onclick = () => {
        const img = lista[Number(b.dataset.k)];
        // PNG para a área de transferência (o Safari só aceita PNG). A Promise mantém o "clique" válido no Safari.
        const png = (async () => {
          const blob = await (await fetch(img.src)).blob();
          const bmp = await createImageBitmap(blob);
          const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; cv.getContext('2d').drawImage(bmp, 0, 0);
          return new Promise((ok) => cv.toBlob(ok, 'image/png'));
        })();
        let copiou = Promise.reject(new Error('sem suporte'));
        try { copiou = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); } catch (e) { /* cai no download */ }
        const janela = window.open(pagina, 'blueFinanceiro');
        copiou.then(() => {
          caixa('<div style="font-weight:bold;color:#1f7d52">✅ Comprovante copiado</div><div style="font-size:13px;margin-top:6px">Na janela <b>Controle financeiro</b>, aperte <b>⌘V</b> (Mac) ou <b>Ctrl+V</b>.' + (janela ? '' : ' Se a janela não abriu: <a href="' + esc(pagina) + '" target="_blank" style="color:#2f6fb5;font-weight:bold">abrir Controle financeiro</a>.') + '</div>');
        }).catch(async () => {
          // Sem permissão de copiar: baixa o arquivo para arrastar na página.
          const blob = await png; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'comprovante-' + new Date().toISOString().slice(0, 19).replace(/\D/g, '') + '.png';
          document.body.appendChild(a); a.click(); a.remove();
          caixa('<div style="font-weight:bold">⬇️ Comprovante baixado</div><div style="font-size:13px;margin-top:6px">O navegador não deixou copiar. Arraste o arquivo baixado para a página <b>Controle financeiro</b>.' + (janela ? '' : ' <a href="' + esc(pagina) + '" target="_blank" style="color:#2f6fb5;font-weight:bold">Abrir Controle financeiro</a>') + '</div>');
        });
      };
    });
    return;
  }

  // ================= AmigoApp (Pacientes) =================
  if (/(^|\.)(amigoapp|amigotech)\.com\.br$/.test(host)) {
    if (!cfg.site || !cfg.senha) await pedirCfg(true);
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const visivel = (el) => el && el.offsetParent !== null && !el.closest('#blue-fin-box');
    // Valor de um campo pelo rótulo: input no mesmo bloco (formulário do Amigo) ou o texto ao lado do rótulo (tela de visualização).
    const campo = (rotulos, evitar) => {
      const nos = [...document.querySelectorAll('label, span, div, p, dt, th, strong, b, small')].filter((n) => visivel(n) && n.children.length <= 2 && n.textContent.length <= 40 &&
        rotulos.some((r) => norm(n.textContent).replace(/[:*]/g, '').trim() === r) && !(evitar || []).some((e) => norm(n.textContent).includes(e)));
      for (const n of nos) {
        const bloco = n.closest('[class*="form__field"], [class*="form-group"], [class*="field"], tr, dl, li') || n.parentElement;
        const i = bloco && [...bloco.querySelectorAll('input, select, textarea')].find((x) => visivel(x) && !['checkbox', 'radio', 'hidden'].includes(x.type));
        if (i && i.value && i.value.trim()) return i.tagName === 'SELECT' ? i.options[i.selectedIndex].text.trim() : i.value.trim();
        const prox = n.nextElementSibling || (n.parentElement && n.parentElement.nextElementSibling);
        if (prox && prox.textContent.trim() && prox.textContent.trim().length < 120) return prox.textContent.trim();
      }
      return '';
    };
    const lerPaciente = () => {
      const id = (/\/patients?\/(?:form\/|edit\/|view\/)?(\d+)/.exec(location.pathname + location.hash) || /[?&#]patient_?id=(\d+)/.exec(location.href) || [])[1] || '';
      let nome = campo(['nome', 'nome completo', 'nome do paciente', 'paciente'], ['social', 'mae', 'pai', 'responsavel']);
      if (!nome) { const h = [...document.querySelectorAll('h1, h2, h3, [class*="patient-name"], [class*="patient__name"]')].find((x) => visivel(x) && /[A-Za-zÀ-ú]{2,}\s+[A-Za-zÀ-ú]{2,}/.test(x.textContent) && x.textContent.trim().length < 80 && !/paciente|cadastro|agenda/i.test(x.textContent)); nome = h ? h.textContent.trim() : ''; }
      const cpf = campo(['cpf']) || ((/cpf[:\s]*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i.exec(document.body.innerText) || [])[1] || '');
      const celular = campo(['celular', 'telefone', 'celular principal', 'whatsapp']);
      const nascimento = (document.getElementById('patient-born') || {}).value || campo(['data de nascimento', 'nascimento']);
      return nome ? { nome, idAmigo: id, cpf: /\d{11}/.test(cpf.replace(/\D/g, '')) ? cpf : '', celular, nascimento, fonte: 'AmigoApp (tela da paciente)', url: location.href } : null;
    };
    const api = async (acao, corpo) => {
      const r = await fetch(cfg.site + '/api/financeiro?acao=' + acao, { method: corpo ? 'POST' : 'GET', headers: { 'x-financeiro-senha': cfg.senha, 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
      if (r.status === 401) { cfg.senha = ''; try { localStorage.setItem('blueFinCfg', JSON.stringify(cfg)); } catch (e) { /* ok */ } throw new Error('Senha da gestão incorreta. Clique de novo no botão.'); }
      return r.json();
    };
    let pend;
    try { pend = (await api('pendente')).conciliacao; } catch (e) {
      caixa('<div style="color:#b04848">' + esc(/senha/i.test(e.message) ? e.message : 'Este site não deixou falar com o Controle financeiro (' + e.message + ').') + '</div>'); return;
    }
    if (!pend) { caixa('<div style="font-size:13px">Nenhum comprovante esperando conferência. Primeiro leia o comprovante no <b>WhatsApp Web</b> (botão 💰) ou na página <a href="' + esc(cfg.site) + '/financeiro" target="_blank" style="color:#2f6fb5">Controle financeiro</a>.</div>'); return; }
    const cp = pend.comprovante || {};
    const resumo = '<div style="font-size:12.5px;background:#f4f8fd;border-radius:8px;padding:8px;margin-bottom:8px"><b>Comprovante em conferência</b><br>' + esc([cp.pagador || 'pagador não lido', cp.valor ? C.brl(cp.valor, cp.moeda) : '', cp.data, cp.forma].filter(Boolean).join(' · ')) + '</div>';
    const p = lerPaciente();
    if (!p) {
      // Lista de pacientes: preenche a busca do Amigo com o nome do pagador e mostra quem aparece na lista (sem escolher).
      const busca = [...document.querySelectorAll('input[type="search"], input[type="text"]')].find((i) => visivel(i) && /busc|pesquis|procur|nome|cpf|search/i.test((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '')));
      if (busca && cp.pagador && !busca.value) {
        busca.focus(); busca.select && busca.select(); document.execCommand('insertText', false, cp.pagador);
        if (busca.value !== cp.pagador) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(busca, cp.pagador); }
        ['input', 'change', 'keyup'].forEach((ev) => busca.dispatchEvent(new Event(ev, { bubbles: true })));
        busca.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
        busca.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
      }
      await new Promise((r) => setTimeout(r, 1500));
      const toks = norm(cp.pagador).split(' ').filter((t) => t.length > 2);
      const linhas = [...document.querySelectorAll('tr, li, [class*="list-item"], [class*="card"], a')].filter((n) => visivel(n) && n.textContent.length < 300 && toks.length && toks.filter((t) => norm(n.textContent).includes(t)).length >= Math.min(2, toks.length) && !n.querySelector('tr, li'));
      const unicas = [...new Set(linhas)].slice(0, 8);
      caixa(resumo + (busca ? '<div style="font-size:13px">Busquei <b>' + esc(cp.pagador || '') + '</b> na lista de pacientes.</div>' : '<div style="font-size:13px">Abra <b>Pacientes</b> e busque a paciente.</div>') +
        (unicas.length ? '<div style="font-size:13px;margin-top:6px">' + (unicas.length > 1 ? '<b>' + unicas.length + ' possíveis pacientes</b>: abra a correta (nada é escolhido sozinho) e clique de novo no 💰.' : '1 paciente encontrada: abra a ficha dela e clique de novo no 💰.') + '<ul style="margin:6px 0 0;padding-left:18px">' + unicas.map((n) => '<li>' + esc(n.textContent.replace(/\s+/g, ' ').trim().slice(0, 90)) + '</li>').join('') + '</ul></div>'
          : '<div style="font-size:13px;margin-top:6px;color:#b04848"><b>PACIENTE NÃO IDENTIFICADO</b> nesta tela. Busque pelo nome, CPF ou celular, abra a ficha da paciente e clique de novo no 💰.</div>'));
      return;
    }
    const val = C.validar(cp, p);
    const c = caixa(resumo + '<div style="font-size:13px"><b>Paciente aberta no AmigoApp:</b><br>' + esc(p.nome) + '<span style="color:#5b6b82">' + esc([p.idAmigo ? ' · ID ' + p.idAmigo : '', p.cpf ? ' · CPF ' + p.cpf : '', p.celular ? ' · ' + p.celular : ''].join('')) + '</span></div>' +
      (val.status === 'confirmada' ? '<div style="margin-top:8px;color:#1f7d52;font-weight:bold">✓ CORRESPONDÊNCIA CONFIRMADA</div>' : '<div style="margin-top:8px;color:#b04848;font-weight:bold">⚠ DIVERGÊNCIA ENCONTRADA</div><ul style="margin:4px 0 0;padding-left:18px;font-size:12.5px">' + val.divergencias.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul>') +
      btn('bf-usar', val.status === 'confirmada' ? 'Usar esta paciente' : 'Usar esta paciente mesmo assim', val.status === 'confirmada' ? '#1f7d52' : '#a46d1c') +
      '<div style="font-size:12px;color:#5b6b82;margin-top:6px">O lançamento é confirmado na janela <b>Controle financeiro</b>.</div>');
    c.querySelector('#bf-usar').onclick = async () => {
      try {
        const j = await api('paciente', { id: pend.id, paciente: p });
        caixa(j.ok ? '<div style="color:#1f7d52;font-weight:bold">✅ Paciente enviada para a conciliação</div><div style="font-size:13px;margin-top:6px">Volte à janela <b>Controle financeiro</b> para conferir e <b>confirmar o lançamento</b>.</div>' : '<div style="color:#b04848">' + esc(j.erro) + '</div>');
      } catch (e) { caixa('<div style="color:#b04848">' + esc(e.message) + '</div>'); }
    };
    return;
  }

  // ================= qualquer outro site =================
  if (!cfg.site) await pedirCfg(false);
  window.open(cfg.site + '/financeiro', 'blueFinanceiro');
})();
