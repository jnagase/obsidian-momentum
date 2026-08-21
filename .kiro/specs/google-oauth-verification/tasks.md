# Implementation Plan: google-oauth-verification

## Overview

Este plano executa o design em **9 fases na ordem exata da seção "Ordem segura de execução"**.
A ordem não é preferência: **fase fora de ordem deixa usuário sem autenticação**. Dois pontos
inegociáveis:

- O redirect canônico só é **deployado** (Fase 5) depois de estar **registrado** no OAuth_Client
  (Fase 2) e do custom domain do Worker estar de pé (Fase 4).
- O redirect legado só é **removido** (Fase 6) depois de **I1 e I2 verdes**.

Linguagem de implementação: **TypeScript** no plugin (`src/`), **JavaScript** no Worker
(`worker/src/`), HTML/CSS estáticos em `site/`. Testes em **vitest + fast-check**, já presentes
como devDependencies — nada a instalar.

### Como ler os marcadores

| Marcador | Significado |
| --- | --- |
| 🤖 **CÓDIGO** | Tarefa executável por agente de código. Escreve/edita arquivos do repo. |
| 👤 **MANUAL** | Ação em console de plataforma (Cloudflare, Google Cloud, Search Console, YouTube, Verification Center) ou com conta Google real. **Agente não tem acesso — só o usuário executa.** |
| ⚠️ **CONFIRMAÇÃO** | Build, deploy, commit ou push. Só roda com **ordem explícita** do usuário (steering do projeto). |
| 🚦 **GATE** | Verificação bloqueante. Nada depois dela avança até ela passar. |

Tarefas com `*` são opcionais para MVP — aqui são os testes. As de código sem `*` são o caminho
crítico.

---

## Tasks

- [x] 1. Fase 1 — Domínio, fonte única do domínio e checklist de submissão

  - [x] 1.1 👤 **MANUAL** Conferir a zona `jnagase.com` na Cloudflare (nada a comprar)
    - **Domínio decidido: `jnagase.com`, já registrado pelo autor** (D1). Não há compra de domínio
      nesta spec. Hosts definidos (D3): site em `momentumlife.jnagase.com`, Broker em
      `momentumlife-auth.jnagase.com`.
    - Confirmar: zona ativa na Cloudflare, na **mesma conta** do Worker `momentum-google`;
      Universal SSL cobrindo `*.jnagase.com`; expiração do registro ≥ 90 dias após a data prevista
      da submissão.
    - **Os dois hosts são de primeiro nível de propósito** (D3b). O Universal SSL cobre apex e
      **um** nível só — `auth.momentumlife.jnagase.com` ficaria sem certificado automático e
      exigiria Advanced Certificate Manager. Não trocar o hífen por ponto.
    - Não criar nenhum registro DNS ainda. Se o apex `jnagase.com` já hospeda algo do autor, ele
      **não é tocado** em fase nenhuma desta spec. Impacto no usuário: **zero**.
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 🤖 **CÓDIGO** Criar `app-domain.json` como fonte única do domínio
    - Criar `app-domain.json` na raiz com:
      `{ "rootDomain": "jnagase.com", "siteHost": "momentumlife.jnagase.com", "authHost": "momentumlife-auth.jnagase.com" }`.
    - Validar as invariantes do design: os três casam `^[a-z0-9-]+(\.[a-z0-9-]+)+$`, minúsculos,
      sem esquema, sem `/`, sem `:`, sem barra final; `siteHost` e `authHost` terminam em
      `.${rootDomain}` e têm **exatamente um** label antes dele; `siteHost !== authHost`;
      `rootDomain` fora de sufixo público compartilhado.
    - A validação de "exatamente um label" não é preciosismo: host de segundo nível passaria no
      resto das checagens e só falharia em produção, como erro de TLS.
    - Adicionar `"resolveJsonModule": true` ao `tsconfig.json` (uma linha).
    - Nenhum efeito em runtime nesta tarefa: o arquivo ainda não é consumido por ninguém.
    - _Requirements: 1.4, 7.5_

  - [x] 1.3 🤖 **CÓDIGO** Criar os módulos derivados do domínio
    - `worker/src/config.js`: exporta `APP_DOMAIN`, `AUTH_HOST` e
      `CANONICAL_REDIRECT_URI = https://${AUTH_HOST}/callback`, derivados por template de
      `app-domain.json`.
    - `src/appdomain.ts`: exporta `WORKER_BASE = https://${AUTH_HOST}`, derivado da mesma fonte.
      **Sem fallback para o Legacy_Origin.**
    - Expor também `APP_HOMEPAGE` e `PRIVACY_URL` derivados, para uso na documentação e nos testes
      de coerência.
    - Toda URL por template, **nunca** por concatenação ad hoc no ponto de uso.
    - Nesta tarefa os módulos ficam **inertes**: `worker/src/index.js` só passa a consumir
      `CANONICAL_REDIRECT_URI` na Fase 5 e `src/googletasks.ts` só passa a consumir `WORKER_BASE`
      na Fase 7. Isso preserva a ordem segura.
    - _Requirements: 6.2, 7.5_

  - [x]* 1.4 🤖 **CÓDIGO** Escrever property test da derivação do domínio
    - **Property 11: Toda URL do sistema deriva do mesmo domínio raiz**
    - **Validates: Requirements 1.4, 1.5, 1.7, 2.10, 7.5**
    - Arquivo: `test/app-domain.property.test.ts`
    - Harness: função pura de derivação + grep sobre `src/`, `worker/src/` e `site/` procurando o
      domínio como literal. O grep deve **tolerar diretório ainda inexistente** (`site/` só nasce
      na Fase 3) em vez de falhar por ausência.
    - Asserta: mesmo domínio raiz em `APP_HOMEPAGE`, `PRIVACY_URL` e `CANONICAL_REDIRECT_URI`;
      ausência de esquema, caminho, porta, barra final e subdomínio em `rootDomain`; `siteHost` e
      `authHost` distintos e com exatamente um label antes de `rootDomain`; rejeição de
      sufixos públicos compartilhados (`workers.dev`, `pages.dev`, `github.io`); rejeição de
      configuração malformada.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag obrigatória, imediatamente acima do teste:
      `// Feature: google-oauth-verification, Property 11: Toda URL do sistema deriva do mesmo domínio raiz`

  - [x] 1.5 🤖 **CÓDIGO** Criar o Submission_Checklist
    - Criar `docs/oauth-verification/submission-checklist.md`.
    - Tabela com **uma linha por critério de aceitação dos Requirements 1 a 9** (ids `1.1` … `9.11`),
      colunas: `ID | Critério (resumo) | Estado | Evidência | Última mudança`.
    - Estados admitidos, exatamente um por linha: `não iniciado` · `em andamento` · `concluído` ·
      `bloqueado`.
    - Seções adicionais no mesmo arquivo: **Gate de submissão** (itens não concluídos),
      **Registro de verificação de domínio** (tentativas, método, erro, troca de método),
      **Contador de vagas** (contas que autorizaram e vagas restantes do cap vitalício de 100),
      **Diário do review** (pedidos do Google com texto integral e prazo, respostas, recusas),
      **Exceções e desvios** — com a exceção do Requirement 1 critério 7 registrada como
      *resolvida por design*, tendo a Fase 6 como evidência.
    - Este arquivo é onde **todas** as tarefas manuais deste plano registram evidência.
    - _Requirements: 10.1, 1.6, 1.9, 5.8, 9.10, 10.3, 10.4, 10.9_

  - [x]* 1.6 🤖 **CÓDIGO** Escrever property test do gate de submissão
    - **Property 13: O gate de submissão é exatamente o conjunto de itens não concluídos**
    - **Validates: Requirements 3.16, 8.8, 9.11, 10.2, 10.8**
    - Arquivo: `test/checklist.property.test.ts`
    - Harness: parser do markdown do checklist + `canSubmit` e `blockingItems` como funções puras.
    - Asserta: `canSubmit ⟺ todos os itens "concluído"`; `blockingItems` é exatamente o conjunto
      dos itens com estado diferente de "concluído"; cada item tem exatamente um estado entre os
      quatro admitidos.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 13: O gate de submissão é exatamente o conjunto de itens não concluídos`

  - [x]* 1.7 🤖 **CÓDIGO** Escrever teste de exemplo da cobertura do checklist
    - Arquivo: `test/checklist.coverage.test.ts`
    - Asserta que **todo** id de critério dos Requirements 1 a 9 aparece **exatamente uma vez** no
      checklist, com um estado válido. Falha se um critério for esquecido ou duplicado.
    - _Requirements: 10.1_

- [x] 2. Checkpoint — base do domínio
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Fase 2 — Registrar o redirect canônico no OAuth_Client (aditivo, reversível)

  - [x] 3.1 👤 **MANUAL** Adicionar o redirect canônico mantendo o legado
    - Google Cloud, projeto `obsidian-tasks-499613`, OAuth_Client **Web `8btbj3o6…`** — o mesmo,
      sempre. **Criar client novo está proibido** (D12): invalida todo refresh token existente.
    - Adicionar em *Authorized redirect URIs*: `https://momentumlife-auth.jnagase.com/callback`, idêntico
      caractere a caractere ao `CANONICAL_REDIRECT_URI` derivado em 1.3.
    - **Manter** o redirect de `momentum-google.jaime-nagase.workers.dev`. Os dois coexistem.
      Nada é removido nesta fase.
    - Não tocar em escopos, publishing status nem user type.
    - Por que antes da Fase 4: se o hostname novo passasse a responder antes do redirect estar
      registrado, uma chamada a `momentumlife-auth.jnagase.com/auth` produziria consentimento com redirect não
      registrado e o Google recusaria.
    - Registrar no checklist (print da tela dos redirect URIs).
    - _Requirements: 6.3, 7.6, 10.1_

