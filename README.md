# kommoimplement — Blue Clínica × Kommo CRM

Integração da conta **https://comercialblueclinica.kommo.com** (API v4):

| Peça | Arquivo | O que faz |
|---|---|---|
| Cliente Kommo | `src/services/kommoClient.js` | Fila p-queue a **4 req/s** (limite do Kommo: 7), retry com Exponential Backoff em 429/5xx/rede, respeita `Retry-After` e pausa a fila inteira em 429 |
| Alice Bot | `src/services/aliceEngine.js` | Score 0–100, régua quente/morna/fria, 19 objeções no método dos 5 passos |
| Retroativo | `src/scripts/retroativo.js` | Varre todos os leads, calcula o score, aplica tags/etapa/nota; retomável |
| Servidor | `src/server.js` | Painel, `/api/metrics` (cache 60 s), webhooks do Kommo e do WhatsApp |
| Métricas | `src/services/metricsService.js` | Monta o objeto `PERIODS` do painel a partir do Kommo |
| Espelho | `src/services/supabaseSync.js` + `supabase/schema.sql` | UPSERT em `leads`, `historico_status`, `vendedores` |
| Painel | `Blue Painel Comercial v1 claro.dc.html` | Carrega `/api/metrics` no `componentDidMount()` |

## Comandos

```bash
npm install
cp .env.example .env                  # preencha KOMMO_TOKEN (e Supabase, se for usar o espelho)

npm test                              # 34 testes (inclui ponta a ponta contra um Kommo simulado)

# 1) Retroativo — SEMPRE rode o dry-run primeiro (não grava nada, só mostra o que faria)
node src/scripts/retroativo.js --dry-run --limite 50
node src/scripts/retroativo.js        # grava no Kommo
node src/scripts/retroativo.js --retomar   # se cair no meio, continua da última página

# 2) Servidor
node src/server.js                    # ou: npm start
# Painel:   http://localhost:3000/
# Métricas: http://localhost:3000/api/metrics   (?refresh=1 ignora o cache)
```

### Opções do retroativo

| Opção | Efeito |
|---|---|
| `--dry-run` | Calcula e lista score/temperatura/objeções; não grava nada |
| `--limite N` | Processa no máximo N leads |
| `--desde AAAA-MM-DD` | Só leads criados a partir da data |
| `--sem-mover` | Só tags, score e nota; não muda a etapa |
| `--sem-notas` | Não lê o histórico de notas (mais rápido, score menos preciso) |
| `--sem-nota-alice` | Não cria a nota de resumo no card |
| `--force` | Reprocessa quem já tem `alice_bot_finalizado` |
| `--retomar` / `--pagina N` | Continua de onde parou |

Regras de segurança do retroativo:
- Ganhos (142) e perdidos (143) não são alterados.
- Leads já processados (tag `alice_bot_finalizado`) são pulados, então rodar de novo não duplica nada.
- **A etapa só avança, nunca volta**: um lead em "APN Agendada" com score baixo não volta para NOVOS. Leads em "Leads de entrada" (incoming) não são movidos.
- As tags existentes do lead são mantidas. Só a temperatura anterior (`lead_fria`/`lead_morna`/`lead_quente`) é trocada.
- Notas são lidas e gravadas em lote (`GET/POST /leads/notes`), com ~3 chamadas por página de 250 leads.
- Ao final, um relatório `retroativo-<timestamp>.json` é salvo.

## Organização do Kommo (`src/scripts/organizarKommo.js`)

Deixa cada comercial com **um funil só**, com a jornada completa, e o card enxuto. Sempre faz backup antes (`backups/`, fora do git).

```bash
node src/scripts/organizarKommo.js            # simula (não grava)
node src/scripts/organizarKommo.js --aplicar  # backup + aplica tudo
```

| Etapa | O que muda |
|---|---|
| Funis | **Comercial 1** e **Comercial 2** com as mesmas etapas: 1. Novo · boas-vindas → 2. Qualificado → 3. Interesse em agendar · Maria → 4. Consulta agendada → 5. Consulta realizada → 6. Oportunidade cirúrgica → 7. Cirurgia confirmada → 8. Nutrição · retomar depois. No Comercial 1 é só renomear: os IDs das etapas e os leads não mudam, então os robôs ligados às etapas continuam funcionando. O funil vazio "Alice - Blue" é apagado. |
| Campos | Aba principal só com o que a comercial preenche (10 campos); "Qualificação (Alice)" com o que é automático; "Financeiro". Remove 12 campos nunca usados. Corrige "Classificação" (Fria/Morna/Quente) e "Data e horário da consulta". |
| Tags | frio/ia-frio/morno/quente/muito_quente → `lead_fria`/`lead_morna`/`lead_quente`; alice_rj/sp/internacional → rj/sp/internacional |
| Tarefas | Conclui as 93 tarefas automáticas vencidas "NOVO LEAD CHEGOU" |
| Templates | Renomeia os 104 por etapa da jornada (`01 Abertura`, `04 Objeção`, `06 Pagamento`, `09 Follow-up`…) e cria os 19 de objeção (5 passos) e os 3 textos dos robôs (`00 Robô · …`) |

