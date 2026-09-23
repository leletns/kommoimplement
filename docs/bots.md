# Robôs do Kommo — boas-vindas + régua de follow-up (3 etapas)

A comercial (Maria) atende tudo pelo chat do Kommo. Os robôs só fazem duas coisas:
avisar que ela vai entrar em contato e, se a paciente parar de responder, retomar
com elegância, sem pressão. Quem fala é a **Alice**, na voz do Manual Comercial Blue:
"Não pressionamos. Não abandonamos. Entendemos, acolhemos e conduzimos."

## Onde cada robô fica no funil (Comercial 1 e Comercial 2)

| Etapa | Robô | O que acontece |
|---|---|---|
| **1. Novo · boas-vindas** | 🤖 **Alice · Boas-vindas** | Ao entrar o lead: mensagem da Alice + tarefa para a Maria (1 hora). Uma vez por lead. |
| **2. Qualificado** e **3. Interesse em agendar · Maria** | 🤖 **Alice · Porteiro** | 1 dia sem resposta da paciente → move para **3.1 Follow-up 1**. |
| **3.1 Follow-up 1 · dia 1** | 🤖 **Maria · Follow-up 1** | Mensagem de atenção. Respondeu → volta para a **3** (Maria). Sem resposta em 2 dias → **3.2**. |
| **3.2 Follow-up 2 · dia 3** | 🤖 **Maria · Follow-up 2** | Prova social + escolha fácil. Respondeu → **3**. Sem resposta em 4 dias → **3.3**. |
| **3.3 Follow-up 3 · dia 7** | 🤖 **Maria · Follow-up 3** | Última mensagem, sem pressão. Respondeu → **3**. Sem resposta em 5 dias → **8. Nutrição**. |
| 4 a 8 | nenhum | A Maria conduz |

## Robô 1 — Boas-vindas

> Oi! Que bom ter você aqui 💙
> Sou a Alice, assistente de relacionamento do Dr. Rafael Erthal.
>
> Pra te atender melhor, me conta:
> 1️⃣ Seu nome
> 2️⃣ Sua cidade
> 3️⃣ O que te trouxe até nós?
>
> Em breve a Maria, nossa consultora, fala com você 😊

Depois de enviar: adiciona a tag `boas_vindas_enviada` e cria a tarefa para a Maria
**"Responder nova paciente"** com prazo de 1 hora.

## Régua de follow-up (etapas 3.1, 3.2 e 3.3)

Os follow-ups falam **como a Maria**, em primeira pessoa, sem se apresentar: mensagens curtas que
**abrem uma curiosidade** e terminam com uma pergunta fácil de responder. Primeiro **atenção**
("posso te fazer uma pergunta?"), depois **identificação** (o que outras pacientes vivem) e, por fim,
a **despedida honesta com uma curiosidade aberta**, que costuma ser a que mais recebe resposta.
A Maria precisa ter a continuação pronta (abaixo de cada mensagem).

**Regra de ouro:** respondeu em qualquer momento → para a régua, volta para **3. Interesse em agendar · Maria**,
tag `fu_respondeu` e tarefa **"🔥 Paciente respondeu: responder AGORA"** (30 minutos).
Tem a tag `opt_out` ou a Maria marcou como perdido → a régua não manda nada.

### Follow-up 1 · dia 1 (atenção)
> Oi, {{contact.first_name}}! 💙
> Fiquei com uma coisa na cabeça depois da sua mensagem… posso te fazer uma pergunta rápida?

**Se responder, a Maria continua:** "Hoje, o que mais te incomoda: dor, peso nas pernas, o formato do corpo ou a pele?"

Sem resposta em 2 dias → **3.2 Follow-up 2**.

### Follow-up 2 · dia 3 (prova social + escolha fácil)
> {{contact.first_name}}, lembrei de você hoje 💙
> Muitas pacientes me contam que passaram anos ouvindo que era "só emagrecer"… e na avaliação descobriram que tinha outra explicação.
> Isso já aconteceu com você?