- [x] 4. Fase 3 — Publicar as páginas, verificar o domínio e alinhar a consent screen

  - [x] 4.1 🤖 **CÓDIGO** Criar `site/index.html` (App_Homepage)
    - `<h1>` com `Momentum Life` — caractere a caractere igual ao nome que será configurado na
      Consent_Screen (D6).
    - Seções conforme a tabela do design: subtítulo do plugin; "Google Tasks sync" declarando sync
      **bidirecional** entre notas do vault e listas do Google Tasks e que é **opcional e desligada
      por padrão**, ligada pelo próprio usuário; "What the app accesses" listando **your task
      lists** e **your tasks** com a finalidade de cada acesso e a frase de que nada mais é
      acessado; "Author and contact" com `Jaime Nagase` e o email idêntico ao developer contact.
    - Links em texto, alcançáveis só com rolagem: `/privacy` (relativo) e
      `github.com/jnagase/obsidian-momentum` (único link absoluto do site).
    - **Zero JavaScript**: nenhuma tag `<script>`, nenhum atributo de evento inline, nenhum recurso
      remoto, nenhum conteúdo obrigatório dentro de `<noscript>`.
    - Todo o conteúdo em **inglês**.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 4.2 🤖 **CÓDIGO** Criar `site/privacy.html` na **versão v1** (Privacy_Policy_Page)
    - Uma seção por critério do Requirement 3, conforme a tabela de mapeamento do design: onde os
      dados vivem (só markdown no vault local); quem fala com o Google (dispositivo → 
      `tasks.googleapis.com`, sem servidor do autor); o OAuth broker (só handshake; não recebe, não
      processa, não armazena conteúdo de task; não persiste token, code nem identificador); tokens
      (só no `data.json` local, até desconectar ou remover o arquivo); lista **exaustiva** de campos
      lidos e escritos (title, notes, due date, completion status, task id, task list id) e nada
      além; uso dos dados (só o sync pedido; não vendido, não transferido, sem publicidade, sem
      treino de IA); revogação (dois caminhos, cada um preservando as notas); exclusão de dados;
      ausência de telemetria e analytics; rodapé com `Last updated: YYYY-MM-DD` e email de
      privacidade idêntico ao developer contact.
    - **v1 (D11)**: em "Revoking access", o caminho do plugin diz que desconectar **remove o token
      local e para o acesso**, apontando a página de permissões do Google para revogar a concessão.
      Fiel ao código de hoje. **Não** escrever "revoga" aqui — a v2 entra no commit do release
      (tarefa 10.10), quando o código passa a revogar de verdade.
    - Mesmas regras de construção do 4.1: zero JavaScript, inglês, links relativos.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.14_

  - [x] 4.3 🤖 **CÓDIGO** Criar `site/styles.css`, `site/robots.txt` e `site/_headers`
    - `styles.css`: CSS puro, sem framework, **sem fonte remota**.
    - `robots.txt`: Allow total, **sem nenhuma regra** que bloqueie `/` ou `/privacy`.
    - `_headers`: garante ausência de `X-Robots-Tag: noindex` nas rotas de produção.
    - _Requirements: 2.7, 3.1_

  - [x]* 4.4 🤖 **CÓDIGO** Escrever property test das páginas servidas
    - **Property 12: Toda página servida funciona sem JavaScript e é indexável**
    - **Validates: Requirements 2.6, 2.7, 3.1**
    - Arquivo: `test/site.property.test.ts`
    - Harness: lê `site/**/*.html` e `site/robots.txt` do disco.
    - Asserta, para **qualquer** HTML em `site/`: ausência de `<script>`, ausência de atributo de
      evento inline, ausência de conteúdo obrigatório dentro de `<noscript>`, ausência de meta
      `noindex`, e caminho não bloqueado por nenhuma regra do `robots.txt`.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 12: Toda página servida funciona sem JavaScript e é indexável`

  - [x]* 4.5 🤖 **CÓDIGO** Escrever testes de exemplo do conteúdo das páginas
    - Arquivo: `test/site.content.test.ts`
    - Uma âncora textual por afirmação exigida em `site/index.html` (nome do app, autor, email,
      bidirecionalidade, opt-in, dados acessados, os dois links) e em `site/privacy.html` (as onze
      declarações do Requirement 3 + rodapé).
    - O teste falha ao remover qualquer declaração. É a rede de segurança contra a política ficar
      menos fiel que o código.
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_

  - [x] 4.6 👤 **MANUAL** Publicar o site no Cloudflare Pages com custom domain
    - Criar projeto Pages ligado ao repo: production branch `main`, output directory `site`,
      **sem build command**.
    - Custom domain no **apex** do App_Domain. Nenhuma URL `*.pages.dev` entra em lugar algum —
      deployment de preview recebe `X-Robots-Tag: noindex` por padrão.
    - `www` não é usado: não é declarado na Consent_Screen nem linkado.
    - Registrar no checklist.
    - _Requirements: 2.1, 3.1_

  - [x] 4.7 👤 **MANUAL** 🚦 **GATE I5** — verificar homepage e política por HTTP
    - `curl -sSI https://momentumlife.jnagase.com/` e `curl -sSI https://momentumlife.jnagase.com/privacy`.
    - Exigido: `200` **direto**, **sem `301`**, sem `X-Robots-Tag`, sem exigir autenticação, sem
      redirecionar para fora do App_Domain, resposta em ≤ 5 s, certificado válido com cadeia
      completa e validade restante ≥ 15 dias.
    - O comportamento de barra final do Pages varia: registrar no checklist **exatamente a URL que
      respondeu 200**. Essa string é a que vai para a Consent_Screen e para o README.
    - **Este gate bloqueia a Fase 9 (submissão).** Colar a saída dos dois comandos como evidência.
    - _Requirements: 2.1, 2.9, 3.1, 3.16_

  - [x] 4.8 👤 **MANUAL** Verificar a propriedade do domínio no Search Console
    - Propriedade **de domínio** (não de prefixo de URL), via registro **TXT no DNS** — cobre
      `auth.` sem registro extra.
    - Precisa ser uma conta Google com papel **Owner** no projeto `obsidian-tasks-499613`. Editor,
      Viewer ou acesso delegado só no Search Console **não bastam**.
    - Deixar o TXT publicado enquanto a submissão estiver pendente.
    - Em caso de recusa: registrar no checklist, em até 1 dia útil, o método usado, o número da
      tentativa, data e hora, a mensagem de erro e o método alternativo. Máximo 3 tentativas com o
      mesmo método antes de trocar.
    - _Requirements: 1.3, 1.6, 1.8, 1.9_

  - [x] 4.9 👤 **MANUAL** Configurar a Consent_Screen
    - App name: `Momentum Life` (caixa exata, com espaço) — idêntico ao `<h1>` da homepage.
    - User support email; developer contact email **idêntico** ao email publicado nas duas páginas.
    - Application home page: `https://momentumlife.jnagase.com/`. Privacy policy link: a URL exata
      que respondeu `200` em 4.7. Terms of service: vazio.
    - Authorized domains: **uma única entrada, `jnagase.com`** — o domínio **raiz**, sem esquema,
      sem `www`, **sem os subdomínios**, sem caminho, sem porta, sem barra final. Não colocar
      `momentumlife.jnagase.com` aqui: o campo é de domínio registrável, e a entrada raiz já cobre
      os dois hosts.
    - Scopes: `https://www.googleapis.com/auth/tasks` como único sensível, nenhum restrito.
      **Imutável nesta spec** — alterar o conjunto de escopos invalida consentimentos.
    - User type `External`, publishing status `In production`. **Nunca voltar para `Testing`**: o
      Google revoga refresh tokens a cada 7 dias nesse estado.
    - **Sem logo** nesta submissão (D4) — logo dispara brand review em paralelo.
    - Registrar prints no checklist.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 1.4, 1.5_

