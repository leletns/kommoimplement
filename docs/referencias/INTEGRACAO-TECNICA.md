# Painel Comercial Blue — Especificação Técnica

Documento de implantação para o time de T.I. Cobre banco de dados, sincronização automática com o CRM (token, sem IA), upload real de foto de perfil e cadastro ilimitado de comerciais.

---

## 1. Arquitetura

```
CRM (API REST + token)
        │  worker de sincronização (cron, 15 min)
        ▼
PostgreSQL  ──►  views materializadas  ──►  API do painel  ──►  front-end
        ▲
Storage de objetos (fotos de perfil)
```

Nenhum componente de IA é necessário. Todo o cálculo de KPI é SQL.

**Stack recomendada (menor custo operacional):**

| Camada | Escolha | Por quê |
|---|---|---|
| Banco | PostgreSQL 15 (Supabase ou RDS) | views materializadas, JSONB para payload bruto |
| Storage | Supabase Storage ou S3 + CloudFront | upload direto do navegador com URL assinada |
| Worker | Supabase Edge Function / AWS Lambda + EventBridge | cron de 15 min, sem servidor ocioso |
| API | PostgREST (Supabase) ou Node + Fastify | leitura das views, escrita em `comerciais` |
| Auth | Supabase Auth (e-mail corporativo) | cada comercial acessa o próprio perfil |

---

## 2. Modelo de dados

```sql
-- Comerciais (cadastro ilimitado)
create table comerciais (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  funcao          text not null,                  -- "Comercial 1", "Comercial 2", ...
  email           text unique not null,
  foto_url        text,                           -- URL pública no storage
  crm_user_id     bigint unique,                  -- id do responsável no CRM
  pipeline_id     bigint,                         -- funil atribuído
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index on comerciais (crm_user_id) where ativo;

-- Leads espelhados do CRM (idempotente por crm_lead_id)
create table leads (
  crm_lead_id     bigint primary key,
  comercial_id    uuid references comerciais(id) on delete set null,
  crm_user_id     bigint,
  pipeline_id     bigint,
  status_id       bigint,                         -- etapa atual
  etapa           text,                           -- rótulo legível (Lead, APN, Consulta, Cirurgia)
  valor_centavos  bigint not null default 0,
  origem          text,                           -- utm_source / canal
  renda_declarada text,
  criado_em       timestamptz not null,
  fechado_em      timestamptz,
  ganho           boolean not null default false,
  payload         jsonb not null,                 -- resposta bruta, para reprocessar sem novo fetch
  sincronizado_em timestamptz not null default now()
);
create index on leads (comercial_id, criado_em desc);
create index on leads (etapa, criado_em desc);

-- Histórico de mudança de etapa (para ciclo médio e funil real)
create table lead_eventos (
  id           bigserial primary key,
  crm_lead_id  bigint references leads(crm_lead_id) on delete cascade,
  de_status    bigint,
  para_status  bigint,
  ocorrido_em  timestamptz not null,
  unique (crm_lead_id, para_status, ocorrido_em)
);

-- Investimento de mídia (entrada manual ou API de anúncios)
create table midia_investimento (
  id            bigserial primary key,
  competencia   date not null,                    -- primeiro dia do mês
  canal         text not null,                    -- meta | google
  valor_centavos bigint not null,
  unique (competencia, canal)
);

-- Controle de sincronização
create table sync_log (
  id            bigserial primary key,
  fonte         text not null,
  iniciado_em   timestamptz not null default now(),
  concluido_em  timestamptz,
  registros     int default 0,
  status        text not null default 'running',  -- running | ok | erro
  erro          text,
  cursor_ate    timestamptz                       -- marca d'água para sync incremental
);
```

### View de métricas por comercial e mês

```sql
create materialized view mv_performance_mensal as
select
  c.id                                   as comercial_id,
  c.nome,
  c.funcao,
  date_trunc('month', l.criado_em)::date as competencia,
  count(*)                                             as leads,
  count(*) filter (where l.etapa in ('APN','Consulta','Cirurgia')) as apns,
  count(*) filter (where l.ganho)                      as vendas,
  coalesce(sum(l.valor_centavos) filter (where l.ganho), 0) as receita_centavos,
  round(avg(extract(epoch from (l.fechado_em - l.criado_em)) / 86400)
        filter (where l.ganho)::numeric, 1)            as ciclo_dias
from comerciais c
left join leads l on l.comercial_id = c.id
where c.ativo
group by 1,2,3,4;

create unique index on mv_performance_mensal (comercial_id, competencia);
-- refresh concurrently after each sync
```

