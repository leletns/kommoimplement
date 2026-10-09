// Botão "📊 Conciliar grupo" (gestão) — use no WhatsApp Web com o grupo "Comprovantes de pagamento" aberto.
// Escolha o período e clique em "Ler e conciliar": o botão rola o grupo até o início do período, junta as mensagens,
// as imagens e os PDFs dos comprovantes e manda tudo para a página /conciliacao, que lê os comprovantes e monta a planilha.
// O WhatsApp Web bloqueia chamadas a outros sites, mas deixa enviar formulário: é assim que os arquivos chegam ao sistema.
// Só leitura: não envia nada no WhatsApp. A chave do botão vem da página /conciliacao (__CHAVE__ é trocada na instalação).
(() => {
  const SITE = '__SITE__', CHAVE = '__CHAVE__';
  const JANELA = 'conciliacao_blue';
  if (!/(^|\.)web\.whatsapp\.com$/.test(location.hostname)) { alert('Abra o grupo "Comprovantes de pagamento" no WhatsApp Web e clique de novo.'); return; }
  if (!document.querySelector('#main')) { alert('Abra o grupo "Comprovantes de pagamento" e clique de novo.'); return; }
  const velho = document.getElementById('bc-caixa');
  if (velho) velho.remove();
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hoje = new Date(), inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const caixa = document.createElement('div');
  caixa.id = 'bc-caixa';
  caixa.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:340px;background:#fff;color:#13294a;border:2px solid #13294a;border-radius:14px;padding:16px;font:14px/1.4 Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)';
  const inp = 'style="width:100%;padding:7px;border:1px solid #dbe4f0;border-radius:8px;font:14px Arial;margin-top:3px;box-sizing:border-box"';
  caixa.innerHTML = '<div style="font-weight:bold;font-size:15px;margin-bottom:10px">📊 Conciliar grupo</div>' +
    '<div style="display:flex;gap:8px"><label style="flex:1">De<input id="bc-de" type="date" ' + inp + ' value="' + iso(inicioMes) + '"></label>' +
    '<label style="flex:1">Até<input id="bc-ate" type="date" ' + inp + ' value="' + iso(hoje) + '"></label></div>' +
    '<button id="bc-ir" style="margin-top:12px;width:100%;border:0;border-radius:10px;padding:11px;background:#13294a;color:#fff;font:bold 15px Arial;cursor:pointer">Ler e conciliar</button>' +
    '<div id="bc-st" style="margin-top:10px;font-size:13px;color:#5b6b82">Lê as mensagens, fotos, PDFs e imagens enviadas como arquivo do período e abre a planilha.</div>' +
    '<div style="text-align:right;margin-top:8px"><button id="bc-x" style="border:0;background:#eaf2fb;border-radius:8px;padding:5px 11px;cursor:pointer">Fechar</button></div>';
  document.body.appendChild(caixa);
  const $ = (s) => caixa.querySelector(s);
  const st = (t) => { $('#bc-st').textContent = t; };
  $('#bc-x').onclick = () => caixa.remove();

  // ---- leitura da tela ----
  const texto = (el) => {
    let t = '';
    const andar = (n) => {
      if (n.nodeType === 3) t += n.nodeValue;
      else if (n.nodeName === 'IMG') t += n.getAttribute('alt') || '';
      else if (n.nodeName === 'BR') t += '\n';
      else n.childNodes.forEach(andar);
    };
    andar(el);
    return t.trim();
  };
  // "[14:08, 11/09/2026] Maria: " (pt) ou "[2:08 PM, 9/11/2026] Maria: " (en) → { dia: 'AAAA-MM-DD', hora: 'HH:MM', autor }
  const lerCab = (cab) => {
    const c = String(cab || '').match(/^\[(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\.?)?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]\s*(.+?):\s*$/i);
    if (!c) return null;
    let h = Number(c[1]), d = c[4], m = c[5];
    if (c[3]) { [d, m] = [c[5], c[4]]; if (/p/i.test(c[3]) && h < 12) h += 12; if (/a/i.test(c[3]) && h === 12) h = 0; }
    const y = c[6].length === 2 ? '20' + c[6] : c[6];
    return { dia: y + '-' + pad(m) + '-' + pad(d), hora: pad(h) + ':' + c[2], autor: c[7].trim() };
  };
  // Separador de dia ("12/09/2026", "HOJE", "ONTEM", "QUINTA-FEIRA")
  const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const lerSeparador = (t) => {
    const s = String(t || '').trim().toLowerCase();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (/^(hoje|today)$/.test(s)) return iso(d);
    if (/^(ontem|yesterday)$/.test(s)) { d.setDate(d.getDate() - 1); return iso(d); }
    const w = SEMANA.findIndex((x) => s.startsWith(x));
    if (w >= 0) { while (d.getDay() !== w) d.setDate(d.getDate() - 1); return iso(d); }
    return null;
  };
  const rolagem = () => {
    let el = document.querySelector('#main [data-pre-plain-text], #main [role="row"]');
    while (el && el !== document.body) { const cs = getComputedStyle(el); if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) return el; el = el.parentElement; }
    return null;
  };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  // Captura do documento (PDF, PNG, JPG… enviado como arquivo): o WhatsApp monta o arquivo (blob) para baixar; o botão fica com ele em vez de salvar no computador.
  let capturando = null;
  const origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click, origOpen = window.open;
  const ligarCaptura = () => {
    URL.createObjectURL = function (b) { const u = origCreate.apply(this, arguments); if (capturando && b instanceof Blob && /pdf|octet|image\//.test(b.type || 'application/pdf')) capturando(b); return u; };
    HTMLAnchorElement.prototype.click = function () { if (capturando && /^blob:/.test(this.href)) return; return origClick.apply(this, arguments); };
    window.open = function (u) { if (capturando && /^blob:/.test(String(u))) return null; return origOpen.apply(this, arguments); };
  };
  const desligarCaptura = () => { URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick; window.open = origOpen; };
  const pegarPdf = (linha) => new Promise((ok) => {
    let feito = false;
    const fim = (b) => { if (feito) return; feito = true; capturando = null; ok(b || null); };
    capturando = (b) => fim(b);
    const alvo = linha.querySelector('[data-icon*="download"], [data-icon*="document"], [title$=".pdf" i], [title$=".png" i], [title$=".jpg" i], [title$=".jpeg" i], [title$=".webp" i], [title$=".heic" i]') || linha.querySelector('[role="button"]');
    try { (alvo || linha).click(); } catch (e) { /* segue */ }
    setTimeout(() => fim(null), 6000);
  });
  // Imagem do comprovante → JPEG (no máximo 1800 px), para caber no envio
  const jpeg = (img) => new Promise((ok) => {
    try {
      const w0 = img.naturalWidth, h0 = img.naturalHeight;
      if (!w0 || !h0) return ok(null);
      const k = Math.min(1, 1800 / Math.max(w0, h0)), cv = document.createElement('canvas');
      cv.width = Math.round(w0 * k); cv.height = Math.round(h0 * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => ok(b), 'image/jpeg', 0.82);
    } catch (e) { ok(null); }
  });

  $('#bc-ir').onclick = async () => {
    const de = $('#bc-de').value, ate = $('#bc-ate').value;
    if (!de || !ate || de > ate) { st('Confira as datas do período.'); return; }
    // A janela da planilha abre já no clique (o Safari bloqueia janela aberta depois); o envio chega nela no fim.
    const janela = window.open('', JANELA);
    try { if (janela) janela.document.write('<p style="font:16px Arial;color:#13294a;padding:30px">Lendo o grupo de comprovantes no WhatsApp… pode voltar para lá e acompanhar.</p>'); } catch (e) { /* ok */ }
    $('#bc-ir').disabled = true;
    const lista = rolagem();
    const vistos = new Map();
    const nomes = {}; // participante (do data-id) → nome
    let diaAtual = null, autorAnterior = '', horaAnterior = '';
    const varrer = async () => {
      diaAtual = null;
      for (const row of document.querySelectorAll('#main [role="row"]')) {
        const sep = !row.querySelector('[data-id]') && lerSeparador(row.textContent);
        if (sep) { diaAtual = sep; continue; }
        const bolha = row.querySelector('[data-id]');
        if (!bolha) continue;
        const id = bolha.getAttribute('data-id');
        const part = (id.match(/_([^_]+@[^_]+)$/) || [])[1] || (/^true_/.test(id) ? 'eu' : '');
        const cabEl = row.querySelector('[data-pre-plain-text]');
        const cab = cabEl && lerCab(cabEl.getAttribute('data-pre-plain-text'));
        if (cab) { diaAtual = cab.dia; nomes[part] = cab.autor; }
        const hora = cab ? cab.hora : ((row.textContent.match(/(\d{1,2}:\d{2})(?!.*\d{1,2}:\d{2})/) || [])[1] || horaAnterior);
        const autor = cab ? cab.autor : (nomes[part] || (part === 'eu' ? 'Você' : autorAnterior));
        autorAnterior = autor; horaAnterior = hora;
        if (vistos.has(id) || !diaAtual) continue;
        const item = { id, dia: diaAtual, hora: pad(hora.split(':')[0]) + ':' + (hora.split(':')[1] || '00'), autor, cab: cabEl ? cabEl.getAttribute('data-pre-plain-text') : '', texto: cabEl ? texto(cabEl.querySelector('.selectable-text') || cabEl) : '' };
        if (item.dia < de || item.dia > ate) { vistos.set(id, null); continue; }
        // Comprovante enviado como documento: PDF ou imagem em arquivo (PNG, JPG, WEBP, HEIC…)
        const nomePdf = [...row.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).find((t) => /\.(pdf|png|jpe?g|webp|heic|heif|gif)$/i.test(t || '')) || ((row.textContent.match(/[^\n]{1,80}\.(?:pdf|png|jpe?g|webp|heic|heif|gif)\b/i) || [])[0] || '');
        if (nomePdf) item.pdf = { nome: nomePdf.trim(), row };
        // Comprovante em imagem (fotos do WhatsApp são blob:; ícones e fotos de perfil ficam de fora)
        const img = [...row.querySelectorAll('img[src^="blob:"]')].sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
        if (img && img.naturalWidth >= 200) item.img = img;
        vistos.set(id, item);
      }
    };
    try {
      st('Carregando o grupo até ' + de.split('-').reverse().join('/') + '…');
      for (let tentativas = 0, semNovidade = 0; lista && tentativas < 200 && semNovidade < 4; tentativas++) {
        await varrer();
        const datas = [...vistos.values()].filter(Boolean).map((x) => x.dia);
        const primeiro = document.querySelector('#main [data-pre-plain-text]');
        const maisVelho = primeiro && lerCab(primeiro.getAttribute('data-pre-plain-text'));
        if (maisVelho && maisVelho.dia < de) break;
        const antes = lista.scrollHeight;
        lista.scrollTop = 0;
        await esperar(1500);
        semNovidade = lista.scrollHeight === antes ? semNovidade + 1 : 0;
        st('Carregando… ' + datas.length + ' mensagens do período até agora');
      }
      await varrer();
      const itens = [...vistos.values()].filter(Boolean);
      // Arquivos: imagens e PDFs do período
      const form = document.createElement('form');
      form.method = 'POST'; form.enctype = 'multipart/form-data'; form.target = janela ? JANELA : '_self'; form.style.display = 'none';
      form.action = SITE + '/api/conciliacao-recebe?k=' + CHAVE;
      const dt = new DataTransfer();
      let nImg = 0, nPdf = 0, semPdf = 0;
      ligarCaptura();
      for (let i = 0; i < itens.length; i++) {
        const it = itens[i];
        st('Juntando os comprovantes… ' + (i + 1) + ' de ' + itens.length);
        if (it.img) { const b = await jpeg(it.img); if (b) { it.arquivo = 'img-' + i + '.jpg'; dt.items.add(new File([b], it.arquivo, { type: 'image/jpeg' })); nImg++; } }
        if (it.pdf) {
          const b = it.pdf.row.isConnected ? await pegarPdf(it.pdf.row) : null;
          // PDF fica PDF; imagem enviada como arquivo vai como imagem (o tipo vem do próprio arquivo ou da extensão)
          const ehPdf = /pdf/i.test(b ? b.type : '') || /\.pdf$/i.test(it.pdf.nome);
          const tipo = ehPdf ? 'application/pdf' : (b && /^image\//.test(b.type) ? b.type : 'image/' + ((it.pdf.nome.match(/\.(\w+)$/) || [])[1] || 'jpeg').toLowerCase().replace('jpg', 'jpeg'));
          if (b) { it.arquivo = (ehPdf ? 'pdf-' : 'doc-') + i + '.' + (ehPdf ? 'pdf' : tipo.split('/')[1]); dt.items.add(new File([b], it.arquivo, { type: tipo })); nPdf++; } else semPdf++;
          it.pdfNome = it.pdf.nome;
        }
        delete it.img; delete it.pdf;
      }
      desligarCaptura();
      const campo = (nome, valor) => { const e = document.createElement('input'); e.type = 'hidden'; e.name = nome; e.value = valor; form.appendChild(e); };
      campo('dados', JSON.stringify({ grupo: ((document.querySelector('#main header span[dir="auto"]') || {}).textContent || '').trim(), de, ate, lidoEm: new Date().toISOString(), itens }));
      const arq = document.createElement('input'); arq.type = 'file'; arq.name = 'arquivo'; arq.multiple = true; arq.files = dt.files; form.appendChild(arq);
      document.body.appendChild(form);
      st('Enviando ' + itens.length + ' mensagens, ' + nImg + ' imagens e ' + nPdf + ' arquivos (PDF/imagem)…' + (semPdf ? ' (' + semPdf + ' arquivo não abriu: vai aparecer em vermelho)' : ''));
      form.submit();
      setTimeout(() => form.remove(), 5000);
      $('#bc-ir').disabled = false;
      st('Pronto! A planilha abriu em outra aba. ' + itens.length + ' mensagens · ' + nImg + ' imagens · ' + nPdf + ' arquivos (PDF/imagem).');
    } catch (e) {
      desligarCaptura();
      $('#bc-ir').disabled = false;
      st('Não consegui ler o grupo: ' + (e && e.message ? e.message : e));
    }
  };
})();
