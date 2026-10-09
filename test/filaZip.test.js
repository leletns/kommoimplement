'use strict';
// Conversa exportada do WhatsApp (Android e iPhone): cada comprovante com a mensagem que veio junto. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert');
const Z = require('../ficha/js/fila-zip.js');

const ANDROID = `05/10/2026 14:20 - Helen: Bom dia, equipe
05/10/2026 14:33 - Maria Gabi: IMG-20261005-WA0012.jpg (arquivo anexado)
05/10/2026 14:33 - Maria Gabi: Segue pagamento da paciente Ana Teste Souza - Consulta
Pagamento: R$ 1.800,00
05/10/2026 14:40 - Helen: Recebido
05/10/2026 15:02 - Mayra: ‎Comprovante NF 2871.pdf (arquivo anexado)
Nota da paciente Beatriz Lima
06/10/2026 09:10 - Mayra: IMG-20261006-WA0003.jpg (arquivo anexado)`;

const IOS = `[05/10/2026, 14:33:10] Maria Gabi: ‎<anexado: 00000012-PHOTO-2026-10-05-14-33-10.jpg>
[05/10/2026, 14:33:40] Maria Gabi: Segue pagamento da paciente Carla Dias - Botox
[05/10/2026, 16:00:00] Maria Gabi: Outra coisa sem relação`;

test('Android: comprovante + mensagem logo depois da mesma pessoa; resposta de outra pessoa fica de fora', () => {
  const it = Z.lerConversaExportada(ANDROID);
  assert.strictEqual(it.length, 3);
  assert.strictEqual(it[0].arquivo, 'IMG-20261005-WA0012.jpg');
  assert.match(it[0].mensagem, /Ana Teste Souza/);
  assert.match(it[0].mensagem, /R\$ 1\.800,00/);
  assert.doesNotMatch(it[0].mensagem, /Recebido|Bom dia/);
  assert.strictEqual(it[1].arquivo, 'Comprovante NF 2871.pdf');
  assert.match(it[1].mensagem, /Beatriz Lima/);
  assert.strictEqual(it[2].mensagem, '');
});

test('iPhone: <anexado: …> e mensagem até 15 min depois', () => {
  const it = Z.lerConversaExportada(IOS);
  assert.strictEqual(it.length, 1);
  assert.strictEqual(it[0].arquivo, '00000012-PHOTO-2026-10-05-14-33-10.jpg');
  assert.strictEqual(it[0].mensagem, 'Segue pagamento da paciente Carla Dias - Botox');
});

test('filtro de período: só comprovantes a partir da data pedida', () => {
  const it = Z.lerConversaExportada(ANDROID, { desde: new Date(2026, 9, 6).getTime() });
  assert.strictEqual(it.length, 1);
  assert.strictEqual(it[0].arquivo, 'IMG-20261006-WA0003.jpg');
});
