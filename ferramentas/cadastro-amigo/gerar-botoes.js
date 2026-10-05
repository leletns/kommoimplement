// Gera os bookmarklets (bookmarklet-*.txt) e a página instalar-botoes.html a partir dos .js desta pasta.
// Uso: node ferramentas/cadastro-amigo/gerar-botoes.js
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ler = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const parser = ler('parse-ficha.js').replace(/^if \(typeof module.*$/m, '');
const pagamento = ler('pagamento-consulta.js').replace(/^if \(typeof module.*$/m, '');
const bio = ler('textos-bio.js').replace(/^if \(typeof module.*$/m, '');
const comprovante = fs.readFileSync(path.join(DIR, '../../ficha/js/comprovante.js'), 'utf8');
const compactar = (codigo) => codigo.replace('/*COMPROVANTE*/', () => comprovante).replace('/*BIO*/', bio).replace('/*PARSER*/', parser).replace('/*PAGAMENTO*/', pagamento).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');
const bookmarklet = (arquivo) => 'javascript:' + encodeURIComponent(compactar(ler(arquivo)));

const BOTOES = [
  { arq: 'link-ficha.js', txt: 'bookmarklet-link-ficha.txt', rotulo: '📝 Link da ficha', cor: '#7a4fb5' },
  { arq: 'copiar-ficha-kommo.js', txt: 'bookmarklet-copiar-ficha.txt', rotulo: '📋 Copiar ficha', cor: '#13294a' },
  { arq: 'preencher-cadastro.js', txt: 'bookmarklet-preencher-cadastro.txt', rotulo: '✍️ Preencher cadastro', cor: '#2e9e5f' },
  { arq: 'mensagem-exame.js', txt: 'bookmarklet-mensagem-exame.txt', rotulo: '💌 Mensagem do exame', cor: '#2f6fb5' },
  { arq: 'confirmar-consulta.js', txt: 'bookmarklet-confirmar-consulta.txt', rotulo: '✅ Confirmar consulta', cor: '#1f7d52' },
  { arq: 'agendamento.js', txt: 'bookmarklet-agendamento.txt', rotulo: '🧾 Agendamento', cor: '#a46d1c' },
];
const DIAG = { arq: 'diagnostico-tela.js', txt: 'bookmarklet-diagnostico.txt', rotulo: '🔍 Diagnóstico da tela', cor: '#c98a2b' };

const links = {};
for (const b of [...BOTOES, DIAG]) {
  const js = bookmarklet(b.arq);
  fs.writeFileSync(path.join(DIR, b.txt), js);
  links[b.rotulo] = js.replace(/"/g, '%22');
}
const a = (b, pad = '12px 18px') => `<a href="${links[b.rotulo]}" style="background:${b.cor};color:#fff;padding:${pad};border-radius:12px;text-decoration:none;font-weight:bold">${b.rotulo}</a>`;

const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Botões Blue</title><body style="font:16px/1.5 Arial,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#13294a;background:#f4f8fd">
<h1 style="font-size:24px">Botões da Comercial · Blue Clínica <small style="font-size:13px;color:#8a97a8">versão 11</small></h1>
<p><b>1. Mostre a barra de favoritos</b><br>Chrome: <b>Ctrl+Shift+B</b> (Mac: <b>⌘+Shift+B</b>). Safari no Mac: menu <b>Visualizar → Mostrar Barra de Favoritos</b> (<b>⌘+Shift+B</b>).</p>
<p><b>2. Arraste</b> cada botão abaixo até a barra de favoritos (se já tinha a versão antiga, apague a antiga antes):</p>
<p style="display:flex;gap:12px;flex-wrap:wrap">${BOTOES.map((b) => a(b)).join('\n')}</p>
<p style="margin-top:18px">Só se o Claude pedir: ${a(DIAG, '8px 14px')}</p>
<p><b>3. Como usar</b></p><ol>
<li>Paciente agendou: no <b>Kommo</b>, card da paciente → <b>📝 Link da ficha</b> → <b>Copiar mensagem com o link</b> e cole no chat. Na primeira vez ele pede o endereço da Ficha Blue (<b>https://ficha.clinicablue.com.br</b>) e a senha do botão. Quando ela enviar, aparece no card uma <b>nota com a ficha</b>, a etiqueta <b>ficha_recebida</b> e uma tarefa, e ela já fica <b>cadastrada no AmigoClinic</b>.</li>
<li>Para completar no Amigo o que a API não aceita (nascimento, RG, complemento, "Como nos conheceu") ou cadastrar no DocSignature: no Kommo clique em <b>📋 Copiar ficha</b> (ele usa a Ficha Blue; se não tiver, lê a conversa) e, na tela do Amigo ou do DocSignature, clique em <b>✍️ Preencher cadastro</b>. Confira e clique em Salvar.</li>
<li><b>Concierge (sem Kommo), no Mac/Safari:</b> só precisa do botão <b>✍️ Preencher cadastro</b>. Na tela de novo paciente do <b>AmigoClinic</b> (ou novo cliente do <b>DocSignature</b>), clique nele, digite o <b>nome, celular ou e-mail</b> da paciente e escolha na lista: os campos são preenchidos. Na primeira vez ele pede o endereço da Ficha Blue e a senha da equipe. Se aparecer "este site não deixou buscar daqui", use a página <b>/equipe</b> da Ficha Blue: busque, clique em Copiar ficha e clique de novo em ✍️.</li>
<li>Paciente pagou: no card dela no Kommo, clique em <b>🧾 Agendamento</b>. Ele monta o <b>texto do grupo de comprovantes</b>, o <b>título e a descrição do TimeTree</b> (com (Tele), (SP) ou (Dr. Leonardo)) e mostra o <b>comprovante</b> da conversa para abrir e salvar. Confira os campos, copie e cole.</li>
<li>Depois de gerar o pedido de exame: no Kommo clique em <b>💌 Mensagem do exame</b> e copie a mensagem.</li>
<li>1 ou 2 dias antes da consulta: <b>✅ Confirmar consulta</b>. No topo ele mostra se a consulta está <b>paga integral, se falta a segunda parte ou se não achou pagamento</b> (clique em "Ver de onde tirei isso" para ver as provas). Se faltar, a mensagem já pede a segunda parte com o valor. Depois → cole o <b>link do termo do DocSignature</b> e copie: 1) a confirmação; 2) presencial: orientações da bioimpedância, teleconsulta: pedido das fotos e <b>anexe o PDF das fotos</b>; 3) o termo com o link.</li></ol>
<p style="color:#5b6b82;font-size:14px"><b>Safari:</b> funciona igual. Se ao clicar no botão nada acontecer: Safari → Ajustes → Avançado → marque "Mostrar recursos para desenvolvedores web"; depois, no menu Desenvolvedor, marque "Permitir JavaScript do Campo de Busca Inteligente". Se aparecer um botão <b>Copiar</b> ou a bolinha <b>Colar</b>, clique nele, porque o Safari só copia e cola com um clique seu. Atalhos no Mac: <b>⌘C</b> e <b>⌘V</b>.</p>
<p style="color:#5b6b82;font-size:14px">Os botões usam a sua sessão do Kommo e preenchem a tela aberta; nada é salvo sozinho. Só o 📝 Link da ficha fala com o servidor da Ficha Blue, para assinar o link da paciente.</p></body>
`;
fs.writeFileSync(path.join(DIR, 'instalar-botoes.html'), html);

// Botão da GESTÃO (controle financeiro): página de instalação separada, fora da página da Comercial.
const FIN = { arq: 'controle-financeiro.js', txt: 'bookmarklet-controle-financeiro.txt', rotulo: '💰 Controle financeiro', cor: '#1f7d52' };
const finJs = bookmarklet(FIN.arq);
fs.writeFileSync(path.join(DIR, FIN.txt), finJs);
links[FIN.rotulo] = finJs.replace(/"/g, '%22');
const htmlFin = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Botão da Gestão</title><body style="font:16px/1.5 Arial,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#13294a;background:#f4f8fd">
<h1 style="font-size:24px">Botão da Gestão · Controle financeiro <small style="font-size:13px;color:#8a97a8">versão 3 (entende o que foi pago e busca no AmigoApp)</small></h1>
<p>Só para a <b>gestão</b>. Não tem relação com os botões da Comercial (Copiar ficha, Preencher cadastro…), que continuam iguais.</p>
<p><b>1. Mostre a barra de favoritos</b><br>Safari no Mac: menu <b>Visualizar → Mostrar Barra de Favoritos</b> (<b>⌘+Shift+B</b>). Chrome: <b>⌘+Shift+B</b> / <b>Ctrl+Shift+B</b>.</p>
<p><b>2. Arraste</b> o botão abaixo até a barra de favoritos:</p>
<p>${a(FIN)}</p>
<p><b>3. Como usar</b></p><ol>
<li><b>WhatsApp Web</b>: abra a conversa com o comprovante e clique em <b>💰 Controle financeiro</b>. Escolha a imagem do comprovante: ela é copiada e a página <b>Controle financeiro</b> abre. Lá, aperte <b>⌘V</b>. Na primeira vez ele pede o endereço do site (<b>https://clinicablue.pages.dev</b> ou o domínio da ficha) e, na página, a <b>senha da gestão</b>.</li>
<li>A página <b>lê o comprovante</b> (nome, valor, data, Pix/cartão, banco, ID da transação) e avisa se ele <b>já foi lançado</b>.</li>
<li>Clique em <b>Conferir no AmigoApp → Pacientes</b>. No AmigoApp, abra a paciente e clique de novo em <b>💰 Controle financeiro</b>: ele compara a paciente com o comprovante e envia para a conciliação. Se você estiver na lista de pacientes, ele busca o nome do pagador e mostra os possíveis pacientes (nunca escolhe sozinho).</li>
<li>Volte à página <b>Controle financeiro</b>: confira a conciliação (✓ ou ⚠ divergência), escreva a observação se precisar e clique em <b>CONFIRMAR LANÇAMENTO</b>. O lançamento vai para a <b>planilha da gestão</b>.</li></ol>
<p style="color:#5b6b82;font-size:14px"><b>Safari:</b> se ao clicar no botão nada acontecer: Safari → Ajustes → Avançado → marque "Mostrar recursos para desenvolvedores web"; no menu Desenvolvedor, marque "Permitir JavaScript do Campo de Busca Inteligente". Se o Safari não deixar copiar a imagem, o botão baixa o comprovante: arraste o arquivo para a página.</p>
<p style="color:#5b6b82;font-size:14px">A leitura do comprovante acontece no seu computador. O botão não altera nada no WhatsApp nem no AmigoApp (nem cadastro, nem prontuário).</p></body>
`;
fs.writeFileSync(path.join(DIR, 'instalar-botao-financeiro.html'), htmlFin);
console.log('ok:', [...BOTOES, DIAG, FIN].map((b) => b.txt).join(', '));
