# FINANCIAL_CONTROL_SAFARI_REPORT

Botão **💰 Controle financeiro**: conciliação de comprovantes da gestão. Data: 05/10/2026.

Legenda:
- ✅ **testado e funcionando** (teste automatizado ou execução real descrita);
- 🟡 **implementado, mas não validado no ambiente final**;
- ⛔ **depende de autorização/ação sua**.

---

## 1. Arquitetura (a mesma do botão anterior)

**O botão anterior** ("📋 Copiar ficha" / "✍️ Preencher cadastro"):
- É um **favorito com `javascript:`** (bookmarklet), gerado por `ferramentas/cadastro-amigo/gerar-botoes.js` e instalado arrastando-o da página `instalar-botoes.html` para a barra de favoritos do Safari.
- Ao clicar, ele roda **na página aberta**: lê a tela (DOM) e mostra um painel fixo no canto.
- Ele fala com o servidor da clínica (Cloudflare Pages + Functions + D1) com uma senha no cabeçalho.
- Não salva nada sozinho.

**O novo botão** segue exatamente esse padrão:
- **Mesmo gerador:** `gerar-botoes.js` agora também gera `bookmarklet-controle-financeiro.txt`, numa **página de instalação separada, só da gestão**: `instalar-botao-financeiro.html`.
- **Mesmo painel fixo:** mesmo visual, na cor verde.
- **Mesmo servidor:** Cloudflare Pages, novas rotas `/financeiro` e `/api/financeiro`.

**Separação da Comercial 1 e da Ficha Blue:**
- senha própria (`FINANCEIRO_SENHA`);
- tabelas próprias (`fin_conciliacoes`, `fin_lancamentos`);
- não lê nem grava fichas;
- não aparece na página de botões da Comercial.

✅ **Os botões antigos não mudaram.** O MD5 de todos os `bookmarklet-*.txt` e de `instalar-botoes.html` antes e depois da mudança é idêntico.

## 2. Arquivos

| Arquivo | O que é |
|---|---|
| `ferramentas/cadastro-amigo/controle-financeiro.js` | código do botão (WhatsApp Web, AmigoApp e outros sites) |
| `ferramentas/cadastro-amigo/gerar-botoes.js` (alterado) | gera o novo botão e a página de instalação da gestão |
| `ferramentas/cadastro-amigo/bookmarklet-controle-financeiro.txt`, `instalar-botao-financeiro.html` | botão gerado e página para arrastar ao Safari |
| `ficha/financeiro.html`, `ficha/js/financeiro.js` | página Controle financeiro (OCR, conciliação, confirmação, lista) |
| `ficha/js/comprovante.js` | leitura do comprovante (texto → dados) e validação contra a paciente |
| `functions/api/financeiro.js`, `functions/_lib/financeiro.js` | API, banco D1, duplicidade e envio à planilha |
| `ferramentas/financeiro/planilha-apps-script.gs` | código da planilha (Google Sheets) |
| `ferramentas/financeiro/LEIA-ME.md` | instalação passo a passo |
| `test/comprovante.test.js` | 9 testes do leitor e da validação |
| `test/e2e/financeiro.e2e.js`, `test/e2e/planilha-emulador.js`, `test/fixtures/comprovantes/*` | teste de ponta a ponta e comprovantes de teste (fictícios) |

## 3. Como funciona

### 3.1 WhatsApp Web

Os cabeçalhos do web.whatsapp.com foram verificados em 05/10:
- **CSP** `connect-src` bloqueia qualquer chamada a outro site e `script-src` bloqueia bibliotecas externas;
- **COOP `same-origin`** isola as janelas abertas.

Por isso, o botão **não tenta** chamar o servidor de dentro do WhatsApp. Ele faz assim:
1. Lista as **imagens da conversa aberta**: as fotos do WhatsApp são `blob:` e ficam de fora ícones, figurinhas e fotos de perfil. A imagem aberta no visualizador aparece primeiro.
2. Ao clicar no comprovante:
   - converte a imagem para PNG e **copia para a área de transferência**. No Safari, isso usa `ClipboardItem` com Promise, o que mantém o clique válido;
   - abre a página **Controle financeiro**.
