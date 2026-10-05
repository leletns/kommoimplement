/**
 * Planilha de Controle Financeiro da GESTÃO · Blue Clínica
 * Recebe os lançamentos confirmados no botão 💰 Controle financeiro (via /api/financeiro do site da clínica).
 *
 * Instalação (uma vez, ~5 min): veja ferramentas/financeiro/LEIA-ME.md
 *   1. Planilha do Google → Extensões → Apps Script → cole este arquivo.
 *   2. Configurações do projeto → Propriedades do script → CHAVE = (o mesmo texto de FINANCEIRO_PLANILHA_CHAVE no Cloudflare).
 *   3. Implantar → Nova implantação → App da Web → Executar como: Eu · Quem pode acessar: Qualquer pessoa → copie a URL.
 * A chave impede que outra pessoa escreva na planilha. Nada aqui apaga ou altera linhas existentes.
 */
var ABA = 'Lançamentos';
var ABA_RESUMO = 'Resumo';

function doGet() {
  return saida({ ok: true, planilha: SpreadsheetApp.getActiveSpreadsheet().getName() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000); // dois lançamentos ao mesmo tempo não pisam um no outro
  try {
    var b = JSON.parse(e.postData.contents);
    var chave = PropertiesService.getScriptProperties().getProperty('CHAVE');
    if (!chave || b.chave !== chave) return saida({ ok: false, erro: 'chave inválida' });
    if (b.acao !== 'lancar' || !b.linha || !b.colunas) return saida({ ok: false, erro: 'pedido inválido' });
    var aba = prepararAba(b.colunas);
    var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
    var colId = cab.indexOf('Lançamento'), colTx = cab.indexOf('ID da transação / Pix');
    var n = aba.getLastRow();
    if (n > 1) {
      var dados = aba.getRange(2, 1, n - 1, cab.length).getValues();
      for (var i = 0; i < dados.length; i++) {
        var mesmoId = String(dados[i][colId]) === String(b.linha[colId]);
        var mesmaTx = b.linha[colTx] && String(dados[i][colTx]) === String(b.linha[colTx]);
        if (mesmoId || mesmaTx) return saida({ ok: true, duplicado: true, linha: i + 2 });
      }
    }
    aba.appendRow(b.linha);
    var linha = aba.getLastRow();
    aba.getRange(linha, cab.indexOf('Valor') + 1).setNumberFormat('#,##0.00');
    return saida({ ok: true, linha: linha });
  } catch (err) {
    return saida({ ok: false, erro: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function prepararAba(colunas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(ABA);
  if (!aba) {
    aba = ss.insertSheet(ABA, 0);
    aba.appendRow(colunas);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, colunas.length).setFontWeight('bold').setBackground('#13294a').setFontColor('#ffffff');
    criarResumo(ss);
  }
  return aba;
}

/** Aba Resumo: totais por status, forma de pagamento e mês (fórmulas: atualizam sozinhas). */
function criarResumo(ss) {
  if (ss.getSheetByName(ABA_RESUMO)) return;
  var r = ss.insertSheet(ABA_RESUMO, 1);
  var L = "'" + ABA + "'!";
  r.getRange('A1').setValue('Controle financeiro · resumo').setFontWeight('bold').setFontSize(14);
  r.getRange('A3:C3').setValues([['Status', 'Lançamentos', 'Valor (R$)']]).setFontWeight('bold');
  r.getRange('A4:A5').setValues([['Conferido'], ['Conferido com divergência']]);
  // setFormula usa a sintaxe em inglês (vírgula), qualquer que seja o idioma da planilha.
  r.getRange('B4').setFormula('=COUNTIF(' + L + 'R:R,A4)'); r.getRange('C4').setFormula('=SUMIFS(' + L + 'I:I,' + L + 'R:R,A4,' + L + 'J:J,"BRL")');
  r.getRange('B5').setFormula('=COUNTIF(' + L + 'R:R,A5)'); r.getRange('C5').setFormula('=SUMIFS(' + L + 'I:I,' + L + 'R:R,A5,' + L + 'J:J,"BRL")');
  r.getRange('A6').setValue('Total'); r.getRange('B6').setFormula('=SUM(B4:B5)'); r.getRange('C6').setFormula('=SUM(C4:C5)');
  r.getRange('A8').setValue('Por forma de pagamento (R$)').setFontWeight('bold');
  r.getRange('A9').setFormula('=QUERY(' + L + 'A:AG,"select K, count(A), sum(I) where A is not null and J = \'BRL\' group by K label count(A) \'Lançamentos\', sum(I) \'Valor (R$)\'",1)');
  r.getRange('E8').setValue('Por mês do pagamento (R$)').setFontWeight('bold');
  r.getRange('E9').setFormula('=QUERY({ARRAYFORMULA(IFERROR(RIGHT(' + L + 'B2:B,7))),' + L + 'I2:I,' + L + 'J2:J},"select Col1, sum(Col2) where Col1 <> \'\' and Col3 = \'BRL\' group by Col1 label Col1 \'Mês\', sum(Col2) \'Valor (R$)\'",0)');
  r.getRange('I8').setValue('Por categoria (R$)').setFontWeight('bold');
  r.getRange('I9').setFormula('=QUERY(' + L + 'A:AG,"select AF, count(A), sum(I) where A is not null and J = \'BRL\' group by AF label AF \'Categoria\', count(A) \'Lançamentos\', sum(I) \'Valor (R$)\'",1)');
  r.getRange('C4:C6').setNumberFormat('#,##0.00');
}

function saida(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
