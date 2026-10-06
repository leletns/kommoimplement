// Lê o texto da ficha que a paciente manda no WhatsApp ("Nome : …", "CPF: …") e devolve os campos.
// Usado pelo botão "Copiar ficha" (Kommo) e testado no Node.
function parseFicha(texto) {
  const ROT = [
    ['nome', /^(nome( completo)?|full name|nombre( completo)?)$/i],
    ['cpf', /^(cpf|passport.*|passaporte|documento)$/i],
    ['rg', /^rg$/i],
    ['nascimento', /^(data de nascimento|nascimento|date of birth|fecha de nacimiento)$/i],
    ['profissao', /^(profiss[aã]o|occupation|profesi[oó]n)$/i],
    ['estadoCivil', /^(estado civil|marital status)$/i],
    ['telefone', /^(telefone|celular|phone( number)?|tel[eé]fono|tel)$/i],
    ['email', /^(e-?mail|correo)$/i],
    ['instagram', /^instagram$/i],
    ['endereco', /^(endere[cç]o|full address.*|direcci[oó]n)$/i],
    ['rua', /^rua\/avenida$/i],
    ['numero', /^n[uú]mero$/i],
    ['complemento', /^complemento$/i],
    ['cep', /^cep$/i],
    ['comoConheceu', /^(como encontrou.*|how did you find.*)$/i],
    ['objetivo', /^(qual seu principal objetivo.*|what is your main goal.*)$/i],
    ['plano', /^plano de sa[uú]de$/i],
  ];
  const linhas = String(texto).replace(/\r/g, '').split('\n').map((l) => l.trim());
  const out = {};
  let ultima = null, nRotulos = 0;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l) continue;
    if (/^por favor, se for indica/i.test(l)) {
      // "Por favor, se for indicação ... ;) Dr Fulano" → quem indicou fica depois do ;) / 😉
      const resto = l.replace(/^.*?(;\)|😉)\s*/u, '').trim();
      if (resto && resto !== l) out.indicacao = resto;
      ultima = 'indicacao';
      continue;
    }
    const m = l.match(/^([^:]{2,60}?)\s*:\s*(.*)$/);
    const chave = m && ROT.find(([, re]) => re.test(m[1].replace(/^\*|\*$/g, '').trim()));
    if (chave) {
      nRotulos++;
      ultima = chave[0];
      out[ultima] = (m[2] || '').trim();
    } else if (ultima && !out[ultima] && !/^https?:/.test(l)) {
      out[ultima] = l; // valor na linha de baixo do rótulo
    } else if (ultima === 'indicacao' && !out.indicacao && !/^https?:/.test(l)) {
      out.indicacao = l;
    }
  }
  // Ficha sem rótulos (só os valores, um por linha): reconhece cada linha pelo formato.
  if (nRotulos < 2) semRotulo(linhas, out);
  if (out.cpf) out.cpf = out.cpf.replace(/[^\dA-Za-z]/g, '');
  if (out.cep) out.cep = out.cep.replace(/\D/g, '');
  if (out.telefone) out.telefone = out.telefone.replace(/[^\d+]/g, '');
  if (out.instagram) out.instagram = out.instagram.replace(/^@?/, '@').replace(/^@$/, '');
  if (out.email) out.email = out.email.trim().toLowerCase();
  // "Endereço: Rua X 3713 ap 101 - bairro - cidade UF" quando rua/número vierem vazios
  // "Rua/avenida: Rua" (só o tipo) com "Endereço: Rua General Venâncio Flores": o nome da rua está no Endereço.
  const tipo = /^(rua|r\.?|avenida|av\.?|travessa|estrada|alameda|rodovia|pra[cç]a)$/i;
  if (out.endereco && (!out.rua || tipo.test(out.rua.trim()))) {
    out.rua = tipo.test((out.rua || '').trim()) && !new RegExp('^' + out.rua.trim(), 'i').test(out.endereco) ? out.rua.trim() + ' ' + out.endereco : out.endereco;
  }
  Object.keys(out).forEach((k) => { if (!out[k]) delete out[k]; });
  return out;
}
// --- Ficha sem rótulos ---------------------------------------------------------------
function cpfValido(c) {
  const d = String(c).replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +d[9] && dv(10) === +d[10];
}
const RE_TIPO_RUA = /^(rua|r\.|av\.?|avenida|travessa|tv\.?|estrada|estr\.?|alameda|al\.|rodovia|rod\.?|pra[cç]a|largo|servid[aã]o)(\s|\.|$)/i;
const RE_ESTADO_CIVIL = /^(casad[oa]|solteir[oa]|divorciad[oa]|separad[oa]|vi[uú]v[oa]|uni[aã]o est[aá]vel|married|single|divorced|widow(er)?|casad[oa]\s*\(.*\))$/i;
// Diz o que é uma linha solta da ficha (ou null se não der para saber pelo formato).
function tipoLinha(l) {
  const t = l.trim(), dig = t.replace(/\D/g, '');
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(t)) return 'email';
  if (/^@[\w.]{2,}$/.test(t)) return 'instagram';
  if (/^\d{1,2}[\/.-]\d{1,2}[\/.-](\d{4}|\d{2})$/.test(t)) return 'nascimento';
  if (/^\d{5}-?\d{3}$/.test(t)) return 'cep';
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(t)) {
    if (cpfValido(t)) return 'cpf';
    if (/^\d{11}$/.test(t) && dig[2] === '9') return 'telefone'; // DDD + 9 + 8 dígitos
    return 'cpf';
  }
  if (/^\+?[\d\s().-]{10,}$/.test(t) && dig.length >= 10 && dig.length <= 13) return 'telefone';
  if (RE_ESTADO_CIVIL.test(t)) return 'estadoCivil';
  if (RE_TIPO_RUA.test(t) || (/\d/.test(t) && /,/.test(t) && /[a-zà-ú]{3}/i.test(t) && t.length > 10)) return 'endereco';
  if (/^[A-Za-zÀ-ÿ'´`^~ -]+$/.test(t)) return t.split(/\s+/).filter(Boolean).length >= 2 ? 'textoLongo' : 'palavra';
  return null;
}
function semRotulo(linhas, out) {
  const soltas = linhas.filter((l) => l && !/^[^:]{2,60}:\s*/.test(l) && !/^https?:/i.test(l));
  // Só trata como ficha sem rótulo quando há pelo menos 2 dados com formato claro (CPF, data, e-mail, CEP, telefone).
  const claros = soltas.filter((l) => ['cpf', 'nascimento', 'email', 'cep', 'telefone'].includes(tipoLinha(l))).length;
  if (claros < 2) return;
  let viuNome = !!out.nome;
  for (const l of soltas) {
    const tipo = tipoLinha(l);
    if (!tipo) continue;
    if (tipo === 'textoLongo' && !viuNome && l.split(/\s+/).length <= 7) { out.nome = l.replace(/\s+/g, ' '); viuNome = true; continue; }
    if (tipo === 'endereco') {
      if (!out.rua && !out.endereco) {
        // "Av.lucio costa 4600, bloco 8 ap 506" → rua, número e complemento
        const a = l.replace(/^(av|r|tv|al|rod|estr)\.(?=\S)/i, '$1. ');
        const m = a.match(/^(.*?[A-Za-zÀ-ÿ.])[\s,]+(?:n[ºo°.]?\s*)?(\d{1,6})\b\s*[,-]?\s*(.*)$/i);
        if (m) { out.rua = m[1].trim(); out.numero = m[2]; if (m[3] && !out.complemento) out.complemento = m[3].trim(); } else out.rua = a.trim();
      }
      continue;
    }
    if (tipo === 'palavra' || tipo === 'textoLongo') {
      // Depois do nome, a primeira palavra solta que não é estado civil costuma ser a profissão.
      if (viuNome && !out.profissao && !/^(ol[aá]|oi|bom dia|boa tarde|boa noite|obrigad[oa])/i.test(l)) out.profissao = l;
      continue;
    }
    if (!out[tipo]) out[tipo] = l;
  }
}
// A mensagem parece uma ficha? (com rótulos ou só com os valores)
function pareceFicha(texto) {
  const t = String(texto || '');
  const linhas = t.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (/cpf|passport|nome\s*:|full name/i.test(t) && linhas.length >= 4) return true;
  const claros = linhas.filter((l) => ['cpf', 'nascimento', 'email', 'cep', 'telefone'].includes(tipoLinha(l))).length;
  return linhas.length >= 4 && claros >= 3;
}
if (typeof module !== 'undefined') module.exports = { parseFicha, pareceFicha, tipoLinha, cpfValido };
