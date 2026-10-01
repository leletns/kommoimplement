'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseWhatsAppGroupMessage, handleWhatsAppGroupWebhook, formatGroupNote } = require('../src/services/webhooks');

const evolution = (over = {}) => ({
  event: 'messages.upsert',
  instance: 'blue',
  data: {
    key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'MSG1', participant: '5521999998888@s.whatsapp.net' },
    pushName: 'Paciente Ana',
    message: { conversation: 'Bom dia, enviei os exames' },
    messageTimestamp: 1790000000,
    ...over,
  },
});

test('Evolution API: mensagem de grupo é normalizada', () => {
  const m = parseWhatsAppGroupMessage(evolution());
  assert.strictEqual(m.provider, 'evolution');
  assert.strictEqual(m.groupId, '120363000000000001@g.us');
  assert.strictEqual(m.senderPhone, '5521999998888');
  assert.strictEqual(m.text, 'Bom dia, enviei os exames');
});

test('Evolution API: conversa 1:1 é ignorada', () => {
  const body = evolution({ key: { remoteJid: '5521999998888@s.whatsapp.net', id: 'x' } });
  assert.strictEqual(parseWhatsAppGroupMessage(body), null);
});

test('Z-API: mensagem de grupo é normalizada', () => {
  const m = parseWhatsAppGroupMessage({
    isGroup: true, phone: '120363000000000002-group', participantPhone: '5521988887777', senderName: 'Ana',
    chatName: 'Blue · Ana #45678', text: { message: 'Oi' }, messageId: 'Z1', momment: 1790000000000, type: 'ReceivedCallback',
  });
  assert.strictEqual(m.provider, 'zapi');
  assert.strictEqual(m.groupName, 'Blue · Ana #45678');
  assert.match(formatGroupNote(m), /Ana \+5521988887777: Oi/);
});

test('Z-API: conversa 1:1 é ignorada', () => {
  assert.strictEqual(parseWhatsAppGroupMessage({ isGroup: false, phone: '5521', text: { message: 'oi' } }), null);
});

test('lead pelo #ID no nome do grupo vira nota, e reenvio não duplica', async () => {
  const notes = [];
  const kommo = { addLeadNote: async (id, text) => notes.push({ id, text }), findContacts: async () => [] };
  const body = { isGroup: true, phone: 'g-1', chatName: 'Pós-op #45678', senderName: 'Ana', text: { message: 'Tudo bem' }, messageId: 'DUP-1' };
  const r1 = await handleWhatsAppGroupWebhook(body, { kommo });
  const r2 = await handleWhatsAppGroupWebhook(body, { kommo });
  assert.strictEqual(r1.status, 'nota_criada');
  assert.strictEqual(r1.leadId, 45678);
  assert.strictEqual(r2.status, 'duplicado');
  assert.strictEqual(notes.length, 1);
});

test('lead pelo telefone do participante (contato no Kommo)', async () => {
  const notes = [];
  const kommo = {
    addLeadNote: async (id, text) => notes.push({ id, text }),
    findContacts: async (q) => (q === '21999998888' ? [{ id: 7, _embedded: { leads: [{ id: 100 }, { id: 250 }] } }] : []),
  };
  const r = await handleWhatsAppGroupWebhook(evolution({ key: { remoteJid: 'g2@g.us', id: 'M2', participant: '5521999998888@s.whatsapp.net' } }), { kommo });
  assert.strictEqual(r.leadId, 250);
  assert.strictEqual(r.via, 'telefone_participante');
});

test('sem lead identificável não grava nota', async () => {
  const kommo = { addLeadNote: async () => assert.fail('não deveria gravar'), findContacts: async () => [] };
  const r = await handleWhatsAppGroupWebhook(evolution({ key: { remoteJid: 'g3@g.us', id: 'M3', participant: '5521900000000@s.whatsapp.net' } }), { kommo });
  assert.strictEqual(r.status, 'sem_lead');
});