- [x] 5. Checkpoint — páginas no ar e Google alinhado
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Fase 4 — Custom domain do Worker (dois hostnames ativos)

  - [x] 6.1 🤖 **CÓDIGO** Configurar `worker/wrangler.toml`
    - Adicionar `workers_dev = true` **explicitamente**, com comentário de que desligar isso quebra
      **toda** instalação antiga do plugin de uma vez (perde `/auth`, `/exchange` e `/refresh`).
    - Adicionar `[[routes]]` com `pattern = "momentumlife-auth.jnagase.com"` e
      `custom_domain = true`.
    - Não declarar nenhum binding de storage (KV, D1, R2, Durable Objects): o Broker é stateless por
      contrato, e a política de privacidade declara isso.
    - _Requirements: 6.1, 7.1_

  - [x]* 6.2 🤖 **CÓDIGO** Escrever testes de exemplo da configuração do Worker
    - Arquivo: `test/worker-config.test.ts`
    - Guarda de coerência: `routes[].pattern` do `wrangler.toml` é igual a
      `authHost` de `app-domain.json`. TOML não importa JSON, então esta é a única
      amarra entre os dois.
    - Guarda de `workers_dev`: falha se a flag não estiver `true`.
    - Guarda de stateless: `wrangler.toml` não declara binding de storage e o código do Worker não
      referencia `caches`, KV, D1 nem R2.
    - _Requirements: 3.5, 6.1, 7.1, 7.5_

  - [x] 6.3 ⚠️ **CONFIRMAÇÃO** Deploy do Worker com o custom domain
    - Perguntar ao usuário antes de rodar. Comando: `cd worker && npx wrangler deploy`.
    - O código ainda deriva o redirect do host — nada de comportamento muda aqui. Os dois callbacks
      já estão registrados (Fase 2), então nenhum fluxo quebra em nenhum dos hostnames.
    - **Verificação obrigatória logo após o deploy**: os quatro caminhos (`/auth`, `/callback`,
      `/exchange`, `/refresh`) respondem **no Legacy_Origin** e **no App_Domain**.
    - Registrar no checklist.
    - _Requirements: 6.1, 7.1_

