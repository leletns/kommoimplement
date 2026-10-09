# Handoff: o que já existe no kommoimplement (para o Blue Intelligence OS)

Tudo está na branch **`claude/loving-curie-mz2qi8`** (a `main` só tem o commit inicial).
`git fetch origin && git checkout claude/loving-curie-mz2qi8`

## Regras que valem para qualquer sessão
- Tokens (Kommo, Amigo, Meta, Google, IA) só no `.env` local ou nas variáveis do Netlify. Nunca no código, no chat ou em commit (`git grep "eyJ0eXAi"` antes de subir).
- Dados de pacientes ficam em `backups/` (fora do git). Nunca versionar nomes, telefones, CPFs.
- Escrita no Kommo: simular primeiro (dry-run), confirmar com a Letícia, só preencher campo vazio, nunca baixar valor de consulta realizada.
- Botões do navegador nunca salvam sozinhos e nunca criam cadastro "NOVO" no Amigo sozinhos.
- Linguagem com a Letícia: português simples.

## Conta Kommo (comercialblueclinica): IDs que importam
IDs não secretos ficam em `config/conta.env`. Os principais:

| O quê | ID |
|---|---|
| Funil Comercial 1 | 13604187 |
| Etapa "Consulta AGENDADA" (na API aparece como "Venda ganha") | 142 |
| 4. Consulta REALIZADA | 104983967 |
| Negociação / Aguardando pagamento / 3.1 Retomar / Interesse | 112211035 / 112211039 / 111694511 / 106593295 |
| Comercial 2 · Passou por consulta | 13687203 · 112098323 |
| Arquivo | 14487067 |
| Não é lead (Funcionário / Propaganda) | 14526023 (112212215 / 112212219) |
| Campo Data do pagamento | 3728960 |
| Campo Data e horário da consulta | 3728948 |
| Campo Fonte (enum) | 3839860 |
| Campo Classificação / Modalidade / Primeiro nome | 3837344 / 3837322 / 3837314 |
| Campo Data próxima ação / Mensagem de follow-up | 3839458 / 3839858 |

Atenção: uma regra do Kommo cria cópias "Autolead: Lead #N" no Comercial 2 quando o lead entra em 142. As métricas ignoram essas cópias (`metricsService.buildPeriod`).

## Código para reaproveitar

| Peça | Arquivo | Para quê |
|---|---|---|
| Cliente Kommo | `src/services/kommoClient.js` | Fila de 4 req/s, novas tentativas em 429/5xx, paginação |
| Métricas | `src/services/metricsService.js` | Agendadas, pagas, consulta × cirurgia, por funil e vendedora |
| Pagamentos | `src/services/pagamentos.js`, `src/scripts/preencherPagamentos.js` | Lê comprovantes (export do WhatsApp) e o relatório do Amigo; ciclo de venda; valor pago × total |
| Importar WhatsApp | `src/scripts/importarGrupo.js` | Export de grupo (formato BR e iPhone EN) |
| Automação da Maria | `src/services/automacaoMaria.js`, `netlify/functions/automacao-kommo.mjs` | Follow-up, Retomar, a cada 15 min (pula quem já pagou) |
| Cliente Amigo | `src/services/amigoClient.js` | API oficial: `GET /patients/exists`, `POST /patients` (base `https://amigobot-api.amigoapp.com.br`, Bearer `AMIGO_TOKEN`). A API não aceita nascimento, RG, complemento nem "Como nos conheceu" |
| Ficha Blue | `ficha/index.html`, `src/services/fichaBlue.js`, `netlify/functions/ficha*.mjs` | Link pessoal assinado `/f/<código>` → cria a paciente no Amigo (sem duplicar), nota com `FICHA_BLUE_JSON:` + etiqueta `ficha_recebida` + tarefa no Kommo |
| Botões (bookmarklets) | `ferramentas/cadastro-amigo/` (`node gerar-botoes.js`) | Link da ficha, Copiar ficha, Preencher cadastro (Amigo/DocSignature), Mensagem do exame, Confirmar consulta. Funcionam no Chrome e no Safari |
| Leitura de conversas com IA | `ferramentas/kommo-leitura-conversas/` | A skill, com config por cliente |
| Painel antigo + Netlify | `Blue Painel Comercial.dc.html`, `netlify.toml`, `src/scripts/snapshot.js`, `netlify/edge-functions/senha.js` | Publicação com senha; a ficha é pública por `excludedPath` |