3. Na página, a gestão aperta **⌘V**.
4. Se o navegador não deixar copiar, o botão **baixa o arquivo** para arrastar na página.
5. PDF que chegou pelo WhatsApp: baixar e arrastar na página.

### 3.2 Leitura do comprovante (OCR → dados)

- **Imagem:** o OCR é o **tesseract.js 5, em português**, e roda **no navegador da gestão**: a imagem não é enviada a nenhum serviço externo. Antes, a imagem é ampliada para melhorar a leitura.
- **PDF de banco:** a leitura é pelo **texto do PDF** (pdf.js). Se o PDF for só imagem, ele é desenhado e passa pelo OCR.
- **Texto → dados** (`comprovante.js`):
  - valor e moeda;
  - data, aceitando `05/10/2026`, `05 OUT 2026` e `5 de outubro de 2026`;
  - hora;
  - forma: Pix, TED, DOC, boleto, cartão de crédito ou débito;
  - banco do pagador, entre 21 instituições;
  - pagador e CPF mascarado;
  - recebedor e instituição recebedora;
  - **ID da transação**: o ID fim a fim do Pix (32 caracteres) ou autenticação/NSU.
- **Erros típicos do OCR são corrigidos:** `O5`→`05`, `]` no meio de números.
- Quando o ID do Pix não fecha 32 caracteres, o campo fica **marcado para conferir na imagem**.
- **Todo campo é editável.** O que a gestão corrigir entra automaticamente na observação ("Corrigido à mão: …").
- A **confiança da leitura** fica registrada.

### 3.3 Paciente no AmigoApp → Pacientes

**Na ficha da paciente** (AmigoApp aberto e logado): o mesmo botão
1. lê da tela **nome, ID** (da URL), **CPF, celular e nascimento**;
2. busca o comprovante em conferência;
3. compara os dois e mostra ✓ **CORRESPONDÊNCIA CONFIRMADA** ou ⚠ **DIVERGÊNCIA ENCONTRADA**, com o motivo;
4. com "Usar esta paciente", envia a paciente para a conciliação. A página Controle financeiro atualiza sozinha.

**Na lista de pacientes:**
- o botão **preenche a busca do Amigo com o nome do pagador**;
- mostra os possíveis pacientes encontrados;
- **nunca escolhe sozinho**: com 2 ou mais, pede para abrir a correta;
- sem nenhum, mostra **PACIENTE NÃO IDENTIFICADO**.

**Também na página:**
- o **histórico de lançamentos** sugere pacientes já pagos pelo mesmo pagador. É só sugestão, a escolha é por clique;
- sem paciente, a página mostra **PACIENTE NÃO IDENTIFICADO** e **não deixa lançar**.

**Regras da comparação:**
- nome igual ou abreviado → forte; só o primeiro nome → fraco, conta como divergência;
- CPF mascarado do comprovante × CPF da paciente: se diferir, é divergência;
- valor existe e bate com o "valor esperado" (opcional);
- data não está no futuro (com mais de 60 dias, aviso);
- forma de pagamento identificada;
- ID presente;
- recebedor parece ser da clínica (aviso).

**Correspondência em %:** é exibida antes de confirmar.

### 3.4 Lançamento e planilha

- Com divergência, **CONFIRMAR LANÇAMENTO** só é liberado depois de marcar "conferi as divergências" e **escrever a observação**. O status fica "Conferido com divergência".
- **Banco (D1, `fin_lancamentos`)** guarda:
  - datas do pagamento e do comprovante, e hora;
  - paciente, ID no AmigoApp e CPF;
  - pagador e documento;
  - valor e moeda;
  - forma, banco, instituição recebedora e recebedor;
  - ID da transação e tipo do ID;
  - hash e referência do comprovante;
  - status e divergências;
  - data de confirmação e responsável;
  - observações, origem, confiança e campos corrigidos;
  - situação na planilha.
