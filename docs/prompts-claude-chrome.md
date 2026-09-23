# Prompts para o Claude no Chrome (extensão)

Como usar: abra a página certa no Chrome, clique no ícone do Claude, cole o prompt inteiro e deixe ele trabalhar.
Os três prompts param e pedem sua confirmação antes de gastar dinheiro ou publicar anúncio.

---

## 1. Kommo: organizar, automatizar e medir as conversas de hoje

Abra antes: https://comercialblueclinica.kommo.com/leads/pipeline/13604187

```
Você é analista comercial da Clínica Blue (cirurgia de lipedema e plástica, Dr. Rafael Mello Erthal).
Estou logado no Kommo: comercialblueclinica.kommo.com. Trabalhe só nesta aba.

REGRAS DE SEGURANÇA (obrigatórias)
- NUNCA envie mensagem para paciente, nem pelo chat, nem pelo robô. Só leia.
- NUNCA exclua lead, contato, campo, etapa ou robô.
- NUNCA mova lead para "Ganho", "4. Consulta agendada" ou "5. Consulta realizada": isso é feito só
  com comprovante de pagamento, por outra rotina.
- Se algo não estiver claro, anote no relatório e siga para o próximo lead.

COMO O KOMMO ESTÁ ORGANIZADO
Funis: "Comercial 1" (Maria) e "Comercial 2" (Mayra).
Etapas: 1. Novo · boas-vindas → 2. Qualificado → 3. Interesse em agendar · Maria →
4. Consulta agendada → 5. Consulta realizada → 6. Oportunidade cirúrgica → 7. Cirurgia confirmada →
8. Nutrição · retomar depois.
Campos do lead: "Classificação" (quente / morna / fria), "Objeção registrada", "Próxima Ação",
"Data Próxima Ação", "Resumo Alice Bot".

PARTE A: LAYOUT (faça uma vez)
1. No funil Comercial 1, abra as configurações de visualização do card e deixe visíveis só:
   nome, valor, Classificação, Próxima Ação, Data Próxima Ação e tags.
2. Crie estes filtros salvos (lista de leads → filtro → salvar):
   - "Hoje · responder": leads com mensagem recebida hoje e sem resposta.
   - "Quentes": Classificação = quente.
   - "Sem próxima ação": etapas 2 e 3 com "Data Próxima Ação" vazia.
3. Repita no funil Comercial 2.

PARTE B: PASSAR POR CADA CONVERSA DE HOJE
Abra "Bate-papos" (ícone de balão à esquerda) e filtre pelas conversas com mensagem recebida HOJE.
Para CADA conversa, uma de cada vez:
1. Clique e leia a conversa inteira de hoje (e o histórico, se precisar de contexto).
2. Conte quantas mensagens a PACIENTE mandou hoje.
3. Classifique:
   - QUENTE: pediu data, valor da consulta, forma de pagamento ou disse que quer agendar.
   - MORNA: tem interesse, mas ainda tem dúvida ou objeção.
   - FRIA: só curiosidade, sem resposta às perguntas, ou fora do perfil.
4. Se não agendou, qual foi o motivo (escolha um): preço · distância/mora longe · medo da cirurgia ·
   precisa falar com marido/família · sem tempo/agenda · plano de saúde/reembolso ·
   já tem outro médico · só pesquisando · parou de responder · outro (descreva).
5. Atualize o lead (abrir o card pela conversa):
   - "Classificação" com o que você decidiu;
   - "Objeção registrada" com o motivo (se tiver);
   - "Próxima Ação" + "Data Próxima Ação" (quente: hoje; morna: amanhã; fria: daqui a 3 dias);
   - uma NOTA começando com "📊 Análise do dia DD/MM:" com 2 linhas: o que a paciente quer e o
     que a Maria deve responder;
   - quente e está em "1. Novo" ou "2. Qualificado" → mover para "3. Interesse em agendar · Maria";
   - respondeu às perguntas e está em "1. Novo" → mover para "2. Qualificado";
   - pediu para não receber mais mensagem → tag "opt_out" e mover para "8. Nutrição".

PARTE C: RELATÓRIO FINAL (escreva na conversa comigo, em português simples)
1. Total de conversas com mensagem hoje e total de mensagens recebidas das pacientes.
2. Quantas quentes / mornas / frias.
3. Lista "PERTO DE AGENDAR": nome, telefone, o que falta para fechar, sugestão de próxima mensagem.
4. "POR QUE NÃO AGENDOU": motivos com quantidade, do mais comum para o menos comum.
5. "POR QUE NÃO CONVERTEU": leads que chegaram em "3. Interesse em agendar" e pararam, com o motivo.
6. Conversas sem resposta da equipe há mais de 2 horas (urgente).
7. 3 sugestões práticas para a Maria melhorar amanhã.
```