- [x] 7. Fase 5 — Deploy do redirect canônico (gate I1 + I2)

  - [x] 7.1 🤖 **CÓDIGO** Trocar `url.origin` pelo `CANONICAL_REDIRECT_URI` em `worker/src/index.js`
    - Importar `CANONICAL_REDIRECT_URI` de `worker/src/config.js`.
    - Substituir `const redirectUri = url.origin + "/callback"` pela constante nas **duas**
      ocorrências: a de `/auth` e a de `/exchange`.
    - **As duas mudam juntas ou nada funciona.** O Google exige `redirect_uri` idêntico entre a
      requisição de consentimento e a troca de token; misturar constante e `url.origin` produz
      `redirect_uri_mismatch`.
    - Depois desta mudança o plugin não influencia mais o `redirect_uri` — quem escolhe é o Worker.
      É isso que sustenta a compatibilidade com o Legacy_Origin e permite remover o redirect legado
      na Fase 6.
    - _Requirements: 6.2, 6.4, 6.5, 7.2, 7.9_

  - [x] 7.2 🤖 **CÓDIGO** Validação de parâmetros obrigatórios e timeout no Broker
    - Validação (`worker/src/index.js`): `/auth` exige `code_challenge` e `state`; `/exchange` exige
      `code` e `code_verifier`; `/refresh` exige `refresh_token`. Ausente → `400` com
      `{ error: "missing_parameter", error_description: "<nome>" }` e **zero** requisições ao
      Google. Remover o `|| ""` que hoje deixa passar.
    - Timeout: `AbortSignal.timeout(10_000)` nas chamadas a `oauth2.googleapis.com/token`.
      **Sem retentativa.** Esgotado → `504` com `{ error: "timeout", error_description: "..." }`.
      Não alterar nenhum token já armazenado no plugin.
    - _Requirements: 6.9, 6.11_

  - [x] 7.3 🤖 **CÓDIGO** Passthrough de erro, callback com erro e secrets só do env
    - Passthrough: status e corpo de erro do Google voltam **crus**. Não envolver, não reescrever,
      não substituir por mensagem genérica. O `googleError()` do plugin depende de `error` e
      `error_description` intactos — e o `refreshToken()` decide `GoogleAuthExpiredError` a partir de
      `invalid_grant`. Registrar isso como comentário de invariante no código.
    - Callback: quando vem `error` sem `code`, o deep link `obsidian://momentum-google` carrega
      `error` **e `error_description`**, nenhuma troca de token é iniciada, e a página **não** diz
      "✓ Authorised". Redirecionamento em ≤ 2 s, com link acionável manualmente para o mesmo deep
      link.
    - Secrets: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` vêm **exclusivamente** do env; valores
      desses parâmetros vindos da requisição são ignorados silenciosamente; o secret nunca aparece
      em resposta, redirect, deep link ou HTML.
    - `SCOPES` do Worker permanece exatamente `https://www.googleapis.com/auth/tasks`. **Imutável.**
    - Caminho desconhecido: `200` com texto neutro, sem eco de parâmetro, sem contato com o Google.
    - _Requirements: 6.6, 6.7, 6.8, 6.10, 5.2_

  - [x]* 7.4 🤖 **CÓDIGO** Escrever property test do redirect canônico
    - **Property 1: O `redirect_uri` é canônico, qualquer que seja o host de entrada**
    - **Validates: Requirements 6.2, 6.4, 6.5, 7.2, 7.9**
    - Arquivo: `test/broker.property.test.ts`
    - Harness: importa o `default.fetch` de `worker/src/index.js`, chama com `new Request(url)` e um
      `env` sintético. `globalThis.fetch` mockado **com contador de chamadas** e resposta
      programável (status, corpo, latência). O gerador de hostname inclui o Legacy_Origin, o
      App_Domain e hosts arbitrários.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 1: O redirect_uri é canônico, qualquer que seja o host de entrada`

  - [x]* 7.5 🤖 **CÓDIGO** Escrever property test da irrelevância do host de entrada
    - **Property 2: O host de entrada não afeta a resposta**
    - **Validates: Requirements 7.1**
    - Arquivo: `test/broker.property.test.ts`
    - Asserta que status, corpo e destino de redirect são idênticos para a mesma requisição chegando
      no Legacy_Origin e no App_Domain, nos quatro caminhos.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 2: O host de entrada não afeta a resposta`

  - [x]* 7.6 🤖 **CÓDIGO** Escrever property test da transparência do Broker
    - **Property 3: O Broker é transparente ao que atravessa**
    - **Validates: Requirements 6.4, 6.6, 6.8, 6.10**
    - Arquivo: `test/broker.property.test.ts`
    - Geradores incluem string vazia, unicode e caracteres reservados de URL (`&`, `=`, `%`, `+`,
      `#`) para `state`, `code_challenge`, `code`, `error` e `error_description`.
    - Asserta: valor decodificado do outro lado idêntico ao de entrada; corpo de erro do Google
      voltando byte a byte com status ≥ 400; callback com `error` e sem `code` carregando os dois
      campos no deep link e não iniciando troca de token.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 3: O Broker é transparente ao que atravessa`

  - [x]* 7.7 🤖 **CÓDIGO** Escrever property test da rejeição de parâmetro ausente
    - **Property 4: Parâmetro obrigatório ausente é rejeitado sem contatar o Google**
    - **Validates: Requirements 6.9**
    - Arquivo: `test/broker.property.test.ts`
    - Gera qualquer subconjunto próprio dos obrigatórios de cada endpoint. Asserta erro nomeando o
      parâmetro ausente e **contador do mock em zero** — sem contador o assert de "zero requisições"
      não existe de verdade.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 4: Parâmetro obrigatório ausente é rejeitado sem contatar o Google`

  - [x]* 7.8 🤖 **CÓDIGO** Escrever property test de não-vazamento de segredo e escopo fixo
    - **Property 5: O pedido ao Google não vaza segredo e não cresce de escopo**
    - **Validates: Requirements 5.2, 6.7**
    - Arquivo: `test/broker.property.test.ts`
    - Inclui requisições que trazem `client_id`/`client_secret` na query e no corpo. Asserta uso
      exclusivo do env, ausência do valor do secret em **qualquer byte** de resposta, redirect, deep
      link ou página, e `scope` exatamente `https://www.googleapis.com/auth/tasks`.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 5: O pedido ao Google não vaza segredo e não cresce de escopo`

  - [x]* 7.9 🤖 **CÓDIGO** Escrever property test do timeout duro no Broker
    - **Property 6: Limite de tempo é duro e não há retentativa** — lado Broker
    - **Validates: Requirements 6.11**
    - Arquivo: `test/broker.property.test.ts`
    - Gera latências arbitrárias na resposta do Google. Asserta encerramento em ≤ 10 s,
      **exatamente uma** requisição pelo contador do mock, e falha distinguível de sucesso quando o
      limite estoura.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 6: Limite de tempo é duro e não há retentativa`

  - [x] 7.10 ⚠️ **CONFIRMAÇÃO** Deploy único do redirect canônico
    - Perguntar ao usuário antes de rodar. Comando: `cd worker && npx wrangler deploy`.
    - **Deploy único, em horário de baixo uso.** Existe uma janela de segundos em que um usuário que
      iniciou o consentimento antes do deploy e chega no `/exchange` depois recebe
      `redirect_uri_mismatch`. Desfecho benigno: nenhum token existente é afetado, e o usuário
      resolve clicando em conectar de novo.
    - Conferir `Config/google-auth-debug.md` depois do deploy.
    - Reversível: `wrangler rollback` ou redeploy do código anterior — a Fase 2 é aditiva, então os
      dois redirects estão registrados e ambos os códigos funcionam.
    - _Requirements: 6.1, 6.2_

  - [x] 7.11 👤 **MANUAL** 🚦 **GATE I1** — plugin antigo conecta do zero depois do deploy canônico
    - Exige conta Google real. Instalar uma versão do plugin **anterior** a esta spec (WORKER_BASE =
      Legacy_Origin) e conectar do zero, concluindo o sync.
    - Prova direta de que `/auth` e `/exchange` concordam no redirect canônico a partir do host
      legado. **Falha com `redirect_uri_mismatch` = as duas linhas da tarefa 7.1 não foram trocadas
      juntas.**
    - **Bloqueia a Fase 6.** Registrar resultado e data no checklist.
    - _Requirements: 7.1, 7.2, 7.9_

  - [x] 7.12 👤 **MANUAL** 🚦 **GATE I2** — refresh token pré-migração renova pelo Legacy_Origin
    - Exige conta Google real com refresh token emitido **antes** da migração. Renovar pelo
      Legacy_Origin e obter, em ≤ 10 s, um access token aceito pela Google Tasks API, **sem** nova
      autorização do usuário.
    - **Bloqueia a Fase 6.** Registrar resultado e data no checklist.
    - _Requirements: 7.3_

- [x] 8. Checkpoint — Broker canônico validado
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Fase 6 — Remover o redirect legado do OAuth_Client

  - [x] 9.1 👤 **MANUAL** Remover o redirect URI de `workers.dev`
    - **Só executar com I1 (7.11) e I2 (7.12) verdes.** Antes disso, remover deixa usuários sem
      autenticação.
    - Remover `https://momentum-google.jaime-nagase.workers.dev/callback` dos authorized redirect
      URIs. Nenhuma versão do plugin faz o Google redirecionar para lá — quem escolhe o redirect é o
      Worker.
    - Estado final: **um único** authorized redirect URI, `Authorized domains` com **uma** entrada,
      **nenhuma exceção a declarar ao Google**.
    - O Legacy_Origin **continua no ar** servindo `/auth`, `/exchange` e `/refresh`
      indefinidamente — só o `/callback` deixa de ser exercido nesse hostname. Nada nesta spec
      desativa o Legacy_Origin.
    - Reversível em minutos: basta re-adicionar. Registrar no checklist, marcando a exceção do
      Requirement 1 critério 7 como resolvida por design.
    - _Requirements: 1.7, 7.11, 7.6_

  - [x] 9.2 👤 **MANUAL** Refazer I1 depois da remoção
    - Repetir o cenário I1 com o redirect legado já removido, para confirmar que o fluxo do plugin
      antigo continua íntegro com um único redirect registrado.
    - Registrar no checklist.
    - _Requirements: 7.1, 7.2, 7.11_