- **Planilha (Google Sheets):** cada lançamento confirmado vira **uma linha na aba "Lançamentos"** (24 colunas) pelo Apps Script.
  - A aba **"Resumo"** soma por status, por forma de pagamento e por mês.
  - O script só acrescenta linhas e não duplica: confere o número do lançamento e o ID da transação.
- **Planilha fora do ar:** o lançamento **fica salvo** como "pendente" e o botão **"Reenviar pendentes à planilha"** completa depois.

### 3.5 Duplicidade

| Situação | O que acontece |
|---|---|
| Mesmo **ID da transação** ou mesmo **arquivo** (SHA-256) | ⚠ **PAGAMENTO JÁ REGISTRADO**: a página bloqueia e o **servidor recusa** (HTTP 409, com índice único no banco) |
| Mesmo **valor + data + pagador/paciente** | ⚠ "Possível pagamento já registrado": só lança se a gestão marcar "não é o mesmo pagamento" (ex.: casal pagando duas consultas iguais) |
| Mesma linha na planilha | o Apps Script ignora a repetição |


### 3.6 Mensagem enviada junto com o comprovante

O comprovante sozinho mostra **quem pagou**. A mensagem que a equipe manda junto mostra **de quem é a consulta e do que é o pagamento**.

**Como a mensagem é capturada:**
- No WhatsApp, o botão pega a **legenda da foto e as mensagens vizinhas da mesma pessoa**, até 15 minutos antes e depois.
- Para no próximo comprovante e ignora respostas de outras pessoas.
- No painel, cada comprovante aparece com um trecho da mensagem ("💬 …").
- A mensagem vai para a página e **sai do endereço logo depois de lida**.
- Se não veio mensagem, ela pode ser colada à mão.

**Formatos lidos:**
- o padrão do botão 🧾 Agendamento: nome, `Tel:`, `Objetivo:`, "Teleconsulta com o Dr. Leonardo - Lipedema 1x", "Dia 12 de novembro às 15h30", `Pagamento: R$ 900 de R$ 1.800`;
- o curto: "Segue pagamento da paciente Juliana Paranhos - Botox e preenchedor. Obs: Desconto de 30% de familiar e amigo";
- os antigos: `Nome:`, `CPF:`, "Restante…", "Pagamento 2/2 | Nome".

**O que vira dado:**
- paciente;
- telefone e CPF;
- procedimento;
- data da consulta;
- pago, total e falta;
- parcela: reserva, 2ª parte ou integral;
- desconto (%);
- observação.

**Como a mensagem entra na conferência:**
- A **paciente da mensagem** é comparada com a do AmigoApp. Se for outra pessoa → ⚠ divergência.
- Se **quem pagou** é um familiar e a mensagem confirma a paciente, vira só um aviso.
- O **valor da mensagem** diferente do valor do comprovante → ⚠ divergência.
- A busca no AmigoApp usa o **nome da paciente da mensagem** (e não o de quem pagou).

**Onde fica registrado:** banco e planilha, nas colunas Paciente (mensagem), Procedimento (mensagem), Consulta (mensagem), Parcela, Total da consulta, Falta pagar, Desconto (%) e Mensagem enviada junto. A "Obs:" da mensagem vai para Observações.


### 3.7 O que foi pago (catálogo) e AmigoApp (v3)

**O botão entende o que foi pago**, em qualquer jeito de escrever, e classifica cada item pelo catálogo da clínica (`classificarItens` em `comprovante.js`):

