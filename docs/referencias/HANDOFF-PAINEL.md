# Handoff: Painel Comercial Blue (CRM)

## Overview
Painel comercial da Clínica Blue. Lê dados do Kommo CRM por token (sem IA), grava num banco Postgres e mostra receita, conversão, funil e performance de cada comercial. Tem cadastro ilimitado de comerciais com upload real de foto de perfil.

Equipe atual: **Maria**, Comercial 1 · **Mayra**, Comercial 2.

## About the Design Files
Os arquivos em `design/` são **referências de design em HTML**: protótipos que mostram o visual e o comportamento esperados. Não são código de produção para copiar direto. A tarefa é **recriar este design numa aplicação real**. Se ainda não existir um repositório, use a stack recomendada abaixo.

Para abrir o protótipo: sirva a pasta `design/` com qualquer servidor estático (`npx serve design`) e abra `Blue Painel Comercial.dc.html`.

## Fidelity
**Alta fidelidade.** Cores, tipografia, espaçamento e interações são finais. Recrie pixel a pixel.

## Stack recomendada
- **Next.js 14** (App Router) + TypeScript
- **Supabase**: Postgres, Auth, Storage (fotos) e Edge Functions (sync cron)
- **Tailwind**, com os tokens desta página em `tailwind.config`
- Gráfico em SVG próprio ou **Recharts**, com a mesma estilização

A especificação completa de back-end (schema SQL, worker de sync com o Kommo, upload de foto, RLS, rotas da API e passos de implantação) está em **`INTEGRACAO-TECNICA.md`**. Siga esse arquivo à risca.

### Estrutura de repositório sugerida
```
/app
  /(painel)/page.tsx          Painel
  /equipe/page.tsx            Equipe (CRUD + foto)
  /conexoes/page.tsx          Conexões (status da sync)
  /api/...                    rotas da seção 5 do INTEGRACAO-TECNICA.md
/components                   KpiCard, RepCard, FunnelRow, WeeklyChart, Pill, Sidebar
/lib/supabase.ts
/supabase/migrations/*.sql    seção 2
/supabase/functions/sync-crm  seção 3
.env.example                  CRM_BASE_URL, CRM_LONG_LIVED_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```
O token do Kommo fica **somente no servidor** (Edge Function / secret). Ele nunca aparece na interface nem no bundle do cliente.

## Screens / Views

### Shell (todas as telas)
- Flex horizontal, `min-height:100vh`, fundo `#f6f8f9`, cor base `#17253d`, `letter-spacing:-0.03em` global.
- **Sidebar**: 230px, fundo `#ffffff`, `border-right:1px solid #e4e8eb`, padding 28px 18px, gap 34px, sticky com 100vh.
  - Wordmark "blue." em Montserrat 200, 32px, `#17253d`. O ponto final usa `#4b7da7`.
  - Legenda "PAINEL COMERCIAL": 11px, peso 500, tracking 0.16em, maiúsculas, `#5f7488`.
  - Navegação: Painel · Equipe · Conexões. Cada item tem 14px, peso 500, padding 11px 13px e raio 6px. Item ativo: fundo `#e9eff4` com texto `#17253d`. Inativo: fundo transparente com texto `#5f7488`.
  - Rodapé com card (`#fbfcfd`, borda `#e4e8eb`, raio 16px, padding 16px): ponto verde `#1c7a4a` + "Sincronização ativa" + "Última leitura às HH:MM · N registros".
- Abaixo de **900px de largura** a sidebar some e a navegação vira uma linha de pílulas no header, junto do wordmark (24px).
- **Header**: sticky, `rgba(255,255,255,0.9)` + `backdrop-filter: blur(14px)`, `border-bottom:1px solid #e4e8eb`, padding 16px 32px, flex-wrap, gap 14px.
  - Bloco de título: eyebrow de 11px em maiúsculas `#5f7488` (Período / Administração / Infraestrutura) e subtítulo de 18px, peso 500.
  - Somente no Painel: pílulas de período (Setembro / Agosto / Maio 2026), divisor de 1px e pílulas de etapa (Tudo / Consulta / Cirurgia).
  - À direita: horário + botão primário "Atualizar dados".

