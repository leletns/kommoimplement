// Executa o Apps Script REAL da planilha (ferramentas/financeiro/planilha-apps-script.gs) num servidor local,
// com um SpreadsheetApp mínimo em memória (salvo em JSON). Serve para testar o caminho site → planilha sem o Google.
// Uso: node test/e2e/planilha-emulador.js <porta> <arquivo.json> <chave>
'use strict';
const http = require('http');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const [porta = 9922, arquivo = '/tmp/planilha.json', chave = 'chave-teste'] = process.argv.slice(2);
const estado = fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : { abas: {} };
const salvar = () => fs.writeFileSync(arquivo, JSON.stringify(estado, null, 1));

const faixa = (aba, r, c, nr = 1, nc = 1) => {
  if (typeof r === 'string') { // 'A1', 'A3:C3'
    const [a, b] = r.split(':'); const p = (x) => [Number(x.replace(/[A-Z]/g, '')), x.replace(/\d/g, '').charCodeAt(0) - 64];
    const [r1, c1] = p(a); const [r2, c2] = b ? p(b) : [r1, c1]; r = r1; c = c1; nr = r2 - r1 + 1; nc = c2 - c1 + 1;
  }
  const lin = () => aba.linhas;
  const self = {
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((lin()[r - 1 + i] || [])[c - 1 + j] ?? ''))),
    setValues: (v) => { v.forEach((row, i) => row.forEach((x, j) => { (lin()[r - 1 + i] ||= [])[c - 1 + j] = x; })); salvar(); return self; },
    setValue: (x) => self.setValues([[x]]), setFormula: (x) => self.setValues([[x]]),
    setFontWeight: () => self, setBackground: () => self, setFontColor: () => self, setFontSize: () => self, setNumberFormat: () => self,
  };
  return self;
};
const abaObj = (nome) => {
  const aba = estado.abas[nome];
  return {
    appendRow: (row) => { aba.linhas.push(row); salvar(); },
    getLastRow: () => aba.linhas.length,
    getLastColumn: () => Math.max(0, ...aba.linhas.map((l) => l.length)),
    getRange: (...a) => faixa(aba, ...a),
    setFrozenRows: () => {},
  };
};
const ss = {
  getName: () => 'Controle financeiro (emulador)',
  getSheetByName: (n) => (estado.abas[n] ? abaObj(n) : null),
  insertSheet: (n) => { estado.abas[n] = { linhas: [] }; salvar(); return abaObj(n); },
};
const ctx = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'CHAVE' ? chave : null) }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ texto: t }) }) },
  JSON, String,
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../ferramentas/financeiro/planilha-apps-script.gs'), 'utf8'), ctx);

http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (d) => { corpo += d; });
  req.on('end', () => {
    if (fs.existsSync(arquivo + '.fora')) { res.writeHead(503); res.end('fora do ar'); return; }
    const out = req.method === 'POST' ? ctx.doPost({ postData: { contents: corpo } }) : ctx.doGet();
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(out.texto);
  });
}).listen(Number(porta), '127.0.0.1', () => console.log('planilha emulador em', porta));