- [x] 10. Fase 7 — Release único do plugin (gate I3 + I4)

  Um **único commit** e um **único release** com código + política v2 + README + whatsnew + bump.
  Não fatiar: a política de privacidade não pode ficar mais generosa que o código (D11).

  - [x] 10.1 🤖 **CÓDIGO** `src/googletasks.ts` — WORKER_BASE derivado, remoção do `userinfo` e
        mensagem de cap
    - Importar `WORKER_BASE` de `src/appdomain.ts` em vez de declarar o literal. **Sem fallback para
      o Legacy_Origin**: o legacy segue no ar para quem não atualizou, mas nenhuma versão nova volta
      a ele.
    - Remover `fetchEmail()` e sua chamada a `oauth2/v3/userinfo` (D10). A chamada de hoje falha com
      401 porque o escopo pedido não a autoriza, e manter uma chamada condenada a falhar contradiz a
      declaração "o app só acessa tasks e listas de tasks".
    - Manter `email?` no tipo `GoogleToken` (apenas não populado) para **não invalidar `data.json`**
      de instalações existentes. A UI já cai em "Connected as Google user".
    - Autorização recusada por limite de usuários do projeto: mensagem identificando o **teto de 100
      contas** como causa, com o link de acompanhamento da verificação e a informação de que quem já
      autorizou continua sincronizando. **Preservar** o token já armazenado.
    - _Requirements: 3.3, 3.7, 7.5, 11.3, 11.7_

  - [x] 10.2 🤖 **CÓDIGO** `src/googletasks.ts` — `revokeGoogleToken()` e redação de segredos
    - `export type RevokeOutcome = { ok: true } | { ok: false; reason: "google_error" | "network" | "timeout"; detail: string }`.
    - `revokeGoogleToken(token)`: `POST https://oauth2.googleapis.com/revoke`,
      `application/x-www-form-urlencoded`, `token=<refresh_token ?? access_token>` — revogar o
      refresh token invalida os access tokens derivados dele.
    - `requestUrl` com `throw: false` (o default lança em 4xx e transformaria as guardas de status em
      código morto). **Uma tentativa, sem retry**, limite de 10 s via `Promise.race` com
      `window.setTimeout` (o `requestUrl` não expõe timeout); perder a corrida devolve
      `{ ok: false, reason: "timeout" }` e a requisição órfã é ignorada. **Não toca o token
      armazenado** — quem remove é `disconnectGoogleTasks()`.
    - `detail` vem de `googleError()` e **nunca** contém token.
    - `redactSecrets(line, token)`: substitui qualquer ocorrência de access token, refresh token,
      authorization code e client secret por `<redacted>`. Aplicado a **toda** linha antes de entrar
      no buffer de `Config/google-auth-debug.md`, num **ponto único de escrita**.
    - Formato da entrada de log: `- <ISO 8601> · stage=<authorize|exchange|refresh|revoke> · error=… · error_description=…`
      ou, quando o corpo não é interpretável, `- <ISO 8601> · stage=… · unparseable body (first 500 chars): …`
      truncado em 500 caracteres.
    - _Requirements: 4.1, 4.2, 4.4, 11.4, 11.5, 11.6_

  - [x] 10.3 🤖 **CÓDIGO** `src/main.ts` — `disconnectGoogleTasks()` com confirmação
    - `ConfirmModal` em inglês, sentence case:
      `"Disconnect Google tasks? The app's access to your Google account will be revoked. Your task notes in the vault are kept."`
    - **Cancelar** → retorna. Token byte a byte inalterado, **nenhuma** requisição enviada.
    - **Confirmar** → `revokeGoogleToken(token)`; e **sempre** (sucesso ou falha) `googleToken = null`,
      `saveSettings()`, reagendar o intervalo de sync (o timer deixa de existir em vez de rodar e
      cair na guarda), rerender das settings.
    - Notice conforme resultado: sucesso → `"✓ Google tasks: access revoked and disconnected."`;
      falha → `"Google tasks: disconnected locally, but revocation wasn't confirmed. You can also remove access at myaccount.google.com/permissions."`
    - Log com `stage=revoke`, timestamp e `detail`, passando pelo redator.
    - **Não tocar**: nenhuma nota do vault, nenhum frontmatter, nenhum `google_id`/`google_list`,
      nenhuma task ou lista na conta Google. **Preservar `gtBaselines`** no `data.json`, para uma
      reconexão futura retomar o merge 3-way em vez de tratar tudo como primeiro contato.
    - Trocar apenas o handler do botão `"Disconnect"` para chamar `plugin.disconnectGoogleTasks()`
      em vez de zerar o token inline.
    - Estado desconectado é `googleToken = null` — não objeto vazio, não string vazia; as guardas
      espalhadas pelo código dependem disso, e nenhum gatilho (startup, intervalo, manual) executa
      sync sem token.
    - _Requirements: 4.3, 4.5, 4.6, 4.7_

  - [x]* 10.4 🤖 **CÓDIGO** Escrever property test do timeout duro na revogação
    - **Property 6: Limite de tempo é duro e não há retentativa** — lado plugin
    - **Validates: Requirements 4.1**
    - Arquivo: `test/disconnect.property.test.ts`
    - Harness: `requestUrl` do Obsidian mockado **com contador**, `App`/`Vault` falsos com snapshot
      de arquivos, fake timers do vitest.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 6: Limite de tempo é duro e não há retentativa`

  - [x]* 10.5 🤖 **CÓDIGO** Escrever property test do fluxo de desconexão
    - **Property 7: Desconectar sempre termina desconectado; cancelar nunca muda nada**
    - **Validates: Requirements 4.1, 4.2, 4.5, 4.6**
    - Arquivo: `test/disconnect.property.test.ts`
    - Gera qualquer token armazenado, qualquer decisão na confirmação e qualquer resultado da
      revogação (sucesso, erro do Google, rede, timeout). Asserta: cancelar preserva o token byte a
      byte e envia zero requisições; confirmar envia **exatamente uma** revogação carregando o
      refresh token quando existe e o access token quando não, termina com `googleToken` `null` no
      `data.json` (sem access, sem refresh, sem email) e exibe a mensagem correspondente ao
      resultado.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 7: Desconectar sempre termina desconectado; cancelar nunca muda nada`

  - [x]* 10.6 🤖 **CÓDIGO** Escrever property test da preservação de estado em falha de auth
    - **Property 8: Falha de autenticação não destrói estado**
    - **Validates: Requirements 4.3, 7.10, 11.7**
    - Arquivo: `test/disconnect.property.test.ts`
    - Gera qualquer estado de vault e qualquer recusa do Google (refresh recusado, autorização
      recusada por cap, revogação que falha). Asserta: nenhuma nota criada, apagada, movida ou
      alterada; nenhum `google_id`/`google_list` mudado; nenhuma task ou lista do Google escrita ou
      apagada; nenhuma reautorização automática; refresh token preservado em recusa de refresh.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 8: Falha de autenticação não destrói estado`

  - [x]* 10.7 🤖 **CÓDIGO** Escrever property test do log de auth
    - **Property 9: A entrada de log é sempre bem-formada e nunca contém segredo**
    - **Validates: Requirements 3.6, 4.4, 11.4, 11.5, 11.6**
    - Arquivo: `test/disconnect.property.test.ts`
    - Gera corpos de erro variados (JSON com os campos, JSON sem, texto não interpretável, vazio,
      arbitrariamente longo) e qualquer token armazenado. Asserta ISO 8601 + `stage` válido; ou os
      campos extraídos, ou a marca de corpo ausente/não interpretável com ≤ 500 caracteres; e
      **nenhuma** linha contendo access token, refresh token, authorization code ou client secret.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 9: A entrada de log é sempre bem-formada e nunca contém segredo`

  - [x]* 10.8 🤖 **CÓDIGO** Escrever property test da superfície de rede do plugin
    - **Property 10: A superfície de rede do plugin é fechada**
    - **Validates: Requirements 3.2, 3.3, 3.7, 3.12, 4.7**
    - Arquivo: `test/network-surface.property.test.ts`
    - Harness: mock de `requestUrl` que **registra host e corpo** de cada chamada; roda
      connect/refresh/sync/revoke sobre vaults gerados.
    - Asserta: todo host contactado pertence a
      `{ momentumlife-auth.jnagase.com, oauth2.googleapis.com, tasks.googleapis.com }`; todo corpo enviado a
      `tasks.googleapis.com` tem chaves contidas em
      `{ id, title, notes, due, status, completed }`; sem token armazenado, nenhum gatilho produz
      requisição a `tasks.googleapis.com`.
    - `fc.assert(fc.property(...), { numRuns: 100 })`
    - Tag: `// Feature: google-oauth-verification, Property 10: A superfície de rede do plugin é fechada`

  - [x] 10.9 🤖 **CÓDIGO** Publicar a política de privacidade na **versão v2**
    - Editar `site/privacy.html`: em "Revoking access", o caminho do plugin passa a declarar que
      desconectar **revoga o acesso do app** e remove o token local. O caminho da página de
      permissões da conta Google permanece.
    - `Last updated` passa para a **data do release**.
    - Esta edição vai no **mesmo commit** do código de revogação (D11). Publicar antes criaria uma
      declaração mais generosa que o código; publicar depois deixaria a política desatualizada.
    - _Requirements: 3.9, 3.15, 4.6_

  - [x] 10.10 🤖 **CÓDIGO** Atualizar o `README.md`
    - Link para a Privacy_Policy_Page apontando para a **mesma URL** registrada na Consent_Screen
      (a que respondeu `200` em 4.7).
    - Seção do aviso "Google hasn't verified this app": **passos numerados**, do aviso até o retorno
      ao Obsidian com a conexão concluída.
    - Aviso do teto: no máximo **100 contas** Google podem autorizar o app durante toda a vida do
      projeto `obsidian-tasks-499613`, o teto **não pode ser resetado**, e ao ser atingido novas
      contas ficam impedidas de autorizar até a verificação ser aprovada.
    - _Requirements: 3.13, 11.1, 11.2_

  - [x] 10.11 🤖 **CÓDIGO** Adicionar a entrada de CHANGELOG em `src/whatsnew.ts`
    - Entrada da versão do release informando, em uma linha, que a **conexão com o Google continua
      ativa** e que **nenhuma ação do usuário é necessária**.
    - Sentence case, conforme a regra de lint de UI do projeto.
    - _Requirements: 7.8_

  - [x]* 10.12 🤖 **CÓDIGO** Escrever testes de exemplo de coerência do release
    - Arquivo: `test/identity.test.ts`
    - Coerência de identidade: nome do app, email de contato e URL da política **idênticos** entre
      `site/index.html`, `site/privacy.html`, `README.md` e as constantes derivadas de
      `app-domain.json` — comparação caractere a caractere, incluindo esquema, host, caminho e barra
      final.
    - CHANGELOG do release: a entrada da versão corrente em `src/whatsnew.ts` diz que a conexão
      continua ativa e que nada precisa ser feito.
    - Mensagem de cap: resposta simulada de limite de usuários produz a Notice esperada.
    - _Requirements: 3.13, 5.5, 7.8, 11.3_

  - [x] 10.13 🤖 **CÓDIGO** Bump de versão nos quatro arquivos e alinhamento do lock
    - Bumpar a mesma SemVer em `manifest.json`, `versions.json`, `package.json` e o `USER_AGENT` de
      `src/foodapi.ts`. Os quatro em sincronia.
    - Rodar `npm install --package-lock-only` para alinhar o `package-lock.json` — o workflow de
      release usa `npm ci`, e lock dessincronizado já quebrou a verificação de attestation.
    - _Requirements: 7.8_

  - [x] 10.14 ⚠️ **CONFIRMAÇÃO** Lint, build e deploy local no vault de teste
    - Perguntar ao usuário antes de rodar. Ordem: `npx eslint src --ext .ts` → `npm test` →
      `npm run build`.
    - O warning pré-existente `'ymdLocal' is defined but never used` em `src/data.ts` é inofensivo.
    - Deploy local:
      `cp main.js manifest.json styles.css "/Users/jnagase/Documents/obsidian_1/.obsidian/plugins/momentum-life/"`
    - **Avisar o usuário para recarregar o plugin** (Community plugins → desliga e liga o Momentum
      Life, ou fecha e reabre o Obsidian).

  - [x] 10.15 👤 **MANUAL** 🚦 **GATE I3** — upgrade com token existente, primeiro sync sem consent
    - Exige conta Google real. Partir de uma instalação na versão antiga **com token armazenado**,
      atualizar para a versão construída em 10.14, e confirmar que o primeiro sync conclui **sem
      exibir tela de consentimento** — o refresh token é reutilizado nas requisições ao App_Domain.
    - **Bloqueia o release (10.16).** Registrar no checklist.
    - _Requirements: 7.4_

  - [x] 10.16 👤 **MANUAL** 🚦 **GATE I4** — disconnect real revoga e preserva as notas
    - Exige conta Google real. Executar o disconnect e confirmar que o acesso **desaparece de
      `myaccount.google.com/permissions`** e que as notas de task do vault continuam intactas,
      incluindo `google_id` e `google_list`.
    - Conferir que `Config/google-auth-debug.md` registrou `stage=revoke` **sem** nenhum token.
    - **Bloqueia o release (10.17).** Registrar no checklist.
    - _Requirements: 4.1, 4.3, 4.4, 4.6_

  - [x] 10.17 ⚠️ **CONFIRMAÇÃO** Publicar o release
    - **Só com I3 (10.15) e I4 (10.16) verdes**, e só com ordem explícita do usuário.
    - **Um único commit** com: `src/appdomain.ts`, `src/googletasks.ts`, `src/main.ts`,
      `src/whatsnew.ts`, `site/privacy.html` (v2), `README.md`, os quatro arquivos de versão e o
      `package-lock.json`. Staging explícito dos arquivos; **não** commitar `.kiro/settings/` nem
      `.vscode/`.
    - Mensagem de commit **sem `!`** (o history expansion do bash quebra), aspas simples.
    - `git push origin main` publica o Pages com a política v2; `git tag X.Y.Z` (SemVer do
      `manifest.json`, **sem prefixo `v`**) e `git push origin X.Y.Z` dispara a Action do release.
    - **Fazer os dois na mesma sessão**: a janela entre "política v2 no ar" e "release existe" tem
      que ser de minutos.
    - Depois: `gh attestation verify <asset> --repo jnagase/obsidian-momentum` (exit 0) e conferir
      que o `main.js` publicado não contém `child_process`.
    - _Requirements: 7.8_

