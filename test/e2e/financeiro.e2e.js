// Teste de ponta a ponta do botão 💰 Controle financeiro (Chromium, Playwright).
// Pré-requisitos (ver FINANCIAL_CONTROL_SAFARI_REPORT.md): `wrangler pages dev ficha` em :8788 com D1 local e o emulador da planilha em :9922.
// WhatsApp Web e AmigoApp são páginas simuladas servidas nos domínios reais, com os cabeçalhos de segurança reais do WhatsApp (CSP/COOP).
'use strict';
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const path = require('path');
const SITE = 'http://127.0.0.1:8788';
const SENHA = 'senha-gestao-teste';
const FIX = path.join(__dirname, '../fixtures/comprovantes');
const BOOK = decodeURIComponent(fs.readFileSync(path.join(__dirname, '../../ferramentas/cadastro-amigo/bookmarklet-controle-financeiro.txt'), 'utf8').slice('javascript:'.length));
const PLANILHA = process.env.PLANILHA_JSON;
const resultados = [];
const ok = (nome, cond, extra = '') => { resultados.push({ nome, ok: !!cond, extra }); console.log((cond ? '✓' : '✗') + ' ' + nome + (extra ? ' · ' + extra : '')); };

// Cabeçalhos copiados do web.whatsapp.com real (05/10/2026): o botão precisa funcionar com eles.
const CSP_WA = "default-src 'self' blob: 'wasm-unsafe-eval';script-src blob: 'self' 'nonce-abc' https://static.whatsapp.net 'wasm-unsafe-eval';style-src data: blob: 'self' 'unsafe-inline';connect-src 'self' https://*.whatsapp.net blob: data: wss://web.whatsapp.com;img-src 'self' data: blob: https://*.whatsapp.net";
const WA_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp</title></head><body><div id="app"><div id="side"><header><img alt="perfil" width="40" height="40"></header></div><div id="main"><header>Mayra · Comprovantes</header><div class="msgs"></div></div></div></body></html>';
const amigoForm = (p) => `<!doctype html><html><head><meta charset="utf-8"><title>Amigo</title></head><body><div class="doca-grid">
<div class="doca-grid__col-2 doca-form__field doca-form__field--required"><label>Nome *</label><input class="doca-form-control" type="text" value="${p.nome}"></div>
<div class="doca-grid__col-2 doca-form__field"><label>Nome Social</label><input class="doca-form-control" type="text" value=""></div>
<div class="doca-form__field"><label>Data de Nascimento</label><div class="doca-form-control__icon-container"><input id="patient-born" class="doca-form-control" type="text" value="${p.nasc}"></div></div>
<div class="doca-grid__col-1 doca-form__field"><label>CPF</label><input class="doca-form-control" type="text" value="${p.cpf}"></div>
<div class="doca-grid__col-1 doca-form__field"><label>Celular</label><input class="doca-form-control" type="text" value="${p.cel}"></div>
</div></body></html>`;
const AMIGO_LISTA = `<!doctype html><html><head><meta charset="utf-8"><title>Pacientes</title></head><body><h1>Pacientes</h1><input type="text" placeholder="Buscar paciente por nome, CPF ou telefone">
<table><tbody><tr><td>Juliana Costa Mendes</td><td>CPF 111.987.123-44</td></tr><tr><td>Juliana Mendes Costa</td><td>CPF 222.555.666-77</td></tr><tr><td>Roberta Lima</td><td>CPF 333.444.555-66</td></tr></tbody></table></body></html>`;

