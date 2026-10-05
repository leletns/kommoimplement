# Controle financeiro da gestão: instalação

O botão **💰 Controle financeiro** é só da gestão. Ele não faz parte do fluxo da Comercial, não usa a Ficha Blue e tem senha própria.

## 1. Planilha (Google Sheets), cerca de 5 minutos

1. Crie uma planilha nova no Google Drive da gestão, por exemplo "Controle financeiro · Blue".
2. **Extensões → Apps Script**: apague o conteúdo e cole o arquivo `planilha-apps-script.gs`.
3. **Configurações do projeto (engrenagem) → Propriedades do script → Adicionar**:
   - nome `CHAVE`;
   - valor: um texto longo e aleatório (é o mesmo do passo 2.3).
4. **Implantar → Nova implantação → tipo "App da Web"**:
   - Executar como: **Eu**;
   - Quem pode acessar: **Qualquer pessoa**.
5. Autorize quando o Google pedir e copie a **URL do app da Web** (termina em `/exec`).

A chave impede que outra pessoa escreva na planilha. O script só **acrescenta** linhas: nunca apaga nem altera o que já está lá.

As abas são criadas sozinhas no primeiro lançamento:
- **Lançamentos**: uma linha por pagamento conferido;
- **Resumo**: totais por status, por forma de pagamento e por mês, com fórmulas.

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
