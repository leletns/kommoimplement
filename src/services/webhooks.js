'use strict';

/**
 * Processamento dos webhooks:
 *   - Kommo (Lead criado/atualizado/mudou de etapa/excluído) → espelho no Supabase
 *   - WhatsApp de GRUPOS (Evolution API ou Z-API) → nota no card do lead no Kommo
 */

const supabase = require('./supabaseSync');

// ─── Kommo → Supabase ──────────────────────────────────────────────────────────

const USERS_TTL_MS = 10 * 60 * 1000;
let usersCache = { at: 0, map: new Map() };

async function getUsersMap(kommo) {
  if (Date.now() - usersCache.at < USERS_TTL_MS) return usersCache.map;
  try {
    const users = await kommo.getUsers();
    usersCache = { at: Date.now(), map: new Map(users.map((u) => [u.id, u])) };
  } catch (err) {
    console.warn(`[webhook:kommo] não foi possível carregar usuários: ${err.message}`);
  }
  return usersCache.map;
}

/** O Kommo manda leads[add][0][...]; o body-parser (qs) transforma em objeto/array. */
const asList = (node) => (!node ? [] : Array.isArray(node) ? node : Object.values(node));

async function handleKommoWebhook(body, { kommo } = {}) {
  const node = body?.leads || {};
  const changed = new Map();
  const history = [];

  for (const bucket of ['add', 'update', 'status', 'responsible']) {
    for (const raw of asList(node[bucket])) {
      const lead = supabase.normalizeLead(raw);
      if (!lead.id) continue;
      changed.set(lead.id, lead);

      const statusChanged = bucket === 'status' || (bucket === 'update' && raw.old_status_id && raw.old_status_id !== raw.status_id);
      if ((bucket === 'add' || statusChanged) && lead.status_id) {
        history.push({
          lead_id: lead.id,
          pipeline_id: lead.pipeline_id,
          status_anterior: supabase.toInt(raw.old_status_id),
          status_id: lead.status_id,
          responsavel_id: lead.responsavel_id,
          alterado_em: lead.atualizado_em || lead.criado_em || new Date().toISOString(),
          origem: `webhook_kommo:${bucket}`,
        });
      }
    }
  }
  const deleted = asList(node.delete).map((l) => supabase.toInt(l.id)).filter(Boolean);

  const result = { leads: changed.size, historico: history.length, excluidos: deleted.length, vendedores: 0 };
  if (!supabase.getSupabase()) {
    console.warn('[webhook:kommo] Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY); nada foi gravado.');
    return { ...result, skipped: true };
  }

  const responsibleIds = [...new Set([...changed.values()].map((l) => l.responsavel_id).filter(Boolean))];
  if (responsibleIds.length && kommo) {
    const users = await getUsersMap(kommo);
    const known = responsibleIds.map((id) => users.get(id)).filter(Boolean);
    await supabase.upsertVendedores(known);
    result.vendedores = known.length;
  }
  await supabase.upsertLeads([...changed.values()]);
  await supabase.insertStatusHistory(history);
  await supabase.markLeadsDeleted(deleted);
  return result;
}

// ─── WhatsApp (grupos) → nota no Kommo ────────────────────────────────────────

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

function evolutionText(message = {}) {
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.documentMessage?.fileName ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    null
  );
}

function evolutionMedia(message = {}) {
  for (const [key, label] of [
    ['imageMessage', 'imagem'],
    ['videoMessage', 'vídeo'],
    ['audioMessage', 'áudio'],
    ['documentMessage', 'documento'],
    ['stickerMessage', 'figurinha'],
    ['locationMessage', 'localização'],
    ['contactMessage', 'contato'],
  ]) {
    if (message[key]) return label;
  }
  return null;
}

/**
 * Converte o payload do provedor para um formato único. Retorna null se não for
 * mensagem de grupo (conversas 1:1 já chegam ao Kommo pelo canal oficial).
 */
