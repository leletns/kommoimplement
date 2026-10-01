'use strict';

/**
 * Espelhamento Kommo → Supabase (CRM próprio).
 *
 * Tabelas (ver supabase/schema.sql):
 *   - leads             UPSERT por id do Kommo
 *   - historico_status  INSERT idempotente (lead_id, status_id, changed_at)
 *   - vendedores        UPSERT por id do usuário do Kommo
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let client;
function getSupabase() {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) return null;
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

const toInt = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const toIso = (unix) => (toInt(unix) ? new Date(toInt(unix) * 1000).toISOString() : null);

/**
 * Normaliza um lead vindo do webhook do Kommo (form-urlencoded → objeto) ou da API v4.
 * O webhook entrega campos como string e tags como { id, name } indexados.
 */
function normalizeLead(raw) {
  const tagsSource = raw.tags || raw._embedded?.tags || [];
  const tags = (Array.isArray(tagsSource) ? tagsSource : Object.values(tagsSource)).map((t) => t.name).filter(Boolean);
  const customSource = raw.custom_fields || raw.custom_fields_values || [];
  return {
    id: toInt(raw.id),
    nome: raw.name || null,
    status_id: toInt(raw.status_id),
    pipeline_id: toInt(raw.pipeline_id),
    preco: toInt(raw.price) || 0,
    responsavel_id: toInt(raw.responsible_user_id),
    tags,
    campos: Array.isArray(customSource) ? customSource : Object.values(customSource),
    criado_em: toIso(raw.created_at || raw.date_create),
    atualizado_em: toIso(raw.updated_at || raw.last_modified),
    fechado_em: toIso(raw.closed_at),
    excluido: false,
    sincronizado_em: new Date().toISOString(),
  };
}

async function upsertLeads(leads) {
  const sb = getSupabase();
  if (!sb || !leads.length) return { skipped: !sb };
  const { error } = await sb.from('leads').upsert(leads, { onConflict: 'id' });
  if (error) throw new Error(`Supabase leads: ${error.message}`);
  return { count: leads.length };
}

async function insertStatusHistory(rows) {
  const sb = getSupabase();
  if (!sb || !rows.length) return { skipped: !sb };
  const { error } = await sb
    .from('historico_status')
    .upsert(rows, { onConflict: 'lead_id,status_id,alterado_em', ignoreDuplicates: true });
  if (error) throw new Error(`Supabase historico_status: ${error.message}`);
  return { count: rows.length };
}

async function upsertVendedores(users) {
  const sb = getSupabase();
  if (!sb || !users.length) return { skipped: !sb };
  const rows = users.map((u) => ({
    id: toInt(u.id),
    nome: u.name || null,
    email: u.email || null,
    ativo: u.rights ? u.rights.is_active !== false : true,
    atualizado_em: new Date().toISOString(),
  }));
  const { error } = await sb.from('vendedores').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`Supabase vendedores: ${error.message}`);
  return { count: rows.length };
}

async function markLeadsDeleted(ids) {
  const sb = getSupabase();
  if (!sb || !ids.length) return { skipped: !sb };
  const { error } = await sb.from('leads').update({ excluido: true, sincronizado_em: new Date().toISOString() }).in('id', ids);
  if (error) throw new Error(`Supabase leads (delete): ${error.message}`);
  return { count: ids.length };
}

/** Procura o lead mapeado para um grupo de WhatsApp (tabela whatsapp_grupos). */
async function findLeadIdByGroup(groupId) {
  const sb = getSupabase();
  if (!sb || !groupId) return null;
  const { data, error } = await sb.from('whatsapp_grupos').select('lead_id').eq('group_id', groupId).maybeSingle();
  if (error) {
    console.warn(`[supabase] whatsapp_grupos: ${error.message}`);
    return null;
  }
  return data ? toInt(data.lead_id) : null;
}

async function saveGroupMapping(groupId, leadId, groupName) {
  const sb = getSupabase();
  if (!sb || !groupId || !leadId) return;
  const { error } = await sb
    .from('whatsapp_grupos')
    .upsert({ group_id: groupId, lead_id: leadId, nome_grupo: groupName || null, atualizado_em: new Date().toISOString() }, { onConflict: 'group_id' });
  if (error) console.warn(`[supabase] whatsapp_grupos upsert: ${error.message}`);
}

module.exports = {
  getSupabase,
  normalizeLead,
  upsertLeads,
  insertStatusHistory,
  upsertVendedores,
  markLeadsDeleted,
  findLeadIdByGroup,
  saveGroupMapping,
  toInt,
  toIso,
};