**Se responder, a Maria continua:** acolhe a história dela e explica que a consulta com o Dr. Rafael serve justamente para avaliar sintomas, histórico e exames com calma. Pergunta se prefere presencial ou online.

Sem resposta em 4 dias → **3.3 Follow-up 3**.

### Follow-up 3 · dia 7 (última mensagem)
> {{contact.first_name}}, vou parar de te mandar mensagem pra não ficar chata 😊
> Só não queria ir sem te contar uma coisa que pode fazer diferença pra você. Posso?

**Se responder, a Maria continua:** "Muita gente não sabe, mas dá para começar com uma avaliação online com o Dr. Rafael, sem sair de casa, e entender o seu caso com clareza antes de decidir qualquer coisa. Quer que eu veja um horário pra você?" (ajuste se a clínica não fizer avaliação online).

Sem resposta em 5 dias → **8. Nutrição · retomar depois** + tag `fu_sem_resposta` (não vai para perdido).

Os quatro textos também existem como templates de chat (`00 Alice · Boas-vindas` e `00 Maria · Follow-up …`), criados pelo
`organizarKommo.js --aplicar`, para a Maria usar manualmente quando quiser.

## Robôs para apagar

O que existe hoje (lido pela API em 23/09/2026):

| ID | Nome | Situação |
|---|---|---|
| 41020 | TestBot | **ativo**: apagar |
| 42554 | Robô de NPS | inativo: apagar (se não usam NPS) |
| 48344 | Teste ID Consulta SP | apagar |
| 52114 | Alice | apagar |
| 52508 | Alice copiar(1) | apagar |
| 52656 | Alice- bot-teste | apagar |
| 52688 | teste alice | apagar |
| 52690 | testebottt Alice v1 | apagar |
| 54516 | testev2alice | apagar |
| 54644 | Salesbot #2 | apagar |

Também: desligar o **Agente de IA "Clínica Blue"** (senão ele responde junto com os robôs)
e apagar a regra do funil que move para "Agendamento Confirmado" quem fica 48h sem mensagem
em "Qualificado" (ela infla os agendamentos).

## Prompt para o Claude no Chrome (com o Kommo aberto)

O Kommo não deixa criar robôs pela API (só pela tela). Cole este prompt no Claude do Chrome:

