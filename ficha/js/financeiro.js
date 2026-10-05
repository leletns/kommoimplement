// Página /financeiro (gestão): comprovante → OCR no navegador → dados → paciente conferida no AmigoApp → conciliação → lançamento → planilha.
(function () {
  'use strict';
  const C = window.BlueComprovante;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* navegação privada */ } };
  const lerLS = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const S = { arquivo: null, hash: '', texto: '', lido: null, concId: null, paciente: null, dup: null, candidatos: [], val: null, poll: null, lancado: false };
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
    $('st').innerHTML = 'Conectado. Planilha: ' + (j.planilha ? '<b style="color:var(--ok)">ligada</b>' : '<b style="color:var(--warn)">não configurada</b> (os lançamentos ficam guardados e vão para a planilha quando ela for ligada)');
    if (j.planilhaLink) { $('l-planilha').href = j.planilhaLink; $('l-planilha').classList.remove('hide'); }
    listar();
  }
  $('senha').addEventListener('change', status);

  // ---------- 1. comprovante ----------
  const drop = $('drop');
  drop.addEventListener('click', () => $('arq').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') $('arq').click(); });
  $('arq').addEventListener('change', () => { if ($('arq').files[0]) receber($('arq').files[0]); });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('on'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('on'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) receber(f); });
  document.addEventListener('paste', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const it = [...(e.clipboardData && e.clipboardData.items || [])].find((i) => i.kind === 'file' && /^(image\/|application\/pdf)/.test(i.type));
    if (it) { e.preventDefault(); receber(it.getAsFile()); }
  });

  const carregarScript = (src) => new Promise((ok, erro) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('Não consegui carregar ' + src)); document.head.appendChild(s); });
  const progresso = (t, v) => { $('ocr').classList.remove('hide'); $('ocr-t').textContent = t; if (v != null) $('ocr-p').value = v; };

  async function imagemParaCanvas(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error('Formato de imagem não suportado neste navegador.')); i.src = url; });
      // Comprovante pequeno (print do celular) fica melhor no OCR ampliado.
      const esc2 = Math.min(3, Math.max(1, 1600 / img.naturalWidth));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * esc2); cv.height = Math.round(img.naturalHeight * esc2);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      return cv;
    } finally { URL.revokeObjectURL(url); }
  }

  let worker = null;
  async function ocr(canvas) {
    if (!window.Tesseract) { progresso('Carregando o leitor de texto (só na primeira vez)…', 0); await carregarScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'); }
    if (!worker) worker = await window.Tesseract.createWorker('por', 1, { logger: (m) => { if (m.status === 'recognizing text') progresso('Lendo o comprovante…', m.progress); else progresso('Preparando a leitura: ' + m.status, m.progress); } });
    const r = await worker.recognize(canvas);
    return { texto: r.data.text, confianca: r.data.confidence };
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

  async function receber(file) {
    if (!$('senha').value) { alert('Digite a senha da gestão primeiro.'); $('senha').focus(); return; }
    Object.assign(S, { arquivo: file, paciente: null, concId: null, lancado: false, val: null });
    clearInterval(S.poll);
    ['dados', 'pac', 'conc'].forEach((id) => $(id).classList.add('hide'));
    $('lanc-res').innerHTML = ''; $('dup').innerHTML = ''; $('obs').value = ''; $('esperado').value = ''; $('msg-txt').value = ''; S.mensagem = null;
    try {
      S.hash = await sha256(file);
      let r;
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
        progresso('Lendo o PDF…', 0.2); r = await lerPdf(file);
        $('prev').src = r.canvas.toDataURL('image/png');
      } else {
        $('prev').src = URL.createObjectURL(file);
        r = await ocr(await imagemParaCanvas(file));
      }
      $('prev').style.display = 'block';
      S.texto = r.texto;
      S.lido = C.lerComprovante(r.texto, { confiancaOcr: r.confianca });
      S.lido.confiancaOcr = Math.round(r.confianca);
      $('ocr').classList.add('hide');
      mostrarDados();
      await registrarConciliacao();
    } catch (e) {
      progresso('Não consegui ler: ' + e.message, 0);
    }
  }

  // ---------- 2. dados ----------
  const CAMPOS = ['pagador', 'pagadorDoc', 'valor', 'moeda', 'data', 'hora', 'forma', 'banco', 'recebedor', 'bancoRecebedor', 'idTransacao'];
  const mostra = (k, v) => (k === 'valor' && v != null && v !== '' ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : v == null ? '' : String(v));
  function mostrarDados() {
    for (const k of CAMPOS) { const el = $('c-' + k); el.value = mostra(k, S.lido[k]); el.classList.remove('mudou'); }
    $('bruto').textContent = S.texto;
    if (MSG_WHATS && !$('msg-txt').value) $('msg-txt').value = MSG_WHATS;
    lerMsg();
    // ID do Pix lido com erro: o campo fica marcado para a gestão conferir na imagem.
    $('c-idTransacao').classList.toggle('mudou', !!S.lido.idDuvida);
    $('c-idTransacao').title = S.lido.idDuvida || '';
    $('dados').classList.remove('hide');
  }
  // Mensagem enviada junto: diz de quem é o pagamento, o que foi pago (1ª/2ª parte) e de quê.
  function lerMsg() {
    S.mensagem = C.lerMensagem($('msg-txt').value);
    const m = S.mensagem || {};
    const pedacos = [m.nome ? 'Paciente: <b>' + esc(m.nome) + '</b>' : '', m.procedimento ? 'Procedimento: <b>' + esc(m.procedimento) + '</b>' : '',
      m.pago ? 'Pago: <b>' + C.brl(m.pago) + (m.total && m.total !== m.pago ? ' de ' + C.brl(m.total) : '') + '</b>' : '',
      m.parcela ? { reserva: 'reserva (1ª parte)', restante: '2ª parte / restante', integral: 'integral' }[m.parcela] : '',
      m.consultaEm ? 'Consulta: ' + esc(m.consultaEm) : '', m.desconto ? 'Desconto: ' + m.desconto + '%' : '', m.obs ? 'Obs.: ' + esc(m.obs) : ''].filter(Boolean);
    $('msg-lido').innerHTML = $('msg-txt').value.trim() ? (pedacos.length ? 'Entendi: ' + pedacos.join(' · ') : 'Não achei nome de paciente nem valor nesta mensagem.') : '';
  }
  let tMsg = null;
  const salvarComprovante = () => { clearTimeout(tMsg); tMsg = setTimeout(() => { if (S.concId && !S.lancado) api('comprovante', { id: S.concId, comprovante: atual() }); }, 700); };
  $('msg-txt').addEventListener('input', () => { lerMsg(); conciliar(); salvarComprovante(); });
  const numero = (s) => { const t = String(s || '').replace(/[^\d,.-]/g, ''); if (!t) return null; const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
  function atual() {
    const c = {};
    for (const k of CAMPOS) c[k] = $('c-' + k).value.trim();
    c.valor = numero(c.valor);
    c.tipoId = S.lido.tipoId;
    c.idDuvida = c.idTransacao === S.lido.idTransacao ? S.lido.idDuvida : '';
    c.mensagem = S.mensagem && Object.keys(S.mensagem).length > 1 ? S.mensagem : null;
    c.confianca = S.lido.confianca;
    return c;
  }
  const corrigidos = () => CAMPOS.filter((k) => { const a = $('c-' + k).value.trim(), b = mostra(k, S.lido[k]); return a !== b; });
  CAMPOS.forEach((k) => $('c-' + k).addEventListener('input', () => { $('c-' + k).classList.toggle('mudou', corrigidos().includes(k)); conciliar(); checarDup(); salvarComprovante(); }));

  function mostrarDup(d) {
    S.dup = d;
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
      if (j.ok) mostrarDup(j.duplicidade);
    }, 500);
  }

  async function registrarConciliacao() {
    const j = await api('conciliacao', { comprovante: { ...atual(), texto: undefined }, hash: S.hash, origem: ORIGEM });
    if (!j.ok) { $('dup').innerHTML = '<div class="res bad">' + esc(j.erro) + '</div>'; return; }
    S.concId = j.id; S.candidatos = j.candidatos || [];
    mostrarDup(j.duplicidade);
    $('pac').classList.remove('hide');
    mostrarPaciente();
    clearInterval(S.poll);
    S.poll = setInterval(acompanhar, 2500);
  }

  // ---------- 3. paciente ----------
  function mostrarPaciente() {
    const p = S.paciente;
    if (p) {
      $('pac-res').innerHTML = '<div class="res ok"><b>Paciente: ' + esc(p.nome) + '</b><div style="font-size:13px;color:var(--ink)">' + [p.idAmigo ? 'ID AmigoApp ' + p.idAmigo : '', p.cpf ? 'CPF ' + p.cpf : '', p.celular, 'fonte: ' + (p.fonte || '')].filter(Boolean).map(esc).join(' · ') + '</div></div>';
      $('cands').innerHTML = '';
    } else {
      const pm = S.mensagem && S.mensagem.nome;
      $('pac-res').innerHTML = '<div class="res bad"><h3>PACIENTE NÃO IDENTIFICADO</h3>' + (pm ? 'A mensagem indica a paciente <b>' + esc(pm) + '</b>. Abra a ficha dela no AmigoApp para conferir.' : 'Confira a paciente no AmigoApp antes de lançar.') + ' Nada é lançado sem paciente.</div>';
      $('cands').innerHTML = S.candidatos.length ? '<div class="muted" style="margin-top:8px">' + (S.candidatos.length > 1 ? 'Mais de uma paciente possível. Escolha a correta (nada é escolhido sozinho):' : 'Possível paciente (pelo histórico deste pagador). Confirme clicando:') + '</div>' +
        S.candidatos.map((c, i) => '<button type="button" class="cand" data-i="' + i + '"><b>' + esc(c.nome) + '</b> <span class="muted">' + esc([c.idAmigo ? 'ID ' + c.idAmigo : '', c.fonte].filter(Boolean).join(' · ')) + '</span></button>').join('') : '';
      $('cands').querySelectorAll('button').forEach((b) => { b.onclick = async () => { const c = S.candidatos[+b.dataset.i]; const j = await api('paciente', { id: S.concId, paciente: { ...c, fonte: c.fonte } }); if (j.ok) { S.paciente = j.paciente; mostrarPaciente(); conciliar(); } }; });
    }
    $('conc').classList.toggle('hide', !p);
    if (p) conciliar();
  }
  async function acompanhar() {
    if (!S.concId || S.lancado) return clearInterval(S.poll);
    const j = await api('conciliacao', { id: S.concId }, 'GET');
    if (j.ok && j.conciliacao.paciente && JSON.stringify(j.conciliacao.paciente) !== JSON.stringify(S.paciente)) { S.paciente = j.conciliacao.paciente; mostrarPaciente(); checarDup(); }
    if (j.ok && j.conciliacao.status === 'lancada') { S.lancado = true; clearInterval(S.poll); }
  }
  $('b-amigo').onclick = () => window.open('https://app.amigoapp.com.br/patients', 'amigoPacientes');

  // ---------- 4. conciliação ----------
  function correspondencia(c, p, val) {
    const n = C.compararNomes(c.pagador, p.nome).nivel, cpf = C.compararCpf(c.pagadorDoc, p.cpf);
    let s = { igual: 100, forte: 92, fraca: 55, diferente: 15 }[n];
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
    const linhas = '<table style="margin-top:6px"><tbody>' + [['Paciente', S.paciente.nome], ['Valor', c.valor > 0 ? C.brl(c.valor, c.moeda) : '—'], ['Data', c.data || '—'], ['Pagamento', c.forma || '—'], ['Banco', c.banco || '—'], ['ID', c.idTransacao || '—'], ['Pagador', c.pagador || '—'],
      ...(c.mensagem ? [['Mensagem', [c.mensagem.nome, c.mensagem.procedimento, c.mensagem.pago ? C.brl(c.mensagem.pago) + (c.mensagem.total && c.mensagem.total !== c.mensagem.pago ? ' de ' + C.brl(c.mensagem.total) : '') : '', c.mensagem.desconto ? 'desconto ' + c.mensagem.desconto + '%' : ''].filter(Boolean).join(' · ') || '—']] : [])]
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
  $('obs').addEventListener('input', habilitar);
  $('resp').addEventListener('input', habilitar);
  $('esperado').addEventListener('input', conciliar);

  $('b-lancar').onclick = async () => {
    if (!$('resp').value.trim()) { alert('Informe quem está conferindo.'); return; }
    $('b-lancar').disabled = true;
    const c = atual(), p = S.paciente, corr = corrigidos();
    const obs = [$('obs').value.trim(), c.mensagem && c.mensagem.obs ? 'Obs. da mensagem: ' + c.mensagem.obs : '', corr.length ? 'Corrigido à mão: ' + corr.join(', ') : ''].filter(Boolean).join(' · ');
    const j = await api('lancar', {
      ...c, paciente: p.nome, pacienteIdAmigo: p.idAmigo, pacienteCpf: p.cpf, hash: S.hash,
      referencia: (S.arquivo && S.arquivo.name ? S.arquivo.name : 'comprovante colado') + ' · sha256 ' + S.hash.slice(0, 12),
      origem: ORIGEM + ' · paciente: ' + (p.fonte || 'AmigoApp'), conciliacaoId: S.concId, responsavel: $('resp').value.trim(), observacoes: obs,
      divergencias: S.val ? S.val.divergencias : [], confirmarDivergencia: $('ok-div').checked, confirmarNaoDuplicado: $('ok-dup').checked, corrigidos: corr,
    });
    if (j.ok) {
      S.lancado = true; clearInterval(S.poll);
      const pl = j.planilha || {};
      $('lanc-res').innerHTML = '<div class="res ok"><h3>✓ Lançamento #' + j.id + ' registrado</h3>' + esc(j.lancamento.paciente) + ' · ' + C.brl(j.lancamento.valor, j.lancamento.moeda) + ' · ' + esc(j.lancamento.status === 'conferido' ? 'conferido' : 'conferido com divergência') +
        '<br>Planilha: ' + (pl.ok ? '<b>atualizada' + (pl.linha ? ' (linha ' + pl.linha + ')' : '') + '</b>' : '<b style="color:var(--warn)">pendente</b> (' + esc(pl.erro || '') + '). O lançamento está salvo; use "Reenviar pendentes à planilha".') + '</div>';
      listar();
    } else {
      $('lanc-res').innerHTML = '<div class="res bad"><h3>' + esc(j.erro) + '</h3>' + (j.duplicidade ? 'Nenhum lançamento novo foi criado.' : '') + '</div>';
      if (j.duplicidade) mostrarDup(j.duplicidade);
      habilitar();
    }
  };
  $('b-desc').onclick = async () => { if (S.concId) await api('descartar', { id: S.concId }); clearInterval(S.poll); location.reload(); };

  // ---------- lista / planilha ----------
  async function listar() {
    const j = await api('lancamentos', { dias: 60 }, 'GET');
    if (!j.ok) return;
    const tb = $('tab').querySelector('tbody');
    tb.innerHTML = j.lancamentos.map((l) => '<tr><td>' + l.id + '</td><td>' + esc(l.dataComprovante || '') + '</td><td>' + esc(l.paciente) + (l.pacienteIdAmigo ? '<div class="muted">ID ' + esc(l.pacienteIdAmigo) + '</div>' : '') + '</td><td>' + esc(l.pagador || '') + '</td><td>' + C.brl(l.valor, l.moeda) + '</td><td>' + esc(l.forma || '') + '</td><td>' +
      (l.status === 'conferido' ? 'Conferido' : '<span style="color:var(--warn)">Com divergência</span>') + '</td><td>' + (/^ok/.test(l.planilha) ? '✓' : '<span style="color:var(--warn)" title="' + esc(l.planilhaErro || '') + '">pendente</span>') + '</td></tr>').join('') || '<tr><td colspan="8" class="muted">Nenhum lançamento ainda.</td></tr>';
    const total = j.lancamentos.filter((l) => l.moeda === 'BRL').reduce((a, l) => a + l.valor, 0);
    const pend = j.lancamentos.filter((l) => !/^ok/.test(l.planilha)).length;
    $('tot').textContent = j.lancamentos.length + ' lançamento(s) · ' + C.brl(total, 'BRL') + (pend ? ' · ' + pend + ' ainda não estão na planilha' : '');
  }
  $('b-sync').onclick = async () => { const j = await api('sincronizar', {}); alert(j.ok ? (j.resultado.length ? j.resultado.filter((r) => r.ok).length + ' de ' + j.resultado.length + ' enviados à planilha.' + (j.resultado.some((r) => !r.ok) ? ' Erro: ' + j.resultado.find((r) => !r.ok).erro : '') : 'Nada pendente.') : j.erro); listar(); };

  if (/colar/.test(location.hash)) drop.querySelector('b').textContent = 'Comprovante copiado do WhatsApp: aperte ⌘V (ou Ctrl+V) para colar';
  status();
})();