| Categoria | Itens reconhecidos |
|---|---|
| Consulta | Dr. Rafael, teleconsulta, Dr. Leonardo, Dra. Lorena (clínica), nutricionista, retorno, acompanhamento e especialista (angiologista, endocrinologista…) |
| Cirurgia | cirurgia, **sinal (com %)** e parcela |
| Estética | botox, preenchimento, bioestimulador, skinbooster, fios, laser, microagulhamento, peeling e enzimas |
| Soroterapia | ferro, vitaminas D, B12 e C, complexo B, glutationa, NAD, magnésio, zinco e soro, **com quantidade** (ampolas, doses) |
| Produto | meia de compressão, cinta, sutiã e compressor / bota pneumática |
| Fisioterapia | fisioterapia (n sessões), drenagem e pressoterapia |
| Exame | bioimpedância e exames |

Na planilha entram **Categoria** e **Itens pagos**, e não a mensagem inteira, que fica só no banco. A aba Resumo ganhou o total por categoria.

**AmigoApp:**
- O botão da página abre **amigoapp.com.br/patients** (antes abria `app.amigoapp.com.br`, que não existe).
- Sem paciente aberta, o botão busca na **própria base do AmigoApp**, usando a sessão que a gestão já tem aberta (só leitura, rota `/api/patient/suggest`). Mostra os candidatos sem escolher sozinho e, ao escolher um, traz CPF e celular da ficha.
- Se a busca da API não responder, o botão usa a lista da tela como antes.
- O endereço do site salvo no botão é corrigido sozinho (https, sem caminho).
- **Se o AmigoApp não conseguir falar com o servidor** ("Failed to fetch"), aparece "**Enviar a paciente pela página**": a página Controle financeiro abre, retoma o comprovante pendente e liga a paciente.
- 🟡 A rota de busca do Amigo foi tirada do código do próprio AmigoApp (`api.amigoapp.com.br`, `localStorage.token`, `company-id`), mas o **formato da resposta real não foi visto**: foi testada com uma resposta simulada.

### 3.8 Correções de 05/10 (v3): colar, nomes parecidos e planilha automática

- **"Me redireciona para a lista":**
  - o clique no comprovante abre a página `/financeiro` **de propósito**: o WhatsApp não deixa o botão falar com o servidor, então a imagem vai pela área de transferência;
  - agora a página mostra um botão grande **📋 Colar o comprovante copiado do WhatsApp** (ou ⌘V).
- **Nomes parecidos:** a comparação aceita:
  - apelido (Gabi × Gabriela);
  - erro de digitação (Juliana × Juliano não; Julianna × Juliana sim);
  - nome incompleto ou com iniciais;
  - nomes fora de ordem.

  A comparação mostra "nome X% parecido". A busca no Amigo tenta o nome completo, o primeiro + último nome, só o sobrenome e só o primeiro nome. Depois ordena por semelhança.
- **Planilha automática:** modelo pronto (`/planilha-controle-financeiro.xlsx`) com as abas Resumo, Lançamentos, Dados e Configuração.
  - A aba Dados usa `IMPORTDATA` no link `/api/financeiro-planilha?k=…`. A chave é um HMAC da senha da gestão.
  - Não precisa de Apps Script.
  - 🟡 Não consegui criar a planilha direto no seu Google Drive: o conector respondeu "sem permissão".
  - **✨ Criar a planilha no Google** (dentro de 🔗 Ligar a planilha) resolve sem Office nem arquivo:
    - copia uma tabela já formatada (título, totais, cabeçalho e `=IMPORTDATA("link")` na linha 6);
    - abre `sheets.new`;
    - a pessoa entra na conta Google e cola em A1.
  - 🟡 Testado até a cópia e a abertura da aba. **A colagem dentro do Google Sheets real não foi testada.** Se a fórmula aparecer como texto, apague a célula A6 e digite a fórmula de novo.
  - 🟡 As fórmulas `QUERY`/`IMPORTDATA` foram geradas, mas não executadas num Google Sheets real.

## 4. Testes realizados