function parseWhatsAppGroupMessage(body) {
  if (!body || typeof body !== 'object') return null;

  // Evolution API (v1/v2): { event: 'messages.upsert', instance, data: { key, pushName, message, messageTimestamp } }
  if (body.data && (body.event || body.instance)) {
    const event = String(body.event || '').toLowerCase().replace('_', '.');
    if (event && event !== 'messages.upsert') return null;
    const data = Array.isArray(body.data) ? body.data[0] : body.data.messages?.[0] || body.data;
    const jid = data?.key?.remoteJid || '';
    if (!jid.endsWith('@g.us')) return null;
    const media = evolutionMedia(data.message);
    return {
      provider: 'evolution',
      messageId: data.key.id,
      groupId: jid,
      groupName: data.groupName || body.groupName || null,
      senderName: data.pushName || null,
      senderPhone: onlyDigits((data.key.participant || data.participant || '').split('@')[0]),
      fromMe: Boolean(data.key.fromMe),
      text: evolutionText(data.message),
      media,
      timestamp: Number(data.messageTimestamp) ? Number(data.messageTimestamp) * 1000 : Date.now(),
    };
  }

  // Z-API: { isGroup: true, phone: '1203...-group', participantPhone, senderName, chatName, text: { message } }
  if ('isGroup' in body || body.type === 'ReceivedCallback') {
    if (!body.isGroup) return null;
    const media = body.image ? 'imagem' : body.video ? 'vídeo' : body.audio ? 'áudio' : body.document ? 'documento' : body.sticker ? 'figurinha' : null;
    return {
      provider: 'zapi',
      messageId: body.messageId,
      groupId: String(body.phone || ''),
      groupName: body.chatName || null,
      senderName: body.senderName || null,
      senderPhone: onlyDigits(body.participantPhone),
      fromMe: Boolean(body.fromMe),
      text: body.text?.message || body.image?.caption || body.video?.caption || body.document?.fileName || null,
      media,
      timestamp: Number(body.momment) || Date.now(),
    };
  }

  return null;
}

function formatGroupNote(msg) {
  const d = new Date(msg.timestamp);
  const when = d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const who = msg.fromMe ? `Equipe Blue${msg.senderName ? ` (${msg.senderName})` : ''}` : msg.senderName || 'Participante';
  const phone = msg.senderPhone ? ` +${msg.senderPhone}` : '';
  const body = msg.text || (msg.media ? `[${msg.media}]` : '[mensagem sem texto]');
  const media = msg.text && msg.media ? ` [${msg.media}]` : '';
  return `💬 WhatsApp · grupo ${msg.groupName ? `"${msg.groupName}"` : msg.groupId} · ${when}\n${who}${phone}:${media} ${body}`;
}

/** Mesmo webhook pode ser reenviado pelo provedor; guardamos os últimos ids processados. */
const seenMessages = new Set();
function rememberMessage(id) {
  if (!id) return;
  seenMessages.add(id);
  if (seenMessages.size > 5000) seenMessages.delete(seenMessages.values().next().value);
}

/**
 * Descobre o lead do grupo, nesta ordem:
 *   1. lead_id explícito (?lead_id= na URL do webhook ou no body)
 *   2. "#12345" no nome do grupo
 *   3. tabela whatsapp_grupos no Supabase
 *   4. telefone do participante → contato no Kommo → lead mais recente (e salva o vínculo)
 */
async function resolveLeadId(msg, { kommo, explicitLeadId }) {
  if (explicitLeadId) return { leadId: Number(explicitLeadId), via: 'parametro' };

  const tagged = msg.groupName && msg.groupName.match(/#(\d{4,})/);
  if (tagged) return { leadId: Number(tagged[1]), via: 'nome_do_grupo' };

  const mapped = await supabase.findLeadIdByGroup(msg.groupId);
  if (mapped) return { leadId: mapped, via: 'supabase' };

  if (!msg.fromMe && msg.senderPhone && msg.senderPhone.length >= 10) {
    // Busca pelos últimos 11 dígitos: pega o número com ou sem +55.
    const contacts = await kommo.findContacts(msg.senderPhone.slice(-11));
    const leadIds = contacts.flatMap((c) => (c._embedded?.leads || []).map((l) => l.id));
    if (leadIds.length) {
      const leadId = Math.max(...leadIds);
      await supabase.saveGroupMapping(msg.groupId, leadId, msg.groupName);
      return { leadId, via: 'telefone_participante' };
    }
  }
  return { leadId: null, via: null };
}

async function handleWhatsAppGroupWebhook(body, { kommo, explicitLeadId } = {}) {
  const msg = parseWhatsAppGroupMessage(body);
  if (!msg) return { status: 'ignorado', motivo: 'não é mensagem de grupo' };
  if (msg.messageId && seenMessages.has(msg.messageId)) return { status: 'duplicado', messageId: msg.messageId };

  const { leadId, via } = await resolveLeadId(msg, { kommo, explicitLeadId });
  if (!leadId) {
    console.warn(`[webhook:whatsapp] grupo ${msg.groupId} sem lead vinculado; cadastre em whatsapp_grupos ou inclua #ID_DO_LEAD no nome do grupo.`);
    return { status: 'sem_lead', groupId: msg.groupId };
  }

  await kommo.addLeadNote(leadId, formatGroupNote(msg));
  rememberMessage(msg.messageId); // só depois de gravar: se falhar, o reenvio do provedor tenta de novo
  return { status: 'nota_criada', leadId, via, groupId: msg.groupId };
}

module.exports = {
  handleKommoWebhook,
  handleWhatsAppGroupWebhook,
  parseWhatsAppGroupMessage,
  formatGroupNote,
};
