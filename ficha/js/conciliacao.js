// Página /conciliacao: planilha da gestão montada a partir do grupo "Comprovantes de pagamento".
// 1) O botão 📊 no WhatsApp Web manda um lote (mensagens + imagens/PDFs) e abre esta página com #lote=…
// 2) Aqui cada comprovante é lido (OCR / texto do PDF), ligado à mensagem da paciente e tudo vai para o banco.
// 3) A planilha mostra cada paciente e, embaixo, os serviços (valor, forma, desconto, recebido, falta). Vermelho = faltou dado.
//    "Baixar planilha" gera o Excel no modelo da gestão: Resumo + uma aba por paciente, com fórmulas.
(function () {
  'use strict';
  const G = window.GrupoComprovantes, C = window.BlueComprovante, L = window.BlueLeitura;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = (v) => (v == null ? '' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const br = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
  const curto = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
  const pad = (n) => String(n).padStart(2, '0');
  const isoHoje = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const ler = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* navegação privada */ } };
  const msg = (t, c) => { $('msg').textContent = t || ''; $('msg').className = c || ''; };
  const prog = (f) => { $('prog').hidden = f == null; if (f != null) $('prog').firstChild.style.width = Math.round(f * 100) + '%'; };
  const numero = (s) => { const t = String(s || '').replace(/[^\d,.-]/g, ''); if (!t) return null; const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
  const fone = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : String(t || ''); };
  const nomeBonito = (s) => String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (x, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (x) => x.toLowerCase()).trim();

  let senha = ler('blueFinSenha'), LINHAS = [], PLANILHA = '';
  const api = async (q, corpo) => {
    const r = await fetch('/api/conciliacao' + (q || ''), corpo ? { method: 'POST', headers: { 'x-financeiro-senha': encodeURIComponent(senha), 'content-type': 'application/json' }, body: JSON.stringify(corpo) } : { headers: { 'x-financeiro-senha': encodeURIComponent(senha) } });
    if (r.status === 401) throw new Error('senha');
    if (q && q.includes('acao=arquivo')) { if (!r.ok) throw new Error('arquivo'); return r.blob(); }
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro || 'erro');
    return j;
  };

  // ---------- 1. lote vindo do WhatsApp ----------
  const minutos = (dia, hora) => new Date(dia + 'T' + (hora || '00:00') + ':00').getTime() / 60000;
  async function processarLote(id) {
    msg('Recebendo o que o botão leu no WhatsApp…'); prog(0);
    const lote = await api('?acao=lote&id=' + encodeURIComponent(id));
    const { itens = [], de, ate } = lote.dados || {};
    if (de) $('de').value = de;
    if (ate) $('ate').value = ate;
    // Mensagens de texto (e legendas) → linhas de pagamento
    const regs = [];
    const porItem = new Map();
    for (const it of itens) {
      if (!it.cab || !it.texto) continue;
      const r = G.parseComprovantes(G.textoDoWhatsAppWeb([{ cab: it.cab, texto: it.texto }]))[0];
      if (!r) continue;
      const reg = Object.assign({}, r, { chave: it.id, hora: it.hora || r.hora, autor: it.autor || r.autor, pagoMensagem: r.pago, origem: 'mensagem' });
      regs.push(reg); porItem.set(it.id, reg);
    }
    // Comprovantes (imagem/PDF) → valor recebido
    const midias = itens.filter((it) => it.arquivo || it.pdfNome);
    let feitos = 0;
    for (const it of midias) {
      prog(feitos / Math.max(1, midias.length));
      msg('Lendo os comprovantes… ' + (feitos + 1) + ' de ' + midias.length + (it.pdfNome ? ' (' + it.pdfNome + ')' : ''));
      feitos++;
      let comp = null;
      if (it.arquivo) {
        try {
          const blob = await api('?acao=arquivo&id=' + encodeURIComponent(id) + '&nome=' + encodeURIComponent(it.arquivo));
          const lido = await L.lerArquivo(blob);
          const d = C.lerComprovante(lido.texto, { confiancaOcr: lido.confianca });
          comp = { valor: d.valor, moeda: d.moeda, data: d.data ? C.dataISO(d.data) : '', forma: d.forma || d.tipoDocumento || '', pagador: d.pagador || '', banco: d.banco || '', idTransacao: d.idTransacao || '', arquivo: it.pdfNome || it.arquivo, tipo: /\.pdf$/i.test(it.arquivo) ? 'PDF' : /^doc-/.test(it.arquivo) ? 'Imagem (arquivo)' : /\.pdf$/i.test(it.pdfNome || '') ? 'PDF (prévia)' : 'Imagem', lido: d.valor != null };
        } catch (e) { console.error('[conciliacao] não li ' + it.arquivo + ': ' + (e && e.message)); comp = { valor: null, arquivo: it.pdfNome || it.arquivo, tipo: /\.pdf$/i.test(it.pdfNome || it.arquivo) ? 'PDF' : 'Imagem', lido: false }; }
      } else comp = { valor: null, arquivo: it.pdfNome, tipo: /\.pdf$/i.test(it.pdfNome) ? 'PDF' : 'Arquivo', lido: false };
      // Liga o comprovante à mensagem da paciente: a própria legenda; senão a mensagem do mesmo autor mais perto no tempo (até 30 min); senão o nome do pagador.
      let alvo = porItem.get(it.id);
      if (!alvo) {
        const t = minutos(it.dia, it.hora);
        alvo = regs.filter((r) => !r.comprovante && r.autor === it.autor && Math.abs(minutos(r.data, r.hora) - t) <= 30)
          .sort((a, b) => Math.abs(minutos(a.data, a.hora) - t) - Math.abs(minutos(b.data, b.hora) - t))[0];
      }
      // Pelo nome só no mesmo dia: comprovante de outro dia é outro pagamento (ex.: o restante), vira linha própria e soma na paciente.
      if (!alvo && comp.pagador) alvo = regs.find((r) => !r.comprovante && r.nome && r.data === (comp.data || it.dia) && ['exato', 'forte'].includes(C.compararNomes(r.nome, comp.pagador).nivel));
      if (alvo) {
        alvo.comprovante = comp;
        if (alvo.pago == null && comp.valor != null) alvo.pago = comp.valor;
      } else {
        regs.push({ chave: it.id, data: (comp.data && comp.data.slice(0, 7) === String(it.dia).slice(0, 7) ? comp.data : it.dia), hora: it.hora, autor: it.autor, nome: comp.pagador ? nomeBonito(comp.pagador) : null,
          telefone: null, pago: comp.valor, total: null, tipo: 'consulta', restante: false, origem: 'comprovante', comprovante: comp,
          texto: comp.lido ? '' : (it.pdfNome ? 'Arquivo não lido: ' + it.pdfNome : 'Comprovante ilegível') });
      }
    }
    prog(1);
    msg('Salvando na planilha…');
    const j = await api('', { registros: regs, lote: id });
    history.replaceState(null, '', location.pathname);
    LINHAS = j.linhas;
    prog(null);
    msg('✅ Grupo conciliado: ' + regs.length + ' pagamento(s) lido(s), ' + j.novos + ' novo(s). Ler de novo não duplica.', 'ok');
    mostrar();
  }

  // ---------- 2. planilha ----------
  function noPeriodo(l) { const de = $('de').value, ate = $('ate').value; return (!de || l.data >= de) && (!ate || l.data <= ate); }
  function pacientes() {
    const q = G.normalize($('busca').value), dig = $('busca').value.replace(/\D/g, '');
    return G.planilhaPorPaciente(LINHAS).filter((p) => p.linhas.some(noPeriodo))
      .filter((p) => !q || G.normalize(p.nome || '').includes(q) || (dig.length >= 4 && String(p.telefone || '').includes(dig)));
  }
  const pct = (d) => (d ? String(d).replace('.', ',') + '%' : '');
  const STATUS = { ok: '<span class="st ok">✓ quitado</span>', falta: '<span class="st falta">a receber</span>', 'sem valor': '<span class="st sem">sem valor</span>' };
  function mostrar() {
    const P = pacientes();
    let rec = 0, falta = 0, pend = 0;
    const html = P.map((p, i) => {
      rec += p.linhas.filter(noPeriodo).reduce((a, l) => a + (l.valor || 0), 0);
      falta += p.falta || 0;
      if (p.faltando.length) pend++;
      const f = (campo, conteudo, extra) => '<span class="' + (p.faltando.includes(campo) ? 'vermelha' : 'editavel') + '" data-p="' + i + '" data-campo="' + campo + '"' + (extra || '') + '>' + (conteudo || (p.faltando.includes(campo) ? ROTULO_CURTO[campo] + '?' : '')) + '</span>';
      const stP = p.falta == null ? 'sem valor' : p.falta === 0 && !p.faltando.includes('total') ? 'ok' : 'falta';
      const cab = '<tr class="pac"><td>' + f('nome', '<b>' + esc(p.nome || '') + '</b>') + '<div class="sub">' + f('telefone', esc(fone(p.telefone))) + ' · consulta ' + f('consultaEm', p.consultaEm ? br(p.consultaEm) + (p.consultaHora ? ' ' + p.consultaHora : '') : '') + '</div></td>' +
        '<td class="n">' + brl(p.total) + '</td><td></td><td class="n">' + (p.desconto ? '− ' + brl(p.desconto) : '') + '</td><td class="n"><b>' + brl(p.pago) + '</b></td><td class="n"><b>' + (p.falta == null ? '–' : brl(p.falta)) + '</b></td><td>' + STATUS[stP] + '</td><td></td></tr>';
      const linhasS = p.servicos.map((s, k) => {
        const c = (campo, conteudo, cls) => '<td class="' + (cls || '') + (s.faltando.includes(campo) ? ' vermelha' : ' editavel') + '" data-p="' + i + '" data-s="' + k + '" data-campo="' + campo + '">' + (conteudo || (s.faltando.includes(campo) ? 'faltando' : '')) + '</td>';
        const chips = s.linhas.map((l, j) => {
          const cp = l.comprovante || {};
          const div = cp.valor != null && l.pagoMensagem != null && Math.abs(cp.valor - l.pagoMensagem) > 0.009;
          const cls = l.valor == null ? 'sem' : l.calculado ? 'calc' : div ? 'div' : '';
          const det = [cp.tipo ? (cp.lido ? '📎 ' : '⚠️ ') + cp.tipo : '', l.restante ? 'restante' : ''].filter(Boolean).join(' · ');
          const tit = [l.autor ? 'Enviado por ' + l.autor + ' às ' + (l.hora || '') : '', l.forma ? 'Forma: ' + l.forma : '', cp.pagador ? 'Pagador: ' + cp.pagador : '', cp.arquivo ? 'Arquivo: ' + cp.arquivo : '', div ? 'Mensagem dizia ' + brl(l.pagoMensagem) + ', comprovante ' + brl(cp.valor) : '', l.texto ? l.texto.slice(0, 160) : ''].filter(Boolean).join('\n');
          return '<span class="chip ' + cls + '" data-p="' + i + '" data-s="' + k + '" data-l="' + j + '" title="' + esc(tit) + '">' + curto(l.data) + ' · ' + (l.valor == null ? 'valor?' : brl(l.valor)) + (l.calculado ? ' (calc.)' : '') + (det ? ' <small>' + esc(det) + '</small>' : '') + '</span>';
        }).join('');
        return '<tr class="serv">' + c('servico', '↳ ' + esc(s.servico)) + c('total', s.total ? brl(s.total) : '', 'n') + c('forma', esc(s.forma || '')) + c('desconto', pct(s.desconto), 'n') +
          '<td class="n">' + brl(s.pago) + '</td><td class="n">' + (s.falta == null ? '–' : brl(s.falta)) + '</td><td>' + STATUS[s.status] + '</td><td>' + chips + '</td></tr>';
      }).join('');
      return cab + linhasS;
    }).join('');
    $('linhas').innerHTML = html || '<tr><td colspan="8" style="color:var(--muted);padding:18px">Nada no período. Use o botão 📊 Conciliar grupo no WhatsApp Web.</td></tr>';
    $('k-rec').textContent = brl(rec) || 'R$ 0,00'; $('k-falta').textContent = brl(falta) || 'R$ 0,00'; $('k-pac').textContent = P.length; $('k-pend').textContent = pend;
    $('linhas').querySelectorAll('[data-campo]').forEach((el) => (el.onclick = () => (el.dataset.s != null ? editarServico(P[el.dataset.p].servicos[el.dataset.s], el.dataset.campo) : editarPaciente(P[el.dataset.p], el.dataset.campo))));
    $('linhas').querySelectorAll('.chip').forEach((ch) => (ch.onclick = () => editarPagamento(P[ch.dataset.p].servicos[ch.dataset.s].linhas[ch.dataset.l])));
  }

  const ROTULO_CURTO = { nome: 'nome', telefone: 'telefone', consultaEm: 'data' };
  const ROTULO = { nome: 'Nome da paciente', telefone: 'Telefone', consultaEm: 'Data da consulta (dd/mm/aaaa)', total: 'Valor do serviço (R$)', forma: 'Forma de pagamento (ex.: Pix, Cartão 10x, À vista)', desconto: 'Desconto em % (ex.: 10). Vazio = sem desconto', servico: 'Serviço (' + G.SERVICOS.join(', ') + ')' };
  // A correção vale para todas as mensagens daquela paciente/serviço, então nenhuma mensagem antiga "ganha" da correção.
  async function ajustar(linhas, campo, valor) {
    for (const l of linhas) await api('?acao=ajustar', { chave: l.chave, campo, valor });
    LINHAS = (await api('')).linhas;
    mostrar();
  }
  async function editarPaciente(p, campo) {
    const r = prompt(ROTULO[campo] + ' — ' + (p.nome || 'paciente sem nome'), campo === 'consultaEm' ? br(p.consultaEm) : (p[campo] || ''));
    if (r == null) return;
    let valor = r.trim();
    if (campo === 'consultaEm' && valor) { const m = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) { alert('Use dd/mm/aaaa.'); return; } valor = m[3] + '-' + pad(m[2]) + '-' + pad(m[1]); }
    try { await ajustar(campo === 'nome' ? p.linhas.slice(0, 1) : p.linhas, campo, valor); } catch (e) { msg('Não consegui salvar a correção.', 'bad'); }
  }
  async function editarServico(s, campo) {
    const atual = campo === 'total' ? (s.total || '') : campo === 'desconto' ? (s.desconto || '') : (s[campo] || '');
    const r = prompt(ROTULO[campo] + ' — ' + s.servico, String(atual).replace('.', ','));
    if (r == null) return;
    let valor = r.trim();
    if (campo === 'total' || campo === 'desconto') valor = valor === '' ? '' : numero(valor);
    if (campo === 'servico' && valor) valor = G.SERVICOS.find((x) => G.normalize(x) === G.normalize(valor)) || G.servicoDoTexto(valor) || valor;
    try { await ajustar(s.linhas, campo, valor); } catch (e) { msg('Não consegui salvar a correção.', 'bad'); }
  }
  async function editarPagamento(l) {
    const r = prompt('Pagamento de ' + br(l.data) + (l.autor ? ' (' + l.autor + ')' : '') + ' · ' + l.servico + '\nValor recebido em R$ (vazio = manter · 0 = tirar da planilha)', l.valor == null ? '' : String(l.valor).replace('.', ','));
    if (r == null || r.trim() === '') return;
    const n = numero(r);
    try {
      if (n === 0) await ajustar([l], 'ignorado', true);
      else if (n != null) await ajustar([l], 'pago', n);
    } catch (e) { msg('Não consegui salvar a correção.', 'bad'); }
  }

  // ---------- 3. exportar ----------
  $('csv').onclick = async () => {
    try { msg('Montando a planilha…'); await baixarExcel(pacientes()); msg('✅ Planilha baixada.', 'ok'); }
    catch (e) { console.error(e); msg('Não consegui montar a planilha: ' + (e && e.message), 'bad'); }
  };
  const carregarScript = (src) => new Promise((ok, erro) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('sem internet para a planilha')); document.head.appendChild(s); });
  // Excel no modelo da gestão: aba Resumo + uma aba por paciente (serviços com fórmulas e pagamentos recebidos).
  async function baixarExcel(P) {
    if (!window.ExcelJS) await carregarScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');
    const wb = new window.ExcelJS.Workbook();
    wb.creator = 'Clínica Blue';
    const NAVY = 'FF13294A', MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" -', VERM = 'FFFBE3E3', AMAR = 'FFFDF3DC', CINZA = 'FFEAF2FB';
    const fundo = (c, cor) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } }; };
    const borda = { top: { style: 'thin', color: { argb: 'FFDBE4F0' } }, bottom: { style: 'thin', color: { argb: 'FFDBE4F0' } }, left: { style: 'thin', color: { argb: 'FFDBE4F0' } }, right: { style: 'thin', color: { argb: 'FFDBE4F0' } } };
    const cabecalho = (row) => row.eachCell((c) => { fundo(c, NAVY); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = borda; });
    // Status colorido (verde ok · laranja falta · vermelho sem valor), acompanha as fórmulas
    const statusCF = (ws, col, r1, r2) => {
      const cor = (txt, fonte, fundoCor, prioridade) => ({ type: 'expression', priority: prioridade, formulae: [col + r1 + '="' + txt + '"'],
        style: { font: { bold: true, color: { argb: fonte } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: fundoCor } } } });
      ws.addConditionalFormatting({ ref: col + r1 + ':' + col + r2, rules: [cor('ok', 'FF1F7D52', 'FFE9F6EF', 1), cor('falta', 'FF8A5A12', 'FFFDF3DC', 2), cor('sem valor', 'FFB04848', 'FFFBE3E3', 3)] });
    };
    const periodo = br($('de').value) + ' a ' + br($('ate').value);

    // Resumo (preenchido com fórmulas que leem as abas das pacientes: mexeu na aba, o resumo acompanha)
    const R = wb.addWorksheet('Resumo', { views: [{ state: 'frozen', ySplit: 3 }], properties: { tabColor: { argb: NAVY } }, pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    R.columns = [{ width: 34 }, { width: 17 }, { width: 13 }, { width: 15 }, { width: 14 }, { width: 17 }, { width: 15 }, { width: 15 }, { width: 12 }];
    R.mergeCells('A1:I1');
    R.getCell('A1').value = 'Conciliação · grupo de comprovantes · ' + periodo;
    R.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY } };
    R.getCell('A2').value = 'Vermelho = faltou no grupo · Amarelo = restante calculado · Clique no nome para abrir a aba da paciente';
    R.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7890' } };
    cabecalho(R.addRow(['PACIENTE', 'TELEFONE', 'CONSULTA', 'VALOR', 'DESCONTO', 'VALOR COM DESCONTO', 'RECEBIDO', 'FALTA', 'STATUS']));
    const usados = new Set();
    const nomeAba = (n) => {
      let b = String(n || 'Sem nome').replace(/[\[\]:*?/\\']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Sem nome', x = b, k = 2;
      while (usados.has(x.toLowerCase()) || x.toLowerCase() === 'resumo') x = b.slice(0, 26) + ' ' + k++;
      usados.add(x.toLowerCase());
      return x;
    };
    const ini = R.rowCount + 1;
    for (const p of P) {
      const aba = nomeAba(nomeBonito(p.nome));
      const ws = wb.addWorksheet(aba, { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      ws.columns = [{ width: 24 }, { width: 16 }, { width: 22 }, { width: 12 }, { width: 19 }, { width: 16 }, { width: 15 }, { width: 13 }];
      ws.mergeCells('A1:H1');
      ws.getCell('A1').value = nomeBonito(p.nome) || 'Paciente sem nome';
      ws.getCell('A1').font = { bold: true, size: 15, color: { argb: NAVY } };
      if (!p.nome) fundo(ws.getCell('A1'), VERM);
      ws.mergeCells('A2:H2');
      ws.getCell('A2').value = 'Telefone: ' + (fone(p.telefone) || 'faltando') + '   ·   Consulta: ' + (p.consultaEm ? br(p.consultaEm) + (p.consultaHora ? ' às ' + p.consultaHora : '') : 'faltando');
      ws.getCell('A2').font = { color: { argb: 'FF3A4760' } };
      cabecalho(ws.addRow(['SERVIÇO', 'VALOR', 'FORMA DE PAGAMENTO', 'DESCONTO', 'VALOR COM DESCONTO', 'RECEBIDO', 'FALTA', 'STATUS']));
      ws.getRow(3).height = 30;
      // Pagamentos ficam embaixo; RECEBIDO soma os pagamentos daquele serviço (SOMASE), então dá para incluir pagamento à mão.
      const nS = p.servicos.length, linhaTot = 4 + nS, pagCab = linhaTot + 8, pagIni = pagCab + 1, pagFim = pagIni + p.linhas.length + 9;
      p.servicos.forEach((s, k) => {
        const r = 4 + k;
        const row = ws.addRow([s.servico, s.total, s.forma || '', s.desconto ? s.desconto / 100 : 0,
          { formula: 'IF(B' + r + '="","",B' + r + '*(1-D' + r + '))', result: s.aPagar == null ? '' : s.aPagar },
          { formula: 'SUMIF($B$' + pagIni + ':$B$' + pagFim + ',A' + r + ',$C$' + pagIni + ':$C$' + pagFim + ')', result: s.pago },
          { formula: 'IF(E' + r + '="","",MAX(0,E' + r + '-F' + r + '))', result: s.falta == null ? '' : s.falta },
          { formula: 'IF(B' + r + '="","sem valor",IF(G' + r + '<=0,"ok","falta"))', result: s.status }]);
        row.eachCell({ includeEmpty: true }, (c) => { c.border = borda; });
        row.getCell(1).font = { bold: true };
        [2, 5, 6, 7].forEach((n) => (row.getCell(n).numFmt = MOEDA));
        row.getCell(4).numFmt = '0%';
        row.getCell(8).alignment = { horizontal: 'center' };
        if (!s.total) fundo(row.getCell(2), VERM);
        if (!s.forma) fundo(row.getCell(3), VERM);
      });
      const f1 = 4, f2 = 3 + nS;
      const tot = [['TOTAL', 'SUM(B' + f1 + ':B' + f2 + ')', p.total || 0], ['DESCONTOS', 'SUM(B' + f1 + ':B' + f2 + ')-SUM(E' + f1 + ':E' + f2 + ')', p.desconto || 0],
        ['TOTAL COM DESCONTOS', 'SUM(E' + f1 + ':E' + f2 + ')', p.aPagar || 0], ['RECEBIDO', 'SUM(F' + f1 + ':F' + f2 + ')', p.pago || 0], ['FALTA RECEBER', 'SUM(G' + f1 + ':G' + f2 + ')', p.falta || 0]];
      ws.addRow([]);
      tot.forEach(([rot, fo, res], k) => {
        const row = ws.addRow([rot, { formula: fo, result: res }]);
        row.getCell(1).font = { bold: true, color: { argb: NAVY } };
        row.getCell(2).numFmt = MOEDA;
        row.getCell(2).font = { bold: true };
        [1, 2].forEach((n) => { fundo(row.getCell(n), k === 4 ? AMAR : CINZA); row.getCell(n).border = borda; });
      });
      ws.getRow(pagCab - 1).getCell(1).value = 'PAGAMENTOS RECEBIDOS';
      ws.getRow(pagCab - 1).getCell(1).font = { bold: true, color: { argb: NAVY } };
      const hp = ws.getRow(pagCab);
      hp.values = ['DATA', 'SERVIÇO', 'VALOR', 'FORMA', 'COMPROVANTE', 'ENVIADO POR', 'OBS.'];
      cabecalho(hp);
      p.linhas.forEach((l, k) => {
        const cp = l.comprovante || {};
        const row = ws.getRow(pagIni + k);
        row.values = [br(l.data), l.servico, l.valor, l.forma || '', cp.tipo ? cp.tipo + (cp.lido ? '' : ' (não lido)') : 'só mensagem', l.autor || '', l.calculado ? 'restante calculado' : l.restante ? 'restante' : ''];
        row.getCell(3).numFmt = MOEDA;
        row.eachCell({ includeEmpty: true }, (c) => { c.border = borda; });
        if (l.valor == null) fundo(row.getCell(3), VERM);
        else if (l.calculado) fundo(row.getCell(3), AMAR);
        if (!l.forma) fundo(row.getCell(4), VERM);
      });
      for (let r = pagIni + p.linhas.length; r <= pagFim; r++) { ws.getRow(r).getCell(3).numFmt = MOEDA; for (let c = 1; c <= 7; c++) ws.getRow(r).getCell(c).border = borda; }
      ws.dataValidations.add('B' + pagIni + ':B' + pagFim, { type: 'list', allowBlank: true, formulae: ['$A$' + f1 + ':$A$' + f2] });
      statusCF(ws, 'H', f1, f2);

      // Linha da paciente no Resumo (fórmulas apontando para a aba dela)
      const q = "'" + aba.replace(/'/g, "''") + "'!";
      const r = R.rowCount + 1;
      const row = R.addRow([{ text: nomeBonito(p.nome) || 'Sem nome', hyperlink: '#' + q + 'A1' }, fone(p.telefone), br(p.consultaEm),
        { formula: q + 'B' + (linhaTot + 1), result: p.total || 0 }, { formula: q + 'B' + (linhaTot + 2), result: p.desconto || 0 }, { formula: q + 'B' + (linhaTot + 3), result: p.aPagar || 0 },
        { formula: q + 'B' + (linhaTot + 4), result: p.pago || 0 }, { formula: q + 'B' + (linhaTot + 5), result: p.falta || 0 },
        { formula: 'IF(COUNTIF(' + q + 'H' + f1 + ':H' + f2 + ',"sem valor")>0,"sem valor",IF(H' + r + '<=0,"ok","falta"))', result: p.falta == null ? 'sem valor' : p.falta === 0 && !p.faltando.includes('total') ? 'ok' : 'falta' }]);
      row.getCell(1).font = { bold: true, color: { argb: 'FF2F6FB5' }, underline: true };
      [4, 5, 6, 7, 8].forEach((n) => (row.getCell(n).numFmt = MOEDA));
      row.getCell(9).alignment = { horizontal: 'center' };
      row.eachCell({ includeEmpty: true }, (c) => { c.border = borda; });
      if (!p.nome) fundo(row.getCell(1), VERM);
      if (!p.telefone) fundo(row.getCell(2), VERM);
      if (!p.consultaEm) fundo(row.getCell(3), VERM);
      if (p.faltando.includes('total')) fundo(row.getCell(4), VERM);
    }
    const fim = R.rowCount;
    if (fim >= ini) {
      const row = R.addRow(['TOTAL (' + P.length + ' pacientes)', '', '', ...['D', 'E', 'F', 'G', 'H'].map((c) => ({ formula: 'SUM(' + c + ini + ':' + c + fim + ')' })), '']);
      row.eachCell({ includeEmpty: true }, (c) => { fundo(c, CINZA); c.font = { bold: true, color: { argb: NAVY } }; c.border = borda; });
      [4, 5, 6, 7, 8].forEach((n) => (row.getCell(n).numFmt = MOEDA));
      statusCF(R, 'I', ini, fim);
      R.autoFilter = 'A3:I' + fim;
    }
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = 'Conciliacao-' + br($('de').value).replace(/\//g, '-') + '-a-' + br($('ate').value).replace(/\//g, '-') + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  $('gsheet').onclick = () => {
    const f = '=IMPORTDATA("' + PLANILHA + '")', box = $('gbox');
    box.hidden = !box.hidden;
    box.innerHTML = '<b>Planilha do Google que atualiza sozinha</b><p class="leg">Abra <b>sheets.new</b>, clique na célula A1 e cole a fórmula. Toda leitura nova do grupo aparece lá (o Google atualiza em até 1 hora). Não compartilhe a fórmula.</p><input readonly style="width:100%" value="' + esc(f) + '"><div style="margin-top:8px"><button id="copiar-f">Copiar fórmula</button></div>';
    $('copiar-f').onclick = () => navigator.clipboard.writeText(f).then(() => msg('Fórmula copiada.', 'ok'), () => msg('Selecione e copie a fórmula.'));
  };
  ['de', 'ate', 'busca'].forEach((k) => $(k).addEventListener('input', mostrar));

  // ---------- 4. entrada ----------
  async function iniciar() {
    $('login').hidden = true; $('app').hidden = false;
    const hoje = new Date();
    if (!$('de').value) $('de').value = isoHoje(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    if (!$('ate').value) $('ate').value = isoHoje(hoje);
    const k = await api('?acao=chave');
    PLANILHA = k.planilha;
    try {
      const modelo = await (await fetch('/js/botao-conciliar.txt', { cache: 'no-store' })).text();
      $('link-botao').href = modelo.trim().replace('__SITE__', encodeURIComponent(location.origin)).replace('__CHAVE__', k.chave);
    } catch (e) { /* sem botão: a planilha funciona igual */ }
    const lote = (location.hash.match(/lote=([a-f0-9]{32})/) || [])[1];
    if (lote) await processarLote(lote);
    else { LINHAS = (await api('')).linhas; mostrar(); if (!LINHAS.length) $('instalar').open = true; }
  }
  async function entrar() {
    const s = $('senha').value.trim();
    if (s) senha = s;
    try { await iniciar(); guardar('blueFinSenha', senha); }
    catch (e) {
      if (e.message === 'senha') { $('app').hidden = true; $('login').hidden = false; msg(''); if (s) alert('Senha incorreta.'); }
      else { msg('Não consegui carregar: ' + e.message, 'bad'); prog(null); }
    }
  }
  $('entrar').onclick = entrar;
  $('senha').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
  if (senha) entrar(); else $('login').hidden = false;
})();
