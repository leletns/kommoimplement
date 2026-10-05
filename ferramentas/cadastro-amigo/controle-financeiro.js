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
    c.innerHTML = '<div style="font-weight:bold;font-size:15px;margin-bottom:8px">💰 Controle financeiro <span style="font-weight:normal;font-size:11px;color:#8a97a8">gestão · v3</span></div>' + html + '<div style="margin-top:10px;text-align:right"><button id="bf-x" style="border:0;background:#e9f6ef;color:#13294a;border-radius:8px;padding:6px 12px;cursor:pointer">Fechar</button></div>';
    c.querySelector('#bf-x').onclick = () => c.remove();
    return c;
  };
  const inp = 'style="width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #dbe4f0;border-radius:8px;font:13px Arial;margin-top:4px"';
  const btn = (id, t, cor) => '<button id="' + id + '" style="margin-top:8px;border:0;background:' + (cor || '#13294a') + ';color:#fff;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:bold">' + t + '</button>';
  // Endereço do site (e, no AmigoApp, a senha da gestão): pedido só na primeira vez, guardado neste navegador.
  // "clinicablue.pages.dev", "http://…/financeiro" → "https://clinicablue.pages.dev"
  const endereco = (v) => { let x = String(v || '').trim(); if (!x) return ''; if (!/^https?:\/\//i.test(x)) x = 'https://' + x; if (!/^http:\/\/(localhost|127\.)/i.test(x)) x = x.replace(/^http:\/\//i, 'https://'); try { return new URL(x).origin; } catch (e) { return x.replace(/\/+$/, ''); } };
  if (cfg.site) cfg.site = endereco(cfg.site);
  const pedirCfg = (precisaSenha) => new Promise((ok) => {
    const c = caixa('<div style="font-size:12px;color:#5b6b82">Só na primeira vez (fica salvo neste navegador):</div><input id="bf-site" ' + inp + ' placeholder="Endereço do site (https://…)" value="' + esc(cfg.site || '') + '">' +
      (precisaSenha ? '<input id="bf-senha" type="password" ' + inp + ' placeholder="Senha da gestão">' : '') + btn('bf-ok', 'Continuar'));
    c.querySelector('#bf-ok').onclick = () => {
      cfg.site = endereco(c.querySelector('#bf-site').value);
      if (precisaSenha) cfg.senha = c.querySelector('#bf-senha').value;
      try { localStorage.setItem('blueFinCfg', JSON.stringify(cfg)); } catch (e) { /* ok */ }
      ok();
    };
  });
  const host = location.hostname;

  // ================= WhatsApp Web =================
  if (/(^|\.)whatsapp\.com$/.test(host)) {
    if (!cfg.site) await pedirCfg(false);
    // Mensagem enviada junto com o comprovante: legenda da foto + mensagens vizinhas da mesma pessoa (até 15 min antes/depois).
    // É ela que diz de quem é o pagamento ("Segue pagamento da paciente…", "Pagamento: R$ 900 de R$ 1.800").
    const linhaDe = (el) => el.closest('[role="row"]') || el.closest('[data-id]') || el.parentElement;
    const todasLinhas = () => { const r = [...document.querySelectorAll('#main [role="row"]')]; return r.length ? r : [...document.querySelectorAll('#main [data-id]')].filter((x) => !x.parentElement.closest('[data-id]')); };
    const infoLinha = (row) => {
      const pre = row.querySelector('[data-pre-plain-text]');
      const meta = /\[(\d{1,2}):(\d{2}),\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]\s*([^:]+):/.exec(pre ? pre.getAttribute('data-pre-plain-text') : '');
      const quando = meta ? new Date(+(meta[5].length === 2 ? '20' + meta[5] : meta[5]), +meta[4] - 1, +meta[3], +meta[1], +meta[2]).getTime() : null;
      const partes = [...row.querySelectorAll('span.selectable-text, .copyable-text span[dir]')].map((x) => x.innerText.trim()).filter(Boolean);
      const texto = [...new Set(partes)].join('\n') || (pre ? pre.innerText.trim() : '');
      return { autor: meta ? meta[6].trim() : '', quando, texto, temImagem: !!row.querySelector('img[src^="blob:"]') };
    };
    const contexto = (img) => {
      const rows = todasLinhas(), row = linhaDe(img), i = rows.indexOf(row);
      const base = infoLinha(row);
      if (i < 0) return base.texto;
      // Foto sem legenda não traz autor/hora: usa os da primeira mensagem de texto logo depois (quem mandou o comprovante).
      if (!base.autor) { const prox = rows.slice(i + 1, i + 3).map(infoLinha).find((x) => x.autor && !x.temImagem); if (prox) { base.autor = prox.autor; base.quando = prox.quando; } }
      const perto = (x) => (!base.autor || !x.autor || x.autor === base.autor) && (!base.quando || !x.quando || Math.abs(x.quando - base.quando) <= 15 * 60e3);
      const antes = [], depois = [];
      for (let k = i - 1; k >= Math.max(0, i - 2); k--) { const x = infoLinha(rows[k]); if (x.temImagem || !perto(x)) break; if (x.texto) antes.unshift(x.texto); }
      for (let k = i + 1; k < Math.min(rows.length, i + 4); k++) { const x = infoLinha(rows[k]); if (x.temImagem || !perto(x)) break; if (x.texto) depois.push(x.texto); }
      return [...antes, base.texto, ...depois].filter(Boolean).join('\n').slice(0, 1500);
    };
    const pagina = (msg) => cfg.site + '/financeiro#whatsapp-colar' + (msg ? '&m=' + encodeURIComponent(msg) : '');
    // Imagens de mensagens (blob:) — o visualizador aberto primeiro; ícones, figurinhas e fotos de perfil ficam de fora.
    const imgs = [...document.querySelectorAll('img[src^="blob:"]')].filter((i) => i.naturalWidth >= 200 && i.naturalHeight >= 200 && !i.closest('header') && !i.closest('#blue-fin-box'));
    const grande = imgs.slice().sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
    const naConversa = imgs.filter((i) => i.closest('#main') || i.closest('[data-id]'));
    const lista = [...new Set([...(grande && !naConversa.includes(grande) ? [grande] : []), ...naConversa.reverse()])].slice(0, 8);
    const msgs = lista.map((i) => { try { return naConversa.includes(i) ? contexto(i) : ''; } catch (e) { return ''; } });
    const c = caixa(lista.length
      ? '<div style="font-size:13px">Clique no comprovante (o mais recente primeiro):</div><div id="bf-l" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">' +
        lista.map((i, k) => '<button data-k="' + k + '" style="border:2px solid #dbe4f0;background:#f4f8fd;border-radius:10px;padding:4px;cursor:pointer;text-align:left"><img src="' + i.src + '" style="width:100%;height:110px;object-fit:cover;border-radius:6px"><div style="font-size:11px;color:#5b6b82;max-height:44px;overflow:hidden">' +
          (msgs[k] ? '💬 ' + esc(msgs[k].replace(/\s+/g, ' ').slice(0, 80)) : (i === grande && !naConversa.includes(i) ? 'imagem aberta' : 'sem mensagem junto')) + '</div></button>').join('') + '</div>' +
        '<div style="font-size:12px;color:#5b6b82;margin-top:8px">A mensagem enviada junto vai para a página e ajuda a identificar a paciente. Comprovante em PDF: baixe pelo WhatsApp e arraste na página.</div>' + btn('bf-abrir', 'Abrir sem comprovante', '#2f6fb5')
      : '<div style="font-size:13px">Não achei imagem nesta conversa. Abra a conversa com o comprovante (ou clique na imagem para ampliar) e clique de novo no botão. PDF: baixe e arraste na página.</div>' + btn('bf-abrir', 'Abrir Controle financeiro', '#2f6fb5'));
    c.querySelector('#bf-abrir').onclick = () => window.open(cfg.site + '/financeiro#whatsapp', 'blueFinanceiro');
    c.querySelectorAll('#bf-l button').forEach((b) => {
      b.onclick = () => {
        const img = lista[Number(b.dataset.k)], destino = pagina(msgs[Number(b.dataset.k)]);
        // PNG para a área de transferência (o Safari só aceita PNG). A Promise mantém o "clique" válido no Safari.
        const png = (async () => {
          const blob = await (await fetch(img.src)).blob();
          const bmp = await createImageBitmap(blob);
          const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; cv.getContext('2d').drawImage(bmp, 0, 0);
          return new Promise((ok) => cv.toBlob(ok, 'image/png'));
        })();
        let copiou = Promise.reject(new Error('sem suporte'));
        try { copiou = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); } catch (e) { /* cai no download */ }
        const janela = window.open(destino, 'blueFinanceiro');
        copiou.then(() => {
          caixa('<div style="font-weight:bold;color:#1f7d52">✅ Comprovante copiado</div><div style="font-size:13px;margin-top:6px">Na janela <b>Controle financeiro</b>, aperte <b>⌘V</b> (Mac) ou <b>Ctrl+V</b>.' + (janela ? '' : ' Se a janela não abriu: <a href="' + esc(destino) + '" target="_blank" style="color:#2f6fb5;font-weight:bold">abrir Controle financeiro</a>.') + '</div>');
        }).catch(async () => {
          // Sem permissão de copiar: baixa o arquivo para arrastar na página.
          const blob = await png; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'comprovante-' + new Date().toISOString().slice(0, 19).replace(/\D/g, '') + '.png';
          document.body.appendChild(a); a.click(); a.remove();
          caixa('<div style="font-weight:bold">⬇️ Comprovante baixado</div><div style="font-size:13px;margin-top:6px">O navegador não deixou copiar. Arraste o arquivo baixado para a página <b>Controle financeiro</b>.' + (janela ? '' : ' <a href="' + esc(destino) + '" target="_blank" style="color:#2f6fb5;font-weight:bold">Abrir Controle financeiro</a>') + '</div>');
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
    const p0 = lerPaciente();
    let pend = null, falhou = '';
    try { pend = (await api('pendente')).conciliacao; } catch (e) {
      if (/senha/i.test(e.message)) { caixa('<div style="color:#b04848">' + esc(e.message) + '</div>'); return; }
      falhou = e.message;
    }
    if (falhou) {
      // Sem comunicação com o servidor daqui: a paciente vai pelo endereço da página Controle financeiro (lá a chamada é do próprio site).
      const c0 = caixa('<div style="color:#b04848;font-size:13px">Não consegui falar com o Controle financeiro em <b>' + esc(cfg.site) + '</b> (' + esc(falhou) + ').</div>' +
        '<div style="font-size:12px;color:#5b6b82;margin-top:4px">O endereço certo é <b>https://clinicablue.pages.dev</b>. Se estiver diferente, clique em "Corrigir o endereço". Bloqueador de anúncios também pode impedir: libere o site.</div>' +
        (p0 ? '<div style="font-size:13px;margin-top:8px">Paciente aberta: <b>' + esc(p0.nome) + '</b></div>' + btn('bf-pag', 'Enviar a paciente pela página', '#1f7d52') : '<div style="font-size:13px;margin-top:8px">Abra a ficha da paciente e clique de novo no 💰.</div>') +
        btn('bf-end', 'Corrigir o endereço do site', '#2f6fb5'));
      if (p0) c0.querySelector('#bf-pag').onclick = () => window.open(cfg.site + '/financeiro#paciente=' + encodeURIComponent(JSON.stringify(p0)), 'blueFinanceiroAmigo');
      c0.querySelector('#bf-end').onclick = () => { delete cfg.site; try { localStorage.setItem('blueFinCfg', JSON.stringify(cfg)); } catch (e) { /* ok */ } caixa('<div style="font-size:13px">Clique de novo no botão 💰 e digite <b>https://clinicablue.pages.dev</b>.</div>'); };
      return;
    }
    if (!pend) { caixa('<div style="font-size:13px">Nenhum comprovante esperando conferência. Primeiro leia o comprovante no <b>WhatsApp Web</b> (botão 💰) ou na página <a href="' + esc(cfg.site) + '/financeiro" target="_blank" style="color:#2f6fb5">Controle financeiro</a>.</div>'); return; }
    const cp = pend.comprovante || {};
    const mg = cp.mensagem || {};
    const resumo = '<div style="font-size:12.5px;background:#f4f8fd;border-radius:8px;padding:8px;margin-bottom:8px"><b>Comprovante em conferência</b><br>' + esc([cp.pagador ? 'pago por ' + cp.pagador : 'pagador não lido', cp.valor ? C.brl(cp.valor, cp.moeda) : '', cp.data, cp.forma].filter(Boolean).join(' · ')) +
      (mg.nome || mg.resumoItens || mg.procedimento ? '<br>💬 Mensagem: ' + esc([mg.nome ? 'paciente ' + mg.nome : '', mg.resumoItens || mg.procedimento, mg.desconto ? 'desconto ' + mg.desconto + '%' : ''].filter(Boolean).join(' · ')) : '') + '</div>';
    const quemBuscar = mg.nome || cp.pagador || '';
    const conferir = (p) => {
      const val = C.validar(cp, p);
      const c = caixa(resumo + '<div style="font-size:13px"><b>Paciente no AmigoApp:</b><br>' + esc(p.nome) + '<span style="color:#5b6b82">' + esc([p.idAmigo ? ' · ID ' + p.idAmigo : '', p.cpf ? ' · CPF ' + p.cpf : '', p.celular ? ' · ' + p.celular : ''].join('')) + '</span></div>' +
        (val.status === 'confirmada' ? '<div style="margin-top:8px;color:#1f7d52;font-weight:bold">✓ CORRESPONDÊNCIA CONFIRMADA</div>' : '<div style="margin-top:8px;color:#b04848;font-weight:bold">⚠ DIVERGÊNCIA ENCONTRADA</div><ul style="margin:4px 0 0;padding-left:18px;font-size:12.5px">' + val.divergencias.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul>') +
        (val.avisos.length ? '<div style="font-size:12px;color:#a46d1c;margin-top:6px">' + val.avisos.map(esc).join('<br>') + '</div>' : '') +
        btn('bf-usar', val.status === 'confirmada' ? 'Usar esta paciente' : 'Usar esta paciente mesmo assim', val.status === 'confirmada' ? '#1f7d52' : '#a46d1c') +
        '<div style="font-size:12px;color:#5b6b82;margin-top:6px">O lançamento é confirmado na janela <b>Controle financeiro</b>.</div>');
      c.querySelector('#bf-usar').onclick = async () => {
        try {
          const j = await api('paciente', { id: pend.id, paciente: p });
          caixa(j.ok ? '<div style="color:#1f7d52;font-weight:bold">✅ Paciente enviada para a conciliação</div><div style="font-size:13px;margin-top:6px">Volte à janela <b>Controle financeiro</b> para conferir e <b>confirmar o lançamento</b>.</div>' : '<div style="color:#b04848">' + esc(j.erro) + '</div>');
        } catch (e) { caixa('<div style="color:#b04848">' + esc(e.message) + '</div>'); }
      };
    };
    if (p0) { conferir(p0); return; }
    // Sem paciente aberta: busca na própria base do AmigoApp, com a sessão que a gestão já tem aberta (só leitura).
    const amigoApi = async (caminho) => {
      const tok = localStorage.getItem('token');
      if (!tok) throw new Error('sem sessão do Amigo');
      const r = await fetch('https://api.amigoapp.com.br' + caminho, { headers: { Authorization: 'Bearer ' + tok, 'company-id': localStorage.getItem('log_in') || '', Accept: 'application/json' } });
      if (!r.ok) throw new Error('Amigo ' + r.status);
      return r.json();
    };
    const listaDe = (j) => { const a = Array.isArray(j) ? j : (j && (j.data || j.patients || j.items || j.results || j.rows)) || []; return Array.isArray(a) ? a : (Array.isArray(a.data) ? a.data : []); };
    const paraPaciente = (x) => ({ nome: String(x.name || x.nome || x.full_name || x.label || '').trim(), idAmigo: String(x.id || x._id || x.value || ''), cpf: x.cpf || x.document || '', celular: x.cellphone || x.contact_cellphone || x.phone || x.mobile || '', nascimento: x.born || x.birthdate || '', fonte: 'AmigoApp (busca)' });
    let achados = null;
    if (quemBuscar) {
      // Nomes parecidos: busca com o nome completo, primeiro + último, só o último sobrenome e o primeiro nome; junta e ordena pela semelhança.
      const ps = quemBuscar.trim().split(/\s+/).filter((w) => !/^(d[aeo]s?|e)$/i.test(w));
      const buscas = [...new Set([quemBuscar, ps.length > 2 ? ps[0] + ' ' + ps[ps.length - 1] : '', ps.length > 1 ? ps[ps.length - 1] : '', ps[0]].filter((q) => q && q.length >= 3))];
      const vistos = new Map();
      try {
        for (const q of buscas) {
          for (const x of listaDe(await amigoApi('/api/patient/suggest?name=' + encodeURIComponent(q) + '&reduce=true')).map(paraPaciente)) if (x.nome && !vistos.has(x.idAmigo || x.nome)) vistos.set(x.idAmigo || x.nome, x);
          const bons = [...vistos.values()].filter((x) => C.compararNomes(quemBuscar, x.nome).nivel !== 'diferente');
          if (bons.length && q !== buscas[0]) break; // achou parecidos: não precisa buscar mais
          if (bons.some((x) => /igual|forte/.test(C.compararNomes(quemBuscar, x.nome).nivel))) break;
        }
        achados = [...vistos.values()].map((x) => ({ ...x, sem: C.compararNomes(quemBuscar, x.nome) })).filter((x) => x.sem.nivel !== 'diferente')
          .sort((a, b) => b.sem.nota - a.sem.nota).slice(0, 10);
      } catch (e) { achados = null; }
    }
    if (achados) {
      const c = caixa(resumo + '<div style="font-size:13px">Busquei <b>' + esc(quemBuscar) + '</b> nos pacientes do AmigoApp' + (mg.nome ? ' (nome da mensagem)' : ' (nome de quem pagou)') + '.</div>' +
        (achados.length ? '<div style="font-size:13px;margin-top:6px">' + (achados.length > 1 ? '<b>' + achados.length + ' possíveis pacientes</b>: escolha a correta (nada é escolhido sozinho).' : '1 paciente encontrada: confira e escolha.') + '</div>' +
          achados.map((x, k) => { const v = C.validar(cp, x); return '<button data-k="' + k + '" style="display:block;width:100%;text-align:left;margin-top:6px;border:1px solid #dbe4f0;background:#f4f8fd;border-radius:8px;padding:8px;cursor:pointer"><b>' + esc(x.nome) + '</b> ' + (v.status === 'confirmada' ? '<span style="color:#1f7d52">✓</span>' : '<span style="color:#a46d1c">⚠</span>') + '<br><span style="font-size:12px;color:#5b6b82">' + esc([x.idAmigo ? 'ID ' + x.idAmigo : '', x.cpf, x.celular, x.sem ? 'nome ' + x.sem.nota + '% parecido' : ''].filter(Boolean).join(' · ')) + '</span></button>'; }).join('')
          : '<div style="font-size:13px;margin-top:6px;color:#b04848"><b>PACIENTE NÃO IDENTIFICADO</b> no AmigoApp com esse nome. Busque pelo CPF ou celular, abra a ficha da paciente e clique de novo no 💰.</div>'));
      c.querySelectorAll('button[data-k]').forEach((b) => {
        b.onclick = async () => {
          const x = achados[Number(b.dataset.k)];
          try { const d = await amigoApi('/api/patient/' + encodeURIComponent(x.idAmigo)); const dd = paraPaciente(d && (d.data || d)); x.cpf = x.cpf || dd.cpf; x.celular = x.celular || dd.celular; x.nascimento = x.nascimento || dd.nascimento; } catch (e) { /* segue com o que a busca trouxe */ }
          conferir(x);
        };
      });
      return;
    }
    {
      // Lista de pacientes: preenche a busca do Amigo com o nome do pagador e mostra quem aparece na lista (sem escolher).
      const busca = [...document.querySelectorAll('input[type="search"], input[type="text"]')].find((i) => visivel(i) && /busc|pesquis|procur|nome|cpf|search/i.test((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '')));
      if (busca && quemBuscar && !busca.value) {
        busca.focus(); busca.select && busca.select(); document.execCommand('insertText', false, quemBuscar);
        if (busca.value !== quemBuscar) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(busca, quemBuscar); }
        ['input', 'change', 'keyup'].forEach((ev) => busca.dispatchEvent(new Event(ev, { bubbles: true })));
        busca.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
        busca.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
      }
      await new Promise((r) => setTimeout(r, 1500));
      const toks = norm(quemBuscar).split(' ').filter((t) => t.length > 2);
      const linhas = [...document.querySelectorAll('tr, li, [class*="list-item"], [class*="card"], a')].filter((n) => visivel(n) && n.textContent.length < 300 && toks.length && toks.filter((t) => norm(n.textContent).includes(t)).length >= Math.min(2, toks.length) && !n.querySelector('tr, li'));
      const unicas = [...new Set(linhas)].slice(0, 8);
      caixa(resumo + (busca ? '<div style="font-size:13px">Busquei <b>' + esc(quemBuscar) + '</b> na lista de pacientes' + (mg.nome ? ' (nome da mensagem)' : ' (nome de quem pagou)') + '.</div>' : '<div style="font-size:13px">Abra <b>Pacientes</b> e busque a paciente.</div>') +
        (unicas.length ? '<div style="font-size:13px;margin-top:6px">' + (unicas.length > 1 ? '<b>' + unicas.length + ' possíveis pacientes</b>: abra a correta (nada é escolhido sozinho) e clique de novo no 💰.' : '1 paciente encontrada: abra a ficha dela e clique de novo no 💰.') + '<ul style="margin:6px 0 0;padding-left:18px">' + unicas.map((n) => '<li>' + esc(n.textContent.replace(/\s+/g, ' ').trim().slice(0, 90)) + '</li>').join('') + '</ul></div>'
          : '<div style="font-size:13px;margin-top:6px;color:#b04848"><b>PACIENTE NÃO IDENTIFICADO</b> nesta tela. Busque pelo nome, CPF ou celular, abra a ficha da paciente e clique de novo no 💰.</div>'));
      return;
    }
    return;
  }

  // ================= qualquer outro site =================
  if (!cfg.site) await pedirCfg(false);
  window.open(cfg.site + '/financeiro', 'blueFinanceiro');
})();
