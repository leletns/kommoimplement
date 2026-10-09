// Leitura de comprovante (imagem ou PDF) no navegador: devolve o texto para o BlueComprovante.lerComprovante.
// Imagem → OCR em português (tesseract.js, roda no computador); PDF → texto do próprio PDF (pdf.js) ou OCR se for escaneado.
// Nada é enviado para serviço externo: só as bibliotecas são baixadas do CDN na primeira vez.
(function (raiz) {
  'use strict';
  const carregarScript = (src) => new Promise((ok, erro) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('Não consegui carregar ' + src)); document.head.appendChild(s); });

  async function canvasDaImagem(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error('imagem ilegível')); i.src = url; });
      const k = Math.min(3, Math.max(img.naturalWidth > 3000 ? 3000 / img.naturalWidth : 1, 1600 / img.naturalWidth));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      return cv;
    } finally { URL.revokeObjectURL(url); }
  }

  // Contraste automático (e preto e branco pelo limiar de Otsu na 2ª tentativa)
  function realcar(cv, binario) {
    const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
    const g = out.getContext('2d'); g.drawImage(cv, 0, 0);
    const im = g.getImageData(0, 0, out.width, out.height), p = im.data, hist = new Uint32Array(256);
    for (let i = 0; i < p.length; i += 4) { const y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0; p[i] = y; hist[y]++; }
    const total = p.length / 4; let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc <= total * 0.02) lo = v; if (acc <= total * 0.98) hi = v; }
    if (hi - lo < 30) { lo = 0; hi = 255; }
    let lim = 128;
    if (binario) { let soma = 0; for (let v = 0; v < 256; v++) soma += v * hist[v]; let sB = 0, wB = 0, melhor = 0; for (let v = 0; v < 256; v++) { wB += hist[v]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += v * hist[v]; const mB = sB / wB, mF = (soma - sB) / wF, entre = wB * wF * (mB - mF) * (mB - mF); if (entre > melhor) { melhor = entre; lim = v; } } }
    for (let i = 0; i < p.length; i += 4) { let y = (p[i] - lo) * 255 / (hi - lo); y = binario ? (y >= (lim - lo) * 255 / (hi - lo) ? 255 : 0) : Math.max(0, Math.min(255, y)); p[i] = p[i + 1] = p[i + 2] = y; }
    g.putImageData(im, 0, 0);
    return out;
  }

  let worker = null;
  async function ocr(canvas) {
    if (!raiz.Tesseract) await carregarScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    if (!worker) worker = await raiz.Tesseract.createWorker('por', 1);
    const r1 = await worker.recognize(realcar(canvas, false), { rotateAuto: true });
    let melhor = { texto: r1.data.text, confianca: r1.data.confidence };
    if (melhor.confianca < 65) {
      const r2 = await worker.recognize(realcar(canvas, true), { rotateAuto: true });
      if (r2.data.confidence > melhor.confianca) melhor = { texto: r2.data.text, confianca: r2.data.confidence };
    }
    return melhor;
  }

  async function lerPdf(blob) {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const pag = await doc.getPage(1);
    const tc = await pag.getTextContent();
    const linhas = {};
    for (const it of tc.items) { const y = Math.round(it.transform[5]); (linhas[y] = linhas[y] || []).push(it); }
    const texto = Object.keys(linhas).map(Number).sort((a, b) => b - a).map((y) => linhas[y].sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (texto.replace(/\s/g, '').length >= 40) return { texto, confianca: 95 };
    const vp = pag.getViewport({ scale: 2 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    await pag.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return ocr(cv); // PDF escaneado (só imagem)
  }

  /** Blob de imagem ou PDF → { texto, confianca } */
  async function lerArquivo(blob) {
    if (/pdf/i.test(blob.type || '')) return lerPdf(blob);
    return ocr(await canvasDaImagem(blob));
  }

  raiz.BlueLeitura = { lerArquivo, lerPdf, ocr };
})(window);