- [x] 11. Checkpoint — release publicado
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Fase 8 — Artefatos de submissão e vídeo demonstrativo

  - [x] 12.1 🤖 **CÓDIGO** Escrever `docs/oauth-verification/scope-justification.md`
    - Texto único em **inglês**, **≤ 4.000 caracteres**, cinco blocos:
      1. **Scope and feature** — string exata `https://www.googleapis.com/auth/tasks`; sync
         bidirecional entre o vault e o Google Tasks como **única** funcionalidade dependente;
         nenhum outro escopo sensível ou restrito além dos não sensíveis de identificação básica
         adicionados por padrão pelo Google.
      2. **Why read-only is not enough** — as quatro escritas (create task, update task, mark task
         completed, delete task) e a afirmação de que `.../auth/tasks.readonly` não permite nenhuma
         das quatro.
      3. **Where the data goes** — markdown no vault local; o autor não opera servidor de
         armazenamento; o Broker só faz handshake, sem receber, processar ou persistir conteúdo de
         task, token ou identificador.
      4. **Limited Use** — as quatro restrições explícitas: não vendido, não transferido a
         terceiros, não usado para publicidade, não usado para treinar IA; usado somente para o sync
         pedido pelo usuário.
      5. **Consistency** — mesmas afirmações de armazenamento, compartilhamento e retenção da
         política de privacidade, no mesmo nível de detalhe.
    - Este arquivo é a **fonte**; o campo do Verification Center recebe cópia **idêntica**. Guardar o
      hash do arquivo submetido no checklist.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 12.2 🤖 **CÓDIGO** Escrever `docs/oauth-verification/demo-video-script.md`
    - Quatro tomadas, conforme a tabela do design. "Contínua" = sem corte **dentro** da tomada;
      cortes entre tomadas são permitidos, **exceto** entre o consentimento e o retorno ao Obsidian.
      1. **Setup e consent** — settings do Momentum Life com o nome do plugin visível → clique em
         conectar → consent screen com `Momentum Life` e a permissão do escopo → **barra de endereço
         expandida** mostrando `client_id=8btbj3o6…` e o `redirect_uri` canônico legíveis →
         aprovação → deep link `obsidian://momentum-google` → confirmação nas settings. **Sem corte
         do clique até a confirmação.**
      2. **Obsidian → Google** — criar task fictícia no board → acionar "Sync now" → mostrar a mesma
         task no Google Tasks com a lista correspondente visível.
      3. **Google → Obsidian** — criar task no Google Tasks → acionar "Sync now" → mostrar a nota no
         board correspondente.
      4. **Encerramento** — restabelecer plugin, escopo e finalidade.
    - Restrições de gravação a documentar: conta Google de **teste** (D7); títulos fictícios;
      nenhuma outra aba, notificação do sistema ou nota do vault com dado real em quadro; 2 a 10
      minutos; mínimo 1280×720 com o texto legível em pausa; narração ou legenda **própria** em
      inglês, sem legenda automática do YouTube; YouTube público ou unlisted, mesma URL até a
      decisão final.
    - Registrar que o clique em conectar da tomada 1 **consome 1 vaga** do cap de 100.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [x]* 12.3 🤖 **CÓDIGO** Escrever testes de exemplo dos documentos de submissão
    - Arquivo: `test/submission-docs.test.ts`
    - Asserta em `scope-justification.md`: presença da string exata do escopo; as quatro operações
      de escrita; a menção a `tasks.readonly` como insuficiente; as quatro restrições de Limited
      Use; `length <= 4000`.
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

  - [ ] 12.4 👤 **MANUAL** Gravar e publicar o Demo_Video
    - Executar o roteiro de 12.2 com a **conta Google de teste**, sobre a versão publicada em 10.17.
    - Publicar no YouTube como público ou unlisted, sem restrição de idade, acessível sem login.
    - Registrar no checklist: URL do vídeo, data de publicação, a conta de teste utilizada e o
      **consumo de 1 vaga** do limite vitalício de 100 usuários.
    - _Requirements: 9.1, 9.10_

  - [ ] 12.5 👤 **MANUAL** Revisão humana do vídeo e do idioma das páginas
    - Revisar o vídeo **quadro a quadro**: nenhum dado pessoal real de terceiros (nome, email,
      telefone, endereço), incluindo abas do navegador, notificações do sistema e outras notas do
      vault; nome do app idêntico ao da Consent_Screen; texto dos critérios 3, 4 e 6 legível com o
      vídeo pausado; duração entre 2 e 10 minutos.
    - Revisar que todo o conteúdo exigido em `site/index.html` e `site/privacy.html` está em inglês.
    - Qualquer divergência **bloqueia a submissão** até uma nova gravação publicada na mesma URL
      registrada.
    - _Requirements: 2.8, 3.14, 9.8, 9.9, 9.11_

