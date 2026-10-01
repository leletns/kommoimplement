-- Espelho do Kommo no Supabase (CRM próprio da Blue Clínica).
-- Rode no SQL Editor do Supabase antes de ligar o webhook /api/webhooks/kommo.

create table if not exists public.vendedores (
  id            bigint primary key,              -- id do usuário no Kommo
  nome          text,
  email         text,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.leads (
  id              bigint primary key,            -- id do lead no Kommo
  nome            text,
  status_id       bigint,
  pipeline_id     bigint,
  preco           numeric(14,2) not null default 0,
  responsavel_id  bigint,                         -- vendedores.id (sem FK: o webhook pode chegar antes do vendedor)
  tags            text[] not null default '{}',
  campos          jsonb  not null default '[]'::jsonb,
  criado_em       timestamptz,
  atualizado_em   timestamptz,
  fechado_em      timestamptz,
  excluido        boolean not null default false,
  sincronizado_em timestamptz not null default now()
);
create index if not exists leads_status_idx      on public.leads (pipeline_id, status_id);
create index if not exists leads_responsavel_idx on public.leads (responsavel_id);
create index if not exists leads_criado_idx      on public.leads (criado_em);

create table if not exists public.historico_status (
  id              bigserial primary key,
  lead_id         bigint not null references public.leads(id) on delete cascade,
  pipeline_id     bigint,
  status_anterior bigint,
  status_id       bigint not null,
  responsavel_id  bigint,
  alterado_em     timestamptz not null default now(),
  origem          text not null default 'webhook_kommo',
  unique (lead_id, status_id, alterado_em)
);
create index if not exists historico_lead_idx on public.historico_status (lead_id, alterado_em desc);

-- Vínculo grupo de WhatsApp → lead (usado por /api/webhooks/whatsapp-groups)
create table if not exists public.whatsapp_grupos (
  group_id      text primary key,               -- ex.: 120363000000000000@g.us
  lead_id       bigint not null,
  nome_grupo    text,
  atualizado_em timestamptz not null default now()
);

-- O backend usa a service_role key (ignora RLS). Deixe RLS ligado para
-- bloquear acesso anônimo pela chave pública.
alter table public.vendedores       enable row level security;
alter table public.leads            enable row level security;
alter table public.historico_status enable row level security;
alter table public.whatsapp_grupos  enable row level security;