(async () => {
  // Só no teste: o site roda em 127.0.0.1 e o Chromium bloqueia página pública → rede local. No site real (https público) isso não existe.
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--disable-features=PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights'] });
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  // Neste servidor de testes a internet sai por um proxy que o Chromium não aceita: os MESMOS arquivos da CDN
  // (leitor de OCR, idioma português, pdf.js) são baixados com o curl e entregues ao navegador. No Safari da gestão eles vêm direto da CDN.
  const CACHE = path.join(require('os').tmpdir(), 'blue-cdn-cache'); fs.mkdirSync(CACHE, { recursive: true });
  const TIPOS = { js: 'application/javascript', mjs: 'text/javascript', wasm: 'application/wasm', gz: 'application/gzip', json: 'application/json' };
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, async (r) => {
    const url = r.request().url();
    const arq = path.join(CACHE, require('crypto').createHash('sha1').update(url).digest('hex'));
    if (!fs.existsSync(arq)) require('child_process').execFileSync('curl', ['-sSfL', '-o', arq, url]);
    const ext = (new URL(url).pathname.match(/\.(\w+)$/) || [])[1];
    r.fulfill({ body: fs.readFileSync(arq), contentType: TIPOS[ext] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' } });
  });
  await ctx.route('https://web.whatsapp.com/**', (r) => r.fulfill({ body: WA_HTML, contentType: 'text/html', headers: { 'content-security-policy': CSP_WA, 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } }));
  const pacientes = {
    4321: { nome: 'Maria da Silva Santos', nasc: '12/03/1988', cpf: '123.456.789-09', cel: '(21) 99876-1234' },
    5555: { nome: 'Ana Paula Pereira', nasc: '01/01/1985', cpf: '555.111.222-33', cel: '(11) 98888-7777' },
    7777: { nome: 'Juliana Costa Mendes', nasc: '02/02/1990', cpf: '111.987.123-44', cel: '(21) 97777-1111' },
  };
  await ctx.route('https://app.amigoapp.com.br/**', (r) => {
    const u = new URL(r.request().url());
    const m = /\/patient\/form\/(\d+)/.exec(u.pathname);
    r.fulfill({ body: m ? amigoForm(pacientes[m[1]]) : AMIGO_LISTA, contentType: 'text/html' });
  });

  // ---------- página do financeiro (senha e responsável) ----------
  const fin = await ctx.newPage();
  fin.on('pageerror', (e) => console.log('[erro na página]', e.message));
  await fin.goto(SITE + '/financeiro');
  await fin.fill('#senha', SENHA); await fin.dispatchEvent('#senha', 'change');
  await fin.fill('#resp', 'Gestão Teste'); await fin.dispatchEvent('#resp', 'change');
  await fin.waitForFunction(() => /Conectado/.test(document.getElementById('st').textContent));
  ok('Página Controle financeiro abre e conecta com a senha da gestão', true);
  const senhaErrada = await fin.evaluate(async () => (await fetch('/api/financeiro?acao=status', { headers: { 'x-financeiro-senha': 'errada' } })).status);
  ok('API recusa senha errada', senhaErrada === 401, 'HTTP ' + senhaErrada);

  // ---------- WhatsApp Web: botão lista o comprovante, copia e abre a página ----------
  const wa = await ctx.newPage();
  await wa.goto('https://web.whatsapp.com/');
  const png = fs.readFileSync(path.join(FIX, 'nubank-maria.png')).toString('base64');
  await wa.evaluate(async ({ b64, site }) => {
    localStorage.setItem('blueFinCfg', JSON.stringify({ site }));
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob(); // o WhatsApp mostra as fotos como blob:
    const img = document.createElement('img'); img.src = URL.createObjectURL(blob); img.style.width = '330px';
    const msg = document.createElement('div'); msg.setAttribute('data-id', 'false_5521999@c.us_ABC'); msg.appendChild(img);
    document.querySelector('#main .msgs').appendChild(msg);
    await img.decode();
  }, { b64: png, site: SITE });
  const bloqueado = await wa.evaluate(async (site) => { try { await fetch(site + '/api/financeiro?acao=status'); return 'passou'; } catch (e) { return 'bloqueado'; } }, SITE);
  ok('CSP do WhatsApp bloqueia chamada direta ao servidor (por isso a imagem vai pela área de transferência)', bloqueado === 'bloqueado');
  await wa.evaluate(BOOK);
  await wa.waitForSelector('#blue-fin-box #bf-l button');
  const nThumbs = await wa.locator('#bf-l button').count();
  ok('Botão no WhatsApp abre o painel e acha o comprovante da conversa', nThumbs === 1, nThumbs + ' imagem(ns)');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), wa.click('#bf-l button')]);
  await popup.waitForLoadState();
  ok('Clique no comprovante abre a página Controle financeiro', /\/financeiro#whatsapp-colar/.test(popup.url()), popup.url());
  await wa.waitForFunction(() => /copiado/.test(document.getElementById('blue-fin-box').textContent));
  ok('Comprovante copiado para a área de transferência (PNG)', true);
  popup.on('pageerror', (e) => console.log('[erro no popup]', e.message));
  await popup.fill('#senha', SENHA); await popup.dispatchEvent('#senha', 'change');
  await popup.fill('#resp', 'Gestão Teste'); await popup.dispatchEvent('#resp', 'change');
  // ⌘V: lê a área de transferência real e entrega ao "paste" da página
  const tipos = await popup.evaluate(async () => {
    const itens = await navigator.clipboard.read();
    const tipo = itens[0].types.find((t) => t.startsWith('image/'));
    const blob = await itens[0].getType(tipo);
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'colado.png', { type: tipo }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    return itens[0].types.join(',');
  });
  ok('Colar (⌘V) na página entrega a imagem', /image\/png/.test(tipos), tipos);
  await popup.waitForSelector('#dados:not(.hide)', { timeout: 180000 });
  const lido = await popup.evaluate(() => Object.fromEntries(['pagador', 'pagadorDoc', 'valor', 'data', 'hora', 'forma', 'banco', 'recebedor', 'idTransacao'].map((k) => [k, document.getElementById('c-' + k).value])));
  console.log('   lido:', JSON.stringify(lido));
  console.log('   texto do OCR:', JSON.stringify((await popup.textContent('#bruto')).slice(0, 400)));
  ok('OCR: pagador', /maria da silva santos/i.test(lido.pagador), lido.pagador);
  ok('OCR: valor', lido.valor === '1.800,00', lido.valor);
  ok('OCR: data', lido.data === '05/10/2026', lido.data);
  ok('OCR: forma', lido.forma === 'PIX', lido.forma);
  ok('OCR: banco', lido.banco === 'Nubank', lido.banco);
  const idTitulo = await popup.getAttribute('#c-idTransacao', 'title');
  ok('OCR: ID da transação exato', lido.idTransacao.toUpperCase() === 'E18236120202610051732S0A1B2C3D4E', lido.idTransacao);
  ok('OCR: se o ID vier com erro, ele fica marcado para conferir', lido.idTransacao.toUpperCase() === 'E18236120202610051732S0A1B2C3D4E' || /confira/.test(idTitulo || ''), idTitulo || '');
  ok('OCR: recebedor', /clinica blue/i.test(lido.recebedor), lido.recebedor);
  const naoIdent = await popup.textContent('#pac-res');
  ok('Sem paciente: mostra PACIENTE NÃO IDENTIFICADO e não deixa lançar', /PACIENTE NÃO IDENTIFICADO/.test(naoIdent) && await popup.locator('#conc').isHidden());

  // ---------- AmigoApp: paciente aberta → conferência ----------
  const amigo = await ctx.newPage();
  await amigo.goto('https://app.amigoapp.com.br/patient/form/4321');
  await amigo.evaluate((site) => localStorage.setItem('blueFinCfg', JSON.stringify({ site, senha: 'senha-gestao-teste' })), SITE);
  await amigo.evaluate(BOOK);
  await amigo.waitForSelector('#bf-usar');
  const painel = await amigo.textContent('#blue-fin-box');
  ok('AmigoApp: botão lê a paciente aberta (nome, ID, CPF)', /Maria da Silva Santos/.test(painel) && /ID 4321/.test(painel) && /123\.456\.789-09/.test(painel));
  ok('AmigoApp: correspondência confirmada com o comprovante', /CORRESPONDÊNCIA CONFIRMADA/.test(painel));
  await amigo.click('#bf-usar');
  await amigo.waitForFunction(() => /enviada para a concilia/.test(document.getElementById('blue-fin-box').textContent));
  await popup.waitForSelector('#conc:not(.hide)', { timeout: 15000 });
  const conc = await popup.textContent('#conc-res');
  ok('Página recebe a paciente do AmigoApp sozinha e mostra PAGAMENTO IDENTIFICADO', /PAGAMENTO IDENTIFICADO/.test(conc) && /Maria da Silva Santos/.test(conc), (conc.match(/Correspondência: \d+%/) || [''])[0]);
  ok('Correspondência ≥ 90%', Number((conc.match(/Correspondência: (\d+)%/) || [0, 0])[1]) >= 90);
  await popup.click('#b-lancar');
  await popup.waitForFunction(() => /Lançamento #\d+ registrado/.test(document.getElementById('lanc-res').textContent));
  const lr = await popup.textContent('#lanc-res');
  ok('CONFIRMAR LANÇAMENTO grava o lançamento', /Lançamento #1 registrado/.test(lr), lr.replace(/\s+/g, ' ').slice(0, 140));
  ok('Planilha atualizada no lançamento', /Planilha: atualizada \(linha 2\)/.test(lr));
  if (PLANILHA) {
    const pl = JSON.parse(fs.readFileSync(PLANILHA, 'utf8'));
    const linhas = pl.abas['Lançamentos'].linhas;
    ok('Linha na planilha com paciente, ID Amigo, valor, Pix, ID da transação e responsável', linhas.length === 2 && linhas[1][4] === 'Maria da Silva Santos' && linhas[1][5] === '4321' && linhas[1][8] === 1800 && linhas[1][10] === 'PIX' && /^E18236120/.test(linhas[1][14]) && linhas[1][20] === 'Gestão Teste', JSON.stringify(linhas[1]).slice(0, 220));
    ok('Planilha tem aba Resumo com fórmulas', !!pl.abas['Resumo']);
  }

  // ---------- duplicidade: o mesmo comprovante de novo ----------
  await popup.reload();
  await popup.fill('#senha', SENHA); await popup.dispatchEvent('#senha', 'change');
  await popup.setInputFiles('#arq', path.join(FIX, 'nubank-maria.png'));
  await popup.waitForFunction(() => /PAGAMENTO JÁ REGISTRADO/.test(document.getElementById('dup').textContent), null, { timeout: 120000 });
  ok('Duplicidade: mesmo comprovante → ⚠ PAGAMENTO JÁ REGISTRADO', true, (await popup.textContent('#dup')).replace(/\s+/g, ' ').slice(0, 160));
  const forcado = await popup.evaluate(async () => {
    const r = await fetch('/api/financeiro?acao=lancar', { method: 'POST', headers: { 'x-financeiro-senha': 'senha-gestao-teste', 'content-type': 'application/json' }, body: JSON.stringify({ paciente: 'Maria da Silva Santos', valor: 1800, data: '05/10/2026', idTransacao: document.getElementById('c-idTransacao').value, responsavel: 'x', forma: 'PIX' }) });
    return [r.status, (await r.json()).erro];
  });
  ok('Duplicidade: servidor recusa lançar de novo (mesmo ID da transação)', forcado[0] === 409 && /JÁ REGISTRADO/.test(forcado[1]), forcado.join(' '));
  const soArquivo = await popup.evaluate(async () => {
    const r = await fetch('/api/financeiro?acao=duplicidade', { method: 'POST', headers: { 'x-financeiro-senha': 'senha-gestao-teste', 'content-type': 'application/json' }, body: JSON.stringify({ valor: 1800, data: '05/10/2026', pagador: 'Maria da Silva Santos' }) });
    return (await r.json()).duplicidade.tipo;
  });
  ok('Duplicidade sem ID: mesmo valor + data + pagador → possível duplicado', soArquivo === 'provavel', soArquivo);

  // ---------- divergência: pago pelo marido (Itaú, JPG) × paciente Ana Paula ----------
  await popup.reload();
  await popup.fill('#senha', SENHA); await popup.dispatchEvent('#senha', 'change');
  await popup.setInputFiles('#arq', path.join(FIX, 'itau-carlos.jpg'));
  await popup.waitForSelector('#pac:not(.hide)', { timeout: 120000 });
  const lido2 = await popup.evaluate(() => Object.fromEntries(['pagador', 'valor', 'data', 'forma', 'banco', 'idTransacao'].map((k) => [k, document.getElementById('c-' + k).value])));
  console.log('   lido:', JSON.stringify(lido2));
  ok('OCR Itaú (JPG): valor 2.200,00, data 03/10/2026, Pix, Itaú', lido2.valor === '2.200,00' && lido2.data === '03/10/2026' && lido2.forma === 'PIX' && lido2.banco === 'Itaú', JSON.stringify(lido2));
  await amigo.goto('https://app.amigoapp.com.br/patient/form/5555');
  await amigo.evaluate(BOOK);
  await amigo.waitForSelector('#bf-usar');
  const painel2 = await amigo.textContent('#blue-fin-box');
  ok('AmigoApp: divergência detectada (pagador ≠ paciente, CPF diferente)', /DIVERGÊNCIA ENCONTRADA/.test(painel2), painel2.replace(/\s+/g, ' ').slice(0, 260));
  await amigo.click('#bf-usar');
  await popup.waitForSelector('#conc:not(.hide)', { timeout: 15000 });
  const conc2 = await popup.textContent('#conc-res');
  ok('Página mostra ⚠ DIVERGÊNCIA ENCONTRADA com o motivo', /DIVERGÊNCIA ENCONTRADA/.test(conc2) && /CARLOS EDUARDO PEREIRA|CPF do pagador/i.test(conc2));
  ok('Com divergência, CONFIRMAR fica bloqueado até marcar a conferência e escrever a observação', await popup.locator('#b-lancar').isDisabled());
  await popup.check('#ok-div'); ok('Só marcar não basta (falta observação)', await popup.locator('#b-lancar').isDisabled());
  await popup.fill('#obs', 'Pago pelo marido, Carlos Eduardo Pereira. Conferido com a paciente.');
  ok('Com conferência + observação, libera', await popup.locator('#b-lancar').isEnabled());
  await popup.click('#b-lancar');
  await popup.waitForFunction(() => /Lançamento #\d+ registrado/.test(document.getElementById('lanc-res').textContent));
  ok('Lançamento com divergência gravado como "conferido com divergência"', /#2 registrado/.test(await popup.textContent('#lanc-res')) && /divergência/.test(await popup.textContent('#lanc-res')));

  // ---------- PDF (Inter) + múltiplos candidatos no AmigoApp ----------
  await popup.reload();
  await popup.fill('#senha', SENHA); await popup.dispatchEvent('#senha', 'change');
  await popup.setInputFiles('#arq', path.join(FIX, 'inter-juliana.pdf'));
  await popup.waitForSelector('#pac:not(.hide)', { timeout: 120000 });
  const lido3 = await popup.evaluate(() => Object.fromEntries(['pagador', 'valor', 'data', 'hora', 'forma', 'banco', 'idTransacao'].map((k) => [k, document.getElementById('c-' + k).value])));
  console.log('   lido:', JSON.stringify(lido3));
  ok('PDF (texto): Juliana, 900,00, 04/10/2026 18:47, Pix, Banco Inter, ID', /Juliana Costa Mendes/.test(lido3.pagador) && lido3.valor === '900,00' && lido3.data === '04/10/2026' && lido3.hora === '18:47' && lido3.forma === 'PIX' && lido3.banco === 'Banco Inter' && /^E00416968/.test(lido3.idTransacao), JSON.stringify(lido3));
  await amigo.goto('https://app.amigoapp.com.br/patients');
  await amigo.evaluate(BOOK);
  await amigo.waitForFunction(() => /possíveis pacientes|paciente encontrada|NÃO IDENTIFICADO/.test((document.getElementById('blue-fin-box') || {}).textContent || ''), null, { timeout: 10000 });
  const lista = await amigo.textContent('#blue-fin-box');
  ok('AmigoApp → Pacientes: busca o pagador e mostra os 2 candidatos sem escolher', /2 possíveis pacientes/.test(lista) && /Juliana Costa Mendes/.test(lista) && /Juliana Mendes Costa/.test(lista), lista.replace(/\s+/g, ' ').slice(0, 220));
  ok('A busca do Amigo foi preenchida com o nome do pagador', /Juliana Costa Mendes/.test(await amigo.inputValue('input[placeholder^="Buscar"]')));
  await amigo.goto('https://app.amigoapp.com.br/patient/form/7777');
  await amigo.evaluate(BOOK); await amigo.waitForSelector('#bf-usar'); await amigo.click('#bf-usar');
  await popup.waitForSelector('#conc:not(.hide)', { timeout: 15000 });
  await popup.click('#b-lancar');
  await popup.waitForFunction(() => /Lançamento #\d+ registrado/.test(document.getElementById('lanc-res').textContent));
  ok('PDF conciliado e lançado (#3)', /#3 registrado/.test(await popup.textContent('#lanc-res')));

  // ---------- planilha fora do ar → lançamento salvo como pendente → reenvio ----------
  if (PLANILHA) {
    fs.writeFileSync(PLANILHA + '.fora', '1');
    const r = await popup.evaluate(async () => {
      const x = await fetch('/api/financeiro?acao=lancar', { method: 'POST', headers: { 'x-financeiro-senha': 'senha-gestao-teste', 'content-type': 'application/json' }, body: JSON.stringify({ paciente: 'Roberta Lima', pagador: 'Roberta Lima', valor: 600, data: '05/10/2026', forma: 'Cartão de crédito', responsavel: 'Gestão Teste', idTransacao: 'NSU778899' }) });
      return x.json();
    });
    ok('Planilha fora do ar: lançamento fica salvo e marcado como pendente', r.ok && r.planilha && !r.planilha.ok, JSON.stringify(r.planilha));
    fs.unlinkSync(PLANILHA + '.fora');
    await popup.reload(); await popup.fill('#senha', SENHA); await popup.dispatchEvent('#senha', 'change');
    await popup.waitForFunction(() => /ainda não estão na planilha/.test(document.getElementById('tot').textContent));
    popup.once('dialog', (d) => d.accept());
    await popup.click('#b-sync');
    await popup.waitForFunction(() => !/ainda não estão na planilha/.test(document.getElementById('tot').textContent) && /4 lançamento/.test(document.getElementById('tot').textContent), null, { timeout: 10000 });
    const pl = JSON.parse(fs.readFileSync(PLANILHA, 'utf8'));
    ok('Reenviar pendentes: planilha recebe o lançamento atrasado', pl.abas['Lançamentos'].linhas.length === 5, (pl.abas['Lançamentos'].linhas.length - 1) + ' linhas de lançamento');
  }
  const tot = await popup.textContent('#tot');
  ok('Lista de lançamentos na página', /4 lançamento\(s\)/.test(tot), tot);
  await browser.close();
  const falhas = resultados.filter((r) => !r.ok);
  fs.writeFileSync(path.join(__dirname, 'resultado-financeiro.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 1));
  console.log('\n' + (resultados.length - falhas.length) + ' de ' + resultados.length + ' verificações passaram.');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