- [ ] 13. Fase 9 — Submissão e acompanhamento do review

  - [ ] 13.1 👤 **MANUAL** Rodar os smoke checks finais e preencher o checklist
    - Registrar, com print ou saída de comando como evidência: domínio ativo e data de expiração
      (WHOIS/RDAP); certificados do apex e de `auth.` válidos com cadeia completa; propriedade
      verificada no Search Console **com papel Owner**; todos os campos da Consent_Screen; os
      redirect URIs do OAuth_Client (um só); publishing status `In production` e user type
      `External`; escopos; contador de vagas do cap; propriedades do arquivo de vídeo.
    - **Re-rodar I5** (`curl -sSI` na homepage e na política) com o conteúdo final: `200` direto,
      sem `301`, sem `X-Robots-Tag`.
    - Atualizar o estado de cada linha do checklist e a data da última mudança.
    - _Requirements: 1.1, 1.2, 1.3, 1.8, 2.1, 3.1, 5.1, 5.2, 5.3, 5.8, 10.1, 10.9_

  - [ ] 13.2 👤 **MANUAL** 🚦 **GATE Property 13** — verificar que o gate de submissão está vazio
    - Rodar `test/checklist.property.test.ts` e o teste de cobertura contra o checklist preenchido.
    - Condição única para liberar o envio: **`blockingItems` vazio** — todos os itens no estado
      `concluído`. Havendo qualquer item em outro estado, **não enviar**, e identificar no checklist
      os pendentes ou bloqueados.
    - _Requirements: 3.16, 8.8, 9.11, 10.2, 10.8_

  - [ ] 13.3 👤 **MANUAL** Enviar a Verification_Submission
    - Verification Center do projeto `obsidian-tasks-499613`. Colar no campo de justificativa uma
      cópia **idêntica** ao `scope-justification.md`, informar a URL do vídeo e os links das duas
      páginas.
    - Registrar no checklist a data de envio, o hash do texto submetido e o contador de vagas.
    - _Requirements: 10.2, 8.7, 9.1, 10.9_

  - [ ] 13.4 👤 **MANUAL** Acompanhar o review
    - Regras que valem durante todo o review: **não** voltar o publishing status para `Testing`
      (revoga refresh tokens a cada 7 dias); **não** criar OAuth_Client novo; **não** alterar o
      conjunto de escopos; manter o TXT do Search Console publicado; manter as duas páginas
      respondendo `200`; não alterar os valores declarados em "Authorized domains".
    - Pedido de informação adicional: registrar em até **1 dia útil** do recebimento a data, o
      **texto integral** do pedido e o prazo informado pelo Google; e em até 1 dia útil do envio, a
      resposta e a data.
    - Recusa: registrar data, motivo informado, o critério desta spec afetado com estado
      `bloqueado` e o item de correção correspondente.
    - Perda da verificação do domínio: registrar detecção, causa e reverificação, e **bloquear**
      novas interações com o Verification Center até a reverificação concluir.
    - Atualizar o contador de vagas a cada envio e a cada resposta.
    - _Requirements: 1.9, 5.3, 5.6, 5.7, 5.8, 10.3, 10.4, 10.5, 10.6, 10.9, 10.10_

  - [ ] 13.5 🤖 **CÓDIGO** Pós-aprovação: limpar o README e registrar no whatsnew
    - **Só depois da aprovação.** Na primeira versão publicada após a aprovação: remover do
      `README.md` as instruções da tela "Google hasn't verified this app" e o aviso do teto de
      contas autorizáveis.
    - Adicionar entrada em `src/whatsnew.ts` registrando que **nenhuma ação do usuário é
      necessária**.
    - Bump nos quatro arquivos de versão e `npm install --package-lock-only`, seguindo o mesmo
      processo de release (build, commit e tag pedem confirmação explícita do usuário).
    - _Requirements: 10.7_

