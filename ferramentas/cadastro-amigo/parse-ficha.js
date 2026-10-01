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
  let ultima = null;
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
      ultima = chave[0];
      out[ultima] = (m[2] || '').trim();
    } else if (ultima && !out[ultima] && !/^https?:/.test(l)) {
      out[ultima] = l; // valor na linha de baixo do rótulo
    } else if (ultima === 'indicacao' && !out.indicacao && !/^https?:/.test(l)) {
      out.indicacao = l;
    }
  }
  if (out.cpf) out.cpf = out.cpf.replace(/[^\dA-Za-z]/g, '');
  if (out.cep) out.cep = out.cep.replace(/\D/g, '');
  if (out.telefone) out.telefone = out.telefone.replace(/[^\d+]/g, '');
  if (out.instagram) out.instagram = out.instagram.replace(/^@?/, '@').replace(/^@$/, '');
  if (out.email) out.email = out.email.trim().toLowerCase();
  // "Endereço: Rua X 3713 ap 101 - bairro - cidade UF" quando rua/número vierem vazios
  if (out.endereco && !out.rua) out.rua = out.endereco;
  Object.keys(out).forEach((k) => { if (!out[k]) delete out[k]; });
  return out;
}
if (typeof module !== 'undefined') module.exports = { parseFicha };
