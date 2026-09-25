# Robôs do Kommo — boas-vindas + régua de follow-up (3 etapas)

A comercial (Maria) atende tudo pelo chat do Kommo. Os robôs só fazem duas coisas:
avisar que ela vai entrar em contato e, se a paciente parar de responder, retomar
com elegância, sem pressão. Quem fala é a **Alice**, na voz do Manual Comercial Blue:
"Não pressionamos. Não abandonamos. Entendemos, acolhemos e conduzimos."

## Onde cada robô fica no funil (Comercial 1 e Comercial 2)

| Etapa | Quem cuida | O que acontece |
|---|---|---|
| **1. Novo · boas-vindas** | 🤖 robô **Alice · Boas-vindas** | Ao entrar o lead: mensagem da Alice + tarefa para a Maria (1 hora). Uma vez por lead. |
| **2. Qualificado** e **3. Interesse em agendar · Maria** | ⚙️ automação (15 em 15 min) | Conversa parada há 1 dia (última mensagem foi nossa) → **3.2 Follow-up 1**. |
| **3.1 Retomar depois · Maria** | ⚙️ automação | Sem data → "Data Próxima Ação" daqui a 30 dias. Chegou a data → volta para a **3** com tarefa "Retomar contato hoje" e mensagem sugerida (IA). |
| **3.2 Follow-up 1 · dia 1** | 🤖 robô **Maria · Follow-up 1** + ⚙️ | A automação escreve a mensagem da paciente (IA) e o robô envia ao entrar. Sem resposta em 2 dias → **3.3**. |
| **3.3 Follow-up 2 · dia 3** | 🤖 robô **Maria · Follow-up 2** + ⚙️ | Idem, com a mensagem do follow-up 2. Sem resposta em 4 dias → **3.4**. |
| **3.4 Follow-up 3 · dia 7** | 🤖 robô **Maria · Follow-up 3** + ⚙️ | Idem, com a mensagem do follow-up 3. Sem resposta em 5 dias → **3.1 Retomar depois** (+30 dias). |
| Qualquer etapa aberta | ⚙️ automação | Última mensagem é da paciente → tag `aguardando_resposta` + tarefa "Responder paciente". Respondeu em 3.1–3.4 → volta para a **3** com a resposta pronta na nota. A equipe respondeu → tira a tag e conclui a tarefa. |
| 4 a 7 | a Maria | |

A automação (⚙️) é o `src/services/automacaoMaria.js`, que roda sozinho no Netlify a cada 15 minutos
(ou `node src/scripts/automacaoMaria.js --aplicar`). Os robôs do Kommo só enviam as mensagens.

**Follow-up com IA (quem fala é a Maria, não a Alice):** a cada passo da régua a automação escreve,
para aquela paciente, uma mensagem nova a partir da mensagem aprovada + o que o CRM sabe dela
(resumo, objeção, classificação) e grava no campo **"Follow-up · mensagem"**; o robô da etapa envia.
Trava de segurança: se a IA escrever algo proibido (promessa, diagnóstico, preço, urgência, link,
texto longo) ou estiver fora do ar, vai a mensagem aprovada. IA grátis: `GEMINI_API_KEY` (Google AI Studio);
paga: `ANTHROPIC_API_KEY`. Sem nenhuma chave, vai sempre a aprovada. No Gemini grátis não enviamos dados de saúde.

## Robô 1 — Boas-vindas

> Oi, {{contact.first_name}}! Que bom ter você aqui 💙
> Sou a Alice, assistente de relacionamento do Dr. Rafael Erthal.
>
> Em breve a nossa consultora Maria vai te atender. Enquanto isso, pode ir adiantando:
> 1️⃣ Qual é o objetivo da sua consulta?
> 2️⃣ Como podemos te ajudar?

Depois de enviar: adiciona a tag `boas_vindas_enviada` e cria a tarefa para a Maria
**"Responder nova paciente"** com prazo de 1 hora.

## Régua de follow-up (etapas 3.2, 3.3 e 3.4)

