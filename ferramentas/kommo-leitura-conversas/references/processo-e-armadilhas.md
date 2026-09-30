# Processo, custos e armadilhas (aprendido no primeiro cliente, set/2026)

## Por que a API privada
- A API oficial v4 **não traz o texto do chat**: `/events` só mostra `incoming/outgoing_chat_message` com horário e IDs.
- A tela do lead monta o histórico chamando `GET /ajax/v3/leads/{id}/events_timeline?limit=100`
  (headers `X-Requested-With: XMLHttpRequest`, `Accept: application/json`). Descoberto olhando as requisições da página.
- Resposta: `_embedded.items`; **type 89 = mensagem recebida, 90 = enviada**. Em `data.message`: `text`, `type` (`text`, `voice`, `picture`…), `media` (URL do áudio no drive-g), `media_duration`; `data.author.name`; `date_create`; `created_by` (0 = robô, id = atendente).
- Paginação por `_links.prev` (às vezes vem como string, às vezes como objeto com `href` — o script trata os dois).
- Com o Bearer oficial responde **403 "This is a private API"** → precisa de cookie de sessão (Playwright com perfil persistente).
- `/ajax/v3/contacts/{id}/events_timeline` NÃO traz as mensagens. Histórico antigo fica nos **leads antigos** do contato (`/contacts/{id}?with=leads`).
- Limite conhecido: conversa ligada a lead excluído (só no contato) não aparece.

## Áudio
- A URL `drive-g.kommo.com/download/...` **aceita o Bearer do token oficial**. 503 intermitente → retentar.
- Transcrição por API (paga) é muito mais rápida que Whisper local (`medium` ~4,5× o tempo real no Mac; `small` ~1,7×).
- Modo econômico transcreve só áudio do PACIENTE (áudio da equipe quase nunca traz dado do paciente).

## Custos medidos (preço de tabela, set/2026)
| Modo | Modelo leitura | Transcrição | Custo/lead |
|---|---|---|---|
| econômico | gpt-5.4-mini ($0,75/$4,50 por 1M) | gpt-4o-mini-transcribe ($0,003/min) | ~US$0,003 |
| completo (+nota) | gpt-5.4 ($2,50/$15) | gpt-4o-transcribe ($0,006/min) | ~US$0,017 |

Validação econômico × completo em 22 leads: ~88% de concordância; o mini chuta mais em cidade e tipo de cirurgia — resolvido com regras explícitas no prompt (endereço da clínica ≠ cidade do paciente; tipo só se dito).

## Erros já resolvidos (não repetir)
- **Login "confirmado" cedo demais**: checar sessão com `/ajax/v4/features?features[]=ai_copilot_analytics_available` (sem o parâmetro dá 400 mesmo logado).
- **Atendente fora da lista de usuários virava "robô"** → qualquer `created_by` ≠ 0 é EQUIPE.
- **`'str' object has no attribute 'get'`** → `data`, `message`, `author` e `_links.prev` podem vir como string.
- **Crédito acabou no meio** → o script para na hora em vez de errar lead por lead.
- **Queixa "Não informado" escrita em campo de texto** → instruir null.
- **"Sinal de alerta" disparando para limitação do dia a dia** → critério restrito na instrução.
- **Texto longo não serve para robô** (ex.: "qual cirurgia") → criar listas (região/tipo) e categorizar.
- **Grupo de campos**: `POST /leads/custom_fields/groups` com `fields` = lista de **inteiros** (IDs), não objetos.
- Chaves OpenAI/Anthropic no VPS podem ficar sem crédito; o script usa OpenAI por padrão.

## Tempo
~7 s/lead sequencial (Kommo < 1 req/s; o gargalo é transcrição + leitura). Para acelerar sem risco: paralelizar só as chamadas OpenAI e manter o Kommo numa fila ≤ 5 req/s; gravar em lote (`PATCH /leads` aceita até 50).
