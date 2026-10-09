// Vários comprovantes de uma vez: abre o .zip (pacote do botão 💰 no WhatsApp ou a conversa exportada do WhatsApp)
// e devolve cada imagem/PDF com a mensagem que veio junto. Tudo no navegador; testado no Node (parte de texto).
(function (raiz) {
  'use strict';
  const EXT = /\.(jpe?g|png|webp|gif|heic|pdf)$/i;
  const LRM = /[‎‏‪-‮]/g;
  // Android: "05/10/2026 14:33 - Maria: texto"  ·  iPhone: "[05/10/2026, 14:33:10] Maria: texto"
  const RE_ANDROID = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*-\s*([^:]{1,60}):\s?([\s\S]*)$/;
  const RE_IOS = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\]\s*([^:]{1,60}):\s?([\s\S]*)$/;
  const anexoDe = (t) => {
    const a = /<(?:anexado|attached|anexo):\s*([^>]+)>/i.exec(t) || /^([^<>"\n]+?\.(?:jpe?g|png|webp|gif|heic|pdf))\s*\((?:arquivo anexado|file attached|archivo adjunto)\)/i.exec(t.trim());
    return a && EXT.test(a[1].trim()) ? a[1].trim() : '';
  };

  /** Texto da conversa exportada → mensagens { quando, autor, texto, anexo } */
  function mensagens(txt) {
    const out = [];
    for (const bruta of String(txt || '').replace(/\r/g, '').split('\n')) {
      const l = bruta.replace(LRM, '');
      const m = RE_IOS.exec(l) || RE_ANDROID.exec(l);
      if (m) {
        const ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        const texto = m[7].trim();
        out.push({ quando: new Date(ano, +m[2] - 1, +m[1], +m[4], +m[5]).getTime(), autor: m[6].trim(), texto: anexoDe(texto) ? texto.replace(/<(?:anexado|attached|anexo):[^>]+>|^[^<>"\n]+?\.(?:jpe?g|png|webp|gif|heic|pdf)\s*\((?:arquivo anexado|file attached|archivo adjunto)\)/i, '').trim() : texto, anexo: anexoDe(texto) });
      } else if (out.length && l.trim()) {
        out[out.length - 1].texto = (out[out.length - 1].texto + '\n' + l.trim()).trim(); // continuação (mensagem de várias linhas ou legenda)
      }
    }
    return out;
  }

  /** Cada anexo (comprovante) com a mensagem que veio junto: legenda + mensagens vizinhas da mesma pessoa (até 15 min). */
  function lerConversaExportada(txt, { desde = 0 } = {}) {
    const ms = mensagens(txt), itens = [];
    ms.forEach((m, i) => {
      if (!m.anexo || m.quando < desde) return;
      const perto = (x) => x && !x.anexo && x.autor === m.autor && Math.abs(x.quando - m.quando) <= 15 * 60e3;
      const antes = [], depois = [];
      for (let k = i - 1; k >= Math.max(0, i - 2) && perto(ms[k]); k--) if (ms[k].texto) antes.unshift(ms[k].texto);
      for (let k = i + 1; k < Math.min(ms.length, i + 4) && perto(ms[k]); k++) if (ms[k].texto) depois.push(ms[k].texto);
      itens.push({ arquivo: m.anexo, quando: m.quando, autor: m.autor, mensagem: [...antes, m.texto, ...depois].filter(Boolean).join('\n').slice(0, 1500) });
    });
    return itens;
  }

  let jszip = null;
  const carregarJSZip = () => jszip || (jszip = new Promise((ok, erro) => {
    if (raiz.JSZip) return ok(raiz.JSZip);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => ok(raiz.JSZip); s.onerror = () => { jszip = null; erro(new Error('Não consegui carregar o leitor de .zip.')); }; document.head.appendChild(s);
  }));
  const tipo = (n) => (/\.pdf$/i.test(n) ? 'application/pdf' : /\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : /\.gif$/i.test(n) ? 'image/gif' : /\.heic$/i.test(n) ? 'image/heic' : 'image/jpeg');

  /** .zip → { origem: 'pacote'|'conversa'|'arquivos', itens: [{ file, mensagem, quando }] } */
  async function abrirZip(file, { desde = 0 } = {}) {
    const Z = await carregarJSZip();
    const zip = await Z.loadAsync(file);
    const nomes = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !/^__MACOSX\//.test(n));
    const base = (n) => n.split('/').pop();
    const arquivo = async (n) => new File([await zip.files[n].async('blob')], base(n), { type: tipo(n) });
    const manifesto = nomes.find((n) => base(n) === 'manifest.json');
    if (manifesto) {
      const m = JSON.parse(await zip.files[manifesto].async('string'));
      const itens = [];
      for (const it of m.itens || []) { const n = nomes.find((x) => base(x) === it.arquivo); if (n) itens.push({ file: await arquivo(n), mensagem: it.mensagem || '', quando: it.quando || null }); }
      return { origem: 'pacote', itens };
    }
    const chat = nomes.find((n) => /\.txt$/i.test(n) && /chat|conversa/i.test(base(n))) || nomes.find((n) => /\.txt$/i.test(n));
    if (chat) {
      const lista = lerConversaExportada(await zip.files[chat].async('string'), { desde });
      const itens = [];
      for (const it of lista) { const n = nomes.find((x) => base(x) === it.arquivo); if (n) itens.push({ file: await arquivo(n), mensagem: it.mensagem, quando: it.quando }); }
      return { origem: 'conversa', itens };
    }
    const itens = [];
    for (const n of nomes.filter((x) => EXT.test(x))) itens.push({ file: await arquivo(n), mensagem: '', quando: null });
    return { origem: 'arquivos', itens };
  }

  const api = { mensagens, lerConversaExportada, abrirZip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.BlueFilaZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
