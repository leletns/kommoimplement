// Leitor do grupo de WhatsApp "Comprovantes de pagamento" (mesmo código no navegador e no Node).
// Navegador: window.GrupoComprovantes · Node: require('../../ficha/js/grupo-comprovantes.js')
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.GrupoComprovantes = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function normalize(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

// Android: 23/09/2026 14:05 - Ana: texto      iPhone: [23/09/2026, 14:05:12] Ana: texto
  //                   iPhone em inglês: [9/3/26, 2:41:03 PM] Ana: texto  (mês/dia e AM/PM)
  const LINE_RE = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}:\d{2})(?::\d{2})?(?:\s?([ap])\.?\s?m\.?)?\]?(?: -)? (.+?): ([\s\S]*)$/i;
  const SYSTEM_RE = /^\[?\d{1,2}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d{2}/;
  const MEDIA_RE = /^<?(m[íi]dia oculta|media omitted|arquivo de m[íi]dia oculto|imagem ocultada|[áa]udio ocultado|v[íi]deo omitido)>?$/i;
  
  const clean = (s) => s.replace(/[‎‏‪-‮﻿]/g, '');
  
  /** O arquivo usa mês/dia (WhatsApp em inglês)? Decide pelo arquivo todo: um "dia" > 12 resolve; senão, AM/PM indica en-US. */
  function mesPrimeiro(lines) {
    let ampm = false;
    for (const raw of lines) {
      const m = raw.match(LINE_RE);
      if (!m) continue;
      if (Number(m[1]) > 12) return false;
      if (Number(m[2]) > 12) return true;
      if (m[5]) ampm = true;
    }
    return ampm;
  }
  
  function parseExport(text) {
    const messages = [];
    const lines = clean(text).split(/\r?\n/);
    const us = mesPrimeiro(lines);
    for (const raw of lines) {
      const m = raw.match(LINE_RE);
      if (m) {
        const [, a, b, y, hm, ap, author, body] = m;
        const [d, mo] = us ? [b, a] : [a, b];
        let [h, min] = hm.split(':').map(Number);
        if (ap && /p/i.test(ap) && h < 12) h += 12;
        if (ap && /a/i.test(ap) && h === 12) h = 0;
        const time = `${h}:${String(min).padStart(2, '0')}`;
        const year = y.length === 2 ? 2000 + Number(y) : Number(y);
        const date = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${year}`;
        const sortKey = `${year}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}`;
        const text = MEDIA_RE.test(body.trim()) ? '[mídia]' : body;
        messages.push({ date, sortKey, time: time.padStart(5, '0'), author: author.trim(), text });
      } else if (SYSTEM_RE.test(raw)) {
        // Mensagem do sistema ("Fulano adicionou Ciclano", "mensagens protegidas com criptografia"…)
        continue;
      } else if (messages.length && raw.trim()) {
        messages[messages.length - 1].text += `\n${raw}`;
      }
    }
    return messages;
  }

  const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
  
  /** Telefone brasileiro normalizado: DDD + número (10 ou 11 dígitos), sem 55. */
  function normPhone(raw) {
    let d = onlyDigits(raw);
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 10 || d.length === 11) return d;
    return null;
  }
  
  /** Os 8 últimos dígitos: casa "21 98765-4321" com "(21) 8765-4321" (número antigo sem o 9). */
  const phoneKey = (p) => (p ? p.slice(-8) : null);
  
  function normCpf(raw) {
    const d = onlyDigits(raw);
    return d.length === 11 ? d : null;
  }
  
  function normName(raw) {
    return normalize(raw)
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\b(de|da|do|das|dos|e)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  /** "R$1.800,00" → 1800 */
  function money(s) {
    const m = String(s || '').match(/R\$\s*([\d.]+(?:,\d{1,2})?)/i);
    if (!m) return null;
    return Number(m[1].replace(/\./g, '').replace(',', '.'));
  }
  
  /**
   * Linha de pagamento → { pago, total }.
   *   "R$900 de R$1800" → 900 de 1800 · "1/3 de R$1800 = R$600" → 600 de 1800 · "R$1800" → 1800
   */
  function parsePagamento(line) {
    const valores = [...String(line).matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/gi)].map((m) =>
      Number(m[1].replace(/\./g, '').replace(',', '.'))
    );
    if (!valores.length) return null;
    const fracao = line.match(/(\d)\s*\/\s*(\d)\s*de\s*R\$/i);
    if (fracao) {
      const total = valores[0];
      const pago = valores[1] || Math.round((total * Number(fracao[1])) / Number(fracao[2]));
      return { pago, total };
    }
    if (/\bde\s*R\$/i.test(line) && valores.length >= 2) return { pago: valores[0], total: valores[1] };
    return { pago: valores[0], total: valores[0] };
  }
  
  const LABEL = (label) => new RegExp(`^\\s*\\*?(?:${label})\\*?\\s*[:\\-]?\\s*(.*)$`, 'i');
  const RE = {
    nome: LABEL('nome(?: completo)?|nombre(?: completo)?|name|full name|paciente'),
    // "Restante pagamento: X", "Restante de pagamento da consulta: X", "Pagamento restante : X"…
    restante: /^\s*\*?(?:pagamento\s+)?restante(?:\s+(?:do|de|da))?(?:\s+pagamento)?(?:\s+(?:de|da|do))?(?:\s+(?:consulta|teleconsulta))?\*?\s*(?::\s*(.*))?$/i,
    tel: LABEL('tel(?:efone)?|tel[ée]fono|fone|phone(?: number)?|cel(?:ular)?|whats(?:app)?|contato'),
    cpf: LABEL('cpf'),
    email: /[\w.+-]+@[\w-]+\.[\w.]+/,
    pagamento: LABEL('pagamento|valor|pago'),
    cpfSolto: /^\s*\d{3}\.\d{3}\.\d{3}-\d{2}\s*$/,
    telSolto: /^\s*(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[\s.-]?\d{4}\s*$/,
  };
  
  function cleanName(s) {
    return String(s || '')
      .replace(/\([^)]*\)/g, ' ') // "(estrangeira)"
      .replace(/[.,;:]+\s*$/, '')
      .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '') // CPF colado no nome
      .replace(/[*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  const looksLikeName = (raw) => {
    const s = String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/[.,;:]+$/, '').replace(/\.(?=\S)/g, '. ').trim();
    return /^[A-Za-zÀ-ÿ'´`^~. ]{5,}$/.test(s) && s.split(/\s+/).length >= 2 && !/^(restante|pagamento|consulta|teleconsulta|cirurgia)\b/i.test(s);
  };
  
  /** Data da consulta citada ("dia 26/02", "amanhã") → AAAA-MM-DD (ano pela data da mensagem). */
  const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
  
  function consultaData(text, msgDate) {
    const [d, m, y] = msgDate.split('/').map(Number);
    if (/amanh[aã]/i.test(text)) {
      const t = new Date(Date.UTC(y, m - 1, d + 1));
      return t.toISOString().slice(0, 10);
    }
    let mm = text.match(/\bdia\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/i) || text.match(/🗓\S*[^\n\d]*?(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/u);
    // "Dia 02 de outubro às 09h00"
    const ext = !mm && text.match(/\bdia\s*(\d{1,2})\s*de\s*(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i);
    if (ext) mm = [ext[0], ext[1], String(MESES[ext[2].toLowerCase().replace('ç', 'c')]), undefined];
    if (!mm) return null;
    const dd = Number(mm[1]);
    const mo = Number(mm[2]);
    let yy = mm[3] ? Number(mm[3].length === 2 ? `20${mm[3]}` : mm[3]) : y;
    if (!mm[3] && mo < m - 1) yy += 1; // consulta em janeiro marcada em dezembro
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
    return `${yy}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  
  /** Horário da consulta citado na ficha ("às 09h00", "as 14:30", "12h") → "HH:MM". */
  function consultaHora(text) {
    const m = String(text || '').match(/(?:\bdia\b|🗓)[^\n]*?(?:às|\bas|\bat|a las)\s*\*?(\d{1,2})(?::(\d{2})|\s*h(?:rs?|oras?)?\s*(\d{2})?)(?!\d)/iu) ||
      String(text || '').match(/\bdia\b[^\n]*?\b(\d{1,2})(?::(\d{2})|\s*h(?:rs?|oras?)?\s*(\d{2})?)(?!\d)/i);
    if (!m || Number(m[1]) > 23) return null;
    return `${m[1].padStart(2, '0')}:${m[2] || m[3] || '00'}`;
  }
  
  const isoFromBr = (br) => {
    const [d, m, y] = br.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  };
  
  // Serviços da planilha da gestão, na ordem da planilha. [nome, regex no texto normalizado]
  // A busca vai do mais específico para o mais geral ("equipe cirúrgica" antes de "cirurgia").
  const SERVICOS = ['Consulta', 'Teleconsulta', 'Retorno', 'Cirurgia', 'Equipe cirúrgica', 'Morpheus', 'Argoplasma', 'Fisioterapia', 'Hospital', 'Compressor', 'Seguro saúde', 'Prótese'];
  const SERVICO_RE = [
    ['Equipe cirúrgica', /\bequipe\b|anestesi|instrumentad/],
    ['Morpheus', /morpheus/],
    ['Argoplasma', /argo ?plasma/],
    ['Fisioterapia', /fisio|drenagem/],
    ['Hospital', /hospital|internac/],
    ['Compressor', /compressor|bota pneumatica/],
    ['Seguro saúde', /\bseguro\b/],
    ['Prótese', /protese|silicone/],
    ['Cirurgia', /cirurgia|lipedefinition|sublift|lipo ?hd|lipoaspira|\blipo\b/],
    ['Teleconsulta', /teleconsulta|\btele\b|consulta (online|on-line|por video)/],
    ['Retorno', /\bretorno\b/],
    ['Consulta', /consulta|avaliacao/],
  ];
  /** Texto da mensagem → serviço da planilha (ou null se a mensagem não diz). */
  function servicoDoTexto(text) {
    const t = normalize(text);
    const s = SERVICO_RE.find(([, re]) => re.test(t));
    return s ? s[0] : null;
  }
  /** Forma de pagamento escrita na mensagem ("pix", "cartão 10x", "à vista"…). */
  function formaDoTexto(text) {
    const t = normalize(text);
    const parc = t.match(/\b(\d{1,2})\s*x\b/);
    if (/cart[a]o|credito|debito|maquininha|\blink\b/.test(t) || (parc && Number(parc[1]) > 1)) return 'Cartão' + (parc && Number(parc[1]) > 1 ? ' ' + Number(parc[1]) + 'x' : /debito/.test(t) ? ' de débito' : '');
    if (/\bpix\b/.test(t)) return 'Pix';
    if (/dinheiro|especie/.test(t)) return 'Dinheiro';
    if (/\bted\b|transferencia/.test(t)) return 'Transferência';
    if (/boleto/.test(t)) return 'Boleto';
    if (/a vista/.test(t)) return 'À vista';
    return null;
  }
  /** "10% de desconto" / "desconto de 5%" → 10 / 5 (porcentagem). */
  function descontoDoTexto(text) {
    const t = normalize(text);
    const m = t.match(/(\d{1,2}(?:[.,]\d+)?)\s*%\s*(?:de\s*)?(?:desc|off)/) || t.match(/desc(?:onto)?\.?\s*(?:de\s*)?(\d{1,2}(?:[.,]\d+)?)\s*%/);
    return m ? Number(m[1].replace(',', '.')) : null;
  }

  /**
   * Fichas de pagamento do grupo de WhatsApp. Cada ficha vira um registro:
   * { data, autor, nome, telefone, cpf, email, pago, total, tipo, restante, consultaEm, texto }
   */
  function parseComprovantes(txt) {
    const out = [];
    for (const msg of parseExport(txt)) {
      // "<imagem ocultada> Fulana" (legenda da foto do comprovante): o nome começa depois da mídia.
      const text = msg.text
        .replace(/<Mensagem editada>/gi, '')
        .replace(/^(?:\[Encaminhada\]\s*)?<(?:imagem|documento|m[íi]dia)[^>]*>\s*/i, '')
        .trim();
      if (text === '[mídia]' || /seja bem[- ]vind[ao] (a|à) cl[ií]nica/i.test(text)) continue;
      const lines = text.split('\n').map((l) => l.replace(/^[-•·]\s*/, '').trim()).filter(Boolean);
      const pagLine =
        lines.find((l) => RE.pagamento.test(l) && money(l) != null) || lines.find((l) => /^R\$\s*[\d.,]+\s+de\s+R\$/i.test(l));
      // Segunda parte / restante de uma consulta já vendida: "Pagamento 2/2", "2/2 Joanna", "Restante…"
      const parcela = /\b(?:pagamento\s*)?2\s*\/\s*2\b|\bpagamento\s+restante\b/i.test(text);
      const restLine = lines.find((l) => RE.restante.test(l)) || (parcela ? lines.find((l) => /2\s*\/\s*2|restante/i.test(l)) : null);
      const cirurgiaParte = /cirurgia\s*\(?\s*parte/i.test(text);
      // "Segue pagamento da paciente X - Consulta Dra. Lorena" (Concierge)
      const segue = text.match(/segue pagamento d[ao]s?\s+pacientes?\s+(.+?)(?:\s+-\s+|\n|$)([\s\S]*)/i);
      // Ficha de cadastro enviada depois do pagamento (CPF + nome), mesmo sem linha de valor
      const ficha = /\b(cpf|passport|passaporte|identidade|id number)\b/i.test(text) && lines.length >= 3;
      if (!pagLine && !restLine && !cirurgiaParte && !segue && !ficha) continue;
      // Pagamentos que não são consulta (protocolos, exames, produtos) não entram
      const naoConsulta = /(protocolo|capilar|[aá]cido|doppler|exame|soro|vitamina|botox|preenchimento|bioestimulador)/i;
      if (segue && naoConsulta.test(segue[2] + ' ' + segue[1]) && !/consulta|tele/i.test(segue[2] + ' ' + segue[1])) continue;
  
      // Valor do rótulo: na mesma linha ou, se vazio, na linha seguinte ("Nome" ↵ "SILVIA CORREIA").
      const labelValue = (re) => {
        for (let i = 0; i < lines.length; i += 1) {
          const m = lines[i].match(re);
          if (!m) continue;
          const v = (m[1] || '').trim();
          if (v) return v;
          if (lines[i + 1] && !/:/.test(lines[i + 1])) return lines[i + 1];
        }
        return null;
      };
      let nome = null;
      const rotulo = labelValue(RE.nome);
      if (rotulo && looksLikeName(cleanName(rotulo))) nome = cleanName(rotulo);
      if (!nome && restLine) {
        const v = cleanName((restLine.match(RE.restante) || [])[1] || '');
        if (looksLikeName(v)) nome = v;
      }
      if (!nome) {
        const nf = text.match(/nota fiscal no nome de\s+([^\n]+)/i);
        if (nf) nome = cleanName(nf[1]);
      }
      if (!nome && segue) {
        const v = cleanName(segue[1].split(/\s+e\s+/)[0]);
        if (looksLikeName(v)) nome = v;
      }
      if (!nome) {
        // "Pagamento 2/2 | Fulana de Tal" / "Fulana de Tal | Pagamento 2/2" / primeira linha com o nome
        for (const l of lines.slice(0, 3)) {
          const v = cleanName(l.replace(/pagamento\s*\d\s*\/\s*\d|\d\s*\/\s*\d|pagamento|restante|consulta.*$|sp$/gi, ''));
          if (looksLikeName(v)) {
            nome = v;
            break;
          }
        }
      }
  
      let telefone = normPhone(labelValue(RE.tel));
      let cpf = null;
      for (const l of lines) {
        const c = l.match(RE.cpf);
        if (!cpf && c) cpf = normCpf(c[1]);
        if (!cpf && RE.cpfSolto.test(l)) cpf = normCpf(l);
        if (!telefone && RE.telSolto.test(l)) telefone = normPhone(l);
      }
      if (!cpf && restLine) cpf = normCpf((restLine.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/) || [])[0]);
      const email = (text.match(RE.email) || [])[0]?.toLowerCase() || null;
  
      const valores = pagLine ? parsePagamento((pagLine.match(RE.pagamento) || [])[1] || pagLine) : null;
      const tipo = cirurgiaParte || (/cirurgia/i.test(text) && !/consulta|teleconsulta/i.test(text)) ? 'cirurgia' : 'consulta';
  
      if (!nome && !telefone && !cpf && !email) continue;
      out.push({
        data: isoFromBr(msg.date),
        hora: msg.time,
        autor: msg.author,
        nome,
        telefone,
        cpf,
        email,
        pago: valores ? valores.pago : null,
        total: valores ? valores.total : null,
        tipo,
        servico: servicoDoTexto(text),
        forma: formaDoTexto(text),
        desconto: descontoDoTexto(text),
        restante: Boolean(restLine) || parcela,
        retorno: /retorno/i.test(text),
        consultaEm: consultaData(text, msg.date),
        consultaHora: consultaHora(text),
        texto: text.slice(0, 400),
      });
    }
    return out;
  }

  /** Mensagens do WhatsApp Web (data-pre-plain-text "[14:08, 11/09/2026] Maria: ") → texto no formato da exportação. */
  function textoDoWhatsAppWeb(msgs) {
    const linhas = [];
    for (const m of msgs) {
      const c = String(m.cab || '').match(/^\[(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\.?)?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]\s*(.+?):\s*$/i);
      if (!c || !String(m.texto || '').trim()) continue;
      let h = Number(c[1]);
      // Com AM/PM o WhatsApp está em inglês: a data vem mês/dia. Sai sempre dia/mês e 24 h.
      let d = c[4], mo = c[5];
      if (c[3]) { [d, mo] = [c[5], c[4]]; if (/p/i.test(c[3]) && h < 12) h += 12; if (/a/i.test(c[3]) && h === 12) h = 0; }
      const ano = c[6].length === 2 ? '20' + c[6] : c[6];
      linhas.push('[' + d.padStart(2, '0') + '/' + mo.padStart(2, '0') + '/' + ano + ', ' + String(h).padStart(2, '0') + ':' + c[2] + '] ' + c[7] + ': ' + m.texto);
    }
    return linhas.join('\n');
  }


  /**
   * Linhas lidas do grupo → planilha por paciente, separada por serviço (consulta, cirurgia, equipe, hospital…).
   * Junta a mesma paciente (CPF, celular, e-mail ou nome — "Cinthia Nunes" junta com "Cinthia Nunes Siqueira Amorim").
   * Em cada serviço: valor (total), forma de pagamento, desconto (%), a pagar, recebido e falta. O restante sem valor
   * escrito é calculado (a pagar − o que já foi pago). Mensagem que não diz o serviço ("Restante pagamento: Fulana")
   * vai para o serviço da paciente que ainda tem saldo em aberto.
   * faltando: campos sem dado (a página pinta de vermelho).
   */
  function planilhaPorPaciente(linhas) {
    const regs = linhas.filter((l) => !l.ignorado).map((l) => Object.assign({}, l, l.ajustes || {}))
      .sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')));
    const grupos = [];
    const tokens = (n) => normName(n || '').split(' ').filter(Boolean);
    const mesmoNome = (a, b) => {
      const x = tokens(a), y = tokens(b);
      if (x.length < 2 || y.length < 2) return false;
      const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
      return curto[0] === longo[0] && curto.every((t) => longo.includes(t));
    };
    for (const r of regs) {
      const tel = r.telefone ? phoneKey(String(r.telefone).replace(/\D/g, '')) : null;
      let g = grupos.find((p) =>
        (r.cpf && p.cpfs.has(r.cpf)) || (tel && p.tels.has(tel)) || (r.email && p.emails.has(r.email)) ||
        (r.nome && p.nomes.some((n) => mesmoNome(n, r.nome))));
      if (!g) { g = { cpfs: new Set(), tels: new Set(), emails: new Set(), nomes: [], linhas: [] }; grupos.push(g); }
      g.linhas.push(r);
      if (r.cpf) g.cpfs.add(r.cpf);
      if (tel) g.tels.add(tel);
      if (r.email) g.emails.add(r.email);
      if (r.nome) g.nomes.push(r.nome);
    }
    const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    const centavos = (v) => Math.round(v * 100) / 100;
    return grupos.map((g) => {
      const L = g.linhas;
      const nome = g.nomes.slice().sort((a, b) => b.length - a.length)[0] || null;
      const telefone = (L.find((l) => l.telefone) || {}).telefone || null;
      // Serviços, na ordem cronológica das mensagens
      const S = [];
      const doServico = (nomeS) => {
        let s = S.find((x) => x.servico === nomeS);
        if (!s) { s = { servico: nomeS, total: null, desconto: null, soma: 0, formas: [], linhas: [] }; S.push(s); }
        return s;
      };
      const saldo = (s) => (s.total ? s.total * (1 - (s.desconto || 0) / 100) - s.soma : 0);
      const todas = L.map((l) => {
        let s;
        if (l.servico) s = doServico(l.servico);
        else if (l.tipo === 'cirurgia') s = doServico('Cirurgia');
        else s = S.slice().reverse().find((x) => saldo(x) > 0.009) || S[S.length - 1] || doServico('Consulta');
        const t = num(l.total);
        if (t && t > (s.total || 0)) s.total = t;
        const d = num(l.desconto);
        if (d != null) s.desconto = d;
        let valor = num(l.pago), calculado = false;
        if (valor == null && s.total && (l.restante || s.soma > 0) && saldo(s) > 0.009) { valor = centavos(saldo(s)); calculado = true; }
        if (valor != null) s.soma += valor;
        const forma = (l.forma || (l.comprovante && l.comprovante.forma) || '').replace(/^PIX$/, 'Pix') || null;
        if (forma && !s.formas.includes(forma)) s.formas.push(forma);
        const faltando = [];
        if (valor == null) faltando.push('valor');
        if (!l.nome && !nome) faltando.push('nome');
        const linha = Object.assign({}, l, { servico: s.servico, valor, calculado, forma, faltando });
        s.linhas.push(linha);
        return linha;
      });
      const servicos = S.sort((a, b) => SERVICOS.indexOf(a.servico) - SERVICOS.indexOf(b.servico)).map((s) => {
        const descontoValor = s.total && s.desconto ? centavos(s.total * s.desconto / 100) : 0;
        const aPagar = s.total ? centavos(s.total - descontoValor) : null;
        const falta = aPagar != null ? Math.max(0, centavos(aPagar - s.soma)) : null;
        const faltando = [];
        if (!s.total) faltando.push('total');
        if (!s.formas.length) faltando.push('forma');
        if (s.linhas.some((l) => l.valor == null)) faltando.push('valor');
        return { servico: s.servico, total: s.total, desconto: s.desconto, descontoValor, aPagar, pago: centavos(s.soma), falta,
          forma: s.formas.join(' + ') || null, status: falta == null ? 'sem valor' : falta === 0 ? 'ok' : 'falta', linhas: s.linhas, faltando };
      });
      const soma = (k) => centavos(servicos.reduce((a, s) => a + (s[k] || 0), 0));
      const comTotal = servicos.filter((s) => s.total);
      const ultima = L.slice().reverse().find((l) => l.consultaEm) || {};
      const faltando = [];
      if (!nome) faltando.push('nome');
      if (!telefone) faltando.push('telefone');
      if (comTotal.length < servicos.length) faltando.push('total');
      if (!ultima.consultaEm) faltando.push('consultaEm');
      if (todas.some((l) => l.valor == null)) faltando.push('valor');
      return {
        nome, telefone, tipo: servicos.some((s) => !/consulta|retorno/i.test(s.servico)) ? 'cirurgia' : 'consulta',
        total: comTotal.length ? soma('total') : null, desconto: soma('descontoValor'), aPagar: comTotal.length ? soma('aPagar') : null,
        pago: soma('pago'), falta: comTotal.length ? centavos(comTotal.reduce((a, s) => a + s.falta, 0)) : null,
        consultaEm: ultima.consultaEm || null, consultaHora: ultima.consultaHora || null,
        primeiraData: L[0].data, ultimaData: L[L.length - 1].data, linhas: todas, servicos, faltando,
      };
    }).sort((a, b) => b.ultimaData.localeCompare(a.ultimaData));
  }

  return { SERVICOS, servicoDoTexto, formaDoTexto, descontoDoTexto, planilhaPorPaciente, normalize, parseExport, parseComprovantes, parsePagamento, consultaData, consultaHora, normPhone, phoneKey, normCpf, normName, cleanName, money, textoDoWhatsAppWeb };
});
