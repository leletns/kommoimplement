# Ficha Blue no Cloudflare (sem Netlify)

Grátis, sem cartão. A paciente vê `https://ficha.clinicablue.com.br/f/<código>` (com o CNAME no Registro.br) ou,
enquanto isso, `https://<nome-do-projeto>.pages.dev/f/<código>`. Dê ao projeto o nome **clinicablue** (ou **blueclinica**)
para o endereço provisório ficar `clinicablue.pages.dev`.

**Sem acesso ao Registro.br, mas com acesso ao Squarespace do site:** em *Settings → Advanced → URL Mappings*, adicione
`/f/[codigo] -> https://clinicablue.pages.dev/f/[codigo] 302` e use `FICHA_URL_BASE=https://clinicablue.com.br`.
O link enviado fica `https://clinicablue.com.br/f/<código>` (o domínio da clínica).

O que roda lá:
- `ficha/index.html`: a página que a paciente preenche; `functions/f/[[codigo]].js` abre a ficha em `/f/...` com a prévia (logo `ficha/og.png`) para o WhatsApp.
- `functions/api/ficha.js`: recebe a ficha → AmigoClinic (só se não existir) + nota, etiqueta e tarefa no Kommo.
- `functions/api/ficha-link.js`: gera o link assinado para o botão 📝 Link da ficha.
- `functions/api/ficha-busca.js` + `ficha/equipe.html` (página `/equipe`): a concierge, sem Kommo, busca a ficha pelo
  nome/celular/e-mail direto no botão ✍️ Preencher cadastro (Amigo/DocSignature). Usa a mesma senha `FICHA_SENHA`.
- A lógica é a mesma da versão Netlify (`src/services/fichaBlue.js` e `amigoClient.js`).

## Passo a passo (uma vez só, ~10 minutos)
1. Crie a conta grátis em **dash.cloudflare.com**.
2. **Workers & Pages → Create → Pages → Connect to Git** (nome do projeto: **clinicablue**) → escolha `leletns/kommoimplement`, branch `claude/loving-curie-mz2qi8` (ou a `main`, quando juntar).
3. Configuração do build: *Framework* **None** · *Build command* **vazio** · *Build output directory* **`ficha`**. Salvar e publicar.
4. **Settings → Variables and Secrets** (tipo **Secret**, ambiente *Production*):
   | Nome | Valor |
   |---|---|
   | `KOMMO_TOKEN` | token de longa duração do Kommo |
   | `AMIGO_TOKEN` | token da API do AmigoClinic |
   | `FICHA_SEGREDO` | um texto longo e aleatório (assina os links; não mude depois, senão os links antigos param) |
   | `FICHA_SENHA` | a senha da equipe (comercial no 📝 e concierge no ✍️/`/equipe`). Use uma senha forte: ela dá acesso às fichas |
   | `FICHA_URL_BASE` | `https://ficha.clinicablue.com.br` |
   Depois, **Deployments → Retry deployment** para valer.
5. **Custom domains → Set up a custom domain** → `ficha.clinicablue.com.br`. O Cloudflare mostra um **CNAME** (`ficha` → `clinicablue.pages.dev`): crie esse registro onde fica o DNS do domínio (Registro.br, Hostinger…). O cadeado (HTTPS) sai sozinho.
6. No Kommo, clique em **📝 Link da ficha**: na primeira vez ele pede o endereço (`https://ficha.clinicablue.com.br`) e a senha (`FICHA_SENHA`).

## Testar no computador (opcional)
`npx wrangler pages dev ficha` com um arquivo `.dev.vars` (fora do git) com as mesmas variáveis.
