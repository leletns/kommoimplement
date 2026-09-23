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

> Oi! Que alegria receber sua mensagem 💙
> Eu sou a Alice, assistente de relacionamento do Dr. Rafael Erthal, aqui na Clínica Blue.
>
> Pode ficar tranquila: por aqui a gente escuta com calma, sem pressa e sem julgamento.
>
> Para a Maria, nossa consultora, já chegar sabendo como cuidar de você, me conta rapidinho:
>
> 1️⃣ Como você gostaria de ser chamada?
> 2️⃣ De qual cidade você fala?
> 3️⃣ O que te trouxe até o Dr. Rafael? (lipedema, dor ou inchaço nas pernas, cirurgia plástica, contorno corporal…)
> 4️⃣ Você já tem diagnóstico de lipedema ou seria sua primeira avaliação?
>
> Pode responder do seu jeito, até por áudio 😊
> A Maria vai falar com você pessoalmente em breve (de segunda a sexta, das 9h às 17h30). 💙

Depois de enviar: adiciona a tag `boas_vindas_enviada` e cria a tarefa para a Maria
**"Responder nova paciente"** com prazo de 1 hora.

## Robô 2 — Follow-up

1. **Dia 2**: envia
   > Oi, {{contact.first_name}}! Aqui é a Alice, assistente de relacionamento do Dr. Rafael Erthal 💙
   > Passei só para saber como você está e se ficou alguma dúvida sobre a avaliação.
   >
   > Sem pressa, tá? Quando fizer sentido para você, a Maria vê os melhores horários na agenda do Dr. Rafael.

   Tag: `follow_up_day2`.
2. **Espera a resposta por até 3 dias.**
   - **Respondeu**: para o robô, adiciona a tag `follow_up_respondeu` e cria a tarefa para a Maria **"Paciente respondeu ao follow-up"** (prazo 1 hora).
   - **Não respondeu (dia 5)**: envia o último contato
     > Oi, {{contact.first_name}}, é a Alice, do Dr. Rafael Erthal 💙
     > Não quero ser inconveniente, então vou pausar nosso contato por aqui.
     >
     > Mas fica o recado: quando você quiser retomar, a gente vai estar aqui para te acolher, do ponto em que paramos. Um abraço carinhoso!

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

```
Você está na conta comercialblueclinica.kommo.com. Quero só 2 robôs (Salesbot) nos funis
"Comercial 1" e "Comercial 2". Siga na ordem e me mostre um resumo no final.

1) ANTES DE APAGAR QUALQUER COISA: vá em Leads > Automatizar (configuração do funil) do
   Comercial 1 e do Comercial 2 e me liste todos os gatilhos/robôs ligados a cada etapa.

2) DESLIGAR:
   - O Agente de IA "Clínica Blue".
   - No Comercial 1, a regra da etapa "Qualificado" (ou "2. Qualificado") que move o lead
     para "Agendamento Confirmado" após 48h sem mensagem. Apague essa regra.

3) CRIAR o robô "Alice · Boas-vindas" (editor visual do Salesbot):
   - Passo 1: enviar mensagem (texto exato):
     Oi! Que alegria receber sua mensagem 💙
     Eu sou a Alice, assistente de relacionamento do Dr. Rafael Erthal, aqui na Clínica Blue.

     Pode ficar tranquila: por aqui a gente escuta com calma, sem pressa e sem julgamento.

     Para a Maria, nossa consultora, já chegar sabendo como cuidar de você, me conta rapidinho:

     1️⃣ Como você gostaria de ser chamada?
     2️⃣ De qual cidade você fala?
     3️⃣ O que te trouxe até o Dr. Rafael? (lipedema, dor ou inchaço nas pernas, cirurgia plástica, contorno corporal…)
     4️⃣ Você já tem diagnóstico de lipedema ou seria sua primeira avaliação?

     Pode responder do seu jeito, até por áudio 😊
     A Maria vai falar com você pessoalmente em breve (de segunda a sexta, das 9h às 17h30). 💙
   - Passo 2: adicionar tag "boas_vindas_enviada".
   - Passo 3: criar tarefa para a Maria "Responder nova paciente", prazo 1 hora.
   - Gatilho: na etapa onde os leads novos do WhatsApp caem ("1. Novo · boas-vindas",
     hoje chamada "Qualificação Bot"), ao criar ou mover o lead para a etapa. Só uma vez por lead.
     Faça o mesmo no Comercial 2 (etapa "1. Novo · boas-vindas").

4) CRIAR o robô "Alice · Follow-up":
   - Passo 1: enviar:
     Oi, {{contact.first_name}}! Aqui é a Alice, assistente de relacionamento do Dr. Rafael Erthal 💙
     Passei só para saber como você está e se ficou alguma dúvida sobre a avaliação.

     Sem pressa, tá? Quando fizer sentido para você, a Maria vê os melhores horários na agenda do Dr. Rafael.
   - Passo 2: adicionar tag "follow_up_day2".
   - Passo 3: aguardar resposta por até 3 dias.
     • Se a paciente responder: adicionar tag "follow_up_respondeu", criar tarefa para a Maria
       "Paciente respondeu ao follow-up" (prazo 1 hora) e encerrar o robô.
     • Se não responder: enviar
       Oi, {{contact.first_name}}, é a Alice, do Dr. Rafael Erthal 💙
       Não quero ser inconveniente, então vou pausar nosso contato por aqui.

       Mas fica o recado: quando você quiser retomar, a gente vai estar aqui para te acolher, do ponto em que paramos. Um abraço carinhoso!
       depois adicionar tag "follow_up_day5" e mover o lead para a etapa "8. Nutrição · retomar depois"
       (se ainda não existir, use "Nutrição").
   - Gatilho: nas etapas "2. Qualificado" e "3. Interesse em agendar · Maria" (hoje "Qualificado"
     e "Em Negociação"), 2 dias após o lead entrar na etapa. Se houver a opção de
     "somente se não houver mensagem da paciente" ou "horário comercial", ative.
     Faça o mesmo no Comercial 2.

5) TESTAR: crie um lead de teste com o seu próprio número, confira se chega só a mensagem
   de boas-vindas (uma vez) e depois apague o lead de teste.

6) SÓ DEPOIS DO TESTE OK, APAGAR estes robôs: TestBot, Robô de NPS, Teste ID Consulta SP,
   Alice, Alice copiar(1), Alice- bot-teste, teste alice, testebottt Alice v1, testev2alice,
   Salesbot #2. Se algum estiver ligado a uma etapa, remova o gatilho antes.

Não altere leads, campos nem nomes de etapas além do que está acima.
```

> Ordem recomendada: rode primeiro `node src/scripts/organizarKommo.js --aplicar` (renomeia as
> etapas) e depois este prompt. Se o Claude no Chrome for antes, ele usa os nomes atuais das
> etapas, e o organizador renomeia depois sem quebrar nada, porque os robôs ficam presos ao ID da etapa, não ao nome.
