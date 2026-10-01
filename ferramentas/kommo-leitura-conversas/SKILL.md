---
name: kommo-leitura-conversas
description: >-
  Lê as conversas de WhatsApp dos leads no Kommo (texto + áudios transcritos),
  extrai informações com IA e grava em campos do CRM — em lote, por etapa do
  funil, para qualquer cliente/médico da agência. Acione quando o usuário
  quiser "analisar as conversas dos leads", "preencher campos com IA",
  "categorizar leads", "mapear quem é o paciente / qual a dor / se perguntou
  convênio", "transcrever os áudios do Kommo", "rodar a IA na etapa X",
  "fazer igual fizemos no primeiro cliente em outra conta", ou pedir para extrair
  qualquer dado das conversas (procedimento de interesse, objeção, prazo,
  parcelamento, cidade, idade) e gravar no Kommo. Serve para médico da dor,
  cirurgião plástico, dermato, odonto etc. — o que muda fica num config JSON.
  NÃO use para analisar a QUALIDADE do atendimento de uma conversa específica
  (isso é leitura consultiva, sem gravar campos) nem para Clint/TalkMi.
---

# Leitura de conversas do Kommo → campos com IA

Transforma o histórico de WhatsApp de centenas de leads em campos filtráveis no Kommo (ex.: "Consulta para: Mãe", "Queixa: artrose no joelho", "Perguntou plano: Sim"), para segmentar robôs, repescagem e análise comercial.

**Tudo que muda por cliente fica em `configs/<cliente>.json`.** O script `scripts/kommo_ia.py` não precisa ser editado.

## Como funciona (em uma frase por etapa)

1. **Lista os leads** da etapa pela API oficial do Kommo (token long-lived).
2. **Busca a conversa** pela API *privada* que a tela do Kommo usa (`/ajax/v3/leads/{id}/events_timeline`) — ela devolve texto, autor e link dos áudios, mas **só aceita a sessão de alguém logado**. Por isso o script usa um navegador próprio (Playwright) onde o usuário faz login à mão, uma vez. Também lê os leads antigos do mesmo contato.
3. **Baixa os áudios** pelo link da mídia com o token oficial e **transcreve** (OpenAI).
4. **Extrai os campos** com um modelo OpenAI em JSON estrito (o esquema é gerado a partir do config).
5. **Grava** pela API oficial, **só em campos vazios**. Planilha + custo no fim.

Custo e tempo de referência (primeiro cliente, set/2026): modo econômico ~US$0,003/lead, ~7 s/lead. Buscar conversa no Kommo é grátis. Detalhes e armadilhas: `references/processo-e-armadilhas.md`.

## Processo para um cliente novo (siga em ordem)

### 1. Levantar o briefing
Pergunte só o que faltar:
- Cliente, subdomínio Kommo, onde está o token no VPS (`/root/.<cliente>_kommo_token`).
- Especialidade e endereço da clínica (o endereço evita confundir com a cidade do paciente).
- **Quais informações quer extrair** e para que vão servir (robô, filtro, relatório). Campo sem uso não entra.
- Funil e etapas a processar.

### 2. Desenhar os campos
Use `references/campos-por-nicho.md` como ponto de partida. Regras de desenho:
- **Se vai virar condição de robô → `lista` ou `lista_multipla`**, nunca texto livre (texto não filtra).
- Sempre incluir uma opção "Não informado" nas listas.
- Um campo com `"marca_processado": true` (normalmente o primeiro) serve para pular leads já feitos.
- Campo que já existe no Kommo (ex.: cidade) entra com o `nome_kommo` exato dele e só é preenchido se vazio.
- **Mostre a lista final de campos ao usuário e peça confirmação** antes de criar qualquer coisa no Kommo.

### 3. Montar o config
Copie `configs/modelo-cirurgia-plastica.json` (ou `configs/<cliente>.json`) para `configs/<cliente>.json`. Levante pela API oficial: `pipeline_id`, IDs das etapas (`/leads/pipelines/{id}`) e usuários (`/users`). Ajuste `contexto`, `endereco_clinica`, `termos_transcricao` e `regras_extra` do nicho.

### 4. Criar campos, logar, testar
```bash
S=~/.claude/skills/kommo-leitura-conversas/scripts/kommo_ia.py
C=~/.claude/skills/kommo-leitura-conversas/configs/<cliente>.json
python3 $S setup --config $C            # lista o que falta
python3 $S setup --config $C --criar    # só depois do OK do usuário (cria campos + grupo)
python3 $S login --config $C            # usuário faz login na janela (nunca digite a senha)
python3 $S run --config $C --ids <5 leads com conversa e áudio>     # simulação, não grava
```
Leia a planilha da simulação com o usuário. Ajuste `regras_extra`/opções se algo sair errado e rode de novo.

### 5. Rodar em escala
```bash
python3 $S run --config $C --etapa negociacao --limit 10 --write     # conferir no Kommo
python3 $S run --config $C --etapa negociacao --write --skip-done    # etapa inteira (rodar em background)
```
Use `--completo` só quando o usuário quiser a **nota de resumo** (tempo de dor, objeção, quem decide, horário oferecido, sinal de alerta, próximo passo) — custa ~6× mais.

### 6. Entregar
Resumo em tabela (distribuição de cada campo), o custo estimado da planilha e o link da planilha. Aponte achados acionáveis (ex.: "45% da qualificação não contou a dor", "1 em 3 perguntou convênio").

## Regras que não se negociam
- **Nunca digitar senha** do Kommo — o usuário faz o login na janela do Playwright.
- **Criar campos/grupos no Kommo altera a conta** → confirmar a lista com o usuário antes.
- **Nunca sobrescrever** campo preenchido (o script já garante) e sempre **simular antes de gravar**.
- **Não contornar o limite de requisições** do Kommo (7 req/s) com tokens/IPs extras — risco de bloqueio da conta. Acelerar é paralelizar a parte da OpenAI.
- Conversas são dados de pacientes: planilhas ficam na pasta de dados local, não publicar em artifact sem anonimizar.
- Se o script parar por sessão expirada → `login` de novo. Por falta de crédito → avisar o usuário (não trocar de provedor sem perguntar).

## Arquivos
- `scripts/kommo_ia.py` — setup / login / run (genérico).
- `configs/<cliente>.json` — config real, validado (medicina da dor).
- `configs/modelo-cirurgia-plastica.json` — modelo para outro nicho.
- `references/campos-por-nicho.md` — sugestões de campos por especialidade.
- `references/processo-e-armadilhas.md` — como a extração foi descoberta, limites, custos, erros já resolvidos.