---

## 2. Meta Business Suite: anúncio do lipedefinition.com para cirurgiões e teto de R$ 6.000

Abra antes: https://adsmanager.facebook.com

```
Você é gestor de tráfego da Clínica Blue. Estou logado no Gerenciador de Anúncios da Meta.

REGRAS DE SEGURANÇA
- Antes de clicar em "Publicar" ou mudar qualquer orçamento, me mostre uma tabela
  "ANTES → DEPOIS" e ESPERE eu responder "pode publicar".
- Não exclua nenhuma campanha, conjunto ou anúncio. Para parar, use "Desativar".
- Não mude forma de pagamento nem dados da conta.

TAREFA 1: ANÚNCIO QUE LEVA PARA lipedefinition.com
1. Encontre as campanhas/anúncios cujo link de destino é lipedefinition.com (confira o URL de cada anúncio).
2. No conjunto de anúncios desse anúncio, ajuste o público para CIRURGIÕES:
   - Segmentação detalhada: cargos/interesses como "Cirurgião plástico", "Cirurgia plástica",
     "Médico", "Sociedade Brasileira de Cirurgia Plástica", "Congresso médico", "Lipoaspiração".
   - Idade 28 a 65, Brasil (e outros países só se já estavam na campanha).
   - Se a Meta não permitir segmentar por cargo, use os interesses acima e me avise.
   - Posicionamentos: Feed e Stories do Instagram e Facebook.
3. Confira se o texto do anúncio fala com médicos (técnica/curso para cirurgiões) e não com
   pacientes. Se estiver falando com paciente, sugira um texto novo e espere minha aprovação.

TAREFA 2: TETO DE R$ 6.000 NO MÊS (TODA A CONTA)
1. Liste todas as campanhas ATIVAS com orçamento diário ou total e o gasto do mês até hoje.
2. Calcule quanto sobra até R$ 6.000 no mês e divida pelos dias que faltam no mês.
3. Proponha novos orçamentos diários para que a SOMA de todas as campanhas não passe de R$ 6.000
   no mês, dando mais verba para quem tem o menor custo por conversa/lead.
4. Configure também o "Limite de gastos da conta" (Configurações de pagamento → Limite de gastos
   da conta) com o valor que falta até R$ 6.000 neste mês.
5. Me mostre a tabela ANTES → DEPOIS e espere o "pode publicar".

RELATÓRIO FINAL
- O que foi alterado, orçamento diário novo de cada campanha, gasto previsto no mês, e qualquer
  coisa que a Meta bloqueou.
```

---

## 3. Google Ads: no máximo R$ 50 por dia, só fundo de funil, site do Dr. Rafael no topo

Abra antes: https://ads.google.com

```
Você é gestor de Google Ads da Clínica Blue (Dr. Rafael Mello Erthal, cirurgia de lipedema).
Estou logado no Google Ads.

REGRAS DE SEGURANÇA
- Antes de salvar qualquer mudança de orçamento, lance ou palavra-chave, me mostre uma tabela
  "ANTES → DEPOIS" e ESPERE eu responder "pode salvar".
- Não exclua campanhas; para parar, use "Pausar".

OBJETIVO: gastar NO MÁXIMO R$ 50 por dia NA CONTA TODA, só com gente pronta para agendar,
e aparecer no topo da pesquisa com o site do Dr. Rafael.

1. ORÇAMENTO
   - Liste as campanhas ativas e o orçamento diário de cada uma.
   - Deixe a soma de todas em no máximo R$ 50/dia. Se tiver mais de uma, pause as de
     Display, Performance Max e YouTube e concentre em UMA campanha de Pesquisa.
2. SÓ FUNDO DE FUNIL (palavras-chave)
   - Mantenha/crie palavras com intenção de agendar, em correspondência de frase ou exata:
     "cirurgia de lipedema", "cirurgião de lipedema", "médico especialista em lipedema",
     "tratamento cirúrgico lipedema", "lipoaspiração para lipedema", "consulta lipedema",
     "cirurgia lipedema preço", "dr rafael erthal", "rafael mello erthal".
   - Pause palavras de pesquisa informativa (o que é lipedema, sintomas, grau, remédio, dieta, exercício).
   - Adicione palavras NEGATIVAS: o que é, sintomas, causa, grátis, sus, curso, vaga, emprego,
     pdf, artigo, tratamento natural, drenagem, remédio, dieta, exercício, fisioterapia.
   - Abra "Termos de pesquisa" dos últimos 30 dias e negative tudo que não é intenção de consulta/cirurgia.
3. SITE DO DR. RAFAEL NO TOPO
   - Os anúncios devem levar para o site do Dr. Rafael (me pergunte o endereço se não estiver
     claro nos anúncios atuais).
   - Estratégia de lance: "Parcela de impressões desejada" → "Parte superior absoluta da página",
     meta de 70% a 90%, com lance máximo de CPC que caiba nos R$ 50/dia (sugira o valor).
   - Anúncio responsivo: título 1 fixado "Dr. Rafael Mello Erthal · Lipedema"; use
     sitelinks (Agendar consulta, Sobre o Dr. Rafael, Cirurgia de lipedema, Depoimentos) e extensão
     de chamada/WhatsApp.
   - Localização: só pessoas que ESTÃO na região atendida (opção "Presença", não "Interesse").
   - Horário: priorize o horário comercial em que a equipe responde.
4. CONVERSÃO
   - Confira se existe conversão de "clique no WhatsApp"/"formulário". Se não existir, me avise.

RELATÓRIO FINAL
- Orçamento diário final, palavras mantidas/pausadas/negativadas, estratégia de lance, e o que
  não foi possível mudar.
```