### 1. Painel
Container com padding 32px, `max-width:1560px` e gap vertical de 48px.
1. **Receita (hero)**: eyebrow "RECEITA DO PERÍODO"; valor em Playfair Display 400, 56px, line-height 1; sub-texto de 15px `#45566a` ("48 consultas e 11 cirurgias · ticket médio R$ 19.387"). À direita, pílula de variação (`#effaf4`, borda `#bfe3ce`, texto `#1c7a4a`, raio 999px).
2. **Grid de KPIs**: `repeat(auto-fit, minmax(215px,1fr))`, gap 14px. Sete cards: Leads gerados, APNs agendadas, Vendas fechadas, Consultas vendidas (CM1), Cirurgias vendidas (CM2), Investimento em mídia, CAC.
   - Card: `#ffffff`, borda `1px #e4e8eb`, raio 16px, padding 20px, gap 7px. No hover, a borda vai para `#b4c2cd` (160ms).
   - Label de 13px `#5f7488` · valor de 34px, peso 600 · sub-texto de 12.5px `#5f7488`.
   - Filtro de etapa: com "Consulta" ativo, o card de Cirurgia fica com `opacity:0.38`, e o inverso também.
3. **Gráfico + Velocidade** (flex-wrap, gap 14px):
   - Card do gráfico com `flex:3 1 440px`: título "Leads e vendas por semana" (16px, peso 500) e legenda. SVG com viewBox 700×240, grade horizontal em `#e4e8eb`, linha de leads `#4b7da7` com 2.5px e área a 10% de opacidade, linha de vendas `#1c7a4a` com 2.5px (escala própria). Rótulos dos eixos em 11px.
   - **Tooltip no hover** por semana: linha tracejada `#c3cfd9` e caixa `#17253d` com raio 6. Primeira linha "SEMANA N" em 11px `#c3cfd9`; segunda "X leads · Y vendas" em 13px, peso 600, branco. A caixa vira para a esquerda quando não cabe à direita.
   - Card de Velocidade com `flex:1 1 250px`: Ticket médio, Ciclo médio, Leads por comercial e Receita por lead. Label de 12px, valor de 24px/600, sub-texto de 12px, separador de 1px `#eef2f5`.
4. **Time comercial**: eyebrow, totais ("N leads · N vendas · R$ X em receita") e botão secundário "Gerenciar equipe", que abre a tela Equipe.
   - Grid `repeat(auto-fit, minmax(310px,1fr))`. Rep card: avatar circular de 46px (foto ou iniciais sobre `#e9eff4`), nome em 16px/500, função em 12.5px, receita em 19px/600 à direita.
   - Linha 1: Leads, APNs e Vendas em 22px/600. Linha 2 (com borda superior): Lead→APN e APN→Venda em `#3d6c95`, Lead→Venda em `#1c7a4a`, todos 15px/600.
   - Barra de participação: 5px, trilho `#eef2f5`, preenchimento `#4b7da7`, largura = receita ÷ maior receita.
   - Ordenação por receita, decrescente.
5. **Funil por etapa**: Leads → Qualificados → APNs → Consultas vendidas → Cirurgias vendidas. Cada linha é um grid `minmax(110px,190px) 1fr minmax(80px,150px)`. Trilho de 32px `#eef2f5`, barra `#3d6c95` com número branco; a última barra é `#5fd39a` com número `#0f3d27`. Barras abaixo de 20% da base mostram o número fora da barra. Sub-texto: "X% da etapa anterior".

### 2. Equipe
Padding 32px, `max-width:1100px`.
- Título "Equipe comercial" em Playfair 40px, descrição e botão primário "Nova comercial".
- **Formulário** (card): avatar de 92px com preview, botão "Enviar foto" (input file, `accept="image/*"`) e dica "JPG ou PNG, mínimo 200×200px". Campos: Nome, Função, E-mail corporativo e Funil atribuído (inputs brancos, borda `#dbe3e9`, raio 6px, padding 11px 13px, 14px). Ações: Salvar (primário) e Cancelar (texto).
  - Validação: o nome é obrigatório; sem ele aparece "Informe ao menos o nome".
- **Lista**: uma linha por comercial com avatar de 44px, nome/função, e-mail/funil e selo de status. "Vinculada" (verde `#1c7a4a`) aparece quando e-mail e funil estão preenchidos; caso contrário, "Pendente" (âmbar `#8a5e10`). Botões Editar e Remover (o hover do Remover fica vermelho `#c96a6a`).
- Em produção: Remover faz soft delete (`ativo=false`), a foto vai para o Storage (ver INTEGRACAO-TECNICA.md §4) e o campo "Funil atribuído" vira um select alimentado por `GET /api/v4/pipelines`, com um select extra de usuário do Kommo (`crm_user_id`).

