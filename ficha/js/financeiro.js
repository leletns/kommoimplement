// Página /financeiro (gestão): comprovantes → OCR no navegador → fila → paciente conferida no AmigoApp → conciliação → lançamento → planilha.
// Um comprovante (colar ⌘V) ou vários (arrastar arquivos, pacote .zip do botão 💰 ou conversa exportada do WhatsApp).
(function () {
  'use strict';
  const C = window.BlueComprovante;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* navegação privada */ } };
  const lerLS = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  // S = comprovante aberto no editor. FILA = todos os comprovantes desta sessão.
  const S = { arquivo: null, hash: '', texto: '', lido: null, concId: null, paciente: null, dup: null, candidatos: [], val: null, poll: null, lancado: false };
  const FILA = [];
  let ATUAL = null, seq = 0;
  const ORIGEM = /whatsapp/.test(location.hash) ? 'WhatsApp Web (botão Controle financeiro)' : 'Página Controle financeiro';
  // Mensagem que veio junto com o comprovante no WhatsApp (o botão manda no endereço). Sai do endereço logo depois de lida.
  let MSG_WHATS = '';
  try { MSG_WHATS = new URLSearchParams(location.hash.slice(1)).get('m') || ''; } catch (e) { MSG_WHATS = ''; }
  if (MSG_WHATS) history.replaceState(null, '', location.pathname + (/colar/.test(location.hash) ? '#whatsapp-colar' : '#whatsapp'));

  $('senha').value = lerLS('blueFinSenha');
  $('resp').value = lerLS('blueFinResp');
  $('resp').addEventListener('change', () => guardar('blueFinResp', $('resp').value.trim()));

  async function api(acao, corpo, metodo) {
    const senha = $('senha').value;
    const r = await fetch('/api/financeiro?acao=' + acao + (metodo === 'GET' && corpo ? '&' + new URLSearchParams(corpo) : ''), {
      method: metodo || (corpo ? 'POST' : 'GET'),
      headers: { 'x-financeiro-senha': senha, 'content-type': 'application/json' },
      body: metodo === 'GET' || !corpo ? undefined : JSON.stringify(corpo),
    });
    let j = {}; try { j = await r.json(); } catch (e) { j = { ok: false, erro: 'Resposta inválida do servidor (' + r.status + ')' }; }
    if (r.status === 401) { guardar('blueFinSenha', ''); $('st').innerHTML = '<span style="color:var(--bad)">Senha incorreta.</span>'; $('senha').focus(); }
    else if (j.ok) guardar('blueFinSenha', senha);
    j.status = r.status;
    return j;
  }

  async function status() {
    if (!$('senha').value) { $('st').textContent = 'Digite a senha da gestão.'; return; }
    const j = await api('status', null, 'GET');
    if (!j.ok) { if (j.status !== 401) $('st').innerHTML = '<span style="color:var(--bad)">' + esc(j.erro) + '</span>'; return; }
    $('st').innerHTML = 'Conectado ✓ · Os lançamentos aparecem sozinhos na planilha do Google (botão <b>🔗 Ligar a planilha</b>, uma vez só).';
    $('b-sync').classList.toggle('hide', !j.planilha);
    if (j.planilhaLink) { $('l-planilha').href = j.planilhaLink; $('l-planilha').classList.remove('hide'); }
    listar();
  }
  $('senha').addEventListener('change', status);

  // ---------- 1. entrada: colar, arrastar, escolher (um ou vários, .zip) ----------
  const drop = $('drop');
  $('zip-op').classList.remove('hide');
  drop.addEventListener('click', () => $('arq').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') $('arq').click(); });
  $('arq').addEventListener('change', () => { if ($('arq').files.length) entrar([...$('arq').files]); $('arq').value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('on'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('on'); }));
  drop.addEventListener('drop', (e) => { const fs = [...(e.dataTransfer.files || [])]; if (fs.length) entrar(fs); });
  document.addEventListener('paste', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const it = [...(e.clipboardData && e.clipboardData.items || [])].find((i) => i.kind === 'file' && /^(image\/|application\/pdf)/.test(i.type));
    if (it) { e.preventDefault(); receber(it.getAsFile()); }
  });

  // Botão grande de colar (o comprovante veio copiado do WhatsApp). Usa a área de transferência com a permissão do navegador.
  if (/colar/.test(location.hash)) $('colar-box').classList.remove('hide');
  $('b-colar').onclick = async () => {
    try {
      const itens = await navigator.clipboard.read();
      for (const it of itens) {
        const tipo = it.types.find((t) => /^image\//.test(t) || t === 'application/pdf');
        if (tipo) { const blob = await it.getType(tipo); $('colar-box').classList.add('hide'); return receber(new File([blob], 'comprovante-whatsapp.' + (tipo.split('/')[1] || 'png'), { type: tipo })); }
      }
      alert('Não achei imagem copiada. Volte ao WhatsApp e clique de novo no comprovante no painel 💰.');
    } catch (e) { alert('O navegador não deixou ler a área de transferência. Clique na página e aperte Ctrl+V (⌘V no Mac).'); }
  };

  const ehZip = (f) => /\.zip$/i.test(f.name || '') || /zip/.test(f.type || '');
  function receber(file) {
    const msg = MSG_WHATS; MSG_WHATS = '';
    return adicionar([{ file, mensagem: msg }]);
  }
  async function entrar(files) {
    if (!$('senha').value) { alert('Digite a senha da gestão primeiro.'); $('senha').focus(); return; }
    const itens = [];
    for (const f of files) {
      if (ehZip(f)) {
        progresso('Abrindo ' + f.name + '…', 0.1);
        try {
          const dias = Number($('zip-dias').value);
          const z = await window.BlueFilaZip.abrirZip(f, { desde: dias ? new Date(new Date().setHours(0, 0, 0, 0) - (dias - 1) * 86400e3).getTime() : 0 });
          if (!z.itens.length) progresso(z.origem === 'conversa' ? 'Nenhum comprovante (imagem ou PDF) na conversa exportada neste período.' : 'Nenhuma imagem ou PDF dentro do .zip.', 0);
          else $('ocr').classList.add('hide');
          itens.push(...z.itens);
        } catch (e) { progresso('Não consegui abrir o .zip: ' + e.message, 0); }
      } else if (/^(image\/|application\/pdf)/.test(f.type) || /\.(jpe?g|png|webp|heic|pdf)$/i.test(f.name || '')) itens.push({ file: f, mensagem: files.length === 1 ? MSG_WHATS : '' });
    }
    if (files.length === 1) MSG_WHATS = '';
    if (itens.length) adicionar(itens);
  }

  // ---------- fila ----------
  function adicionar(lista) {
    if (!$('senha').value) { alert('Digite a senha da gestão primeiro.'); $('senha').focus(); return; }
    for (const x of lista) {
      const it = { k: ++seq, file: x.file, nome: x.file ? x.file.name : '', msg: x.mensagem || '', quando: x.quando || null, estado: 'esperando', thumb: '' };
      if (x.file && /^image\//.test(x.file.type)) it.thumb = URL.createObjectURL(x.file);
      FILA.push(it);
    }
    renderFila();
    processarFila();
  }
  let rodando = false;
  async function processarFila() {
    if (rodando) return;
    rodando = true;
    try {
      for (let it = FILA.find((x) => x.estado === 'esperando'); it; it = FILA.find((x) => x.estado === 'esperando')) await processar(it);
    } finally { rodando = false; }
    pollFila();
  }
  const varios = () => FILA.length > 1;
  async function processar(it) {
    it.estado = 'lendo'; renderFila();
    try {
      it.hash = await sha256(it.file);
      // Mesmo arquivo já lançado: no lote, nem lê de novo.
      const d0 = await api('duplicidade', { hash: it.hash });
      if (d0.ok && d0.duplicidade.tipo === 'certa' && varios()) { it.dup = d0.duplicidade; it.estado = 'dup'; renderFila(); return; }
      let r;
      if (it.file.type === 'application/pdf' || /\.pdf$/i.test(it.nome)) {
        progresso('Lendo o PDF' + (varios() ? ' (' + it.nome + ')' : '') + '…', 0.2); r = await lerPdf(it.file);
        it.thumb = r.canvas.toDataURL('image/png');
      } else {
        r = await ocr(await imagemParaCanvas(it.file), it.nome);
      }
      $('ocr').classList.add('hide');
      it.texto = r.texto;
      it.lido = C.lerComprovante(r.texto, { confiancaOcr: r.confianca });
      it.lido.confiancaOcr = Math.round(r.confianca);
      if (it.lido.tipoDocumento === 'Cartão' && !it.lido.cartaoFinal) it.lido.cartaoFinal = await finalDoCartao(r);
      it.mensagem = C.lerMensagem(it.msg);
      it.comp = comprovanteDe(it.lido, it.mensagem);
      if (d0.ok && d0.duplicidade.tipo === 'certa') { it.dup = d0.duplicidade; it.estado = 'dup'; }
      else {
        const j = await api('conciliacao', { comprovante: it.comp, hash: it.hash, origem: ORIGEM + (varios() ? ' · lote' : '') });
        if (!j.ok) throw new Error(j.erro || 'erro no servidor');
        it.concId = j.id; it.candidatos = j.candidatos || []; it.dup = j.duplicidade; it.estado = 'conferir';
        // Mesmo pagamento já lançado (mesmo ID da transação/NSU/nota): sai da fila de conferência na hora.
        if (j.duplicidade && j.duplicidade.tipo === 'certa') { await api('descartar', { id: j.id }); it.concId = null; it.estado = 'dup'; }
      }
    } catch (e) { it.estado = 'erro'; it.erro = e.message; progresso('Não consegui ler' + (it.nome ? ' ' + it.nome : '') + ': ' + e.message, 0); }
    renderFila();
    if (!ATUAL && it.estado !== 'erro' && (!varios() || it === FILA.find((x) => x.lido))) abrir(it);
  }
  const comprovanteDe = (lido, mensagem) => {
    const c = {};
    for (const k of CAMPOS) c[k] = lido[k] == null ? '' : lido[k];
    c.valor = lido.valor; c.tipoId = lido.tipoId; c.idDuvida = lido.idDuvida || ''; c.confianca = lido.confianca; c.adquirente = lido.adquirente || '';
    c.mensagem = mensagem && Object.keys(mensagem).length > 1 && (mensagem.nome || mensagem.resumoItens || mensagem.pago) ? mensagem : null;
    return c;
  };

  function estadoDe(it) {
    if (it.estado === 'esperando') return ['Na fila', 'neu'];
    if (it.estado === 'lendo') return ['Lendo…', 'neu'];
    if (it.estado === 'erro') return ['Não consegui ler', 'bad'];
    if (it.estado === 'dup') return ['Já lançado', 'bad'];
    if (it.estado === 'lancado') return ['Lançado #' + it.lancId, 'ok'];
    if (it.estado === 'descartado') return ['Descartado', 'neu'];
    if (!it.paciente) return it.amigo && it.amigo.lista && it.amigo.lista.length ? ['Escolher paciente', 'warn'] : it.amigo ? ['Paciente não achada no Amigo', 'bad'] : ['Falta conferir a paciente', 'warn'];
    if (it.dup && it.dup.tipo === 'certa') return ['Já lançado', 'bad'];
    const v = C.validar(it.comp, it.paciente);
    if (v.divergencias.length) return ['Divergência', 'bad'];
    if (it.dup && it.dup.tipo === 'provavel') return ['Possível duplicado', 'warn'];
    return ['Pronto para lançar', 'ok'];
  }
  const pronto = (it) => it.estado === 'conferir' && estadoDe(it)[0] === 'Pronto para lançar';
  function renderFila() {
    const ativos = FILA.filter((x) => x.estado !== 'descartado');
    $('fila-box').classList.toggle('hide', ativos.length < 2 && !ativos.some((x) => x !== ATUAL));
    $('fila').querySelector('tbody').innerHTML = ativos.map((it) => {
      const [t, cls] = estadoDe(it), c = it.comp || {};
      return '<tr data-k="' + it.k + '"' + (it === ATUAL ? ' class="sel"' : '') + '><td>' + (it.thumb ? '<img src="' + esc(it.thumb) + '" alt="">' : '📄') + '</td><td><span class="st ' + cls + '">' + esc(t) + '</span></td><td>' +
        esc(it.paciente ? it.paciente.nome : (c.mensagem && c.mensagem.nome) || c.pagador || it.nome || '') + (it.paciente && it.paciente.idAmigo ? '<div class="muted">ID Amigo ' + esc(it.paciente.idAmigo) + '</div>' : '') + '</td><td>' + (c.valor > 0 ? C.brl(c.valor, c.moeda) : '—') + '</td><td>' +
        esc([c.forma, c.bandeira, c.parcelas > 1 ? c.parcelas + 'x' : ''].filter(Boolean).join(' · ') || '—') + '</td><td>' + esc(c.data || '') + '</td></tr>';
    }).join('');
    $('fila').querySelectorAll('tr[data-k]').forEach((tr) => { tr.onclick = () => { const it = FILA.find((x) => x.k === +tr.dataset.k); if (it && it.lido) abrir(it); }; });
    const prontos = FILA.filter(pronto);
    $('b-lote').disabled = !prontos.length;
    $('b-lote').textContent = '✓ Lançar as prontas (' + prontos.length + (prontos.length ? ' · ' + C.brl(prontos.reduce((a, x) => a + (x.comp.moeda === 'USD' ? 0 : x.comp.valor), 0), 'BRL') : '') + ')';
    const pend = FILA.filter((x) => x.estado === 'conferir').length;
    $('fila-resumo').textContent = ativos.length + ' comprovante(s) · ' + FILA.filter((x) => x.estado === 'lancado').length + ' lançado(s) · ' + pend + ' para conferir';
    $('k-fila').textContent = pend;
  }

  // A paciente chega do AmigoApp (o botão 💰 lá confere a fila inteira): atualiza todos os comprovantes da fila.
  let tFila = null;
  async function pollFila() {
    clearTimeout(tFila);
    const esperando = FILA.filter((x) => x.concId && x.estado === 'conferir' && !x.paciente);
    if (!esperando.length) return;
    const j = await api('fila', null, 'GET');
    if (j.ok) {
      const porId = Object.fromEntries(j.fila.map((c) => [c.id, c]));
      for (const it of esperando) {
        const c = porId[it.concId];
        if (!c) continue;
        if (c.candidatos) it.amigo = c.candidatos;
        if (c.paciente) it.paciente = c.paciente;
        if (it === ATUAL) { S.paciente = it.paciente; S.candidatos = candidatosDe(it); mostrarPaciente(); if (it.paciente) checarDup(); }
      }
      renderFila();
    }
    tFila = setTimeout(pollFila, 4000);
  }
  const candidatosDe = (it) => [...(it.amigo && it.amigo.lista ? it.amigo.lista.map((p) => ({ ...p, fonte: p.fonte || 'AmigoApp (busca' + (p.nota ? ', nome ' + p.nota + '% parecido' : '') + ')' })) : []), ...(it.candidatos || [])];

  // ---------- leitura (OCR / PDF) ----------
  const carregarScript = (src) => new Promise((ok, erro) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('Não consegui carregar ' + src)); document.head.appendChild(s); });
  const progresso = (t, v) => { $('ocr').classList.remove('hide'); $('ocr-t').textContent = t; if (v != null) $('ocr-p').value = v; };

  // Foto de celular: amplia, passa para tons de cinza e estica o contraste (papel acinzentado, sombra, nota fiscal impressa).
  async function imagemParaCanvas(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error('Formato de imagem não suportado neste navegador.')); i.src = url; });
      const esc2 = Math.min(3, Math.max(img.naturalWidth > 3000 ? 3000 / img.naturalWidth : 1, 1600 / img.naturalWidth));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * esc2); cv.height = Math.round(img.naturalHeight * esc2);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      return cv;
    } finally { URL.revokeObjectURL(url); }
  }
  function realcar(cv, binario) {
    const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
    const g = out.getContext('2d'); g.drawImage(cv, 0, 0);
    const im = g.getImageData(0, 0, out.width, out.height), p = im.data, hist = new Uint32Array(256);
    for (let i = 0; i < p.length; i += 4) { const y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0; p[i] = y; hist[y]++; }
    const total = p.length / 4; let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc <= total * 0.02) lo = v; if (acc <= total * 0.98) hi = v; }
    if (hi - lo < 30) { lo = 0; hi = 255; }
    // Limiar de Otsu (preto e branco) para a segunda tentativa.
    let lim = 128;
    if (binario) { let soma = 0; for (let v = 0; v < 256; v++) soma += v * hist[v]; let sB = 0, wB = 0, melhor = 0; for (let v = 0; v < 256; v++) { wB += hist[v]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += v * hist[v]; const mB = sB / wB, mF = (soma - sB) / wF, entre = wB * wF * (mB - mF) * (mB - mF); if (entre > melhor) { melhor = entre; lim = v; } } }
    for (let i = 0; i < p.length; i += 4) { let y = (p[i] - lo) * 255 / (hi - lo); y = binario ? (y >= (lim - lo) * 255 / (hi - lo) ? 255 : 0) : Math.max(0, Math.min(255, y)); p[i] = p[i + 1] = p[i + 2] = y; }
    g.putImageData(im, 0, 0);
    return out;
  }

  let worker = null;
  async function ocr(canvas, nome) {
    if (!window.Tesseract) { progresso('Carregando o leitor de texto (só na primeira vez)…', 0); await carregarScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'); }
    const rot = varios() && nome ? ' (' + nome + ')' : '';
    if (!worker) worker = await window.Tesseract.createWorker('por', 1, { logger: (m) => { if (m.status === 'recognizing text') progresso('Lendo o comprovante' + (window.__finRot || '') + '…', m.progress); else progresso('Preparando a leitura: ' + m.status, m.progress); } });
    window.__finRot = rot;
    // 1ª leitura: imagem com contraste ajustado e giro automático (foto torta ou de lado).
    const cv1 = realcar(canvas, false);
    const r1 = await worker.recognize(cv1, { rotateAuto: true }, { blocks: true, text: true });
    let melhor = { texto: r1.data.text, confianca: r1.data.confidence, linhas: r1.data.lines, rot: r1.data.rotateRadians, canvas: cv1 };
    // Foto ruim (confiança baixa): tenta de novo em preto e branco e fica com a melhor.
    if (melhor.confianca < 65) {
      const r2 = await worker.recognize(realcar(canvas, true), { rotateAuto: true });
      if (r2.data.confidence > melhor.confianca) melhor = { ...melhor, texto: r2.data.text, confianca: r2.data.confidence };
    }
    return melhor;
  }
  // Final do cartão ("************1234"): o OCR costuma trocar a fileira de asteriscos por letras e perder os números.
  // Acha a linha dos asteriscos (ou a logo abaixo da bandeira), recorta só o fim dela e lê de novo só com números.
  async function finalDoCartao(r) {
    if (!r.linhas || !r.canvas) return '';
    const linhas = r.linhas, txt = (l) => String(l.text || '').trim();
    const alvo = linhas.filter((l) => (txt(l).match(/[*xXA#•]/g) || []).length >= 4 && !/[a-z]{3}|r\$|valor|nsu|aut|cnpj|cpf/i.test(txt(l)));
    const iB = linhas.findIndex((l) => /visa|master|elo|amex|hiper|credito|crédito|debito|débito/i.test(txt(l)));
    if (!alvo.length && iB >= 0 && linhas[iB + 1]) alvo.push(linhas[iB + 1]);
    if (!alvo.length) return '';
    const rc = document.createElement('canvas'); rc.width = r.canvas.width; rc.height = r.canvas.height;
    const g = rc.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, rc.width, rc.height);
    g.translate(rc.width / 2, rc.height / 2); g.rotate(r.rot || 0); g.drawImage(r.canvas, -rc.width / 2, -rc.height / 2);
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '*0123456789' });
      // Várias leituras (recortes e tamanhos diferentes): só aceita o número que aparecer em pelo menos duas. Final errado é pior que final em branco.
      for (const l of alvo.slice(0, 2)) {
        const votos = {};
        for (const frac of [0.38, 0.3]) for (const k of [1, 2, 3]) {
          const bb = l.bbox, x0 = bb.x1 - (bb.x1 - bb.x0) * frac - 6, pad = 10, w = bb.x1 - x0 + 2 * pad, h = bb.y1 - bb.y0 + 2 * pad;
          const cr = document.createElement('canvas'); cr.width = w * k; cr.height = h * k;
          const g2 = cr.getContext('2d'); g2.fillStyle = '#fff'; g2.fillRect(0, 0, cr.width, cr.height); g2.drawImage(rc, x0 - pad, bb.y0 - pad, w, h, 0, 0, cr.width, cr.height);
          const m = /(\d{4})\s*$/.exec((await worker.recognize(cr)).data.text.trim());
          if (m) { votos[m[1]] = (votos[m[1]] || 0) + 1; if (votos[m[1]] >= 3) return m[1]; }
        }
        const [melhor, n] = Object.entries(votos).sort((a, b) => b[1] - a[1])[0] || [];
        if (n >= 2 && Object.values(votos).filter((v) => v === n).length === 1) return melhor;
      }
    } catch (e) { /* segue sem o final */ } finally { try { await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' }); } catch (e) { /* ok */ } }
    return '';
  }

  async function lerPdf(blob) {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const pag = await doc.getPage(1);
    // PDF do banco quase sempre tem texto: lê direto, linha por linha (pela posição vertical).
    const tc = await pag.getTextContent();
    const linhas = {};
    for (const it of tc.items) { const y = Math.round(it.transform[5]); (linhas[y] = linhas[y] || []).push(it); }
    const texto = Object.keys(linhas).map(Number).sort((a, b) => b - a).map((y) => linhas[y].sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    const vp = pag.getViewport({ scale: 2 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    await pag.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    if (texto.replace(/\s/g, '').length >= 40) return { texto, confianca: 95, canvas: cv };
    const o = await ocr(cv); // PDF escaneado (só imagem)
    return { ...o, canvas: cv };
  }

  async function sha256(blob) {
    const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- 2. editor de um comprovante ----------
  const CAMPOS = ['pagador', 'pagadorDoc', 'valor', 'moeda', 'data', 'hora', 'forma', 'banco', 'recebedor', 'bancoRecebedor', 'idTransacao', 'tipoDocumento', 'bandeira', 'cartaoFinal', 'nsu', 'autorizacao', 'parcelas', 'numeroNota'];
  const mostra = (k, v) => (k === 'valor' && v != null && v !== '' ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : v == null ? '' : String(v));
  function guardarAtual() {
    if (!ATUAL || !ATUAL.lido || !$('c-valor')) return;
    ATUAL.comp = atual(); ATUAL.msg = $('msg-txt').value; ATUAL.obs = $('obs').value;
  }
  function abrir(it) {
    if (ATUAL && ATUAL !== it) guardarAtual();
    ATUAL = it;
    clearInterval(S.poll);
    Object.assign(S, { arquivo: it.file || { name: it.nome }, hash: it.hash, texto: it.texto || '', lido: it.lido, concId: it.concId || null, paciente: it.paciente || null, candidatos: candidatosDe(it), val: null, lancado: it.estado === 'lancado' || it.estado === 'dup' });
    $('lanc-res').innerHTML = it.lancId ? '<div class="res ok"><h3>✓ Lançamento #' + it.lancId + ' registrado</h3></div>' : '';
    $('obs').value = it.obs || ''; $('esperado').value = ''; $('ok-div').checked = false; $('ok-dup').checked = false;
    if (it.thumb) { $('prev').src = it.thumb; $('prev').style.display = 'block'; } else $('prev').style.display = 'none';
    mostrarDados(it);
    mostrarDup(it.dup);
    if (it.concId) {
      $('pac').classList.remove('hide');
      mostrarPaciente();
      if (!S.lancado) S.poll = setInterval(acompanhar, 2500);
    } else ['pac', 'conc'].forEach((id) => $(id).classList.add('hide'));
    renderFila();
  }
  function mostrarDados(it) {
    const base = it && it.comp ? it.comp : S.lido;
    for (const k of CAMPOS) { const el = $('c-' + k); el.value = mostra(k, base[k]); el.classList.toggle('mudou', mostra(k, base[k]) !== mostra(k, S.lido[k])); }
    $('bruto').textContent = S.texto;
    $('msg-txt').value = it ? it.msg || '' : $('msg-txt').value;
    lerMsg();
    // ID do Pix lido com erro: o campo fica marcado para a gestão conferir na imagem.
    if (S.lido.idDuvida && $('c-idTransacao').value === S.lido.idTransacao) { $('c-idTransacao').classList.add('mudou'); $('c-idTransacao').title = S.lido.idDuvida; } else $('c-idTransacao').title = '';
    mostrarTipo();
    $('dados').classList.remove('hide');
  }
  // Campos de cartão e de nota fiscal só aparecem quando fazem sentido.
  function mostrarTipo() {
    const t = $('c-tipoDocumento').value, f = $('c-forma').value;
    const cartao = t === 'Cartão' || /^Cartão/.test(f) || !!($('c-nsu').value || $('c-bandeira').value);
    document.querySelectorAll('#dados .cartao').forEach((e) => e.classList.toggle('hide', !cartao));
    document.querySelectorAll('#dados .nota').forEach((e) => e.classList.toggle('hide', !(t === 'Nota fiscal' || $('c-numeroNota').value)));
  }
  // Mensagem enviada junto: diz de quem é o pagamento, o que foi pago (1ª/2ª parte) e de quê.
  function lerMsg() {
    S.mensagem = C.lerMensagem($('msg-txt').value);
    const m = S.mensagem || {};
    const pedacos = [m.nome ? 'Paciente: <b>' + esc(m.nome) + '</b>' : '', m.categoria ? esc(m.categoria) + ': <b>' + esc(m.resumoItens) + '</b>' : m.procedimento ? 'Procedimento: <b>' + esc(m.procedimento) + '</b>' : '',
      m.pago ? 'Pago: <b>' + C.brl(m.pago) + (m.total && m.total !== m.pago ? ' de ' + C.brl(m.total) : '') + '</b>' : '',
      m.parcela ? { reserva: 'reserva (1ª parte)', restante: '2ª parte / restante', integral: 'integral', sinal: 'sinal' }[m.parcela] : '',
      m.consultaEm ? 'Consulta: ' + esc(m.consultaEm) : '', m.desconto ? 'Desconto: ' + m.desconto + '%' : '', m.obs ? 'Obs.: ' + esc(m.obs) : ''].filter(Boolean);
    $('msg-lido').innerHTML = $('msg-txt').value.trim() ? (pedacos.length ? 'Entendi: ' + pedacos.join(' · ') : 'Não achei nome de paciente nem valor nesta mensagem.') : '';
  }
  let tMsg = null;
  const salvarComprovante = () => { clearTimeout(tMsg); tMsg = setTimeout(() => { if (S.concId && !S.lancado) api('comprovante', { id: S.concId, comprovante: atual() }); }, 700); };
  $('msg-txt').addEventListener('input', () => { lerMsg(); conciliar(); salvarComprovante(); guardarAtual(); renderFila(); });
  const numero = (s) => { const t = String(s || '').replace(/[^\d,.-]/g, ''); if (!t) return null; const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
  function atual() {
    const c = {};
    for (const k of CAMPOS) c[k] = $('c-' + k).value.trim();
    c.valor = numero(c.valor);
    c.parcelas = c.parcelas ? Number.parseInt(c.parcelas, 10) || null : null;
    c.tipoId = S.lido.tipoId;
    c.idDuvida = c.idTransacao === S.lido.idTransacao ? S.lido.idDuvida : '';
    c.mensagem = S.mensagem && Object.keys(S.mensagem).length > 1 ? S.mensagem : null;
    c.confianca = S.lido.confianca;
    c.adquirente = S.lido.adquirente || '';
    return c;
  }
  const corrigidosDe = (comp, lido) => CAMPOS.filter((k) => mostra(k, comp[k]) !== mostra(k, lido[k]));
  const corrigidos = () => CAMPOS.filter((k) => { const a = $('c-' + k).value.trim(), b = mostra(k, S.lido[k]); return a !== b; });
  CAMPOS.forEach((k) => $('c-' + k).addEventListener('input', () => { $('c-' + k).classList.toggle('mudou', corrigidos().includes(k)); mostrarTipo(); conciliar(); checarDup(); salvarComprovante(); guardarAtual(); renderFila(); }));

  function mostrarDup(d) {
    S.dup = d;
    if (ATUAL) ATUAL.dup = d;
    const box = $('dup');
    if (!d || d.tipo === 'nenhuma') { box.innerHTML = ''; return; }
    const lista = '<ul>' + d.lancamentos.map((l) => '<li>#' + l.id + ' · ' + esc(l.paciente) + ' · ' + C.brl(l.valor, l.moeda) + ' · ' + esc(l.dataComprovante || '') + ' · lançado por ' + esc(l.responsavel) + ' (' + esc(l.motivo) + ')</li>').join('') + '</ul>';
    box.innerHTML = d.tipo === 'certa'
      ? '<div class="res bad"><h3>⚠ PAGAMENTO JÁ REGISTRADO</h3>Este comprovante já foi lançado. Nenhum lançamento novo será criado.' + lista + '</div>'
      : '<div class="res warn"><h3>⚠ Possível pagamento já registrado</h3>Já existe lançamento com o mesmo valor, a mesma data e o mesmo pagador/paciente.' + lista + '</div>';
    conciliar();
  }
  let tDup = null;
  function checarDup() {
    clearTimeout(tDup);
    tDup = setTimeout(async () => {
      const c = atual();
      const j = await api('duplicidade', { idTransacao: c.idTransacao, hash: S.hash, valor: c.valor, data: c.data, pagador: c.pagador, paciente: S.paciente && S.paciente.nome });
      if (j.ok) { mostrarDup(j.duplicidade); renderFila(); }
    }, 500);
  }

  // ---------- 3. paciente ----------
  function mostrarPaciente() {
    const p = S.paciente;
    if (p) {
      $('pac-res').innerHTML = '<div class="res ok"><b>Paciente: ' + esc(p.nome) + '</b><div style="font-size:13px;color:var(--ink)">' + [p.idAmigo ? 'ID AmigoApp ' + p.idAmigo : '', p.cpf ? 'CPF ' + p.cpf : '', p.celular, 'fonte: ' + (p.fonte || '')].filter(Boolean).map(esc).join(' · ') + '</div></div>';
      $('cands').innerHTML = '';
    } else {
      const pm = S.mensagem && S.mensagem.nome;
      const am = ATUAL && ATUAL.amigo;
      $('pac-res').innerHTML = '<div class="res bad"><h3>PACIENTE NÃO IDENTIFICADO</h3>' + (pm ? 'A mensagem indica a paciente <b>' + esc(pm) + '</b>. ' : '') +
        (am && am.lista && !am.lista.length ? 'O AmigoApp não achou ninguém com o nome <b>' + esc(am.busca || '') + '</b>: busque pelo CPF ou celular e abra a ficha.' : am && am.lista ? 'O AmigoApp achou mais de uma possibilidade: escolha abaixo.' : 'Confira a paciente no AmigoApp antes de lançar.') + ' Nada é lançado sem paciente.</div>';
      $('cands').innerHTML = S.candidatos.length ? '<div class="muted" style="margin-top:8px">' + (S.candidatos.length > 1 ? 'Mais de uma paciente possível. Escolha a correta (nada é escolhido sozinho):' : 'Possível paciente. Confirme clicando:') + '</div>' +
        S.candidatos.map((c, i) => '<button type="button" class="cand" data-i="' + i + '"><b>' + esc(c.nome) + '</b> <span class="muted">' + esc([c.idAmigo ? 'ID ' + c.idAmigo : '', c.cpf ? 'CPF ' + c.cpf : '', c.fonte].filter(Boolean).join(' · ')) + '</span></button>').join('') : '';
      $('cands').querySelectorAll('button').forEach((b) => { b.onclick = async () => { const c = S.candidatos[+b.dataset.i]; const j = await api('paciente', { id: S.concId, paciente: { ...c, fonte: c.fonte } }); if (j.ok) { S.paciente = j.paciente; if (ATUAL) ATUAL.paciente = j.paciente; mostrarPaciente(); conciliar(); checarDup(); renderFila(); } }; });
    }
    $('conc').classList.toggle('hide', !p);
    if (p) conciliar();
  }
  async function acompanhar() {
    if (!S.concId || S.lancado) return clearInterval(S.poll);
    const it = ATUAL;
    const j = await api('conciliacao', { id: S.concId }, 'GET');
    if (it !== ATUAL) return;
    if (j.ok && j.conciliacao.candidatos && JSON.stringify(j.conciliacao.candidatos) !== JSON.stringify(it.amigo)) { it.amigo = j.conciliacao.candidatos; if (!S.paciente) { S.candidatos = candidatosDe(it); mostrarPaciente(); } renderFila(); }
    if (j.ok && j.conciliacao.paciente && JSON.stringify(j.conciliacao.paciente) !== JSON.stringify(S.paciente)) { S.paciente = j.conciliacao.paciente; it.paciente = S.paciente; mostrarPaciente(); checarDup(); renderFila(); }
    if (j.ok && j.conciliacao.status === 'lancada') { S.lancado = true; clearInterval(S.poll); }
  }
  const abrirAmigo = () => window.open('https://amigoapp.com.br/patients', 'amigoPacientes');
  $('b-amigo').onclick = abrirAmigo;
  $('b-amigo-lote').onclick = abrirAmigo;

  // ---------- 4. conciliação ----------
  function correspondencia(c, p, val) {
    const n = C.compararNomes(c.pagador, p.nome).nivel, cpf = C.compararCpf(c.pagadorDoc, p.cpf);
    let s = { igual: 100, forte: 92, fraca: 55, diferente: 15 }[n];
    if (c.mensagem && c.mensagem.nome && /igual|forte/.test(C.compararNomes(c.mensagem.nome, p.nome).nivel)) s = Math.max(s, 95);
    if (cpf === 'confere') s = Math.max(s, 99); if (cpf === 'diverge') s = Math.min(s, 10);
    s -= 8 * val.divergencias.filter((d) => !/^Pagador|^CPF|^O comprovante não mostra/.test(d)).length;
    return Math.max(0, Math.min(100, s));
  }
  function conciliar() {
    if (!S.paciente || !S.lido) return;
    const c = atual();
    const esperado = numero($('esperado').value);
    const val = C.validar(c, S.paciente, { esperado: esperado ? { valor: esperado } : null });
    S.val = val;
    const pct = correspondencia(c, S.paciente, val);
    const cartao = [c.bandeira, c.cartaoFinal ? 'final ' + c.cartaoFinal : '', c.parcelas > 1 ? c.parcelas + 'x' : c.parcelas === 1 ? 'à vista' : '', c.nsu ? 'NSU ' + c.nsu : '', c.autorizacao ? 'aut. ' + c.autorizacao : ''].filter(Boolean).join(' · ');
    const linhas = '<table style="margin-top:6px"><tbody>' + [['Paciente', S.paciente.nome], ['Valor', c.valor > 0 ? C.brl(c.valor, c.moeda) : '—'], ['Data', c.data || '—'], ['Pagamento', c.forma || '—'], ...(cartao ? [['Cartão', cartao]] : []), ...(c.numeroNota ? [['Nota fiscal', 'nº ' + c.numeroNota]] : []), ['Banco', c.banco || '—'], ['ID', c.idTransacao || '—'], ['Pagador', c.pagador || '—'],
      ...(c.mensagem ? [['Mensagem', [c.mensagem.nome, c.mensagem.resumoItens || c.mensagem.procedimento, c.mensagem.pago ? C.brl(c.mensagem.pago) + (c.mensagem.total && c.mensagem.total !== c.mensagem.pago ? ' de ' + C.brl(c.mensagem.total) : '') : '', c.mensagem.desconto ? 'desconto ' + c.mensagem.desconto + '%' : ''].filter(Boolean).join(' · ') || '—']] : [])]
      .map(([a, b]) => '<tr><th style="width:120px">' + a + '</th><td style="color:var(--ink)">' + esc(b) + '</td></tr>').join('') + '</tbody></table>';
    const avisos = val.avisos.length ? '<div class="muted" style="margin-top:6px">' + val.avisos.map(esc).join('<br>') + '</div>' : '';
    const dupCerta = S.dup && S.dup.tipo === 'certa';
    $('conc-res').innerHTML = dupCerta ? '<div class="res bad"><h3>⚠ PAGAMENTO JÁ REGISTRADO</h3>Não é possível lançar de novo.</div>'
      : val.status === 'confirmada'
        ? '<div class="res ok"><h3>✓ PAGAMENTO IDENTIFICADO · correspondência confirmada</h3>Correspondência: <b>' + pct + '%</b>' + linhas + avisos + '</div>'
        : '<div class="res bad"><h3>⚠ DIVERGÊNCIA ENCONTRADA</h3>Correspondência: <b>' + pct + '%</b><ul>' + val.divergencias.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul>' + linhas + avisos + '</div>';
    $('l-div').classList.toggle('hide', !val.divergencias.length);
    $('l-dup').classList.toggle('hide', !(S.dup && S.dup.tipo === 'provavel'));
    habilitar();
  }
  function habilitar() {
    const precisaDiv = S.val && S.val.divergencias.length, precisaDup = S.dup && S.dup.tipo === 'provavel';
    $('b-lancar').disabled = S.lancado || !S.paciente || (S.dup && S.dup.tipo === 'certa') || (precisaDiv && (!$('ok-div').checked || !$('obs').value.trim())) || (precisaDup && !$('ok-dup').checked) || !$('resp').value.trim();
  }
  ['ok-div', 'ok-dup'].forEach((id) => $(id).addEventListener('change', habilitar));
  $('obs').addEventListener('input', () => { habilitar(); if (ATUAL) ATUAL.obs = $('obs').value; });
  $('resp').addEventListener('input', habilitar);
  $('esperado').addEventListener('input', conciliar);

  // Dados enviados ao servidor para um lançamento (o mesmo para o botão do editor e para o lote).
  function corpoLancamento(it, comp, extra) {
    const p = it.paciente, corr = corrigidosDe(comp, it.lido);
    const obs = [extra.obs || '', comp.mensagem && comp.mensagem.obs ? 'Obs. da mensagem: ' + comp.mensagem.obs : '', corr.length ? 'Corrigido à mão: ' + corr.join(', ') : ''].filter(Boolean).join(' · ');
    return {
      ...comp, paciente: p.nome, pacienteIdAmigo: p.idAmigo, pacienteCpf: p.cpf, hash: it.hash,
      referencia: (it.nome || 'comprovante colado') + ' · sha256 ' + String(it.hash || '').slice(0, 12),
      origem: ORIGEM + (extra.lote ? ' · lançado em lote' : '') + ' · paciente: ' + (p.fonte || 'AmigoApp'), conciliacaoId: it.concId, responsavel: $('resp').value.trim(), observacoes: obs,
      divergencias: extra.divergencias || [], confirmarDivergencia: !!extra.confirmarDivergencia, confirmarNaoDuplicado: !!extra.confirmarNaoDuplicado, corrigidos: corr,
    };
  }
  const resultadoPlanilha = (pl) => (pl.ok ? '<b>atualizada' + (pl.linha ? ' (linha ' + pl.linha + ')' : '') + '</b>' : '<b style="color:var(--warn)">pendente</b> (' + esc(pl.erro || '') + '). O lançamento está salvo; use "Reenviar pendentes à planilha".');

  $('b-lancar').onclick = async () => {
    if (!$('resp').value.trim()) { alert('Informe quem está conferindo.'); return; }
    $('b-lancar').disabled = true;
    const it = ATUAL;
    const j = await api('lancar', corpoLancamento(it, atual(), { obs: $('obs').value.trim(), divergencias: S.val ? S.val.divergencias : [], confirmarDivergencia: $('ok-div').checked, confirmarNaoDuplicado: $('ok-dup').checked }));
    if (j.ok) {
      S.lancado = true; clearInterval(S.poll);
      it.estado = 'lancado'; it.lancId = j.id; it.comp = atual();
      const prox = FILA.find((x) => x.estado === 'conferir' && x !== it);
      $('lanc-res').innerHTML = '<div class="res ok"><h3>✓ Lançamento #' + j.id + ' registrado</h3>' + esc(j.lancamento.paciente) + ' · ' + C.brl(j.lancamento.valor, j.lancamento.moeda) + ' · ' + esc(j.lancamento.status === 'conferido' ? 'conferido' : 'conferido com divergência') +
        '<br>Planilha: ' + resultadoPlanilha(j.planilha || {}) + (prox ? '<div style="margin-top:8px"><button type="button" class="sec" id="b-prox">Próximo comprovante da fila →</button></div>' : '') + '</div>';
      if (prox) $('b-prox').onclick = () => abrir(prox);
      renderFila();
      listar();
    } else {
      $('lanc-res').innerHTML = '<div class="res bad"><h3>' + esc(j.erro) + '</h3>' + (j.duplicidade ? 'Nenhum lançamento novo foi criado.' : '') + '</div>';
      if (j.duplicidade) mostrarDup(j.duplicidade);
      habilitar();
    }
  };
  $('b-desc').onclick = async () => {
    if (S.concId) await api('descartar', { id: S.concId });
    clearInterval(S.poll);
    if (!varios()) return location.reload();
    if (ATUAL) ATUAL.estado = 'descartado';
    ATUAL = null;
    const prox = FILA.find((x) => x.estado === 'conferir');
    if (prox) abrir(prox); else { ['dados', 'pac', 'conc'].forEach((id) => $(id).classList.add('hide')); $('prev').style.display = 'none'; renderFila(); }
  };

  // Lançar de uma vez tudo o que está pronto (paciente conferida, sem divergência, sem duplicidade).
  $('b-lote').onclick = async () => {
    if (!$('resp').value.trim()) { alert('Informe quem está conferindo.'); $('resp').focus(); return; }
    guardarAtual();
    const prontos = FILA.filter(pronto);
    if (!prontos.length) return;
    const total = prontos.reduce((a, x) => a + (x.comp.moeda === 'USD' ? 0 : x.comp.valor), 0);
    if (!confirm('Lançar ' + prontos.length + ' comprovante(s), ' + C.brl(total, 'BRL') + ', todos com a paciente conferida e sem divergência?\n\n' + prontos.map((x) => '• ' + x.paciente.nome + ' · ' + C.brl(x.comp.valor, x.comp.moeda) + ' · ' + (x.comp.forma || '')).join('\n'))) return;
    $('b-lote').disabled = true;
    const linhas = [];
    for (const it of prontos) {
      const j = await api('lancar', corpoLancamento(it, it.comp, { obs: it.obs || '', lote: true }));
      if (j.ok) { it.estado = 'lancado'; it.lancId = j.id; linhas.push('✓ #' + j.id + ' · ' + esc(it.paciente.nome) + ' · ' + C.brl(it.comp.valor, it.comp.moeda) + ' · planilha ' + (j.planilha && j.planilha.ok ? 'ok' : 'pendente')); }
      else { if (j.duplicidade) it.dup = j.duplicidade; linhas.push('✗ ' + esc(it.paciente.nome) + ': ' + esc(j.erro)); }
      renderFila();
    }
    $('lote-res').innerHTML = '<div class="res ' + (linhas.every((l) => l[0] === '✓') ? 'ok' : 'warn') + '"><h3>Lote lançado</h3>' + linhas.join('<br>') + '</div>';
    if (ATUAL && ATUAL.estado === 'lancado') { S.lancado = true; habilitar(); }
    listar();
  };

  // ---------- painel e lista ----------
  function painel(lancs) {
    const hoje = new Date(), iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dHoje = iso(hoje), seg = new Date(hoje); seg.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
    const dSeg = iso(seg), dMes = dHoje.slice(0, 8) + '01';
    const brl = lancs.filter((l) => l.moeda === 'BRL');
    const dia = (l) => l.dataPagamento || String(l.confirmadoEm || '').slice(0, 10);
    const soma = (f) => { const x = brl.filter(f); return [x.reduce((a, l) => a + l.valor, 0), x.length]; };
    const kpi = (id, [v, n]) => { $(id).textContent = C.brl(v, 'BRL'); $(id + '-n').textContent = n + ' pagamento(s)'; };
    kpi('k-hoje', soma((l) => dia(l) === dHoje));
    kpi('k-semana', soma((l) => dia(l) >= dSeg && dia(l) <= dHoje));
    kpi('k-mes', soma((l) => dia(l) >= dMes && dia(l) <= dHoje));
    const mes = brl.filter((l) => dia(l) >= dMes && dia(l) <= dHoje);
    const agrupar = (f) => { const g = {}; for (const l of mes) { const k = f(l) || 'Não informado'; (g[k] = g[k] || [0, 0]); g[k][0] += l.valor; g[k][1]++; } return Object.entries(g).sort((a, b) => b[1][0] - a[1][0]); };
    const chips = (lst) => lst.map(([k, [v, n]]) => '<span class="chip">' + esc(k) + ' · <b>' + C.brl(v, 'BRL') + '</b> (' + n + ')</span>').join('') || '<span class="muted">—</span>';
    $('k-formas').innerHTML = chips(agrupar((l) => [l.forma, l.bandeira].filter(Boolean).join(' ')));
    $('k-cats').innerHTML = chips(agrupar((l) => l.categoria));
    const usd = lancs.filter((l) => l.moeda === 'USD' && dia(l) >= dMes);
    $('k-mes-n').textContent += usd.length ? ' · + ' + C.brl(usd.reduce((a, l) => a + l.valor, 0), 'USD') : '';
  }
  async function listar() {
    const j = await api('lancamentos', { dias: 62 }, 'GET');
    if (!j.ok) return;
    painel(j.lancamentos);
    const tb = $('tab').querySelector('tbody');
    tb.innerHTML = j.lancamentos.map((l) => '<tr><td>' + l.id + '</td><td>' + esc(l.dataComprovante || '') + '</td><td>' + esc(l.paciente) + (l.pacienteIdAmigo ? '<div class="muted">ID ' + esc(l.pacienteIdAmigo) + '</div>' : '') + '</td><td>' + esc(l.pagador || '') + '</td><td>' + C.brl(l.valor, l.moeda) + '</td><td>' + esc(l.forma || '') + (l.bandeira || l.parcelas > 1 ? '<div class="muted">' + esc([l.bandeira, l.parcelas > 1 ? l.parcelas + 'x' : ''].filter(Boolean).join(' · ')) + '</div>' : '') + '</td><td>' +
      (l.status === 'conferido' ? 'Conferido' : '<span style="color:var(--warn)">Com divergência</span>') + '</td><td>' + (/^ok/.test(l.planilha) ? '✓' : '<span style="color:var(--warn)" title="' + esc(l.planilhaErro || '') + '">pendente</span>') + '</td></tr>').join('') || '<tr><td colspan="8" class="muted">Nenhum lançamento ainda.</td></tr>';
    const total = j.lancamentos.filter((l) => l.moeda === 'BRL').reduce((a, l) => a + l.valor, 0);
    const pend = j.lancamentos.filter((l) => !/^ok/.test(l.planilha)).length;
    $('tot').textContent = j.lancamentos.length + ' lançamento(s) · ' + C.brl(total, 'BRL') + (pend ? ' · ' + pend + ' ainda não estão na planilha' : '');
  }
  $('b-plan').onclick = async () => {
    const j = await api('planilha-link', null, 'GET');
    if (!j.ok) { alert(j.erro || 'Não consegui gerar o link.'); return; }
    $('plan-box').classList.remove('hide');
    $('plan-box').innerHTML = '<b>Link da planilha</b> (é como uma senha: não compartilhe fora da gestão)<br>' +
      '<input id="plan-url" readonly style="margin-top:6px" value="' + esc(j.url) + '">' +
      '<div class="row" style="margin-top:8px"><button type="button" id="plan-criar" style="flex:0 0 auto">✨ Criar a planilha no Google</button><button type="button" class="sec" id="plan-copiar" style="flex:0 0 auto">Copiar só o link</button></div>' +
      '<p style="margin:8px 0 0"><b>Criar a planilha (tudo no navegador, sem Office):</b> clique em ✨, entre na sua conta Google se pedir e, na planilha nova, aperte <b>⌘V</b> (ou Ctrl+V) na célula A1. Pronto: ela já vem ligada ao site e se preenche sozinha.</p>' +
      '<p class="hint" style="margin:6px 0 0">Se preferir a planilha modelo com abas (<a href="/planilha-controle-financeiro.xlsx" download>.xlsx</a>, precisa subir no Google Drive), use Copiar só o link e:</p>' +
      '<ol style="margin:8px 0 0;padding-left:20px"><li>Na aba <b>Configuração</b>, cole o link na célula amarela <b>B3</b>.</li><li>Pronto: as abas Lançamentos e Resumo se preenchem sozinhas (o Google atualiza cerca de 1 vez por hora e sempre que a planilha é aberta).</li></ol>';
    $('plan-criar').onclick = () => criarPlanilhaGoogle(j.url);
    $('plan-copiar').onclick = async () => { try { await navigator.clipboard.writeText(j.url); $('plan-copiar').textContent = 'Copiado ✓'; } catch (e) { $('plan-url').select(); document.execCommand('copy'); $('plan-copiar').textContent = 'Copiado ✓'; } };
  };
  function planilhaHtml(url) {
    const N = 41, navy = '#13294A', claro = '#EAF2FB', cinza = '#6B7890';
    const td = (conteudo, estilo) => '<td style="font-family:Arial;' + (estilo || '') + '">' + conteudo + '</td>';
    const vazio = (n, estilo) => Array.from({ length: n }, () => td('', estilo)).join('');
    const kpi = 'background:' + claro + ';color:' + navy + ';font-weight:bold;font-size:16pt';
    const rot = 'background:' + claro + ';color:' + cinza + ';font-weight:bold;font-size:9pt';
    const cab = 'background:' + navy + ';color:#FFFFFF;font-weight:bold';
    const linhas = [
      td('Controle financeiro · Blue Clínica', 'font-size:18pt;font-weight:bold;color:' + navy) + vazio(N - 1),
      td('Pagamentos conferidos pela gestão. Atualiza sozinha (cerca de 1 vez por hora e sempre que a planilha é aberta). Não edite da linha 6 para baixo.', 'font-size:10pt;color:' + cinza) + vazio(N - 1),
      td('Total recebido (R$)', rot) + td('Lançamentos', rot) + td('Com divergência', rot) + vazio(N - 3),
      td('=SUM(I7:I)', kpi) + td('=COUNT(A7:A)', kpi) + td('=COUNTA(S7:S)', kpi) + vazio(N - 3),
      vazio(N),
      td(esc('=IMPORTDATA("' + url + '")'), cab) + vazio(N - 1, cab),
    ];
    return '<meta charset="utf-8"><table><tbody>' + linhas.map((l) => '<tr>' + l + '</tr>').join('') + '</tbody></table>';
  }
  function planilhaTexto(url) {
    return ['Controle financeiro · Blue Clínica', '', 'Total recebido (R$)\tLançamentos\tCom divergência', '=SUM(I7:I)\t=COUNT(A7:A)\t=COUNTA(S7:S)', '', '=IMPORTDATA("' + url + '")'].join('\n');
  }
  async function criarPlanilhaGoogle(url) {
    const html = planilhaHtml(url), texto = planilhaTexto(url);
    // A cópia começa antes de abrir a aba (o navegador só deixa copiar com a página em foco) e a aba abre ainda no clique (Safari bloqueia depois de esperar).
    let copia;
    try { copia = navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([texto], { type: 'text/plain' }) })]); } catch (e) { copia = Promise.reject(e); }
    const aba = window.open('https://sheets.new', '_blank');
    let copiou = false;
    try {
      await copia;
      copiou = true;
    } catch (e) {
      const div = document.createElement('div'); div.contentEditable = 'true'; div.innerHTML = html; div.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(div); const r = document.createRange(); r.selectNodeContents(div); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      try { copiou = document.execCommand('copy'); } catch (e2) { /* sem cópia */ }
      sel.removeAllRanges(); div.remove();
    }
    $('plan-criar').textContent = copiou ? 'Copiado ✓ cole (⌘V) na célula A1 da planilha nova' : 'Não consegui copiar: use Copiar só o link';
    if (!aba) alert('O navegador bloqueou a nova aba. Abra sheets.new e cole (⌘V) na célula A1.');
  }
  $('b-sync').onclick = async () => { const j = await api('sincronizar', {}); alert(j.ok ? (j.resultado.length ? j.resultado.filter((r) => r.ok).length + ' de ' + j.resultado.length + ' enviados à planilha.' + (j.resultado.some((r) => !r.ok) ? ' Erro: ' + j.resultado.find((r) => !r.ok).erro : '') : 'Nada pendente.') : j.erro); listar(); };

  // Paciente enviada pelo botão no AmigoApp pelo endereço (quando o Amigo não deixa chamar o servidor):
  // retoma a conciliação em andamento e liga a paciente a ela.
  let PAC_HASH = null;
  try { const v = new URLSearchParams(location.hash.slice(1)).get('paciente'); if (v) PAC_HASH = JSON.parse(v); } catch (e) { PAC_HASH = null; }
  if (PAC_HASH) history.replaceState(null, '', location.pathname);
  async function retomar() {
    if (!PAC_HASH || !$('senha').value) return;
    const j = await api('pendente', null, 'GET');
    if (!j.ok || !j.conciliacao) { $('st').innerHTML = '<span style="color:var(--bad)">Recebi a paciente ' + esc(PAC_HASH.nome) + ', mas não há comprovante esperando conferência.</span>'; return; }
    const cc = j.conciliacao;
    const it = { k: ++seq, file: null, nome: 'comprovante da conciliação', msg: cc.comprovante.mensagem && cc.comprovante.mensagem.texto || '', estado: 'conferir', hash: cc.hash, texto: cc.comprovante.texto || '', lido: cc.comprovante, comp: cc.comprovante, concId: cc.id, candidatos: [], thumb: '' };
    FILA.push(it);
    abrir(it);
    const r = await api('paciente', { id: cc.id, paciente: PAC_HASH });
    if (r.ok) { S.paciente = r.paciente; it.paciente = r.paciente; $('pac').classList.remove('hide'); mostrarPaciente(); checarDup(); renderFila(); }
    PAC_HASH = null;
  }
  $('senha').addEventListener('change', retomar);
  if (/colar/.test(location.hash)) drop.querySelector('b').textContent = 'Comprovante copiado do WhatsApp: aperte ⌘V (ou Ctrl+V) para colar';
  if (/lote/.test(location.hash)) drop.querySelector('b').textContent = 'Arraste aqui o pacote .zip que acabou de baixar do WhatsApp (pasta Downloads)';
  status();
  retomar();
})();