Depois, o retroativo preenche o card (Score, Classificação, Objeção registrada, Resumo Alice Bot) sem poluir a timeline:
```bash
node src/scripts/retroativo.js --sem-nota-alice                   # Comercial 1
node src/scripts/retroativo.js --sem-nota-alice --funil 13687203  # Comercial 2
```
Régua: **≥ 70** → `lead_quente` + `handoff_maria` → *3. Interesse em agendar · Maria* · **40–69** → `lead_morna` → *2. Qualificado* · **< 40** → `lead_fria` → *1. Novo*. Todas recebem `follow_up_day2` e `alice_bot_finalizado`; a etapa só avança.

Para desfazer: o JSON em `backups/` tem funis, campos, templates, tarefas e as tags e campos de cada lead de antes da mudança.

### Robôs (Salesbot)
Só dois robôs: **boas-vindas** e **follow-up**. Textos, onde ficam no funil e o passo a passo para criar esses dois e apagar os outros estão em [`docs/bots.md`](docs/bots.md). A API do Kommo só lista robôs; criar e apagar se faz na tela.

## Painel (`Blue Painel Comercial v1 claro.dc.html`)

Só o bloco `<script type="text/x-dc">` mudou. Layout, temas, fontes e todos os `sc-for` / `sc-if` (linhas 1–237) estão idênticos ao original.

- `componentDidMount()` chama `loadMetrics()`, que faz `fetch('/api/metrics')` e repete a cada 60 s. O botão **Atualizar** força `?refresh=1`.
- A resposta substitui o conteúdo de `PERIODS`, e as abas de mês passam a ser geradas a partir dela. Se a API falhar, o painel continua com os últimos dados (ou os de exemplo).
- Foram adicionadas proteções contra divisão por zero (mês sem leads/vendas não gera `NaN`).
- Abra por **http://localhost:3000/** (mesma origem). Aberto via `file://`, ele usa `http://localhost:3000` automaticamente; para outro host, defina `window.KOMMO_API_BASE`.
- ⚠️ O HTML carrega `./support.js` (runtime do DC), que **não veio junto com o arquivo**. Coloque o `support.js` exportado na raiz do projeto; o servidor já o serve em `/support.js`.

### Formato de `/api/metrics`

As chaves são os meses (`set`, `ago`, `jul`…, do mais recente para o mais antigo, `METRICS_MONTHS` meses), com os mesmos campos do `PERIODS` original:

```json
{
  "set": {
    "label": "Setembro 2026", "range": "01/09/2026 — 30/09/2026",
    "leads": "1.243", "apn": "414", "consultas": "48", "cirurgias": "11",
    "vendas": "59", "receita": "R$ 1.143.828", "ads": "R$ 15.034,66", "cac": "R$ 255",
    "cm1": "CM1 · R$ 82.300", "cm2": "CM2 · R$ 1.061.528",
    "ticket": "R$ 19.387", "ciclo": "37 dias", "leadsRenda": "409", "form": "18/09/2026",
    "weeks": ["S1","S2","S3","S4","S5"], "leadSeries": [268,302,331,246,96], "saleSeries": [12,16,14,11,6],
    "team":   [{ "name": "Lya", "role": "C01B · Closer Lya", "leads": 235, "apn": 222, "sales": 32, "c1": "94.5%", "c2": "14.4%", "c3": "13.6%", "revenue": 60250 }],
    "funnel": [{ "label": "Leads", "count": 1243, "value": "—" }, { "label": "Qualificados", "count": 812, "value": "R$ 4,9M pipe" }]
  }
}
```

| KPI | Regra |
|---|---|
| Leads | Criados no mês no funil principal (`KOMMO_PIPELINE_ID` ou o funil principal da conta) |
| Qualificados / APN | Leads da safra do mês que chegaram na etapa: etapa atual ≥ alvo, ganhos, ou evento `lead_status_changed` para a etapa (conta também quem foi perdido depois) |
| Vendas / Receita | Status 142 com `closed_at` no mês; receita = soma do `price` |
| Consulta (CM1) × Cirurgia (CM2) | Tag/nome com cirurgia/LipeDefinition/Sublift/… ou `price ≥ KOMMO_CIRURGIA_MIN_PRICE` → cirurgia |
| ADS / CAC | `ADS_INVESTIMENTO_JSON` (o Kommo não tem esse dado); CAC = ADS ÷ vendas |
| Time | Responsável pelo lead; cargo via `KOMMO_TEAM_ROLES_JSON`; c1 = APN/leads, c2 = vendas/APN, c3 = vendas/leads |
| Leads com renda | Leads com `KOMMO_RENDA_FIELD_ID` preenchido (sem o campo: "—") |