Conversões (Lead→APN, APN→Venda, Lead→Venda), CAC e ticket médio são calculados na API a partir dessa view — não são colunas armazenadas, para nunca ficarem defasados.

---

## 3. Sincronização com o CRM (token, sem IA)

### 3.1 Credenciais

Guarde o token de acesso de longa duração em variável de ambiente / secret manager. **Nunca** no front-end.

```
CRM_BASE_URL=https://<subdominio>.kommo.com
CRM_LONG_LIVED_TOKEN=<token>
```

O token de longa duração dispensa o fluxo OAuth de refresh. Se optar por OAuth, persista `access_token` + `refresh_token` numa tabela `crm_credenciais` e renove antes do vencimento (24 h).

### 3.2 Worker incremental (cron 15 min)

```ts
// supabase/functions/sync-crm/index.ts
const BASE = Deno.env.get('CRM_BASE_URL')!;
const TOKEN = Deno.env.get('CRM_LONG_LIVED_TOKEN')!;

async function crm(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}/api/v4/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 204) return { _embedded: {} };          // sem novos registros
  if (res.status === 429) { await sleep(2000); return crm(path, params); } // backoff
  if (!res.ok) throw new Error(`CRM ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function sync(db) {
  const { cursor_ate } = await db.one(
    `select coalesce(max(cursor_ate), now() - interval '90 days') as cursor_ate
       from sync_log where status = 'ok'`);
  const log = await db.one(
    `insert into sync_log (fonte) values ('crm') returning id`);

  let page = 1, total = 0, maxSeen = cursor_ate;
  while (true) {
    const data = await crm('leads', {
      page: String(page), limit: '250',
      'filter[updated_at][from]': String(Math.floor(+new Date(cursor_ate) / 1000)),
      with: 'contacts'
    });
    const leads = data._embedded?.leads ?? [];
    if (!leads.length) break;

    await db.tx(t => Promise.all(leads.map(l => t.none(`
      insert into leads (crm_lead_id, crm_user_id, pipeline_id, status_id, etapa,
                         valor_centavos, criado_em, fechado_em, ganho, payload,
                         comercial_id, sincronizado_em)
      values ($1,$2,$3,$4,$5,$6, to_timestamp($7), $8, $9, $10,
              (select id from comerciais where crm_user_id = $2 and ativo), now())
      on conflict (crm_lead_id) do update set
        status_id = excluded.status_id, etapa = excluded.etapa,
        valor_centavos = excluded.valor_centavos, fechado_em = excluded.fechado_em,
        ganho = excluded.ganho, payload = excluded.payload,
        comercial_id = excluded.comercial_id, sincronizado_em = now()`,
      [l.id, l.responsible_user_id, l.pipeline_id, l.status_id,
       rotularEtapa(l.status_id), l.price * 100, l.created_at,
       l.closed_at ? new Date(l.closed_at * 1000) : null,
       l.status_id === 142, l]))));

    total += leads.length;
    maxSeen = new Date(Math.max(...leads.map(l => l.updated_at * 1000)));
    if (leads.length < 250) break;
    page++;
  }

  await db.none(`refresh materialized view concurrently mv_performance_mensal`);
  await db.none(`update sync_log set status='ok', concluido_em=now(),
                 registros=$2, cursor_ate=$3 where id=$1`, [log.id, total, maxSeen]);
}
```

**Mapa de etapas** — preencha uma vez com os `status_id` reais de cada funil:

```sql
create table etapa_mapa (
  pipeline_id bigint, status_id bigint, rotulo text,
  ordem int, primary key (pipeline_id, status_id));
