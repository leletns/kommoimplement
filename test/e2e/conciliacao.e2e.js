// Pré-requisito: `wrangler pages dev ficha --binding FINANCEIRO_SENHA=SenhaTeste` em :8788. Rode: PW=/caminho/playwright node test/e2e/conciliacao.e2e.js
// Ponta a ponta: WhatsApp Web simulado → botão 📊 → /conciliacao (wrangler local em :8788) → planilha.
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, '..', 'fixtures', 'comprovantes');
const LOCAL = 'http://127.0.0.1:8788';
const SITE = 'https://clinicablue.pages.dev';
const CSP_WA = "default-src 'self' blob: 'wasm-unsafe-eval';script-src blob: 'self' 'nonce-abc' https://static.whatsapp.net 'wasm-unsafe-eval';style-src data: blob: 'self' 'unsafe-inline';connect-src 'self' https://*.whatsapp.net blob: data: wss://web.whatsapp.com;img-src 'self' data: blob: https://*.whatsapp.net";

const pdf64 = fs.readFileSync(path.join(FIX, 'inter-juliana.pdf')).toString('base64');
const jpg64 = fs.readFileSync(path.join(FIX, 'itau-carlos.jpg')).toString('base64');
const png64 = fs.readFileSync(path.join(FIX, 'nubank-maria.png')).toString('base64');
const linhaTexto = (id, cab, html) => `<div role="row"><div data-id="${id}"><div class="copyable-text" data-pre-plain-text="${cab}"><span class="selectable-text copyable-text"><span>${html}</span></span></div></div></div>`;
const sep = (t) => `<div role="row"><div><span>${t}</span></div></div>`;
const WA = `<!doctype html><html><body><div id="main"><header><span dir="auto">Comprovantes de pagamento</span></header>
<div id="lista" style="height:300px;overflow-y:auto"><div id="topo" style="height:400px"></div><div id="msgs">
${sep('01/10/2026')}
${linhaTexto('false_g@g.us_A1_5521911111111@c.us', '[09:00, 01/10/2026] Maria Gabriela: ', 'Juliana Costa Mendes<br>Tel: 21 98888-7777<br>Consulta - Lipedema 1x<br><img alt="🗓️" src="data:,"> quinta-feira, 08/10/2026 às 14h00<br>Pagamento: R$ 900,00 de R$ 1.800,00')}
${sep('02/10/2026')}
${linhaTexto('false_g@g.us_A2_5521922222222@c.us', '[11:30, 02/10/2026] Helen: ', 'Restante pagamento: Fulana Beltrana Silva')}
${sep('04/10/2026')}
<div role="row"><div data-id="false_g@g.us_A3_5521911111111@c.us"><div role="button" title="comprovante-pix.pdf" id="doc">comprovante-pix.pdf · PDF</div><span>18:50</span></div></div>
${sep('05/10/2026')}
<div role="row"><div data-id="false_g@g.us_A4_5521922222222@c.us"><img id="foto" style="width:300px"><span>10:00</span></div></div>
${sep('06/10/2026')}
<div role="row"><div data-id="false_g@g.us_A5_5521911111111@c.us"><div role="button" title="comprovante-itau.jpg" id="doc2">comprovante-itau.jpg · JPG</div><span>16:20</span></div></div>
</div></div></div>
<script nonce="abc">
  const bin = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  document.getElementById('foto').src = URL.createObjectURL(new Blob([bin('${png64}')], { type: 'image/png' }));
  // Como o WhatsApp: clicar no documento monta o blob e "baixa" com <a download>
  document.getElementById('doc').onclick = () => { const u = URL.createObjectURL(new Blob([bin('${pdf64}')], { type: 'application/pdf' })); const a = document.createElement('a'); a.href = u; a.download = 'comprovante-pix.pdf'; document.body.appendChild(a); a.click(); a.remove(); window.__baixouDeVerdade = (window.__baixouDeVerdade || 0); };
  document.getElementById('doc2').onclick = () => { const u = URL.createObjectURL(new Blob([bin('${jpg64}')], { type: 'image/jpeg' })); const a = document.createElement('a'); a.href = u; a.download = 'comprovante-itau.jpg'; document.body.appendChild(a); a.click(); a.remove(); };
  // Rolar até o topo carrega mensagens mais antigas (uma vez)
  const lista = document.getElementById('lista'); let carregou = false;
  lista.addEventListener('scroll', () => { if (lista.scrollTop === 0 && !carregou) { carregou = true; setTimeout(() => { document.getElementById('msgs').insertAdjacentHTML('afterbegin', ${JSON.stringify(sep('28/09/2026') + linhaTexto('false_g@g.us_A0_5521933333333@c.us', '[10:00, 28/09/2026] Maria Beatriz: ', 'Paciente Antiga Fora Do Periodo<br>Pagamento: R$ 500,00'))}); }, 300); } });
  lista.scrollTop = lista.scrollHeight;
</script></body></html>`;

