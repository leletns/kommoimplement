// Leitura de comprovante (texto do OCR ou do PDF) → dados estruturados, e comparação com a paciente.
// Usado pela página /financeiro (navegador, Safari incluso) e pelos testes no Node. Não fala com nenhum servidor.
(function (raiz) {
  'use strict';
  const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const digitos = (s) => String(s || '').replace(/\D/g, '');
  const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12, feb: 2, apr: 4, may: 5, aug: 8, sep: 9, oct: 10, dec: 12 };
  const BANCOS = [
    ['Nubank', /\bnu ?bank\b|nu pagamentos|\bnu financeira/],
    ['Itaú', /\bitau\b|itau unibanco/],
    ['Bradesco', /bradesco/],
    ['Banco Inter', /\bbanco inter\b|\binter s\.?a\b|\binter\b(?= ?(?:&|pix|dtvm))/],
    ['Banco do Brasil', /banco do brasil|\bbb\b s\.?a/],
    ['Caixa', /caixa econ|\bcaixa\b/],
    ['Santander', /santander/],
    ['C6 Bank', /\bc6\b|c6 bank/],
    ['PicPay', /picpay/],
    ['Mercado Pago', /mercado ?pago/],
    ['PagBank', /pagbank|pagseguro/],
    ['BTG Pactual', /\bbtg\b/],
    ['Sicoob', /sicoob/],
    ['Sicredi', /sicredi/],
    ['Banco Original', /banco original/],
    ['Neon', /\bneon\b/],
    ['Next', /\bnext\b/],
    ['Safra', /\bsafra\b/],
    ['Stone', /\bstone\b/],
    ['XP', /\bxp investimentos\b|\bbanco xp\b/],
    ['Wise', /\bwise\b/],
  ];
  // OCR troca letras parecidas dentro de números ("O5 OUT", "2O26", "0l/10"): só onde a maior parte já é número.
  const consertarNumeros = (t) => String(t || '').replace(/[0-9OoIl|\]]{2,}/g, (m) => {
    const dig = (m.match(/\d/g) || []).length;
    return dig && dig * 2 >= m.length ? m.replace(/[Oo]/g, '0').replace(/[Il|\]]/g, '1') : m;
  });
  const banco = (t) => { const n = normal(t); const b = BANCOS.find(([, re]) => re.test(n)); return b ? b[0] : ''; };

  // "R$ 1.800,00" / "R$1800" / "1.800,00" → 1800 (número). Aceita o "S" que o OCR troca pelo "$".
  const VALOR_RE = /(?:r\s?[$s5]\s?|us\s?\$\s?|usd\s?)?(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{2}))(?!\d)/gi;
  const valores = (linha) => [...String(linha).matchAll(VALOR_RE)].map((m) => ({
    v: Number(m[1].replace(/[.\s]/g, '') + '.' + m[2]),
    moeda: /us|usd/i.test(m[0]) ? 'USD' : 'BRL',
    comSimbolo: /[$s5]|usd/i.test(m[0].slice(0, m[0].indexOf(m[1]))),
  }));

  function lerData(texto) {
    const t = normal(consertarNumeros(texto)).replace(/[“”"']/g, ' ');
    const achados = [];
    for (const m of t.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4}|\d{2})\b/g)) achados.push({ i: m.index, d: +m[1], m: +m[2], a: +(m[3].length === 2 ? '20' + m[3] : m[3]) });
    for (const m of t.matchAll(/\b(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s*(?:de\s+)?(\d{4})\b/g)) achados.push({ i: m.index, d: +m[1], m: MESES[m[2]], a: +m[3] });
    for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) achados.push({ i: m.index, d: +m[3], m: +m[2], a: +m[1] });
    const ok = achados.filter((x) => x.m >= 1 && x.m <= 12 && x.d >= 1 && x.d <= 31 && x.a >= 2000 && x.a <= 2100);
    if (!ok.length) return null;
    // Data junto da palavra "data"/"realizado em" tem preferência; senão, a primeira do comprovante.
    const perto = ok.find((x) => /(data|realizad[ao] em|efetuad[ao] em|pago em|em:?)\s*[^\n]{0,25}$/.test(t.slice(Math.max(0, x.i - 40), x.i)));
    const x = perto || ok[0];
    return String(x.d).padStart(2, '0') + '/' + String(x.m).padStart(2, '0') + '/' + x.a;
  }

  const hora = (t) => { const m = /\b([01]?\d|2[0-3])\s*[:h]\s*([0-5]\d)(?:\s*:\s*([0-5]\d))?\b/.exec(t); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };

  function forma(t) {
    const n = normal(t);
    if (/\bpix\b|chave pix|e2e|end ?to ?end/.test(n)) return 'PIX';
    if (/\bted\b/.test(n)) return 'TED';
    if (/\bdoc\b/.test(n) && /transfer/.test(n)) return 'DOC';
    if (/boleto|linha digitavel|codigo de barras/.test(n)) return 'Boleto';
    if (/credito|debito|cartao|\bnsu\b|\bvisa\b|mastercard|\belo\b|parcelad/.test(n)) return /debito/.test(n) && !/credito/.test(n) ? 'Cartão de débito' : 'Cartão de crédito';
    if (/transferencia|ted\/doc/.test(n)) return 'Transferência';
    return '';
  }

  function idTransacao(texto) {
    // ID fim a fim do Pix: E + ISPB (8) + AAAAMMDDHHMM (12) + 11 caracteres = 32. O OCR pode quebrar com espaços.
    const corrido = String(texto).replace(/[ \t]/g, '');
    const e2e = /\b[EeD](\d{8})(20\d{10})([A-Za-z0-9]{11})\b/.exec(corrido);
    if (e2e) return { id: e2e[0].toUpperCase(), tipo: 'Pix E2E' };
    // ID do Pix com erro de leitura (O no lugar de 0, ] no meio): conserta a parte numérica; se a parte final não tiver 11 caracteres, avisa.
    const quase = /(?:^|[^A-Za-z0-9])[EeD]([0-9OoIl|\]]{20,23})([A-Za-z0-9]{9,13})(?![A-Za-z0-9])/m.exec(corrido);
    if (quase) {
      const num = quase[1].replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/\]/g, '');
      if (/^\d{8}20\d{10}$/.test(num)) {
        const id = ('E' + num + quase[2]).toUpperCase();
        return { id, tipo: 'Pix E2E', duvida: quase[2].length !== 11 ? 'O ID do Pix foi lido com ' + id.length + ' caracteres (o certo são 32): confira na imagem.' : '' };
      }
    }
    const linhas = String(texto).split(/\n/);
    for (let i = 0; i < linhas.length; i++) {
      const m = /(id da transa[cç][aã]o|identificador|autentica[cç][aã]o|c[oó]digo da transa[cç][aã]o|n[uú]mero de controle|controle|protocolo|\bnsu\b|\bdoc\b ?n[ºo°]?|transa[cç][aã]o)\s*[:\-]?\s*(.*)$/i.exec(linhas[i]);
      if (!m) continue;
      let v = m[2].trim();
      if (!v && linhas[i + 1]) v = linhas[i + 1].trim();
      v = v.replace(/[^A-Za-z0-9.\-/]/g, ''); // tira sujeira do OCR (], |, aspas)
      if (v.length >= 6 && /\d/.test(v)) {
        const pix = /^[EeD]\d/.test(v);
        return { id: pix ? v.toUpperCase() : v, tipo: pix ? 'Pix E2E' : m[1].replace(/\s+/g, ' '), duvida: pix && v.length !== 32 ? 'O ID do Pix foi lido com ' + v.length + ' caracteres (o certo são 32): confira na imagem.' : '' };
      }
    }
    return null;
  }

  // Seções do comprovante: quem pagou × quem recebeu.
  const PAGOU = /^(origem|de|pagador|dados do pagador|quem pagou|remetente|conta de origem|debitado de|enviado por|pago por)\b\s*:?/;
  const RECEBEU = /^(destino|para|recebedor|dados do recebedor|quem recebeu|favorecido|beneficiario|destinatario|conta de destino|creditado para|enviado para|pago para)\b\s*:?/;
  const pareceNome = (s) => {
    const x = String(s || '').replace(/[^A-Za-zÀ-ÿ' .-]/g, ' ').replace(/\s+/g, ' ').trim();
    return x.length >= 5 && x.split(' ').length >= 2 && !/\b(institui|ag[eê]ncia|conta|cpf|cnpj|chave|banco|tipo|valor|data|pagamento|transfer|comprovante|pix)\b/i.test(x) ? x : '';
  };
  function partes(texto) {
    const linhas = String(texto).split(/\n/).map((l) => l.trim()).filter(Boolean);
    const sec = { pagou: [], recebeu: [] };
    let atual = null;
    for (const l of linhas) {
      const n = normal(l);
      const p = PAGOU.exec(n), r = RECEBEU.exec(n);
      if (p) { atual = 'pagou'; const resto = l.slice(p[0].length).trim(); if (resto) sec.pagou.push(resto); continue; }
      if (r) { atual = 'recebeu'; const resto = l.slice(r[0].length).trim(); if (resto) sec.recebeu.push(resto); continue; }
      if (atual) sec[atual].push(l);
    }
    const nomeDe = (ls) => {
      for (let i = 0; i < ls.length; i++) {
        const m = /^nome\s*:?\s*(.*)$/i.exec(ls[i]);
        if (m) { const v = pareceNome(m[1]) || pareceNome(ls[i + 1]); if (v) return v; }
      }
      for (const l of ls.slice(0, 3)) { const v = pareceNome(l); if (v) return v; }
      return '';
    };
    const docDe = (ls) => {
      const l = ls.find((x) => /cpf|cnpj|[*•x•]{3}\.?\d{3}/i.test(x) || /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(x)) || '';
      const m = /([0-9*•xX•]{3}\.?[0-9*•xX]{3}\.?[0-9*•xX]{3}-?[0-9*•xX]{2})|(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/.exec(l);
      return m ? m[0] : '';
    };
    const instDe = (ls) => { const l = ls.find((x) => /institui|banco/i.test(x)); return l ? banco(l) || l.replace(/^.*?(institui[cç][aã]o|banco)\s*:?\s*/i, '').trim() : banco(ls.join(' ')); };
    return {
      pagador: nomeDe(sec.pagou), pagadorDoc: docDe(sec.pagou), bancoPagador: instDe(sec.pagou),
      recebedor: nomeDe(sec.recebeu), recebedorDoc: docDe(sec.recebeu), bancoRecebedor: instDe(sec.recebeu),
    };
  }

  /** Texto do comprovante → { valor, moeda, data, hora, forma, banco, pagador, pagadorDoc, recebedor, idTransacao, ... , confianca, faltando } */
  function lerComprovante(texto, { confiancaOcr = null } = {}) {
    const t = String(texto || '').replace(/\r/g, '');
    const linhas = t.split('\n');
    // Valor: o da linha "valor"/"total"/"pago"; senão o maior valor com R$; tarifas e saldos ficam de fora.
    let valor = null, moeda = 'BRL';
    for (let i = 0; i < linhas.length && valor == null; i++) {
      const n = normal(linhas[i]);
      if (/^(valor|total|valor pago|valor da transferencia|valor do pix|valor enviado|quantia|montante)\b/.test(n) || /\bvalor\b/.test(n)) {
        if (/tarifa|saldo|limite|desconto|juros|multa/.test(n)) continue;
        const v = valores(linhas[i]).concat(valores(linhas[i + 1] || ''));
        if (v.length) { valor = v[0].v; moeda = v[0].moeda; }
      }
    }
    if (valor == null) {
      const todos = linhas.filter((l) => !/tarifa|saldo|limite/i.test(l)).flatMap(valores).filter((x) => x.comSimbolo && x.v > 0);
      if (todos.length) { const m = todos.sort((a, b) => b.v - a.v)[0]; valor = m.v; moeda = m.moeda; }
    }
    const p = partes(t);
    const id = idTransacao(t);
    const d = {
      valor, moeda, data: lerData(t) || '', hora: hora(consertarNumeros(t)), forma: forma(t),
      banco: p.bancoPagador || banco(linhas.slice(0, 4).join(' ')) || banco(t),
      pagador: p.pagador, pagadorDoc: p.pagadorDoc, recebedor: p.recebedor, recebedorDoc: p.recebedorDoc, bancoRecebedor: p.bancoRecebedor,
      idTransacao: id ? id.id : '', tipoId: id ? id.tipo : '', idDuvida: id && id.duvida ? id.duvida : '',
    };
    const essenciais = ['valor', 'data', 'forma', 'pagador'];
    d.faltando = essenciais.filter((k) => !d[k]);
    const achados = ['valor', 'data', 'forma', 'pagador', 'recebedor', 'idTransacao', 'banco'].filter((k) => d[k]).length / 7;
    d.confianca = Math.round(100 * (confiancaOcr == null ? achados : (achados * 0.6 + (confiancaOcr / 100) * 0.4))) / 100;
    return d;
  }


  // ---------- mensagem enviada junto com o comprovante ----------
  // Formato do grupo de comprovantes (botão 🧾 Agendamento): nome · Tel · Ind · Objetivo · "Teleconsulta com o Dr. Leonardo - Lipedema 1x" ·
  // "Dia 12 de novembro às 15h30" · "Pagamento: R$ 900,00 de R$ 1.800,00". Também lê os formatos antigos ("Nome:", "CPF:", "Restante…", "2/2", "Segue pagamento da paciente…").
  const MES_EXT = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
  const ROTULO = /^\s*\*?(nome(?: completo)?|nombre|name|paciente|tel(?:efone)?|cel(?:ular)?|whats(?:app)?|ind(?:ica[cç][aã]o)?|objetivo|cpf|e-?mail|pagamento|valor|pago|dia|data|restante[^:]*|obs[^:]*)\*?\s*:\s*(.*)$/i;
  function lerMensagem(texto) {
    const t = String(texto || '').replace(/\r/g, '').replace(/<[^>]+>/g, ' ').trim();
    if (!t) return null;
    const linhas = t.split('\n').map((l) => l.replace(/^[-•·*_\s]+|[*_\s]+$/g, '').trim()).filter(Boolean);
    const m = { texto: t.slice(0, 1500) };
    // Nome de pessoa: 2+ palavras com inicial maiúscula (ou tudo maiúsculo), sem palavras de conversa ("ok obrigada", "segue pagamento").
    const pareceNomeMsg = (x) => {
      const v = String(x || '').replace(/\([^)]*\)/g, ' ').replace(/[.,;:!]+$/, '').replace(/\s+/g, ' ').trim();
      const ps = v.split(' ');
      if (ps.length < 2 || ps.length > 7 || !/^[A-Za-zÀ-ÿ'´. ]{5,}$/.test(v)) return '';
      if (/^(restante|pagamento|consulta|teleconsulta|cirurgia|dados|aguardando|segue|comprovante|dia|tel|ok|obrigad|bom|boa|oi|ola|segunda|primeira|valor|pix)\b/i.test(normal(v))) return '';
      const maiusc = v === v.toUpperCase();
      const titulo = ps.every((w) => /^(d[aeo]s?|e)$/i.test(w) || /^[A-ZÀ-Ý]/.test(w));
      return maiusc || titulo ? v : '';
    };
    for (const l of linhas) {
      const r = ROTULO.exec(l);
      if (!r) continue;
      const k = normal(r[1]), v = r[2].trim();
      if (/^(nome|nombre|name|paciente)/.test(k) && !m.nome) m.nome = pareceNomeMsg(v);
      else if (/^(tel|cel|whats)/.test(k) && !m.telefone) m.telefone = digitos(v) || '';
      else if (k === 'cpf' && !m.cpf) m.cpf = (v.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/) || [''])[0];
      else if (/^e-?mail/.test(k) && !m.email) m.email = v.toLowerCase();
      else if (/^ind/.test(k) && !m.indicacao) m.indicacao = v;
      else if (k === 'objetivo' && !m.objetivo) m.objetivo = v;
      else if (/^restante/.test(k)) { m.parcela = 'restante'; if (!m.nome) m.nome = pareceNomeMsg(v); }
      else if (/^(pagamento|valor|pago)/.test(k) && !m.pagamentoTexto) m.pagamentoTexto = v;
      else if (/^obs/.test(k)) m.obs = (m.obs ? m.obs + ' · ' : '') + v;
    }
    const desc = /desconto\s*(?:de\s*)?(\d{1,3})\s*%/i.exec(t);
    if (desc) m.desconto = Number(desc[1]);
    if (!m.nome) { const seg = /segue (?:o )?pagamento d[ao]s?\s+(?:paciente\s+)?(.+?)(?:\s+-\s+|\n|$)/i.exec(t); if (seg) m.nome = pareceNomeMsg(seg[1]); }
    if (!m.nome) for (const l of linhas.slice(0, 3)) { if (ROTULO.test(l)) continue; const v = pareceNomeMsg(l.replace(/pagamento\s*\d\s*\/\s*\d|\d\s*\/\s*\d|\|/gi, ' ')); if (v) { m.nome = v; break; } }
    if (!m.cpf) m.cpf = (t.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/) || [''])[0];
    const pt = m.pagamentoTexto || (linhas.find((l) => /R\$\s*[\d.]+/.test(l)) || '');
    const vs = [...pt.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/gi)].map((x) => Number(x[1].replace(/\./g, '').replace(',', '.')));
    const frac = /(\d)\s*\/\s*(\d)\s*de\s*R\$/i.exec(pt);
    if (frac && vs.length) { m.total = vs[0]; m.pago = vs[1] || Math.round(vs[0] * Number(frac[1]) / Number(frac[2])); }
    else if (/\bde\s*R\$/i.test(pt) && vs.length >= 2) { m.pago = vs[0]; m.total = vs[1]; }
    else if (vs.length) { m.pago = vs[0]; if (/integral|total/i.test(pt)) m.total = vs[0]; }
    if (m.pago && m.total) m.falta = Math.max(0, Math.round((m.total - m.pago) * 100) / 100);
    if (/\b2\s*\/\s*2\b|restante|segunda parte/i.test(t)) m.parcela = 'restante';
    else if (m.pago && m.total && m.pago < m.total) m.parcela = 'reserva';
    else if (m.pago && m.total) m.parcela = 'integral';
    const sg = /segue (?:o )?pagamento[^\n]*?\s[-–]\s(.+)$/im.exec(t);
    const lp = linhas.find((l) => /teleconsulta|consulta|cirurgia|retorno|procedimento|botox|preench|bioimped|sculptra|bioestimul/i.test(l) && !ROTULO.test(l) && !/segue pagamento/i.test(l));
    if (sg) m.procedimento = sg[1].replace(/[.\s]+$/, '').slice(0, 120);
    else if (lp) m.procedimento = lp.slice(0, 120);
    const tl = normal(t);
    m.local = /teleconsulta|tele\b|online|google meet/.test(tl) ? 'tele' : /\(sp\)|sao paulo|\bsp\b/.test(tl) ? 'sp' : /barra|rio de janeiro|\(rj\)/.test(tl) ? 'rj' : '';
    m.medico = /leonardo/.test(tl) ? 'Dr. Leonardo' : /lorena/.test(tl) ? 'Dra. Lorena' : /rafael/.test(tl) ? 'Dr. Rafael' : '';
    const de = /\bdia\s*(\d{1,2})\s*de\s*(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:[^\n]*?(\d{1,2})\s*[h:]\s*(\d{2})?)?/i.exec(t);
    const dn = !de && /\bdia\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:[^\n]*?(\d{1,2})\s*[h:]\s*(\d{2})?)?/i.exec(t);
    if (de) m.consultaEm = String(de[1]).padStart(2, '0') + '/' + String(MES_EXT[normal(de[2]).replace('ç', 'c')]).padStart(2, '0') + (de[3] ? ' ' + de[3].padStart(2, '0') + ':' + (de[4] || '00') : '');
    else if (dn) m.consultaEm = dn[1].padStart(2, '0') + '/' + dn[2].padStart(2, '0') + (dn[3] ? ' ' + dn[3].padStart(2, '0') + ':' + (dn[4] || '00') : '');
    const util = ['nome', 'cpf', 'telefone', 'pago', 'procedimento', 'consultaEm', 'obs'].some((k) => m[k]);
    return util ? m : { texto: m.texto };
  }

  // ---------- comparação com a paciente ----------
  const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  const tokens = (s) => normal(s).replace(/[^a-z ]/g, ' ').split(/\s+/).filter((x) => x && !PARTICULAS.has(x));
  /** Semelhança de nomes: 'igual' | 'forte' | 'fraca' | 'diferente' (+ detalhe). */
  function compararNomes(a, b) {
    const x = tokens(a), y = tokens(b);
    if (!x.length || !y.length) return { nivel: 'diferente', detalhe: 'nome ausente' };
    if (x.join(' ') === y.join(' ')) return { nivel: 'igual', detalhe: 'nome idêntico' };
    const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
    const todos = curto.every((t) => longo.includes(t) || (t.length === 1 && longo.some((l) => l[0] === t)));
    if (todos && curto[0] === longo[0] && curto.length >= 2) return { nivel: 'forte', detalhe: 'mesmo nome, com sobrenome abreviado ou a mais' };
    if (x[0] === y[0] && x[x.length - 1] === y[y.length - 1]) return { nivel: 'forte', detalhe: 'primeiro e último nome iguais' };
    if (x[0] === y[0]) return { nivel: 'fraca', detalhe: 'só o primeiro nome é igual' };
    const comuns = curto.filter((t) => t.length > 2 && longo.includes(t));
    if (comuns.length >= 2) return { nivel: 'fraca', detalhe: 'sobrenomes em comum (' + comuns.join(', ') + '), primeiro nome diferente' };
    return { nivel: 'diferente', detalhe: 'nomes diferentes' };
  }
  /** CPF mascarado do comprovante (•••.456.789-••) × CPF da paciente: 'confere' | 'diverge' | '' (sem como comparar). */
  function compararCpf(mascarado, cpf) {
    const c = digitos(cpf), m = String(mascarado || '').replace(/[^\d*•xX•]/g, '');
    if (c.length !== 11 || m.length !== 11) return '';
    let comparados = 0;
    for (let i = 0; i < 11; i++) if (/\d/.test(m[i])) { comparados++; if (m[i] !== c[i]) return 'diverge'; }
    return comparados >= 4 ? 'confere' : '';
  }
  const brl = (v, moeda) => (moeda === 'USD' ? 'US$ ' : 'R$ ') + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dataISO = (br) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };

  /**
   * Valida o comprovante contra a paciente (da ficha aberta no Amigo ou escolhida na busca).
   * Retorna { status: 'confirmada'|'divergencia'|'nao_identificado', divergencias:[], avisos:[], itens:[] }.
   * Nunca "acerta" nada sozinho: tudo que não bate aparece em divergencias.
   */
  function validar(c, paciente, { hoje = new Date(), esperado = null, recebedores = ['blue', 'erthal'] } = {}) {
    const divergencias = [], avisos = [], itens = [];
    if (!paciente || !paciente.nome) {
      return { status: 'nao_identificado', divergencias: ['Paciente não identificada: escolha a paciente antes de lançar.'], avisos, itens };
    }
    // Paciente: a mensagem enviada junto (quando diz o nome) é a melhor prova; o pagador pode ser um familiar.
    const msg = c.mensagem && c.mensagem.nome ? c.mensagem : null;
    const nomes = compararNomes(c.pagador, paciente.nome);
    const cpf = compararCpf(c.pagadorDoc, paciente.cpf);
    const forte = (n) => n.nivel === 'igual' || n.nivel === 'forte';
    let pacienteOk = false, detalhe = '';
    if (msg) {
      const nm = compararNomes(msg.nome, paciente.nome);
      if (!forte(nm)) divergencias.push('A mensagem enviada com o comprovante fala de "' + msg.nome + '", mas a paciente escolhida é "' + paciente.nome + '" (' + nm.detalhe + ').');
      else { pacienteOk = true; detalhe = 'a mensagem confirma a paciente'; }
      if (msg.cpf && paciente.cpf && digitos(msg.cpf) !== digitos(paciente.cpf)) { divergencias.push('CPF da mensagem (' + msg.cpf + ') é diferente do CPF da paciente.'); pacienteOk = false; }
      if (msg.telefone && paciente.celular && digitos(msg.telefone).slice(-8) !== digitos(paciente.celular).slice(-8)) avisos.push('Telefone da mensagem (' + msg.telefone + ') é diferente do celular da paciente no AmigoApp: confira.');
      if (c.pagador && !forte(nomes)) avisos.push('Quem pagou foi "' + c.pagador + '" (não é a paciente). A mensagem identifica a paciente; confirme se foi um familiar.');
      if (cpf === 'diverge' && forte(nomes)) { divergencias.push('CPF do pagador (' + c.pagadorDoc + ') é diferente do CPF da paciente.'); pacienteOk = false; }
    } else {
      if (!c.pagador) divergencias.push('O comprovante não mostra o nome de quem pagou e não veio mensagem com o nome da paciente. Confira se é da paciente ' + paciente.nome + '.');
      else if (cpf === 'diverge') divergencias.push('CPF do pagador (' + c.pagadorDoc + ') é diferente do CPF da paciente.');
      else if (!forte(nomes)) divergencias.push('Pagador "' + c.pagador + '" × paciente "' + paciente.nome + '": ' + nomes.detalhe + '. Se foi um familiar que pagou, confirme e explique na observação.');
      pacienteOk = !!c.pagador && cpf !== 'diverge' && forte(nomes);
      detalhe = c.pagador ? 'pagador: ' + c.pagador + (cpf === 'confere' ? ' · CPF confere' : '') : 'sem pagador no comprovante';
    }
    itens.push({ campo: 'Paciente', ok: pacienteOk, valor: paciente.nome, detalhe });
    // Valor informado na mensagem ("Pagamento: R$ 900 de R$ 1.800") × valor do comprovante
    if (c.mensagem && c.mensagem.pago && c.valor > 0 && Math.abs(c.mensagem.pago - c.valor) > 0.009) divergencias.push('A mensagem diz que foi pago ' + brl(c.mensagem.pago) + ', mas o comprovante mostra ' + brl(c.valor, c.moeda) + '.');
    // Valor
    if (!(c.valor > 0)) divergencias.push('Valor não encontrado no comprovante.');
    else if (esperado && esperado.valor && Math.abs(Number(esperado.valor) - c.valor) > 0.009) divergencias.push('Valor do comprovante ' + brl(c.valor, c.moeda) + ' é diferente do esperado ' + brl(esperado.valor, c.moeda) + '.');
    itens.push({ campo: 'Valor', ok: c.valor > 0 && !(esperado && esperado.valor && Math.abs(Number(esperado.valor) - c.valor) > 0.009), valor: c.valor > 0 ? brl(c.valor, c.moeda) : '—' });
    // Data
    const iso = dataISO(c.data);
    if (!iso) divergencias.push('Data do pagamento não encontrada.');
    else {
      const dt = new Date(iso + 'T12:00:00');
      const dias = Math.round((hoje - dt) / 86400000);
      if (dias < -1) divergencias.push('Data do comprovante (' + c.data + ') está no futuro.');
      else if (dias > 60) avisos.push('Comprovante de ' + c.data + ' (' + dias + ' dias atrás). Confira se não é um comprovante antigo.');
      if (esperado && esperado.data && esperado.data !== c.data) divergencias.push('Data do comprovante ' + c.data + ' é diferente da esperada ' + esperado.data + '.');
    }
    itens.push({ campo: 'Data', ok: !!iso && !divergencias.some((d) => /^Data/.test(d)), valor: c.data || '—' });
    // Forma
    if (!c.forma) divergencias.push('Forma de pagamento não identificada (Pix, cartão, TED…).');
    itens.push({ campo: 'Pagamento', ok: !!c.forma, valor: c.forma || '—' });
    // Identificador
    if (c.idDuvida) avisos.push(c.idDuvida);
    if (!c.idTransacao) avisos.push(c.forma === 'PIX' ? 'Pix sem ID da transação legível: a checagem de duplicidade usa o arquivo, o valor, a data e o pagador.' : 'Sem identificador da transação.');
    itens.push({ campo: 'ID da transação', ok: !!c.idTransacao, valor: c.idTransacao || '—', opcional: true });
    // Recebedor
    if (c.recebedor && recebedores.length && !recebedores.some((r) => normal(c.recebedor).includes(r))) avisos.push('Recebedor "' + c.recebedor + '": confira se é uma conta da clínica.');
    return { status: divergencias.length ? 'divergencia' : 'confirmada', divergencias, avisos, itens };
  }

  const api = { lerComprovante, lerMensagem, validar, compararNomes, compararCpf, lerData, idTransacao, banco, normal, brl, dataISO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.BlueComprovante = api;
})(typeof window !== 'undefined' ? window : globalThis);
