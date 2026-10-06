// Teste de ponta a ponta do Controle financeiro em LOTE (Chromium, Playwright). Dados fictícios.
// WhatsApp: marca 3 comprovantes (maquininha, nota fiscal em foto, Pix) → baixa o pacote .zip → arrasta na página → fila lê os 3
// → AmigoApp confere a fila inteira (2 ligadas sozinhas, 1 para escolher) → escolhe na página → "Lançar as prontas" → planilha e painel.
// Pré-requisitos: `wrangler pages dev ficha` em :8788 com D1 local NOVO e o emulador da planilha em :9922 (ver FINANCIAL_CONTROL_SAFARI_REPORT.md).
'use strict';
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const SITE = 'http://127.0.0.1:8788';
const SENHA = 'senha-gestao-teste';
const FIX = path.join(__dirname, '../fixtures/comprovantes');
const BOOK = decodeURIComponent(fs.readFileSync(path.join(__dirname, '../../ferramentas/cadastro-amigo/bookmarklet-controle-financeiro.txt'), 'utf8').slice('javascript:'.length));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-lote-'));
const resultados = [];
const ok = (nome, cond, extra = '') => { resultados.push({ nome, ok: !!cond, extra }); console.log((cond ? '✓' : '✗') + ' ' + nome + (extra ? ' · ' + extra : '')); };
const CSP_WA = "default-src 'self' blob: 'wasm-unsafe-eval';script-src blob: 'self' 'nonce-abc' https://static.whatsapp.net 'wasm-unsafe-eval';style-src data: blob: 'self' 'unsafe-inline';connect-src 'self' https://*.whatsapp.net blob: data: wss://web.whatsapp.com;img-src 'self' data: blob: https://*.whatsapp.net";
const WA_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp</title></head><body><div id="app"><div id="main"><header>Comprovantes de pacientes</header><div class="msgs"></div></div></div></body></html>';
const PACIENTES = {
  9001: { id: 9001, name: 'Fernanda Alves Rocha', cpf: '111.222.333-96', cellphone: '(21) 98888-0001' },
  9002: { id: 9002, name: 'Beatriz Lima Costa', cpf: '529.982.247-25', cellphone: '(21) 98888-0002' },
  9003: { id: 9003, name: 'Beatriz Costa Lima', cpf: '222.333.444-05', cellphone: '(21) 98888-0003' },
  4321: { id: 4321, name: 'Maria da Silva Santos', cpf: '123.456.789-09', cellphone: '(21) 99876-1234' },
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--disable-features=PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights'] });
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  // Arquivos da CDN (OCR, pdf.js, jszip) baixados com o curl só neste servidor de testes (ver financeiro.e2e.js).
  const CACHE = path.join(os.tmpdir(), 'blue-cdn-cache'); fs.mkdirSync(CACHE, { recursive: true });
  const TIPOS = { js: 'application/javascript', mjs: 'text/javascript', wasm: 'application/wasm', gz: 'application/gzip', json: 'application/json' };
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, async (r) => {
    const url = r.request().url();
    const arq = path.join(CACHE, require('crypto').createHash('sha1').update(url).digest('hex'));
    if (!fs.existsSync(arq)) execFileSync('curl', ['-sSfL', '-o', arq, url]);
    const ext = (new URL(url).pathname.match(/\.(\w+)$/) || [])[1];
    r.fulfill({ body: fs.readFileSync(arq), contentType: TIPOS[ext] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' } });
  });
  await ctx.route('https://web.whatsapp.com/**', (r) => r.fulfill({ body: WA_HTML, contentType: 'text/html', headers: { 'content-security-policy': CSP_WA, 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } }));
  await ctx.route('https://amigoapp.com.br/**', (r) => r.fulfill({ body: '<!doctype html><html><head><meta charset="utf-8"><title>Pacientes</title></head><body><h1>Pacientes</h1></body></html>', contentType: 'text/html' }));
  // API do AmigoApp (busca e ficha), só com a sessão aberta.
  const buscasAmigo = [];
  await ctx.route('https://api.amigoapp.com.br/**', (r) => {
    const u = new URL(r.request().url()), sessao = r.request().headers().authorization === 'Bearer token-da-sessao';
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    let corpo;
    if (/\/api\/patient\/suggest/.test(u.pathname)) {
      const q = (u.searchParams.get('name') || '').toLowerCase(); buscasAmigo.push(q);
      corpo = Object.values(PACIENTES).filter((p) => q.split(' ').every((t) => p.name.toLowerCase().includes(t))).map((p) => ({ id: p.id, name: p.name }));
    } else { const id = (/\/api\/patient\/(\d+)/.exec(u.pathname) || [])[1]; corpo = PACIENTES[id] || {}; }
    r.fulfill({ status: sessao ? 200 : 401, contentType: 'application/json', body: JSON.stringify(sessao ? corpo : { erro: 'sem sessão' }), headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
  });

  const fin = await ctx.newPage();
  fin.on('pageerror', (e) => console.log('[erro na página]', e.message));
  fin.on('dialog', (d) => d.accept());
  await fin.goto(SITE + '/financeiro');
  await fin.fill('#senha', SENHA); await fin.dispatchEvent('#senha', 'change');
  await fin.fill('#resp', 'Gestão Teste'); await fin.dispatchEvent('#resp', 'change');
  await fin.waitForFunction(() => /Conectado/.test(document.getElementById('st').textContent));

  // ---------- WhatsApp: marcar 3 comprovantes e baixar o pacote ----------
  const wa = await ctx.newPage();
  await wa.goto('https://web.whatsapp.com/');
  const b64 = (f) => fs.readFileSync(path.join(FIX, f)).toString('base64');
  await wa.evaluate(async ({ imgs, site }) => {
    localStorage.setItem('blueFinCfg', JSON.stringify({ site }));
    let n = 0;
    const linha = (pre, texto, img) => { const r = document.createElement('div'); r.setAttribute('role', 'row'); const m = document.createElement('div'); m.setAttribute('data-id', 'false_g@g.us_' + (n++));
      if (img) m.appendChild(img);
      if (pre) { const c = document.createElement('div'); c.className = 'copyable-text'; c.setAttribute('data-pre-plain-text', pre); const sp = document.createElement('span'); sp.className = 'selectable-text'; sp.innerText = texto; c.appendChild(sp); m.appendChild(c); }
      r.appendChild(m); document.querySelector('#main .msgs').appendChild(r); };
    for (const x of imgs) {
      const blob = await (await fetch('data:' + x.tipo + ';base64,' + x.b64)).blob();
      const img = document.createElement('img'); img.src = URL.createObjectURL(blob); img.style.width = '300px';
      linha('', '', img);
      linha(x.pre, x.msg);
      await img.decode();
    }
  }, { site: SITE, imgs: [
    { b64: b64('nubank-maria.png'), tipo: 'image/png', pre: '[09:10, 05/10/2026] Maria Gabi: ', msg: 'Segue pagamento da paciente Maria da Silva Santos - Consulta' },
    { b64: b64('maquininha-visa.jpg'), tipo: 'image/jpeg', pre: '[14:25, 06/10/2026] Mayra: ', msg: 'Segue pagamento da paciente Fernanda Alves Rocha - Consulta, 3x no cartão' },
    { b64: b64('nota-fiscal-foto.jpg'), tipo: 'image/jpeg', pre: '[15:02, 06/10/2026] Mayra: ', msg: 'Nota da paciente Beatriz Lima Costa - ferro e vitamina D' },
  ] });
  await wa.evaluate(BOOK);
  await wa.waitForSelector('#blue-fin-box #bf-l button');
  ok('WhatsApp: botão lista os 3 comprovantes', (await wa.locator('#bf-l button').count()) === 3);
  await wa.check('#bf-varios');
  for (let k = 0; k < 3; k++) await wa.click('#bf-l button[data-k="' + k + '"]');
  ok('WhatsApp: modo "vários de uma vez" marca os 3', /Baixar pacote \(3\)/.test(await wa.textContent('#bf-pacote')));
  const [download, aba] = await Promise.all([wa.waitForEvent('download'), ctx.waitForEvent('page'), wa.click('#bf-pacote')]);
  const zipPath = path.join(TMP, download.suggestedFilename()); await download.saveAs(zipPath);
  const manifesto = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("manifest.json").decode())', zipPath]).toString());
  const nomesZip = execFileSync('python3', ['-c', 'import zipfile,sys;print(",".join(zipfile.ZipFile(sys.argv[1]).namelist()))', zipPath]).toString().trim();
  ok('Pacote .zip com as 3 imagens e as mensagens de cada uma', manifesto.itens.length === 3 && /Fernanda Alves Rocha/.test(manifesto.itens.map((i) => i.mensagem).join('|')) && nomesZip.split(',').length === 4, nomesZip);
  ok('Abre a página Controle financeiro pronta para receber o pacote', /\/financeiro#whatsapp-lote/.test(aba.url()), aba.url());
  await aba.close();

  // ---------- página: arrastar o pacote → fila ----------
  await fin.setInputFiles('#arq', zipPath);
  await fin.waitForFunction(() => document.querySelectorAll('#fila tbody tr').length === 3 && ![...document.querySelectorAll('#fila .st')].some((s) => /Lendo|Na fila/.test(s.textContent)), null, { timeout: 300000 });
  const filaTxt = await fin.$$eval('#fila tbody tr', (trs) => trs.map((t) => t.innerText.replace(/\s+/g, ' ').trim()));
  console.log('   fila:', JSON.stringify(filaTxt));
  ok('Fila lê os 3 comprovantes do pacote', filaTxt.length === 3 && filaTxt.every((t) => !/Não consegui ler/.test(t)));
  const linha = (re) => fin.locator('#fila tbody tr', { hasText: re });
  ok('Maquininha na fila: R$ 1.800,00, crédito Visa 3x', /1\.800,00/.test(filaTxt.find((t) => /Fernanda/.test(t)) || '') && /Visa/.test(filaTxt.find((t) => /Fernanda/.test(t)) || '') && /3x/.test(filaTxt.find((t) => /Fernanda/.test(t)) || ''), filaTxt.find((t) => /Fernanda/.test(t)));
  await linha(/Fernanda/).click();
  const cartao = await fin.evaluate(() => Object.fromEntries(['tipoDocumento', 'forma', 'bandeira', 'cartaoFinal', 'nsu', 'autorizacao', 'parcelas', 'valor', 'data'].map((k) => [k, document.getElementById('c-' + k).value])));
  console.log('   maquininha (foto):', JSON.stringify(cartao));
  console.log('   texto do OCR da maquininha:', JSON.stringify((await fin.textContent('#bruto')).slice(0, 500)));
  ok('Foto da maquininha: tipo Cartão, crédito, Visa, final 1234', cartao.tipoDocumento === 'Cartão' && cartao.forma === 'Cartão de crédito' && cartao.bandeira === 'Visa' && cartao.cartaoFinal === '1234', JSON.stringify(cartao));
  ok('Foto da maquininha: NSU 004512, autorização A1B2C3, 3 parcelas', cartao.nsu === '004512' && cartao.autorizacao === 'A1B2C3' && cartao.parcelas === '3', JSON.stringify(cartao));
  ok('Foto da maquininha: valor 1.800,00 e data 06/10/2026', cartao.valor === '1.800,00' && cartao.data === '06/10/2026', JSON.stringify(cartao));
  await linha(/Beatriz/).click();
  const nota = await fin.evaluate(() => Object.fromEntries(['tipoDocumento', 'numeroNota', 'pagador', 'pagadorDoc', 'valor', 'data'].map((k) => [k, document.getElementById('c-' + k).value])));
  console.log('   nota fiscal (foto):', JSON.stringify(nota));
  ok('Foto da nota fiscal: tipo, número 2871, tomador e CPF', nota.tipoDocumento === 'Nota fiscal' && nota.numeroNota === '2871' && /Beatriz Lima Costa/.test(nota.pagador) && nota.pagadorDoc === '529.982.247-25', JSON.stringify(nota));
  ok('Foto da nota fiscal: valor total 900,00 (sem o ISS) e emissão 06/10/2026', nota.valor === '900,00' && nota.data === '06/10/2026', JSON.stringify(nota));
  ok('Mensagem de cada comprovante chega junto', /Beatriz Lima Costa/.test(await fin.inputValue('#msg-txt')));
  ok('Sem paciente conferida: nenhum está pronto para lançar', await fin.locator('#b-lote').isDisabled());

  // ---------- AmigoApp: confere a fila inteira ----------
  const amigo = await ctx.newPage();
  await amigo.goto('https://amigoapp.com.br/patients');
  await amigo.evaluate((site) => { localStorage.setItem('blueFinCfg', JSON.stringify({ site, senha: 'senha-gestao-teste' })); localStorage.setItem('token', 'token-da-sessao'); localStorage.setItem('log_in', '123'); }, SITE);
  await amigo.evaluate(BOOK);
  await amigo.waitForFunction(() => /Conferi 3 comprovantes/.test((document.getElementById('blue-fin-box') || {}).textContent || ''), null, { timeout: 30000 });
  const resumoAmigo = (await amigo.textContent('#blue-fin-box')).replace(/\s+/g, ' ');
  console.log('   AmigoApp:', resumoAmigo.slice(0, 400));
  ok('AmigoApp: liga sozinha as 2 pacientes sem dúvida (nome e CPF)', /2 paciente\(s\) encontrada\(s\) e ligada\(s\)/.test(resumoAmigo) && /Fernanda Alves Rocha/.test(resumoAmigo) && /Maria da Silva Santos/.test(resumoAmigo), resumoAmigo.slice(0, 200));
  ok('AmigoApp: nomes parecidos (Beatriz Lima Costa × Beatriz Costa Lima) ficam para escolher', /1 para você escolher/.test(resumoAmigo) && /Beatriz/.test(resumoAmigo));
  ok('AmigoApp: nada lançado nem alterado lá', /Nada foi lançado/.test(resumoAmigo));

  // ---------- página: escolhe a Beatriz e lança as prontas ----------
  await fin.waitForFunction(() => [...document.querySelectorAll('#fila .st')].filter((s) => /Pronto para lançar/.test(s.textContent)).length === 2 && /Escolher paciente/.test(document.getElementById('fila').textContent), null, { timeout: 20000 });
  ok('Página recebe sozinha: 2 prontas para lançar e 1 para escolher', true);
  await linha(/Beatriz/).click();
  await fin.waitForSelector('#cands button');
  const cands = await fin.$$eval('#cands button', (bs) => bs.map((b) => b.innerText.replace(/\s+/g, ' ')));
  ok('Candidatas do AmigoApp aparecem para escolher (com ID e % parecido)', cands.length === 2 && cands.some((c) => /ID 9002/.test(c)) && cands.some((c) => /ID 9003/.test(c)), JSON.stringify(cands));
  await fin.click('#cands button:has-text("ID 9002")');
  await fin.waitForFunction(() => [...document.querySelectorAll('#fila .st')].filter((s) => /Pronto para lançar/.test(s.textContent)).length === 3, null, { timeout: 10000 });
  ok('Escolhida a paciente, as 3 ficam prontas', true);
  ok('Botão mostra quantas e o total: 3 · R$ 4.500,00', /Lançar as prontas \(3 · R\$ 4\.500,00\)/.test(await fin.textContent('#b-lote')), await fin.textContent('#b-lote'));
  await fin.click('#b-lote');
  await fin.waitForFunction(() => /Lote lançado/.test(document.getElementById('lote-res').textContent), null, { timeout: 30000 });
  const lote = (await fin.textContent('#lote-res')).replace(/\s+/g, ' ');
  ok('Lote: 3 lançamentos gravados e enviados à planilha', (lote.match(/✓ #/g) || []).length === 3 && !/✗/.test(lote), lote.slice(0, 260));

  // ---------- planilha (link IMPORTDATA) ----------
  await fin.click('#b-plan'); await fin.waitForSelector('#plan-url');
  const csv = await fin.evaluate(async (u) => (await fetch(u)).text(), await fin.inputValue('#plan-url'));
  const parse = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const [cab, ...linhasCsv] = csv.replace(/^﻿/, '').trim().split('\n').map(parse);
  const col = (l, n) => l[cab.indexOf(n)];
  const lf = linhasCsv.find((l) => /Fernanda/.test(l.join(' '))) || [], lb = linhasCsv.find((l) => /Beatriz/.test(l.join(' '))) || [];
  ok('Planilha tem as colunas novas (tipo, bandeira, final, NSU, autorização, parcelas, nota, paciente no Amigo)', ['Tipo de documento', 'Bandeira', 'Final do cartão', 'NSU', 'Autorização', 'Parcelas', 'Nº da nota fiscal', 'Paciente no AmigoApp'].every((n) => cab.includes(n)), cab.slice(33).join(' | '));
  ok('Planilha: cartão com Visa, final 1234, NSU 004512, aut. A1B2C3, 3 parcelas', col(lf, 'Bandeira') === 'Visa' && col(lf, 'Final do cartão') === '1234' && col(lf, 'NSU') === '004512' && col(lf, 'Autorização') === 'A1B2C3' && col(lf, 'Parcelas') === '3', JSON.stringify(lf.slice(33)));
  ok('Planilha: paciente encontrada no AmigoApp com o ID', /Encontrada no AmigoApp \(ID 9001\)/.test(col(lf, 'Paciente no AmigoApp')) && col(lf, 'ID AmigoApp') === '9001', col(lf, 'Paciente no AmigoApp'));
  ok('Planilha: nota fiscal nº 2871 e o que foi pago (soroterapia)', col(lb, 'Nº da nota fiscal') === '2871' && col(lb, 'Tipo de documento') === 'Nota fiscal' && /Soroterapia/.test(col(lb, 'Categoria')), JSON.stringify([col(lb, 'Nº da nota fiscal'), col(lb, 'Categoria'), col(lb, 'Itens pagos')]));

  // ---------- painel ----------
  await fin.waitForFunction(() => /4\.500,00/.test(document.getElementById('k-mes').textContent), null, { timeout: 10000 });
  ok('Painel: recebido no mês R$ 4.500,00 (3 pagamentos)', /3 pagamento/.test(await fin.textContent('#k-mes-n')));
  const formas = await fin.textContent('#k-formas');
  ok('Painel: por forma de pagamento (Pix, cartão Visa e nota sem forma = Não informado)', /PIX/.test(formas) && /Cartão de crédito Visa/.test(formas) && /Não informado/.test(formas) && !/null/.test(formas), formas.replace(/\s+/g, ' '));
  ok('Painel: pelo que foi pago (consulta, soroterapia)', /Consulta/.test(await fin.textContent('#k-cats')) && /Soroterapia/.test(await fin.textContent('#k-cats')), (await fin.textContent('#k-cats')).replace(/\s+/g, ' '));

  // ---------- o mesmo pacote de novo: nada duplica ----------
  await fin.setInputFiles('#arq', zipPath);
  await fin.waitForFunction(() => [...document.querySelectorAll('#fila .st')].filter((s) => /Já lançado/.test(s.textContent)).length === 3, null, { timeout: 60000 });
  ok('Mesmo pacote de novo: os 3 aparecem como "Já lançado" (sem ler de novo)', true);

  // ---------- conversa exportada do WhatsApp (.zip com _chat.txt) ----------
  const conversa = path.join(TMP, 'WhatsApp Chat - Comprovantes.zip');
  const hoje = new Date(), dd = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
  const chat = `${dd} 10:00 - Helen: Bom dia\n${dd} 10:05 - Mayra: IMG-0001-WA0001.jpg (arquivo anexado)\n${dd} 10:05 - Mayra: Segue pagamento da paciente Fernanda Alves Rocha - Consulta\n01/01/2020 10:00 - Mayra: IMG-0002-WA0002.jpg (arquivo anexado)\n`;
  execFileSync('python3', ['-c', 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED)\nz.writestr("_chat.txt",sys.argv[2])\nz.write(sys.argv[3],"IMG-0001-WA0001.jpg")\nz.write(sys.argv[3],"IMG-0002-WA0002.jpg")\nz.close()', conversa, chat, path.join(FIX, 'maquininha-visa.jpg')]);
  const antes = await fin.$$eval('#fila tbody tr', (t) => t.length);
  await fin.setInputFiles('#arq', conversa);
  await fin.waitForFunction((n) => document.querySelectorAll('#fila tbody tr').length === n + 1 && /Já lançado/.test(document.querySelector('#fila tbody tr:last-child').textContent), antes, { timeout: 60000 });
  ok('Conversa exportada: lê só os comprovantes do período (o de 2020 fica de fora) e reconhece o já lançado', true);

  await browser.close();
  const falhas = resultados.filter((r) => !r.ok);
  fs.writeFileSync(path.join(__dirname, 'resultado-financeiro-lote.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 1));
  console.log('\n' + (resultados.length - falhas.length) + ' de ' + resultados.length + ' verificações passaram.');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
