# Robôs do Kommo — só 2: boas-vindas e follow-up

A comercial (Maria) atende tudo pelo chat do Kommo. Os robôs só fazem duas coisas:
avisar que ela vai entrar em contato e, se a paciente parar de responder, retomar
com elegância, sem pressão. Quem fala é a **Alice**, na voz do Manual Comercial Blue:
"Não pressionamos. Não abandonamos. Entendemos, acolhemos e conduzimos."

## Onde cada robô fica no funil (Comercial 1 e Comercial 2)

| Etapa | Robô | Quando dispara |
|---|---|---|
| **1. Novo · boas-vindas** (é onde caem os leads novos do WhatsApp) | 🤖 **Boas-vindas** | Ao criar o lead / entrar na etapa. Uma vez por lead. |
| **2. Qualificado** e **3. Interesse em agendar · Maria** | 🤖 **Follow-up** | Lead há **2 dias** na etapa sem resposta da paciente |
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

## Robô 2 — Follow-up

1. **Dia 2**: envia
   > Oi, {{contact.first_name}}! Aqui é a Alice, do Dr. Rafael Erthal 💙
   > Posso pedir pra Maria te mandar os próximos horários de avaliação, presencial ou online?
   > É só responder SIM 😊

   Tag: `follow_up_day2`.
2. **Espera a resposta por até 3 dias.**
   - **Respondeu**: para o robô, adiciona a tag `follow_up_respondeu`, cria a tarefa para a Maria **"🔥 Paciente respondeu ao follow-up: mandar horários AGORA"** (prazo 30 minutos) e move o lead para **3. Interesse em agendar · Maria**.
   - **Não respondeu (dia 5)**: envia o último contato
     > Oi, {{contact.first_name}}! Vou deixar a porta aberta por aqui 💙
     > Quando quiser dar o primeiro passo, a avaliação com o Dr. Rafael é o caminho pra entender o seu caso com clareza e segurança.
     > É só responder QUERO que a Maria te chama 😊

     Tag: `follow_up_day5`. Move o lead para **8. Nutrição · retomar depois** (não para "Perdido": pelo manual, "vou pensar" não encerra a oportunidade).

Os três textos também existem como templates de chat (`00 Alice · …`), criados pelo
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

3) ROBÔ "Alice · Follow-up"
   Onde: etapas "2. Qualificado" e "3. Interesse em agendar · Maria" (as duas), do Comercial 1 e 2.
   Passos no editor:
   a) Condição: se a última mensagem da conversa foi da PACIENTE → parar (a Maria responde).
   b) Mensagem (texto exato):
      Oi, {{contact.first_name}}! Aqui é a Alice, do Dr. Rafael Erthal 💙
      Posso pedir pra Maria te mandar os próximos horários de avaliação, presencial ou online?
      É só responder SIM 😊
   c) Ação → Adicionar tag: follow_up_day2
   d) Esperar resposta por até 3 dias:
      • Se RESPONDEU: tag follow_up_respondeu + tarefa para a Maria
        "🔥 Paciente respondeu ao follow-up: mandar horários AGORA" (prazo 30 minutos) e mover o lead
        para "3. Interesse em agendar · Maria" → fim.
      • Se NÃO respondeu em 3 dias: enviar
          Oi, {{contact.first_name}}! Vou deixar a porta aberta por aqui 💙
          Quando quiser dar o primeiro passo, a avaliação com o Dr. Rafael é o caminho pra entender o seu caso com clareza e segurança.
          É só responder QUERO que a Maria te chama 😊
        depois: tag follow_up_day5 e mover o lead para a etapa "8. Nutrição · retomar depois" → fim.
   Gatilho: 2 dias depois de o lead entrar na etapa (atraso personalizado de 2 dias),
   UMA vez por lead. Se houver opção de "horário de funcionamento", use seg a sex 9h–17h30.
   Salve e ative.

4) TESTE: crie um lead de teste com o MEU número de WhatsApp no "Comercial 1", etapa
   "1. Novo · boas-vindas". Confira se chega só UMA mensagem de boas-vindas e se a tarefa foi criada.
   Depois mova o lead de teste para "Perdido" (não apague nada).

5) RESUMO: me mostre o que foi criado/removido em cada funil e qualquer passo que o Kommo não deixou fazer.
```

> Ordem recomendada: rode primeiro `node src/scripts/organizarKommo.js --aplicar` (renomeia as
> etapas) e depois este prompt. Se o Claude no Chrome for antes, ele usa os nomes atuais das
> etapas, e o organizador renomeia depois sem quebrar nada, porque os robôs ficam presos ao ID da etapa, não ao nome.
