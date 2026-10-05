# Controle financeiro da gestão: instalação

O botão **💰 Controle financeiro** é só da gestão. Ele não faz parte do fluxo da Comercial, não usa a Ficha Blue e tem senha própria.

## 1. Planilha (Google Sheets), cerca de 2 minutos, uma vez só

A planilha já vem pronta, com layout, e se preenche sozinha. Não precisa de Apps Script.

**Jeito mais fácil (só navegador, sem Office):**
1. Na página `/financeiro`, clique em **🔗 Ligar a planilha → ✨ Criar a planilha no Google**.
2. Entre na conta Google se pedir.
3. Na planilha nova, aperte ⌘V na célula A1. Pronto.

**Ou com o modelo de 4 abas:**

1. Baixe o modelo: https://clinicablue.pages.dev/planilha-controle-financeiro.xlsx
   (gerado por `gerar_planilha.py`).
2. No Google Drive da gestão: **Novo → Upload de arquivo**. Abra o arquivo e escolha **Arquivo → Salvar como Planilhas Google**.
3. Na página https://clinicablue.pages.dev/financeiro, entre com a senha e clique em **🔗 Ligar a planilha → Copiar link**.
4. Na planilha, aba **Configuração**, cole o link na célula amarela **B3**.

Pronto: a aba **Dados** puxa os lançamentos do site (`IMPORTDATA`), e as abas formatadas se preenchem sozinhas:
- **Lançamentos** (mais novo primeiro, divergências em destaque);
- **Resumo** (recebido no mês e no total, por categoria, forma de pagamento, responsável e mês).

O Google atualiza cerca de 1 vez por hora e sempre que a planilha é aberta.

O link tem uma chave derivada da senha da gestão. Quem tiver o link vê os lançamentos. Trocar a senha (`FINANCEIRO_SENHA`) troca o link.

**Opcional (envio na hora):** `planilha-apps-script.gs` continua disponível. Ele envia cada lançamento no momento da confirmação, mas exige implantar como App da Web e configurar `FINANCEIRO_PLANILHA_URL` e `FINANCEIRO_PLANILHA_CHAVE`.

## 2. Cloudflare Pages (projeto `clinicablue`)

1. **Settings → Bindings → D1 database**: ligue um banco com o nome **`DB`**. Pode ser o mesmo da Ficha Blue, porque as tabelas do financeiro são separadas (`fin_*`).
2. **Settings → Variables and Secrets**, do tipo **Secret**:

   | Nome | Valor |
   |---|---|
   | `FINANCEIRO_SENHA` | senha só da gestão (diferente da senha da equipe) |
   | `FINANCEIRO_PLANILHA_URL` | a URL `/exec` do passo 1.5 |
   | `FINANCEIRO_PLANILHA_CHAVE` | o mesmo texto da propriedade `CHAVE` |
   | `FINANCEIRO_PLANILHA_LINK` | (opcional) o link da planilha, para o botão "Abrir planilha" |

3. **Deployments → Retry deployment**.

## 3. Botão no Safari

Abra `ferramentas/cadastro-amigo/instalar-botao-financeiro.html` no Safari e arraste **💰 Controle financeiro** para a barra de favoritos.

Na primeira vez, o botão pede:
- o endereço do site (por exemplo `https://clinicablue.pages.dev`);
- no AmigoApp, também a senha da gestão.

## Como funciona

1. **WhatsApp Web:** o botão lista as imagens da conversa aberta. Ao clicar no comprovante, ele copia a imagem e abre a página `/financeiro`; lá você aperta ⌘V. O WhatsApp bloqueia chamadas a outros sites e isola janelas, por isso a imagem passa pela área de transferência.
2. **Leitura:** o OCR (tesseract.js, em português) roda **no próprio navegador**. PDF de banco é lido direto pelo texto (pdf.js). Em seguida, os dados são extraídos: valor, data, hora, Pix/cartão/TED, banco, pagador, recebedor e ID da transação.
3. **Duplicidade:**
   - mesmo ID da transação ou mesmo arquivo (SHA-256) → **bloqueia**;
   - mesmo valor, data e pagador/paciente → pede confirmação explícita.
4. **Paciente (AmigoApp → Pacientes):** abra a paciente e clique no botão. Ele lê nome, ID, CPF e celular da tela e compara com o comprovante.
   - Na lista de pacientes, ele busca pelo nome do pagador e mostra os possíveis pacientes, sem escolher sozinho.
   - O histórico de lançamentos também sugere pacientes já pagos pelo mesmo pagador, igualmente sem escolher sozinho.
5. **Conciliação:**
   - ✓ ou ⚠ **DIVERGÊNCIA** com o motivo;
   - com divergência, só lança depois de marcar a conferência e escrever uma observação;
   - sem paciente, não lança.
6. **Lançamento:** vai para o banco (D1) e para a planilha. Se a planilha falhar, o lançamento fica salvo como "pendente" e o botão **Reenviar pendentes** manda de novo, sem duplicar linha.