A régua é de **resgate**: a paciente já conversou com a Maria e parou de responder. Os follow-ups
falam **como a Maria** (SDR), em primeira pessoa, sem se apresentar: curtos, profissionais e cada um
**abre uma curiosidade** ("separei uma informação", "a resposta costuma surpreender", "uma última
informação") que só se resolve se ela responder. Terminam com um "sim" fácil.
A Maria precisa ter a continuação pronta (abaixo de cada mensagem).

**Regra de ouro:** respondeu em qualquer momento → para a régua, volta para **3. Interesse em agendar · Maria**,
tag `fu_respondeu`, tarefa **"Responder paciente"** (30 minutos) e a resposta pronta na nota do lead.
Tem a tag `opt_out` ou a Maria marcou como perdido → a régua não manda nada.

### Follow-up 1 · dia 1 (resgate: "separei uma informação")
> Oi, {{contact.first_name}}! Retomando nossa conversa: separei uma informação sobre a avaliação que pode te ajudar a decidir o próximo passo.
> Posso te mandar?

**Se responder, a Maria continua:** "Na avaliação, o Dr. Rafael analisa seus sintomas, histórico e exames e te diz com clareza qual é o melhor caminho para o seu caso. É o passo que tira a dúvida de vez. Você prefere presencial ou online?"

Sem resposta em 2 dias → **3.3 Follow-up 2**.

### Follow-up 2 · dia 3 (curiosidade: a dúvida que toda paciente tem)
> {{contact.first_name}}, uma dúvida que quase toda paciente tem nessa fase é se realmente vai precisar de cirurgia ou se existe outro caminho. A resposta costuma surpreender.
> Quer que eu te explique como o Dr. Rafael avalia isso?

**Se responder, a Maria continua:** "Nem toda paciente precisa operar no primeiro momento. Só a avaliação individualizada confirma o diagnóstico e a melhor conduta, e é isso que o Dr. Rafael faz na consulta, com calma. Quer que eu veja um horário pra você?"

Sem resposta em 4 dias → **3.4 Follow-up 3**.

### Follow-up 3 · dia 7 (última informação antes de encerrar)
> {{contact.first_name}}, antes de encerrar seu atendimento, tenho uma última informação que pode facilitar a sua decisão.
> Te mando?

**Se responder, a Maria continua:** mostra o que facilita: formas de pagamento da consulta, opção de avaliação online para quem mora longe e o que a consulta inclui. Em seguida, 2 ou 3 opções de horário.

Sem resposta em 5 dias → **3.1 Retomar depois · Maria** + tag `fu_sem_resposta`, com retorno automático em 30 dias (não vai para perdido).

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
Você está no Kommo da Clínica Blue (comercialblueclinica.kommo.com). Vou criar 4 robôs (Salesbot)
nos funis "Comercial 1" e "Comercial 2": boas-vindas e 3 follow-ups. Siga na ordem e me mostre um resumo no final.

REGRAS
- Não envie mensagem manual para nenhuma paciente. Não apague leads, campos nem etapas.
- Copie os textos EXATAMENTE como estão abaixo (com os emojis e as quebras de linha).
- Onde aparece {{contact.first_name}}, use a variável "Nome do contato" do editor (ou digite igual).

1) ANTES DE CRIAR: abra Leads → funil "Comercial 1" → botão "Automatizar" (canto superior direito).
   Me liste todos os gatilhos/robôs de cada etapa. Na etapa "2. Qualificado", APAGUE a regra que
   move o lead para "Consulta agendada"/"Agendamento Confirmado" depois de 48 horas.
   Se na etapa "1. Novo · boas-vindas" já existir outro robô de boas-vindas, remova o gatilho dele
   (senão a paciente recebe duas mensagens). Desligue o "Agente de IA" se ele responder no WhatsApp.
   Procure de onde sai a mensagem "Olá! Obrigado por entrar em contato conosco. Entraremos em contato
   com você em breve." e DESLIGUE/APAGUE essa mensagem. Lugares prováveis: o robô "TestBot" (é o único
   robô ativo: desative), Configurações → Canais/Chats → WhatsApp → resposta automática / mensagem de
   boas-vindas / fora do horário. Me diga onde estava.