| Teste | Resultado |
|---|---|
| `node --test test/comprovante.test.js` (Nubank, Itaú, cartão, texto ilegível, validação, nomes e 5 casos de mensagem + catálogo com 7 formatos) | ✅ 16 de 16 (inclui nomes parecidos: apelido, erro de digitação, nome incompleto; e Bruna × Bruno continua "diferente") |
| `test/e2e/financeiro.e2e.js`: ponta a ponta com o servidor real (`wrangler pages dev` + D1 local), **OCR real** (tesseract.js) em PNG/JPG, PDF real (pdf.js) e o **código real da planilha** rodando num emulador local do Google Sheets | ✅ **56 de 57** (inclui a planilha automática: link → CSV com os 4 lançamentos, chave errada recusada (401), botão ✨ Criar a planilha no Google (abre sheets.new e copia a planilha formatada com o link), modelo .xlsx disponível; inclui busca pela API do Amigo, caminho alternativo sem comunicação, categoria e itens na planilha; inclui a mensagem do WhatsApp chegando na página, a mensagem curta com desconto, a busca no Amigo pelo nome da mensagem e as colunas novas na planilha) |
| A falha (1): ID do Pix lido **exatamente** pelo OCR na imagem | ✗ O OCR trocou `0`/`O` e `1`/`l` no final do ID. O sistema **detectou e marcou para conferir** (verificação seguinte ✅). A duplicidade continua protegida pelo arquivo e por valor + data + pagador |
| Persistência: servidor desligado e religado | ✅ os 4 lançamentos continuam no banco e na planilha, sem linha duplicada |
| `npm test` do projeto | 87 de 89. As 2 falhas são **anteriores** a esta mudança (`test/e2e.test.js` do painel espera o mês "set" e hoje é outubro) e não têm relação com o botão |

**O que o teste de ponta a ponta validou, em ordem:**
1. ✅ Página abre, pede a senha da gestão e recusa senha errada (401).
2. ✅ No **WhatsApp Web simulado com a CSP e o COOP reais**:
   - a chamada direta ao servidor é bloqueada (por isso a área de transferência);
   - o botão abre o painel e acha o comprovante da conversa;
   - o clique copia o PNG e abre a página;
   - ⌘V entrega a imagem.
3. ✅ OCR do Nubank (PNG): pagador, valor, data (`O5 OUT` → `05/10/2026`), hora, Pix, Nubank e recebedor. 🟡 O ID saiu com 1 caractere a mais e ficou **marcado para conferir**.
4. ✅ **PACIENTE NÃO IDENTIFICADO** antes da conferência, sem botão de lançar.
5. ✅ **AmigoApp simulado** (formulário com as mesmas classes `doca-form__field` do Amigo real):
   - lê nome, ID 4321 e CPF;
   - mostra correspondência confirmada;
   - envia a paciente;
   - a página mostra **PAGAMENTO IDENTIFICADO** com **100%**.
6. ✅ **CONFIRMAR LANÇAMENTO** grava o lançamento #1 e **atualiza a planilha** (linha 2, com paciente, ID Amigo, 1800, PIX, ID da transação e responsável). A aba Resumo é criada.
7. ✅ Mesmo comprovante de novo → **PAGAMENTO JÁ REGISTRADO**. O servidor recusa o lançamento forçado (409). Sem ID, valor + data + pagador → "possível duplicado".
8. ✅ Itaú (JPG): 2.200,00, 03/10/2026, Pix, Itaú.
   - Paciente Ana Paula × pagador Carlos → **DIVERGÊNCIA** (CPF e nome).
   - O botão fica bloqueado até marcar e escrever a observação.
   - Lançado como "conferido com divergência".