### 3. Conexões
Três cards de status: CRM (pipeline comercial, leitura a cada 15 min), Banco analítico (materialização diária às 03h) e Armazenamento de mídia (upload imediato). Os dados reais vêm de `GET /api/sync/status`. **Não mostre token nem nome do fornecedor na UI.**

## Interactions & Behavior
- Todas as transições são de 140–160ms ease (borda, fundo e opacidade).
- Trocar o período refaz a busca de `/api/kpis`, `/performance`, `/funil` e `/serie` com `?competencia=YYYY-MM`.
- "Atualizar dados" dispara a sync sob demanda (`POST /api/sync/run`, protegida) e depois recarrega os dados.
- Estados vazios: comercial sem leads mostra 0 e as conversões mostram "—".
- Loading: use skeletons com as mesmas dimensões dos cards (fundo `#eef2f5`).

## State Management
- `period` ('YYYY-MM'), `stage` ('todas' | 'cm1' | 'cm2'), `nav`
- Dados do servidor (React Query / SWR): kpis, performance[], funil[], serie[], comerciais[], syncStatus
- Formulário da Equipe: `draft {id?, nome, funcao, email, pipeline_id, crm_user_id, foto_url}`, `formOpen`, `saving`, `error`
- No protótipo, o cadastro persiste em localStorage (`blue_dash_team_v1`). **Em produção, substitua pela API/Supabase.**

## Design Tokens
**Cores**
- Canvas `#f6f8f9` · Superfície `#ffffff` · Superfície suave `#fbfcfd`
- Bordas `#e4e8eb` · Hairline `#eef2f5` · Borda de input `#dbe3e9` · Borda outline `#c3cfd9` · Borda hover `#b4c2cd`
- Texto primário `#17253d` · Corpo `#45566a` · Secundário `#5f7488`
- Navy da marca `#284359` (botão primário e pílula ativa; hover `#17253d`)
- Azul de dados `#4b7da7` · Azul de dados escuro `#3d6c95` · Tinta ativa `#e9eff4`
- Sucesso `#1c7a4a` · Fundo de sucesso `#effaf4` · Borda de sucesso `#bfe3ce` · Barra de sucesso `#5fd39a` / `#0f3d27`
- Aviso `#8a5e10` · Perigo no hover `#c96a6a`
- Paleta da marca (manual): `#d1cebf` areia · `#e1e5e4` névoa · `#4b7da7` · `#a6bacb` · `#284359`

**Tipografia**: Montserrat (200–700) para UI e wordmark; Playfair Display 400 só na receita-hero e nos títulos de tela. Tracking global de -0.03em. Eyebrows usam +0.14/0.16em em maiúsculas.
Escala: 11 · 12 · 12.5 · 13 · 14 · 15 · 16 · 18 · 22 · 24 · 34 · 40 · 56 px.

**Raios**: botões e inputs 6px · cards 16px · pílulas e selos 999px · avatares 50%.
**Espaçamento**: gaps 6 / 10 / 14 / 16 / 18 / 22 / 28 / 48 · padding de card 20–24px · padding de página 32px.
**Sombras**: nenhuma. Profundidade só por borda e contraste de superfície.

## Assets
- Wordmark "blue.": tipográfico, sem arquivo. Substitua pelo SVG oficial se existir.
- Fotos de perfil: enviadas pelo usuário para o bucket `perfis`.
- Referências de marca em `referencias/` (manual PDF e guia de estilo MD).

## Files
- `design/Blue Painel Comercial.dc.html`: protótipo interativo (precisa de `support.js` ao lado)
- `INTEGRACAO-TECNICA.md`: back-end, banco, sync com o Kommo, upload e deploy
- `referencias/`: manual da marca e guia de estilo

## Prompt sugerido para o Claude Code
> Leia README.md e INTEGRACAO-TECNICA.md. Crie um repositório Next.js 14 + Supabase seguindo a estrutura sugerida, implemente as migrations, a Edge Function de sync com o Kommo (token via secret), o upload de foto no Storage e as três telas pixel a pixel conforme o protótipo em design/. Faça o seed com Maria (Comercial 1) e Mayra (Comercial 2). Faça commit e push para o GitHub.