- [ ] 14. Checkpoint final
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um caminho mais curto — aqui são
  os testes de propriedade e de exemplo.
- **A ordem das fases é restrição de segurança, não preferência.** Fase fora de ordem deixa usuário
  sem autenticação. Os três acoplamentos duros: Fase 5 depende de Fase 2 (redirect registrado) e
  Fase 4 (custom domain no ar); Fase 6 depende de I1 e I2 verdes; Fase 7 depende de I3 e I4 verdes.
- **Tarefas 👤 MANUAL não são executáveis por agente** — exigem console de plataforma (Cloudflare
  Registrar, Cloudflare Pages, Cloudflare Worker custom domain, Google Cloud Console, Google Search
  Console, YouTube, Verification Center) ou conta Google real. Um agente de código deve parar nelas
  e devolver o controle ao usuário.
- **Tarefas ⚠️ CONFIRMAÇÃO** (build, deploy, commit, push) só rodam com ordem explícita do usuário,
  conforme o steering do projeto.
- **Gates de integração**: I1 e I2 na tarefa 7.11/7.12 (bloqueiam a Fase 6); I3 e I4 na tarefa
  10.15/10.16 (bloqueiam o release); I5 na tarefa 4.7 (bloqueia a submissão, re-verificado em 13.1).
- **Property tests**: 13 propriedades, 14 tarefas de teste (a Property 6 tem lado Broker e lado
  plugin, em harnesses diferentes). Todas com `numRuns: 100` mínimo, fast-check, e a tag
  `// Feature: google-oauth-verification, Property N: <texto>` imediatamente acima do teste.
- **O release da Fase 7 é um commit único.** Não fatiar: a política de privacidade não pode ficar
  mais generosa que o código (D11).
- **Domínio decidido:** `jnagase.com` (já do autor, nada a comprar). Site em
  `momentumlife.jnagase.com`, Broker em `momentumlife-auth.jnagase.com`, "Authorized domains" com a
  entrada raiz `jnagase.com`. **Nenhum valor pendente na spec.**
- **Trocar os hosts depois** = editar `app-domain.json` + `routes[].pattern` em
  `worker/wrangler.toml`, e reexecutar os passos de plataforma. Nenhum literal de host existe em
  `src/`, `worker/src/` ou `site/` — garantido pela Property 11.
- **Não transformar o hífen em ponto** nos hosts. `momentumlife-auth.jnagase.com` é subdomínio de
  primeiro nível e pega o Universal SSL; `auth.momentumlife.jnagase.com` é de segundo nível e
  ficaria sem certificado automático (D3b).
- **Regras que valem em todas as fases**: nunca criar OAuth_Client novo; nunca alterar o conjunto de
  escopos; nunca voltar o publishing status para `Testing`; nunca desligar o subdomínio `workers.dev`
  do Worker; nunca remover um redirect URI antes de validar o fluxo sem ele.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.5"] },
    { "id": 1, "tasks": ["1.2", "1.6"] },
    { "id": 2, "tasks": ["1.3", "1.7"] },
    { "id": 3, "tasks": ["1.4", "3.1"] },
    { "id": 4, "tasks": ["4.1", "4.3"] },
    { "id": 5, "tasks": ["4.2"] },
    { "id": 6, "tasks": ["4.4", "4.5", "6.1"] },
    { "id": 7, "tasks": ["4.6", "6.2"] },
    { "id": 8, "tasks": ["4.7", "4.8"] },
    { "id": 9, "tasks": ["4.9"] },
    { "id": 10, "tasks": ["6.3"] },
    { "id": 11, "tasks": ["7.1"] },
    { "id": 12, "tasks": ["7.2"] },
    { "id": 13, "tasks": ["7.3"] },
    { "id": 14, "tasks": ["7.4"] },
    { "id": 15, "tasks": ["7.5"] },
    { "id": 16, "tasks": ["7.6"] },
    { "id": 17, "tasks": ["7.7"] },
    { "id": 18, "tasks": ["7.8"] },
    { "id": 19, "tasks": ["7.9"] },
    { "id": 20, "tasks": ["7.10"] },
    { "id": 21, "tasks": ["7.11"] },
    { "id": 22, "tasks": ["7.12"] },
    { "id": 23, "tasks": ["9.1"] },
    { "id": 24, "tasks": ["9.2"] },
    { "id": 25, "tasks": ["10.1", "10.9", "10.10", "10.11", "10.13"] },
    { "id": 26, "tasks": ["10.2"] },
    { "id": 27, "tasks": ["10.3", "10.12"] },
    { "id": 28, "tasks": ["10.4", "10.8"] },
    { "id": 29, "tasks": ["10.5"] },
    { "id": 30, "tasks": ["10.6"] },
    { "id": 31, "tasks": ["10.7"] },
    { "id": 32, "tasks": ["10.14"] },
    { "id": 33, "tasks": ["10.15"] },
    { "id": 34, "tasks": ["10.16"] },
    { "id": 35, "tasks": ["10.17"] },
    { "id": 36, "tasks": ["12.1", "12.2"] },
    { "id": 37, "tasks": ["12.3"] },
    { "id": 38, "tasks": ["12.4"] },
    { "id": 39, "tasks": ["12.5"] },
    { "id": 40, "tasks": ["13.1"] },
    { "id": 41, "tasks": ["13.2"] },
    { "id": 42, "tasks": ["13.3"] },
    { "id": 43, "tasks": ["13.4"] },
    { "id": 44, "tasks": ["13.5"] }
  ]
}
```