(async () => {
  const b = await chromium.launch({ args: ['--disable-features=PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights'] });
  const ctx = await b.newContext({ acceptDownloads: false, ignoreHTTPSErrors: true });
  ctx.on('response', async (resp) => { if (resp.url().includes('acao=lote')) { try { const j = await resp.json(); console.log('[lote]', JSON.stringify(j.dados.itens.map((i) => ({ id: i.id, dia: i.dia, hora: i.hora, autor: i.autor, cab: i.cab, t: (i.texto || '').slice(0, 60), arq: i.arquivo, pdf: i.pdfNome })))); } catch (e) {} } });
  await ctx.addInitScript(() => { if (location.hostname === 'clinicablue.pages.dev') localStorage.setItem('blueFinSenha', 'SenhaTeste'); });
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === 'web.whatsapp.com') return r.fulfill({ contentType: 'text/html', body: WA, headers: { 'content-security-policy': CSP_WA, 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } });
    if (/^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)$/.test(u.hostname)) {
      const CACHE = path.join(require('os').tmpdir(), 'blue-cdn-cache'); fs.mkdirSync(CACHE, { recursive: true });
      const arq = path.join(CACHE, require('crypto').createHash('sha1').update(u.href).digest('hex'));
      if (!fs.existsSync(arq)) require('child_process').execFileSync('curl', ['-sSfL', '-o', arq, u.href]);
      const ext = (u.pathname.match(/\.(\w+)$/) || [])[1];
      const T = { js: 'application/javascript', mjs: 'text/javascript', wasm: 'application/wasm', gz: 'application/gzip', json: 'application/json' };
      return r.fulfill({ body: fs.readFileSync(arq), contentType: T[ext] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' } });
    }
    if (u.hostname === 'clinicablue.pages.dev') {
      const resp = await r.fetch({ url: LOCAL + u.pathname + u.search, maxRedirects: 0 });
      const h = resp.headers(); console.log('[rota]', r.request().method(), u.pathname, resp.status(), h.location || '');
      // Só no teste: o Playwright não entrega redirecionamento de POST interceptado; a página faz o mesmo salto.
      if (h.location) return r.fulfill({ status: 200, contentType: 'text/html', body: '<script>location.replace(' + JSON.stringify(h.location) + ')</script>' });
      return r.fulfill({ response: resp });
    }
    return r.continue();
  });
  const chave = (await (await fetch(LOCAL + '/api/conciliacao?acao=chave', { headers: { 'x-financeiro-senha': 'SenhaTeste' } })).json()).chave;
  const modelo = fs.readFileSync(path.join(__dirname, '..', '..', 'ficha', 'js', 'botao-conciliar.txt'), 'utf8').trim().replace('__SITE__', encodeURIComponent(SITE)).replace('__CHAVE__', chave);
  const wa = await ctx.newPage();
  wa.on('console', (m) => { if (m.type() === 'error') console.log('[wa erro]', m.text()); });
  await wa.goto('https://web.whatsapp.com/');
  await wa.evaluate(decodeURIComponent(modelo.slice('javascript:'.length)));
  await wa.fill('#bc-de', '2026-10-01'); await wa.fill('#bc-ate', '2026-10-09');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), wa.click('#bc-ir')]);
  popup.on('console', (m) => { if (m.type() === 'error') console.log('[planilha erro]', m.text()); });
  await wa.waitForFunction(() => /Pronto|Não consegui/.test(document.getElementById('bc-st').textContent), null, { timeout: 120000 });
  console.log('WhatsApp:', await wa.textContent('#bc-st'), '| baixou de verdade?', await wa.evaluate(() => !!document.querySelector('a[download]')));
  await new Promise((r) => setTimeout(r, 8000)); console.log('popup url:', popup.url(), '| corpo:', (await popup.content()).slice(0, 300));
  await popup.waitForFunction(() => /conciliado|Não consegui/.test((document.getElementById('msg') || {}).textContent || ''), null, { timeout: 240000 });
  console.log('Planilha:', await popup.textContent('#msg'), '| url:', popup.url());
  const linhas = await popup.$$eval('#linhas tr', (trs) => trs.map((tr) => [...tr.children].map((td) => (td.classList.contains('vermelha') ? '🟥' : '') + td.textContent.trim()).join(' | ')));
  linhas.forEach((l) => console.log('  ', l));
  console.log('KPIs:', await popup.textContent('#k-rec'), '/', await popup.textContent('#k-falta'), '/', await popup.textContent('#k-pac'), '/', await popup.textContent('#k-pend'));
  await popup.screenshot({ path: path.join(__dirname, 'conciliacao.png'), fullPage: true });
  // Ler de novo não duplica
  const n1 = (await (await fetch(LOCAL + '/api/conciliacao', { headers: { 'x-financeiro-senha': 'SenhaTeste' } })).json()).linhas.length;
  console.log('linhas no banco:', n1);
  await b.close();
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