Testes: `npm test`. Os 4 testes que falham (e2e do painel) esperam o mês de setembro; não têm relação com as peças acima.

## Números de setembro/2026 (já conferidos com a Letícia)
- 28 consultas pagas (27 Dr. Rafael + 1 Dr. Leonardo); Patrícia Balla conta em agosto.
- R$ 47,5 mil vendidos, R$ 28 mil recebidos. Mídia R$ 9.233 (Meta 6.903 + Google 2.330).
- CPL R$ 15,31 · CAC R$ 330 · ROAS 5,1x.
- Instagram: +3,8 mil seguidores, 1,1 mi visualizações, 444,5 mil de alcance.
- "Link da bio" = campanha de engajamento da Meta (paga).
- Nos relatórios não citar a queda do Google nem a demora nas respostas; o foco é nos resultados.

## Pendências abertas
- Publicar a Ficha Blue no **Cloudflare Pages** (escolha da Letícia, sem Netlify): passo a passo em `docs/ficha-blue-cloudflare.md` (`functions/`, `wrangler.toml`, `ficha/_redirects`). A versão Netlify (`netlify/functions/ficha*.mjs`) continua no código, mas não é a usada.
- Relatório diário automático: precisa de `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` e ID do Google Ads (Ads Script primeiro, sem aprovação).
- Rotacionar as chaves expostas em conversas do Kommo (Anthropic, e-mail, WordPress). Nunca usar essas chaves.
- Pendentes com a Letícia: data do pagamento da Daniela; valores de Larissa, Renata, Sandra e Helena; desfecho do cancelamento da Aline; apagar a regra de 48h no Kommo.

## Atualização 01/10/2026 (noite), para a sessão do Blue Intelligence OS
- **O repositório oficial agora é `growthblueclinica-re/blue-sistemas`, branch `main`** (mesmo histórico do kommoimplement).
  Troque o submódulo `vendor/kommoimplement` para ele (o commit `eb565fb` está bem atrasado):
  `git submodule set-url vendor/kommoimplement https://github.com/growthblueclinica-re/blue-sistemas && git submodule set-branch -b main vendor/kommoimplement && git submodule update --remote`.
- **Ficha Blue no Cloudflare Pages** (projeto `clinicablue`, publica sozinho a cada push na `main`):
  links fixos `https://clinicablue.pages.dev/lipedema|plastica[/es|/en]`, página da equipe `/equipe` (fichas recebidas, PDF para o prontuário),
  diagnóstico `/api/ficha-status`. A ficha vai para a nota do lead no Kommo (marcador `FICHA_BLUE_JSON:` com a ficha inteira em `_ficha`),
  etiqueta `ficha_recebida` (ou lead novo `ficha_sem_lead`) e tarefa. Guia: `docs/ficha-blue-cloudflare.md`.
- **Amigo: decisão da Letícia = cadastro pelo botão ✍️** (preenche tudo e alguém confere). `AMIGO_TOKEN` fica de fora; a API não aceita
  nascimento, RG, "como nos conheceu" nem anamnese/arquivos.
- **Botões novos:** 🧾 Agendamento (mensagem "consulta agendada" com o link da pré-consulta, texto do grupo de comprovantes, título/descrição
  do TimeTree, link do comprovante) e ✅ Confirmar consulta com conferência de pagamento (`ferramentas/cadastro-amigo/pagamento-consulta.js`,
  regra de valor: Rio R$ 1.800, SP R$ 2.200, Dr. Leonardo pelo valor da conversa).
- **Cache das transcrições de 30/09** (44 áudios + 217 extrações): entregue à Letícia como `cache-ia-30-09.zip` para colocar em `data/` do
  Blue OS. Nome de cada transcrição = id da mensagem no export do Kommo.
- O `KOMMO_TOKEN` colado no Cloudflare estava com texto a mais (6 mil caracteres, não começava com `eyJ`); a Letícia está trocando.