9. ✅ **PDF** (Inter): todos os campos exatos, inclusive o ID.
   - Na **lista de pacientes do Amigo**: busca preenchida com o pagador e **2 candidatos mostrados sem escolher**.
   - Depois, paciente aberta → lançado (#3).
10. ✅ Planilha fora do ar → lançamento salvo como pendente → **Reenviar** → planilha completa (4 linhas).

## 5. O que NÃO foi validado no ambiente final

- 🟡 **Safari de verdade (Mac).** O teste rodou no **Chromium** (Playwright). Este servidor é Linux e não tem Safari nem o WebKit instalado. O código usa só recursos que o Safari tem:
  - `ClipboardItem` com Promise;
  - `createImageBitmap`;
  - `crypto.subtle`;
  - `import()` de módulo (pdf.js);
  - WebAssembly (tesseract.js).

  **Falta você testar no Safari:** o roteiro está na seção 7.
- 🟡 **Rodar o botão dentro do WhatsApp Web no Safari.** O WhatsApp tem CSP rígida. No Chrome, favoritos `javascript:` rodam mesmo assim. No Safari, se ao clicar nada acontecer, ative "Permitir JavaScript do Campo de Busca Inteligente" (mesma instrução dos botões atuais). Se mesmo assim o Safari bloquear no WhatsApp, o caminho sem botão funciona sempre: clique com o botão direito na imagem → **Copiar imagem** → página Controle financeiro → ⌘V.
- 🟡 **AmigoApp real.** O teste usou uma réplica do formulário do Amigo (classes e rótulos reais, tirados do diagnóstico feito antes). A **tela de visualização da paciente** e a **lista de Pacientes** do Amigo real não foram vistas. Se o botão não ler a paciente, use o **🔍 Diagnóstico da tela** (botão existente) nessas telas e me mande o resultado para eu ajustar.
- 🟡 **Google Sheets real.** O código da planilha foi executado de verdade, mas num emulador local da planilha. O caminho até o Google depende da implantação (seção 6).
- 🟡 **Comprovantes reais.** Os testes usaram 3 comprovantes fictícios (Nubank, Itaú, Inter). Comprovantes de outros bancos ou fotos de tela podem ter layouts que o leitor não conhece. Por isso todo campo é editável e a conferência é humana.
- **IA/visão (Claude) não foi ligada:** não há chave de API, e isso enviaria comprovantes para fora. O OCR local foi suficiente nos testes. Se fotos ruins de celular falharem muito, dá para acrescentar uma leitura por IA, opcional e com aviso.

## 6. ⛔ O que precisa da sua autorização/ação

1. **Planilha:** baixar o modelo, subir no Google Drive como Planilha Google e colar o link de "🔗 Ligar a planilha" em Configuração!B3. São cerca de 2 minutos; veja `ferramentas/financeiro/LEIA-ME.md`.
2. **Cloudflare (projeto clinicablue):**
   - binding **D1 `DB`** (ainda pendente desde a Ficha Blue);
   - secrets `FINANCEIRO_SENHA`, `FINANCEIRO_PLANILHA_URL`, `FINANCEIRO_PLANILHA_CHAVE` e, opcional, `FINANCEIRO_PLANILHA_LINK`;
   - **Retry deployment**.
3. **Publicar esta branch** (ou juntar na `main`) para `/financeiro` e `/api/financeiro` irem ao ar.
4. **Safari:** arrastar o botão de `instalar-botao-financeiro.html` para a barra de favoritos.

## 7. Roteiro de teste no Safari (10 minutos)

1. Abra o WhatsApp Web e uma conversa com um comprovante. Clique em **💰 Controle financeiro**: deve aparecer o painel com as imagens.
2. Clique no comprovante: a página deve abrir. Digite a senha e o seu nome e aperte ⌘V: os dados devem aparecer.
3. Clique em **Conferir no AmigoApp**, abra a paciente e clique em 💰: deve aparecer ✓ ou ⚠ e o botão "Usar esta paciente".
4. Volte à página e clique em **CONFIRMAR LANÇAMENTO**: a planilha deve ganhar uma linha.
5. Cole o mesmo comprovante de novo: deve aparecer ⚠ **PAGAMENTO JÁ REGISTRADO**.