2) ROBÔ "Alice · Boas-vindas"
   Onde: etapa "1. Novo · boas-vindas" → "+ Adicionar gatilho" → Salesbot → Criar novo bot.
   Passos no editor:
   a) Mensagem (texto exato):
      Oi, {{contact.first_name}}! Que bom ter você aqui 💙
      Sou a Alice, assistente de relacionamento do Dr. Rafael Erthal.

      Em breve a nossa consultora Maria vai te atender. Enquanto isso, pode ir adiantando:
      1️⃣ Qual é o objetivo da sua consulta?
      2️⃣ Como podemos te ajudar?
   b) Ação → Adicionar tag: boas_vindas_enviada
   c) Ação → Criar tarefa para a Maria: "Responder nova paciente", prazo 1 hora.
   Gatilho: "Quando o lead é criado ou movido para esta etapa", executar UMA vez por lead,
   imediatamente, em todos os canais (WhatsApp). Salve e ative.
   Repita no funil "Comercial 2" (mesmo bot, etapa "1. Novo · boas-vindas"; tarefa para a Mayra).

3) ROBÔS DA RÉGUA DE FOLLOW-UP. As etapas "3.2 Follow-up 1 · dia 1", "3.3 Follow-up 2 · dia 3" e
   "3.4 Follow-up 3 · dia 7" JÁ EXISTEM nos dois funis. Uma automação externa move os leads entre elas,
   devolve para a Maria quem responder e ESCREVE a mensagem de cada paciente no campo do lead
   "Follow-up · mensagem" (feita sob medida por IA, já revisada por regras de segurança).
   Os robôs SÓ enviam esse campo. Crie 3 robôs, nos dois funis, gatilho "ao entrar na etapa",
   uma vez por lead. Se o lead tiver a tag opt_out, não enviar.

   Cada robô tem 2 passos:
   a) Condição: o campo "Follow-up · mensagem" está preenchido?
   b) SIM → Mensagem com a variável do campo "Follow-up · mensagem" (no editor: inserir variável →
      Lead → Follow-up · mensagem; aparece como {{lead.cf.3839858}}).
      NÃO → Mensagem fixa (texto exato abaixo).

   3a) "Maria · Follow-up 1" — etapa "3.2 Follow-up 1 · dia 1". Texto fixo:
         Oi, {{contact.first_name}}! Retomando nossa conversa: separei uma informação sobre a avaliação que pode te ajudar a decidir o próximo passo.
         Posso te mandar?

   3b) "Maria · Follow-up 2" — etapa "3.3 Follow-up 2 · dia 3". Texto fixo:
         {{contact.first_name}}, uma dúvida que quase toda paciente tem nessa fase é se realmente vai precisar de cirurgia ou se existe outro caminho. A resposta costuma surpreender.
         Quer que eu te explique como o Dr. Rafael avalia isso?

   3c) "Maria · Follow-up 3" — etapa "3.4 Follow-up 3 · dia 7". Texto fixo:
         {{contact.first_name}}, antes de encerrar seu atendimento, tenho uma última informação que pode facilitar a sua decisão.
         Te mando?

   Se o Kommo tiver a opção de horário comercial, use seg a sex, 9h–17h30.
   NÃO crie regras de "mover etapa" nem de "esperar resposta": isso já é automático.

4) TESTE: crie um lead de teste com o MEU número de WhatsApp no "Comercial 1", etapa
   "1. Novo · boas-vindas". Confira se chega só UMA mensagem de boas-vindas e se a tarefa foi criada.
   Depois mova o mesmo lead para "3.2 Follow-up 1 · dia 1" e confira se chega a mensagem do
   follow-up 1. Eu respondo pelo celular: em até 15 minutos o lead volta sozinho para
   "3. Interesse em agendar · Maria" com a tarefa "Responder paciente".
   No fim, mova o lead de teste para "Perdido" (não apague nada).

5) SÓ DEPOIS DO TESTE OK, APAGAR os robôs antigos: TestBot, Robô de NPS, Teste ID Consulta SP,
   Alice, Alice copiar(1), Alice- bot-teste, teste alice, testebottt Alice v1, testev2alice,
   Salesbot #2. Se algum estiver ligado a uma etapa, remova o gatilho antes.

6) RESUMO: me mostre o que foi criado/removido em cada funil e qualquer passo que o Kommo não deixou fazer.
```

> Ordem recomendada: rode primeiro `node src/scripts/organizarKommo.js --aplicar` (renomeia as
> etapas) e depois este prompt. Se o Claude no Chrome for antes, ele usa os nomes atuais das
> etapas, e o organizador renomeia depois sem quebrar nada, porque os robôs ficam presos ao ID da etapa, não ao nome.