---

## 4. WhatsApp Web: analisar as conversas de ontem e hoje e deixar como não lidas

Abra antes: https://web.whatsapp.com (já conectado no número da clínica)

```
Você é analista comercial da Clínica Blue (Dr. Rafael Erthal, lipedema e cirurgia plástica).
Estou no WhatsApp Web com o número da clínica. Trabalhe só nesta aba.

REGRAS DE SEGURANÇA (obrigatórias)
- NUNCA escreva, envie, encaminhe, reaja ou grave áudio. NÃO digite nada na caixa de mensagem.
- NUNCA apague, arquive, silencie, bloqueie ou fixe conversas. NUNCA mexa em "Aparelhos conectados".
- Só abra, leia e depois marque como não lida.

PASSO A PASSO
1. Na lista de conversas, considere todas com mensagem de ONTEM ou de HOJE (role a lista até
   chegar em conversas mais antigas que ontem e pare aí). Ignore grupos internos da equipe.
2. Para CADA conversa, uma de cada vez:
   a) Abra e leia as mensagens de ontem e de hoje (suba um pouco para entender o contexto).
   b) Anote: nome/telefone, quantas mensagens a paciente mandou, quantas a equipe mandou,
      horário da última mensagem da paciente e se ela está SEM RESPOSTA da equipe.
   c) Classifique:
      - QUENTE: pediu data, valor, forma de pagamento ou disse que quer agendar.
      - MORNA: tem interesse, mas tem dúvida ou objeção.
      - FRIA: só curiosidade, parou de responder ou fora do perfil.
      - JÁ PACIENTE: pós-consulta, pós-operatório, exame, retorno (não é venda).
   d) Se não agendou, o motivo principal: preço · distância · medo da cirurgia · falar com
      marido/família · sem tempo · plano de saúde/reembolso · já tem outro médico ·
      só pesquisando · parou de responder · demora da nossa resposta · outro (descreva).
   e) Avalie o atendimento da equipe (0 a 10): tempo de resposta, acolhimento, se fez perguntas,
      se conduziu para o agendamento, se tratou a objeção.
   f) VOLTE para a lista, clique com o botão direito na conversa (ou na setinha ao passar o mouse)
      e escolha "Marcar como não lida". Confira se a bolinha verde apareceu antes de seguir.
3. Ao terminar, confira que todas as conversas analisadas estão com a bolinha de não lida.

PARECER FINAL (escreva na conversa comigo, em português simples)
1. Números: total de conversas, mensagens recebidas das pacientes (ontem / hoje),
   mensagens enviadas pela equipe, conversas SEM RESPOSTA agora.
2. Quantas quentes / mornas / frias / já pacientes.
3. PRIORIDADE AGORA: tabela com nome, telefone, classificação, o que ela quer e a
   sugestão de mensagem para a Maria mandar (no tom da Alice: acolhedor, sem pressão).
4. POR QUE NÃO AGENDOU: motivos com quantidade, do mais comum ao menos comum.
5. POR QUE NÃO CONVERTEU: quem chegou perto (pediu valor/data) e travou, e onde travou.
6. Atendimento: nota média, tempo médio de resposta, 3 acertos e 3 erros com exemplos curtos.
7. 5 ações práticas para amanhã (ex.: mensagem pronta para a objeção mais comum).
```

> Atenção: ao abrir a conversa, a paciente pode ver os dois tiques azuis (lida). Se não quiser isso,
> antes de rodar desligue em WhatsApp → Configurações → Privacidade → **Confirmações de leitura**,
> e ligue de novo depois.
