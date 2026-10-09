// Página /conciliacao: planilha da gestão montada a partir do grupo "Comprovantes de pagamento".
// 1) O botão 📊 no WhatsApp Web manda um lote (mensagens + imagens/PDFs) e abre esta página com #lote=…
// 2) Aqui cada comprovante é lido (OCR / texto do PDF), ligado à mensagem da paciente e tudo vai para o banco.
// 3) A planilha mostra uma paciente por linha: total, recebido, falta e os pagamentos. Vermelho = faltou dado.
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
  function mostrar() {
    const P = pacientes();
    let rec = 0, falta = 0, pend = 0;
    const html = P.map((p, i) => {
      rec += p.linhas.filter(noPeriodo).reduce((a, l) => a + (l.valor || 0), 0);
      falta += p.falta || 0;
      if (p.faltando.length) pend++;
      const v = (campo, conteudo, cls) => '<td class="' + (cls || '') + (p.faltando.includes(campo) ? ' vermelha' : ' editavel') + '" data-p="' + i + '" data-campo="' + campo + '">' + (conteudo || (p.faltando.includes(campo) ? 'faltando' : '')) + '</td>';
      const chips = p.linhas.map((l, j) => {
        const c = l.comprovante || {};
        const div = c.valor != null && l.pagoMensagem != null && Math.abs(c.valor - l.pagoMensagem) > 0.009;
        const cls = l.valor == null ? 'sem' : l.calculado ? 'calc' : div ? 'div' : '';
        const det = [c.tipo ? (c.lido ? '📎 ' : '⚠️ ') + c.tipo : '', c.forma, l.restante ? 'restante' : ''].filter(Boolean).join(' · ');
        const tit = [l.autor ? 'Enviado por ' + l.autor + ' às ' + (l.hora || '') : '', c.pagador ? 'Pagador: ' + c.pagador : '', c.arquivo ? 'Arquivo: ' + c.arquivo : '', div ? 'Mensagem dizia ' + brl(l.pagoMensagem) + ', comprovante ' + brl(c.valor) : '', l.texto ? l.texto.slice(0, 160) : ''].filter(Boolean).join('\n');
        return '<span class="chip ' + cls + '" data-p="' + i + '" data-l="' + j + '" title="' + esc(tit) + '">' + curto(l.data) + ' · ' + (l.valor == null ? 'valor?' : brl(l.valor)) + (l.calculado ? ' (calc.)' : '') + (det ? ' <small>' + esc(det) + '</small>' : '') + '</span>';
      }).join('');
      return '<tr>' + v('nome', esc(p.nome) + (p.tipo === 'cirurgia' ? ' <small>(cirurgia)</small>' : '')) + v('telefone', esc(fone(p.telefone))) +
        v('consultaEm', p.consultaEm ? br(p.consultaEm) + (p.consultaHora ? ' ' + p.consultaHora : '') : '') + v('total', p.total ? brl(p.total) : '', 'n') +
        '<td class="n">' + brl(p.pago) + '</td><td class="n ' + (p.falta === 0 ? 'falta-0' : '') + '">' + (p.falta == null ? '–' : p.falta === 0 ? 'quitado' : brl(p.falta)) + '</td><td>' + chips + '</td></tr>';
    }).join('');
    $('linhas').innerHTML = html || '<tr><td colspan="7" style="color:var(--muted);padding:18px">Nada no período. Use o botão 📊 Conciliar grupo no WhatsApp Web.</td></tr>';
    $('k-rec').textContent = brl(rec) || 'R$ 0,00'; $('k-falta').textContent = brl(falta) || 'R$ 0,00'; $('k-pac').textContent = P.length; $('k-pend').textContent = pend;
    $('linhas').querySelectorAll('td[data-campo]').forEach((td) => (td.onclick = () => editarPaciente(P[td.dataset.p], td.dataset.campo)));
    $('linhas').querySelectorAll('.chip').forEach((ch) => (ch.onclick = () => editarPagamento(P[ch.dataset.p].linhas[ch.dataset.l])));
  }

  const ROTULO = { nome: 'Nome da paciente', telefone: 'Telefone', consultaEm: 'Data da consulta (dd/mm/aaaa)', total: 'Valor total da consulta (R$)' };
  async function ajustar(chave, campo, valor) {
    await api('?acao=ajustar', { chave, campo, valor });
    LINHAS = (await api('')).linhas;
    mostrar();
  }
  async function editarPaciente(p, campo) {
    const atual = campo === 'consultaEm' ? br(p.consultaEm) : campo === 'total' ? (p.total || '') : (p[campo] || '');
    const r = prompt(ROTULO[campo] + ' — ' + (p.nome || 'paciente sem nome'), atual);
    if (r == null) return;
    let valor = r.trim();
    if (campo === 'total') valor = numero(valor);
    if (campo === 'consultaEm' && valor) { const m = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) { alert('Use dd/mm/aaaa.'); return; } valor = m[3] + '-' + pad(m[2]) + '-' + pad(m[1]); }
    try { await ajustar(p.linhas[0].chave, campo, valor); } catch (e) { msg('Não consegui salvar a correção.', 'bad'); }
  }
  async function editarPagamento(l) {
    const r = prompt('Pagamento de ' + br(l.data) + (l.autor ? ' (' + l.autor + ')' : '') + '\nValor recebido em R$ (vazio = manter · 0 = tirar da planilha)', l.valor == null ? '' : String(l.valor).replace('.', ','));
    if (r == null || r.trim() === '') return;
    const n = numero(r);
    try {
      if (n === 0) await ajustar(l.chave, 'ignorado', true);
      else if (n != null) await ajustar(l.chave, 'pago', n);
    } catch (e) { msg('Não consegui salvar a correção.', 'bad'); }
  }

  // ---------- 3. exportar ----------
  $('csv').onclick = () => {
    const cel = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const num = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));
    const linhas = [['Paciente', 'Telefone', 'Tipo', 'Consulta', 'Total', 'Recebido', 'Falta', 'Pagamentos', 'Faltando no grupo']];
    for (const p of pacientes()) linhas.push([p.nome, p.telefone, p.tipo, br(p.consultaEm) + (p.consultaHora ? ' ' + p.consultaHora : ''), num(p.total), num(p.pago), num(p.falta),
      p.linhas.map((l) => br(l.data) + ' ' + (l.valor == null ? '?' : num(l.valor)) + (l.calculado ? ' (calculado)' : '') + (l.comprovante && l.comprovante.forma ? ' ' + l.comprovante.forma : '')).join(' | '), p.faltando.join(', ')]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'conciliacao-' + ($('de').value || '') + '-a-' + ($('ate').value || '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  };
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
