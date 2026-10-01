# Ficha Blue no Cloudflare (sem Netlify)

Grátis, sem cartão. A paciente vê só `https://ficha.clinicablue.com.br/f/<código>`.

O que roda lá:
- `ficha/index.html`: a página que a paciente preenche (`ficha/_redirects` faz `/f/...` abrir a ficha).
- `functions/api/ficha.js`: recebe a ficha → AmigoClinic (só se não existir) + nota, etiqueta e tarefa no Kommo.
- `functions/api/ficha-link.js`: gera o link assinado para o botão 📝 Link da ficha.
- A lógica é a mesma da versão Netlify (`src/services/fichaBlue.js` e `amigoClient.js`).

## Passo a passo (uma vez só, ~10 minutos)
1. Crie a conta grátis em **dash.cloudflare.com**.
2. **Workers & Pages → Create → Pages → Connect to Git** → escolha `leletns/kommoimplement`, branch `claude/loving-curie-mz2qi8` (ou a `main`, quando juntar).
3. Configuração do build: *Framework* **None** · *Build command* **vazio** · *Build output directory* **`ficha`**. Salvar e publicar.
4. **Settings → Variables and Secrets** (tipo **Secret**, ambiente *Production*):
   | Nome | Valor |
   |---|---|
   | `KOMMO_TOKEN` | token de longa duração do Kommo |
   | `AMIGO_TOKEN` | token da API do AmigoClinic |
   | `FICHA_SEGREDO` | um texto longo e aleatório (assina os links; não mude depois, senão os links antigos param) |
   | `FICHA_SENHA` | a senha que a comercial digita no botão 📝 na primeira vez |
   | `FICHA_URL_BASE` | `https://ficha.clinicablue.com.br` |
   Depois, **Deployments → Retry deployment** para valer.
5. **Custom domains → Set up a custom domain** → `ficha.clinicablue.com.br`. O Cloudflare mostra um **CNAME** (`ficha` → `ficha-blue.pages.dev`): crie esse registro onde fica o DNS do domínio (Registro.br, Hostinger…). O cadeado (HTTPS) sai sozinho.
6. No Kommo, clique em **📝 Link da ficha**: na primeira vez ele pede o endereço (`https://ficha.clinicablue.com.br`) e a senha (`FICHA_SENHA`).

## Testar no computador (opcional)
`npx wrangler pages dev ficha` com um arquivo `.dev.vars` (fora do git) com as mesmas variáveis.