```
Você está no Kommo da Clínica Blue (comercialblueclinica.kommo.com). Vou criar 2 robôs (Salesbot)
nos funis "Comercial 1" e "Comercial 2". Siga na ordem e me mostre um resumo no final.

REGRAS
- Não envie mensagem manual para nenhuma paciente. Não apague leads, campos nem etapas.
- Copie os textos EXATAMENTE como estão abaixo (com os emojis e as quebras de linha).
- Onde aparece {{contact.first_name}}, use a variável "Nome do contato" do editor (ou digite igual).

1) ANTES DE CRIAR: abra Leads → funil "Comercial 1" → botão "Automatizar" (canto superior direito).
   Me liste todos os gatilhos/robôs de cada etapa. Na etapa "2. Qualificado", APAGUE a regra que
   move o lead para "Consulta agendada"/"Agendamento Confirmado" depois de 48 horas.
   Se na etapa "1. Novo · boas-vindas" já existir outro robô de boas-vindas, remova o gatilho dele
   (senão a paciente recebe duas mensagens). Desligue o "Agente de IA" se ele responder no WhatsApp.

2) ROBÔ "Alice · Boas-vindas"
   Onde: etapa "1. Novo · boas-vindas" → "+ Adicionar gatilho" → Salesbot → Criar novo bot.
   Passos no editor:
   a) Mensagem (texto exato):
      Oi! Que bom ter você aqui 💙
      Sou a Alice, assistente de relacionamento do Dr. Rafael Erthal.

      Pra te atender melhor, me conta:
      1️⃣ Seu nome
      2️⃣ Sua cidade
      3️⃣ O que te trouxe até nós?

      Em breve a Maria, nossa consultora, fala com você 😊
   b) Ação → Adicionar tag: boas_vindas_enviada
   c) Ação → Criar tarefa para a Maria: "Responder nova paciente", prazo 1 hora.
   Gatilho: "Quando o lead é criado ou movido para esta etapa", executar UMA vez por lead,
   imediatamente, em todos os canais (WhatsApp). Salve e ative.
   Repita no funil "Comercial 2" (mesmo bot, etapa "1. Novo · boas-vindas"; tarefa para a Mayra).

3) RÉGUA DE FOLLOW-UP (as etapas "3.1 Follow-up 1 · dia 1", "3.2 Follow-up 2 · dia 3" e
   "3.3 Follow-up 3 · dia 7" JÁ EXISTEM nos dois funis). Crie 4 robôs, nos dois funis:

   REGRA EM TODOS: se a paciente RESPONDER em qualquer momento → adicionar tag fu_respondeu,
   mover para "3. Interesse em agendar · Maria" e criar tarefa para a Maria
   "🔥 Paciente respondeu: responder AGORA" (prazo 30 minutos) → fim.
   Se o lead tiver a tag opt_out → não enviar nada.

   3a) "Alice · Porteiro" — etapas "2. Qualificado" e "3. Interesse em agendar · Maria".
       Gatilho: 1 dia depois de entrar na etapa (ou da última mensagem da equipe).
       Condição: se NÃO houve mensagem da paciente nesse período → mover para "3.1 Follow-up 1 · dia 1".
       Se houve → não fazer nada.

   3b) "Maria · Follow-up 1" — etapa "3.1 Follow-up 1 · dia 1". Gatilho: ao entrar na etapa.
       Mensagem (texto exato):
         Oi, {{contact.first_name}}! 💙
         Fiquei com uma coisa na cabeça depois da sua mensagem… posso te fazer uma pergunta rápida?
       Esperar resposta por 2 dias. Respondeu → REGRA acima. Não respondeu → mover para "3.2 Follow-up 2 · dia 3".

   3c) "Maria · Follow-up 2" — etapa "3.2 Follow-up 2 · dia 3". Gatilho: ao entrar na etapa.
       Mensagem (texto exato):
         {{contact.first_name}}, lembrei de você hoje 💙
         Muitas pacientes me contam que passaram anos ouvindo que era "só emagrecer"… e na avaliação descobriram que tinha outra explicação.
         Isso já aconteceu com você?
       Esperar resposta por 4 dias. Respondeu → REGRA acima. Não respondeu → mover para "3.3 Follow-up 3 · dia 7".

   3d) "Maria · Follow-up 3" — etapa "3.3 Follow-up 3 · dia 7". Gatilho: ao entrar na etapa.
       Mensagem (texto exato):
         {{contact.first_name}}, vou parar de te mandar mensagem pra não ficar chata 😊
         Só não queria ir sem te contar uma coisa que pode fazer diferença pra você. Posso?
       Esperar resposta por 5 dias. Respondeu → REGRA acima. Não respondeu → tag fu_sem_resposta e
       mover para "8. Nutrição · retomar depois".

   Em todos: enviar só em horário comercial (seg a sex, 9h–17h30) se o Kommo tiver essa opção,
   e executar UMA vez por lead em cada etapa.

4) TESTE: crie um lead de teste com o MEU número de WhatsApp no "Comercial 1", etapa
   "1. Novo · boas-vindas". Confira se chega só UMA mensagem de boas-vindas e se a tarefa foi criada.
   Depois mova o lead de teste para "Perdido" (não apague nada).

5) RESUMO: me mostre o que foi criado/removido em cada funil e qualquer passo que o Kommo não deixou fazer.
```

> Ordem recomendada: rode primeiro `node src/scripts/organizarKommo.js --aplicar` (renomeia as
> etapas) e depois este prompt. Se o Claude no Chrome for antes, ele usa os nomes atuais das
> etapas, e o organizador renomeia depois sem quebrar nada, porque os robôs ficam presos ao ID da etapa, não ao nome.
