# Campos sugeridos por nicho

Tipos aceitos no config: `lista` (uma opção), `lista_multipla`, `texto`, `numero`, `sim_nao`.
Regra de ouro: **se o campo vai virar condição de robô ou filtro, use lista.**

## Base (vale para quase todo médico)

| chave | tipo | opções / instrução |
|---|---|---|
| consulta_para | lista | Própria pessoa · Mãe · Pai · Cônjuge · Filho(a) · Outro parente · Não informado |
| idade_paciente | numero | só se dita ou calculável pela data de nascimento |
| perguntou_plano_saude | sim_nao | perguntou convênio, plano ou reembolso |
| cidade | texto | "Cidade - UF" onde o paciente mora (usar campo existente se houver) |

## Medicina da dor / ortopedia (validado no primeiro cliente)

| chave | tipo | opções |
|---|---|---|
| queixa_principal | texto | máx. 10 palavras |
| ja_fez_cirurgia | lista | Sim · Não · Tem indicação de cirurgia · Não informado |
| cirurgia_regiao | lista_multipla | Joelho · Quadril · Coluna · Ombro · Pé / tornozelo · Mão / punho / cotovelo · Fêmur / perna (fratura) · Não ortopédica · Região não informada |
| cirurgia_tipo | lista_multipla | Prótese · Artroscopia / menisco · Ligamento (LCA / LCP) · Artrodese / cirurgia de coluna · Tendão / manguito · Fratura / trauma · Outra · Tipo não informado |

Regras extras úteis: região/tipo vazios se não operou; tipo só se dito; artrodese é só de coluna.

## Cirurgia plástica

| chave | tipo | opções |
|---|---|---|
| procedimento_interesse | lista_multipla | Lipo / Lipo HD · Abdominoplastia · Mama (prótese / mastopexia / redução) · Face (rino / blefaro / lifting) · Lipedema · Outro · Não informado |
| ja_operou | lista | Sim · Não · Não informado |
| prazo_cirurgia | lista | Até 3 meses · 3 a 6 meses · Mais de 6 meses · Não informado |
| perguntou_parcelamento | sim_nao | parcelas, financiamento, forma de pagamento |
| pediu_orcamento_whatsapp | sim_nao | pediu valor da cirurgia antes da consulta |

Regra extra: procedimento só o que o paciente disse querer, não o que a equipe ofereceu.

## Dermatologia / estética

| chave | tipo | opções |
|---|---|---|
| queixa_estetica | lista_multipla | Manchas / melasma · Acne · Flacidez · Rugas · Cabelo / queda · Gordura localizada · Outro · Não informado |
| ja_fez_procedimento | lista | Sim · Não · Não informado |
| interesse_tipo | lista | Consulta · Procedimento específico · Não informado |

## Odontologia

| chave | tipo | opções |
|---|---|---|
| tratamento_interesse | lista_multipla | Implante · Lente / faceta · Ortodontia / alinhador · Prótese · Clareamento · Dor / urgência · Outro · Não informado |
| urgencia | sim_nao | dor ou urgência agora |

## Campos comerciais (qualquer nicho)

| chave | tipo | opções |
|---|---|---|
| objecao_principal | lista | Valor · Convênio · Distância / agenda · Decisão com família · Medo / insegurança · Sumiu sem objeção · Não informado |
| horario_oferecido | sim_nao | a equipe ofereceu dia e horário concretos |
| origem_declarada | lista | Instagram · Anúncio · Indicação · Google · Não informado |

> `objecao_principal` como **lista** (não texto) permite montar robô de repescagem por objeção. No modo `--completo` a nota traz a objeção em texto livre também.