-- exemplo: (Comercial 1, 1420301, 'APN', 3)
```

Assim, renomear uma etapa no CRM não quebra o painel: basta atualizar uma linha.

### 3.3 Robustez

- **Idempotência:** todo upsert usa `crm_lead_id` como chave; reexecutar a sync nunca duplica.
- **Marca d'água:** `cursor_ate` garante leitura incremental; em caso de falha, a próxima rodada retoma do último ponto confirmado.
- **Rate limit:** o CRM limita ~7 req/s. Mantenha `limit=250` e backoff exponencial em 429.
- **Reprocessamento:** como o payload bruto fica em `leads.payload`, mudanças de regra são reaplicadas com SQL, sem novo fetch.
- **Alerta:** se `sync_log` não registrar `ok` por 60 min, dispare e-mail/Slack.

### 3.4 Webhook (opcional, tempo real)

Registre um webhook no CRM apontando para `POST /webhooks/crm`; valide a origem por token na query string e faça o mesmo upsert de um único lead. O cron continua como rede de segurança.

---

## 4. Foto de perfil — upload real

Fluxo com URL assinada: o arquivo vai direto do navegador para o storage, sem passar pela API.

**Bucket:** `perfis` (público para leitura, escrita só autenticada).

```ts
// front-end
async function enviarFoto(comercialId, file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type))
    throw new Error('Formato inválido');
  if (file.size > 5 * 1024 * 1024) throw new Error('Máximo 5 MB');

  const caminho = `${comercialId}/${crypto.randomUUID()}.${file.name.split('.').pop()}`;
  const { error } = await supabase.storage
    .from('perfis').upload(caminho, file, { cacheControl: '31536000', upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from('perfis').getPublicUrl(caminho);
  await supabase.from('comerciais')
    .update({ foto_url: data.publicUrl, atualizado_em: new Date() })
    .eq('id', comercialId);
  return data.publicUrl;
}
```

Boas práticas: redimensione para 512×512 no cliente (canvas) antes de enviar; mantenha a foto antiga até o upload confirmar; apague o objeto anterior depois.

**Política de acesso (RLS):**

```sql
alter table comerciais enable row level security;

create policy "leitura interna" on comerciais
  for select using (auth.role() = 'authenticated');

create policy "edita o proprio perfil" on comerciais
  for update using (auth.jwt() ->> 'email' = email);

create policy "admin gerencia todos" on comerciais
  for all using (auth.jwt() ->> 'role' = 'admin');
```

---

## 5. API do painel

| Método | Rota | Retorno |
|---|---|---|
| GET | `/api/kpis?competencia=2026-09` | receita, leads, APNs, vendas, CAC, ticket, ciclo |
| GET | `/api/performance?competencia=2026-09` | array por comercial, com conversões calculadas |
| GET | `/api/funil?competencia=2026-09` | contagem e valor por etapa |
| GET | `/api/serie?competencia=2026-09&granularidade=semana` | leads e vendas por semana |
| GET | `/api/comerciais` | lista ativa |
| POST | `/api/comerciais` | cria (nome, funcao, email, crm_user_id, pipeline_id) |
| PATCH | `/api/comerciais/:id` | edita, inclusive `foto_url` |
| DELETE | `/api/comerciais/:id` | desativa (soft delete: `ativo = false`) |
| GET | `/api/sync/status` | última sync, registros, erro |

Remoção é sempre lógica — o histórico de leads da comercial permanece nos relatórios.

---

## 6. Cadastro atual

| Nome | Função | Funil no CRM |
|---|---|---|
| Maria | Comercial 1 | Comercial 1 |
| Mayra | Comercial 2 | Comercial 2 |

Para vincular: pegue o `responsible_user_id` de cada uma em `GET /api/v4/users` e grave em `comerciais.crm_user_id`. A partir daí, todo lead atribuído a ela no CRM aparece no painel sem intervenção.

---

## 7. Implantação

1. Criar banco e rodar as migrations da seção 2.
2. Preencher `etapa_mapa` com os `status_id` reais dos dois funis.
3. Cadastrar Maria e Mayra com seus `crm_user_id`.
4. Guardar o token do CRM no secret manager; testar `GET /api/v4/account`.
5. Rodar a sync manualmente com janela de 90 dias (carga inicial).
6. Agendar o cron de 15 min e o refresh da view.
7. Criar o bucket `perfis` e aplicar as políticas RLS.
8. Publicar o front-end com as variáveis de ambiente do banco e do storage.
9. Configurar alerta de sync parada.

**Checklist de aceite:** um lead criado no CRM aparece no painel em até 15 min · a soma de receita do painel bate com o relatório do CRM no mesmo período · uma nova comercial cadastrada recebe métricas na sync seguinte · a foto enviada persiste após recarregar em outro dispositivo.