Etapas: detectadas pelo nome ("Novos", "Qualific…", "Agend…/APN"). Se os nomes forem outros, defina `KOMMO_STATUS_NOVOS_ID`, `KOMMO_STATUS_QUALIFICADOS_ID` e `KOMMO_APN_STATUS_IDS`.

## Webhooks

As duas rotas respondem **200 na hora** e processam em segundo plano: o Kommo desativa webhooks lentos, e os provedores de WhatsApp reenviam em timeout. Proteja as URLs com `?token=WEBHOOK_SECRET` (ou o header `x-webhook-token`). O servidor precisa estar acessível publicamente (deploy ou túnel, ex.: `cloudflared tunnel --url http://localhost:3000`).

### Kommo → Supabase — `POST /api/webhooks/kommo?token=…`
1. Rode `supabase/schema.sql` no SQL Editor do Supabase.
2. No Kommo: *Configurações → Integrações → Webhooks*, com a URL acima e os eventos *Lead adicionado, Lead editado, Etapa do lead alterada, Responsável alterado, Lead excluído*.

Resultado: UPSERT em `leads`, INSERT idempotente em `historico_status` (lead + etapa + data) e UPSERT em `vendedores` (nome/e-mail vindos de `GET /users`, com cache de 10 min). Excluídos ficam com `excluido = true`.

### WhatsApp (grupos) → nota no lead — `POST /api/webhooks/whatsapp-groups?token=…`
Aceita **Evolution API** (`messages.upsert`, `remoteJid …@g.us`) e **Z-API** (`isGroup: true`). Mensagens 1:1 são ignoradas, porque já chegam pelo canal oficial.

O lead é identificado nesta ordem:
1. `?lead_id=123` na URL do webhook (útil para uma instância dedicada a um lead);
2. `#123` no **nome do grupo** (ex.: "Pós-op Ana #123") — Z-API envia o nome; na Evolution, use as opções 1, 3 ou 4;
3. tabela `whatsapp_grupos` no Supabase (`group_id → lead_id`);
4. telefone do participante → contato no Kommo → lead mais recente do contato. O vínculo é salvo em `whatsapp_grupos`.

A nota entra na timeline do card via `POST /api/v4/leads/{id}/notes`. Reenvios do mesmo `messageId` não duplicam.

### Histórico antigo de grupos (retroativo)
Nenhuma integração de WhatsApp traz mensagens antigas de grupos (a opção de grupos do Wazzup só capta mensagens a partir de quando é ligada). Para o passado:
1. No WhatsApp, abra o grupo → ⋮ → *Mais* → **Exportar conversa** → *Sem mídia* (no iPhone, extraia o `_chat.txt` do .zip).
2. Simule e depois grave (uma nota por dia no card; rodar de novo não duplica):
```bash
node src/scripts/importarGrupo.js --lead 79973970 --arquivo "Conversa do WhatsApp com Pós-op Ana.txt"
node src/scripts/importarGrupo.js --lead 79973970 --arquivo "Conversa do WhatsApp com Pós-op Ana.txt" --gravar
```

## Alice Bot — régua

| Score | Tags | Etapa |
|---|---|---|
| ≥ 70 | `lead_quente` + `follow_up_day2` + `alice_bot_finalizado` | QUALIFICADOS |
| 40–69 | `lead_morna` + `follow_up_day2` + `alice_bot_finalizado` | QUALIFICADOS |
| < 40 | `lead_fria` + `follow_up_day2` + `alice_bot_finalizado` | NOVOS |

O score soma sinais explicáveis: sintomas (dor, peso, hematomas, inchaço, desproporção…), diagnóstico/suspeita de lipedema, intenção (agendar, consulta, cirurgia, valor, Sublift), desinteresse (negativo), valor no card, engajamento (nº de notas), recência e progresso no funil. A nota no card mostra a composição do score e, se houver objeções, o roteiro de cada uma nos 5 passos (**Acolher → Investigar → Compreender → Reposicionar → Conduzir**).

As 19 objeções são: valor da consulta, valor da cirurgia, distância, paciente internacional, medo de cirurgia, tempo de afastamento, sem diagnóstico, lipedema × gordura localizada, comparação com outros médicos, desconfiança de promessas, resultado artificial, recuperação difícil, pele irregular, Sublift serve?, plano de saúde, "preciso pensar/falar com alguém", falta de tempo, forma de pagamento e consulta online. Os textos seguem as regras de segurança médica da Blue: sem diagnóstico, sem promessa de resultado, sempre conduzindo para avaliação individualizada. **Valide a lista e as falas com o Manual Comercial Blue** antes de usar com pacientes. Elas ficam em `OBJECTIONS`, em `aliceEngine.js`.
