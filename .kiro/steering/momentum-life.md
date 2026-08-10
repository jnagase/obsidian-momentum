# Momentum Life — regras do projeto

Guia de trabalho para o plugin Obsidian **Momentum Life**. Consolidado a partir das
nossas conversas. Vale para toda interação neste repositório.

## Princípios gerais
- **Pense sempre no usuário.** Toda mudança precisa considerar o impacto real de quem usa
  o plugin no dia a dia. Um **upgrade tem que ser transparente**: o usuário atualiza e as
  coisas continuam funcionando, sem passos manuais, sem perda de dados, sem surpresa.
  Migrações rodam sozinhas e avisam com um Notice (ver seção Migrações).
- **Os dados e pastas dentro do `Momentum Life` são a fonte de verdade.** Sempre que
  possível, construa as funcionalidades em cima da estrutura de arquivos/pastas do vault
  (como refizemos em Tasks, onde a pasta do board é 100% a fonte de verdade). Evite estado
  paralelo em índices/arquivos de controle quando a própria estrutura de pastas já pode
  representar o dado.

## Comunicação
- **Responda sempre em português (PT-BR).** Código, caminhos e identificadores em inglês.
- Assuma os próprios erros. Não jogue a culpa no usuário por bagunça gerada em
  desenvolvimento/testes. Diferencie o que é **problema real de produto** (merece fix no
  código) do que é **sujeira de teste/vibe coding** (resolve local, sem build).

## Processo de trabalho
- **Depois de mexer no código, SEMPRE pergunte ao usuário se ele quer buildar** antes de
  rodar o build. Nunca buildar automaticamente sem confirmação.
- **Steering vivo:** ao longo das interações, avalie se surgiu regra/decisão nova. Ao final,
  **proponha ao usuário o que adicionar/mudar no steering e só grave após a aprovação dele.**

## Build e deploy
- Tudo é **local**. Só commitar/publicar no git quando o usuário mandar **explicitamente**.
- Build: `npm run build` (roda `tsc -noEmit -skipLibCheck` + esbuild).
- Lint: `npx eslint src --ext .ts`. O warning `'ymdLocal' is defined but never used` em
  `src/data.ts` é **pré-existente e inofensivo** — pode ignorar.
- Deploy (cópia local pro vault de teste):
  `cp main.js manifest.json styles.css "/Users/jnagase/Documents/obsidian_1/.obsidian/plugins/momentum-life/"`
- **Depois do deploy, avise o usuário para recarregar o plugin** (Community plugins →
  desliga e liga o Momentum Life; ou fecha/reabre o Obsidian).

## Release / promover pra prod (só quando o usuário mandar)
- Repo: `github.com/jnagase/obsidian-momentum`, branch `main`. `main.js` é **gitignored**
  (a CI builda). Releases saem via `.github/workflows/release.yml`, disparado por **push de
  tag** (qualquer tag) → builda e cria o GitHub Release com `main.js`/`manifest.json`/`styles.css`.
- Passos: bump de versão em **`manifest.json` + `package.json` + `versions.json`** (mesma
  SemVer; tag SEM `v`, ex.: `0.5.0`) → commit → `git push origin main` → `git tag X.Y.Z` →
  `git push origin X.Y.Z`.
- Staging do commit: adicionar explicitamente (`manifest.json package.json versions.json
  styles.css eslint.config.mjs src mcp .kiro/steering`). **Não commitar** `.kiro/settings/`
  nem `.vscode/` (config de máquina). `node_modules`, `main.js`, `*.log` já são ignorados.
- **Secret / push protection:** RESOLVIDO na 0.5.1 — o secret saiu do plugin (foi pro
  Cloudflare Worker, ver seção "Google Tasks sync"). Commits novos não têm secret, então o
  push não é mais bloqueado. (A 0.5.0 teve o secret liberado manualmente pelos links de
  unblock; o antigo continua público nos `main.js` de releases ≤0.5.0 → rotacionar.)

## Ambiente (importante)
- **Vault de teste:** `/Users/jnagase/Documents/obsidian_1/` (NÃO é `Obsidian_jnagase`).
  Data root dentro do vault: `Momentum Life`. Plugin em
  `/Users/jnagase/Documents/obsidian_1/.obsidian/plugins/momentum-life/`.
- O **workspace (código) está no OneDrive**; o **vault NÃO está**. Operações no vault
  usam caminho absoluto e rodam normalmente.
- **O shell (execute_bash) é instável**: saída às vezes vem truncada/"not a tty" e o
  exit code costuma ser `-1` mesmo em sucesso. Padrão confiável:
  redirecionar a saída para um arquivo de log no workspace (`cmd > mm.log 2>&1`), depois
  ler com a ferramenta de leitura, e por fim apagar o log (`rm -f mm.log`).
- **NUNCA editar arquivos do vault com `sed`/shell** (lição aprendida na prática): o comando
  chega mangled (caracteres especiais como `/`, `<`, `>`, `"` são comidos) e **corrompe dados
  do usuário**. Para escrever/corrigir notas do vault, usar o **MCP** (`create_task`,
  `update_task` — grava frontmatter com `JSON.stringify`, escapando certo) ou as ferramentas
  de edição de arquivo. Shell no vault só para **leitura** (`ls`, `cat`, `grep`, `find`).
- **Não editar o vault com o Obsidian ABERTO.** O plugin reage às mudanças em disco (adopt,
  sync, arquivamento) e briga com a edição — já resultou em card arquivado em `_orphaned` no
  meio de uma correção. Pedir ao usuário para fechar o Obsidian antes de mexer.
- **NÃO rodar scripts Python** — travam em "working" por muito tempo. O usuário reclamou.
- Evitar comandos pesados/lentos (find recursivo grande, greps enormes) — podem travar.
- Preferir `requestUrl` (Obsidian) a `fetch`. Usar `window.setTimeout`, não `setTimeout`.
- **Não usar `console.log`** (o lint bloqueia) — usar logs em arquivo ou `Notice`.

## Lint / convenções de UI
- Regra `obsidianmd/ui/sentence-case`: texto de UI (Notice, nomes de settings, labels de
  botão) deve ser **sentence case**. Ex.: usar "Google tasks", não "Google Tasks".
  Depois de um emoji/símbolo, a próxima palavra fica minúscula. "Momentum Life" reprova
  (o lint quer "Momentum life").
- Depois de editar um arquivo, o warning pré-existente do `ymdLocal` é o único aceitável.

## Arquitetura — Tasks / Boards
- **Boards são pastas** sob `Tasks/` (a pasta é 100% a fonte de verdade). Não existe mais
  `boards.md`. Qualquer pasta criada (por plugin, sync, ou à mão) vira board.
- **Board default: "My Tasks"** — sempre existe, fixo em primeiro, não pode ser deletado.
  Pareia com a lista nativa **"My Tasks"** do Google Tasks. (Era "General Tasks"; renomeado.)
- Notas de task ficam em `Tasks/<Board>/<titulo>.md`. `kanban_name` no frontmatter é só
  uma dica/espelho; quem manda é a pasta.
- **Mirrors** (listas Markdown pra interop com outros plugins) em `Tasks/Lists/<board>.md`
  (um arquivo por board, achatado — não mais `Tasks/Lists/<board>/tasks.md`).
- `Tasks/_orphaned/` é arquivo morto: excluída dos boards, do load e do sync.
- **Criar task à mão** = largar um `.md` numa pasta de board (ou na raiz `Tasks/` → cai em
  My Tasks). O plugin adota, repara frontmatter e arquiva.
- **O NOME DO ARQUIVO é o título da task.** O Obsidian cria a nota como `Untitled.md` **antes**
  do usuário digitar, então adotar naquele instante gravava `title: Untitled` pra sempre.
  Três camadas garantem o título: (1) adopt usa o `basename` (e só se ele for "Untitled" cai
  pra primeira linha/heading do corpo); (2) listener de `rename` mantém o `title` em sincronia
  com o nome do arquivo (só sobrescreve placeholder ou título que espelhava o nome antigo);
  (3) `repairTaskTitles()` — varredura no startup e a cada 5 min — realinha qualquer task com
  `title: Untitled` cujo arquivo tem nome real. A camada (3) é essencial porque **rename feito
  em OUTRO device chega via Obsidian Sync sem disparar evento de rename local**.
- **Ordem dos boards**: "My Tasks" fixo em primeiro; o resto o usuário reordena com ◀ ▶ no
  board bar. Persistida em `Config/settings.md` (`board_order`, campo `boardOrder`). Board
  ausente da lista cai no fim em ordem alfabética (board criado por fora nunca desaparece).
- **Busca de tasks** (`SearchModal` em `ui.ts`, sobre o `SuggestModal` do Obsidian): casa por
  palavras soltas (AND) em título+board+grupo+data+coluna. Ao escolher, pula pro board em
  Kanban, **eleva o `colLimits` da coluna** (senão o card paginado nem existe no DOM), rola
  até ele e aplica a classe `.pa-flash` (destaque estilo Android). Respeita
  `prefers-reduced-motion`.
- **Recurrency de TASKS foi REMOVIDA — não reintroduzir.** (Gerava duplicação em loop.)
  Recurring de FINANÇAS (`Finance/recurring.md`) continua existindo, é outra coisa.

## Comportamento dos cards
- Engine unificada de cards: `src/cardrender.ts` (ações ✓/🗑/⋮) e `src/cardchips.ts`
  (chips de prioridade/data), usada por Kanban, Matrix e Studies.
- Na coluna **done**, o botão vira **reopen (↩)** e volta a task pra "In Progress" (coluna
  antes de done), não pro backlog.
- **Marcar done por qualquer meio** manda o card pro **topo** da coluna done
  (`completeTaskAtTop`). Só arrastar manualmente muda a posição.
- Cards novos (adotados/criados) aparecem no **topo** da coluna (order `?? -1`, mais novo
  primeiro).
- Botão de delete sempre visível (opacity .7, 1 no hover).

## Migrações
- Guardadas por **schema version** nas settings (`readableNotesSchema`, `taskListsSchema`,
  `taskFoldersSchema`). Rodam **uma vez** por upgrade, de forma **automática e
  transparente** (com um Notice). Bumpar o número faz re-rodar.
- **Não-destrutivas**: usam `vault.rename` (move puro, **sem o prompt "update links"** do
  Obsidian — os links resolvem por basename, então mover de pasta não quebra `[[links]]`).
- Reparo de frontmatter YAML malformado é feito no texto cru (`repairTaskFrontmatter` /
  `repairFrontmatterText`) — roda na migração e no adopt, pra o `processFrontMatter` (usado
  pelo botão done e por mover card) voltar a funcionar. Cobre dois casos:
  (1) valor que abre flow collection sem fechar (ex.: título não-aspado `title: [gbm] ...`);
  (2) **chave duplicada** (ex.: `google_id`/`google_list` escritos duas vezes) — colapsa
  mantendo o **valor mais recente** na posição da **primeira** ocorrência. Chave repetida é
  YAML inválido e trava o card do mesmo jeito.
- Operações **destrutivas** (propagação de deleção, de-dupe) são **manuais**, nunca
  automáticas num upgrade.

## Google Tasks sync (`src/gtSync.ts`, `src/googletasks.ts`) — BETA
- Marcado **(beta)** na UI (header das settings, tag vermelha `.pa-beta-tag`), no
  `whatsnew.ts` e no README. Off por padrão.
- **Auth via Cloudflare Worker** (`worker/`): o Worker `momentum-google` (subdomínio
  `jaime-nagase` → `https://momentum-google.jaime-nagase.workers.dev`) guarda os secrets
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` **server-side**. O plugin **não embarca
  secret**. Fluxo PKCE: plugin → Worker `/auth` → Google → Worker `/callback` → deep-link
  `obsidian://momentum-google` (via `registerObsidianProtocolHandler`, mesmo caminho
  desktop e mobile) → plugin `/exchange` e `/refresh`. `WORKER_BASE` fica em
  `googletasks.ts`. O redirect `/callback` está registrado no client **Web** que termina
  em `8btbj3o6...` no Google Cloud. Deploy do Worker: `cd worker && npx wrangler deploy`;
  secrets via `npx wrangler secret put <NOME>` (o NOME é fixo, o valor vai no prompt/stdin).
- **Rotação do secret (FEITA):** o `client_secret` foi rotacionado no Google Cloud (client
  Web `8btbj3o6...`) — geradas chaves novas, colocado o valor novo no Worker com
  `wrangler secret put GOOGLE_CLIENT_SECRET`, e as antigas (incl. a vazada nos `main.js`
  ≤0.5.0) desabilitadas/deletadas. Estado alvo: **1 secret** ativo no Google Cloud, igual
  ao do Worker. Armadilhas que já morderam: (a) rodar `wrangler` **fora de `worker/`** →
  "Required Worker name missing"; (b) colar o **valor** no lugar do **nome** (o nome é
  sempre `GOOGLE_CLIENT_SECRET`, o valor vai só no prompt); (c) espaço/quebra no fim do
  valor colado → `invalid_client` (HTTP 401) no `/exchange`. Log de auth do plugin em
  `Config/google-auth-debug.md` ajuda a cravar (401 = client errado, não grant).
- **Chave de sync = `google_id` (+ `google_list`)** no frontmatter da task. Casa por id
  estável, nunca por título → rename seguro, sem duplicata por título.
- **Baseline por item** (persistido em `data.json`, `gtBaselines`): merge 3-way — só
  empurra o lado que mudou desde o baseline; primeiro contato adota o remoto (não clobbera).
- **Bridge do legado**: task sem `google_id` primeiro tenta vincular por título a uma task
  existente na lista antes de criar (não duplica no upgrade).
- **TODOS os syncs são `confirmed:true`** (decisão do usuário): startup, intervalo e manual
  rodam o pipeline completo — deleção + consolidação — e **ignoram o disjuntor de massa**.
  O `MAX_WRITES_PER_RUN`/disjuntor e o gate `confirmed` continuam no código, mas na prática
  nunca bloqueiam porque `confirmed` é sempre true. (Trade-off aceito: operações destrutivas
  no Google rodam automaticamente; a proteção contra "storm" de widget foi abdicada.)
- **Deleção (Fase 2)** roda em todo sync agora. Guarda de sanidade: se sumir >25% (mín.15)
  de uma vez, **NÃO aborta silenciosamente — PERGUNTA ao usuário** (ConfirmModal via
  `confirmMass`) se quer continuar, com uma **nota curta explicando o porquê** (pode ser
  deleção real ou glitch de sync/carga). Cancelar mantém tudo. Obsidian→Google apaga a task;
  Google→Obsidian **arquiva** a nota em `Tasks/_orphaned/` (nunca hard-delete), confirmado
  por GET (404/410/`deleted`).
- **ESCUDO DA DELEÇÃO (`rawGoogleIds`) — não remover.** O ramo A ("nenhuma nota referencia
  esse baseline → apaga no Google") lia só o `metadataCache`, e uma nota que momentaneamente
  não parseia (YAML ruim, arquivo que o Obsidian Sync ainda não terminou de baixar) **sai do
  `loadTasks()`** → o plugin apagava a task real no Google. Agora, antes de apagar, confere o
  **texto cru** dos arquivos; se o `google_id` ainda aparece escrito, mantém a task e registra
  `Deletion shield: kept ...`. Se a varredura falhar, **blinda tudo** (nunca apaga às cegas).
  A guarda de massa não cobria isso porque 1–2 tasks passavam direto.
- **Log auditável**: a linha final do log inclui `deleted=` e `orphaned=`, e cada ação
  destrutiva grava o **motivo** em `result.notes` (deletado no Google / arquivado / duplicata
  removida). Sem isso ficamos cegos pra diagnosticar (aconteceu).
- **YAML inválido no frontmatter — o que realmente quebra** (verificado com o parser `yaml`):
  (a) valor abrindo flow collection sem fechar (`title: [gbm] ...`); (b) **chave duplicada**;
  (c) **`: ` (dois-pontos + espaço) dentro de valor não-aspado** (ex.: `title: Script
  (provision.sh): roda...`). **Aspas no MEIO de um escalar sem aspas são VÁLIDAS** — não é
  causa de erro (eu errei esse diagnóstico uma vez). Os três casos (a)(b)(c) são reparados por
  `repairFrontmatterText`.
- **Consolidação de listas (`consolidateLists`, sync confirmed)**: (1) realoca toda task
  vinculada cuja lista no Google ≠ a lista do seu board (Google não move entre listas →
  recria na certa + apaga a antiga + revincula); (2) apaga por inteiro as listas
  tombstonadas (boards removidos/renomeados). O board **"My Tasks" pareia com a lista
  default do Google via `@default`** (id real, não por título) — nunca é criada nem apagada,
  e funciona em qualquer idioma.
- **Descoberta**: percorre todas as listas do Google; lista nova → board no Obsidian
  (pasta criada quando a primeira task é puxada). Simétrico com Obsidian→Google.
- **Tombstones** (`Config/deleted-boards.md`, `loadIgnoredBoards`): board deletado ou
  renomeado (ex.: General Tasks) entra na lista de ignorados; a descoberta **não
  ressuscita** listas ignoradas. Recriar o board limpa o tombstone.
- Datas: due sempre normalizado para `YYYY-MM-DD` antes de mandar ao Google
  (`normalizeYmd`); formato irreconhecível → manda **sem due** (evita HTTP 400).
- Progresso: o sync mostra um **Notice persistente** (duration 0) com evolução (X/total) e
  fecha ao terminar; pede pro usuário não editar tasks até acabar.
- Logs de debug em `Momentum Life/Config/google-sync-debug.md` e `google-auth-debug.md`.
- **⚠️ Multi-device + Obsidian Sync (LIMITAÇÃO conhecida):** com o **mesmo vault espelhado
  por Obsidian Sync** em dois dispositivos e o **Google sync ligado nos dois**, os dois
  escrevem `google_id` na mesma nota e/ou criam a task no Google antes do id propagar. Dá
  dois estragos: (1) o Sync faz **merge linha a linha** e duplica chaves no frontmatter →
  YAML inválido → card **travado** (curado pelo `repairFrontmatterText`); (2) cada device
  cria **sua própria task no Google** (ids diferentes p/ o mesmo título) + nota com sufixo
  ` 2`/` 3` via `uniquePath` — o de-dupe por `google_id` **não pega** isso porque os ids são
  distintos. Assinatura no vault: vários arquivos mesmo título com `google_id` diferente e
  `modified` a poucos ms um do outro. **Mitigação atual (orientação de uso):** manter o
  Google sync ligado em **um só device**; o Obsidian Sync continua espelhando as notas. O
  endurecimento de verdade (lock de sync entre devices, ou reconciliar duplicatas por
  título+lista mesmo com ids distintos) é mudança estruturante → tratar via **spec**.

## MCP (`mcp/src/*.mjs`)
- O MCP é um port Node do data layer do plugin (ESM `.mjs`, **sem build** — roda direto;
  "aplicar" = **reiniciar o servidor MCP** no Kiro). Valida sintaxe com `node --check`.
- **Ao mudar o modelo de Tasks/Boards no plugin, atualize também o `mcp/src/store.mjs` pra
  espelhar**: boards = pastas (sem `boards.md`), `createTask` grava em `Tasks/<board>/` com
  default **"My Tasks"**, `loadTasks` deriva board da pasta, mirror **achatado**
  `Tasks/Lists/<board>.md`, exclui `_orphaned`, lê/preserva `google_id`/`google_list`.
- **Campo novo no config = adicionar no `loadConfig` E no `saveConfig` do MCP também.** O
  `saveConfig` do MCP reescreve o arquivo inteiro, então um campo que ele não conhece é
  **apagado** (aconteceria com `board_order`).
- **O MCP é a via segura pra escrever notas do vault** (frontmatter escapado via
  `JSON.stringify`) — preferir ao shell quando precisar corrigir dados.
- **O MCP NÃO faz sync com Google Tasks** — isso é exclusivo do plugin. O MCP só lê/escreve
  os arquivos do vault.

## O que NÃO fazer
- Não reintroduzir recurrency de tasks.
- Não criar uma única lista "Momentum Life" no Google (erro antigo de sub-agente) — é uma
  lista por board.
- Não buildar sem perguntar.
- Não commitar/publicar no git sem ordem explícita.

## Release e publicação na comunidade
- **Bump de versão toca 4 arquivos:** `manifest.json`, `versions.json`, `package.json` e
  `src/foodapi.ts` (o `USER_AGENT`). Manter os quatro em sincronia.
- **Build reproduzível:** o workflow de release usa `npm ci`, então o `package-lock.json`
  **precisa estar em sincronia** com o `package.json`. Lock dessincronizado (versão antiga
  ou dependência removida ainda listada) já quebrou a verificação de attestation. Após bumpar
  o `package.json`, rode `npm install --package-lock-only` pra alinhar o lock.
- **Fluxo de release:** `git tag X && git push origin X` dispara a GitHub Action, que buildar
  e anexa `main.js` + `manifest.json` + `styles.css` à release, com **attestations** de
  proveniência. Publicação é via **community.obsidian.md** (o autor gerencia lá) — **não** é
  mais PR pro `obsidian-releases`.
- **Regras da tag:** a tag tem que casar com a `version` do `manifest.json`, **sem prefixo
  `v`** (ex.: `0.2.10`, não `v0.2.10`).
- **Verificar depois do release:** `gh attestation verify <asset> --repo jnagase/obsidian-momentum`
  (esperar exit 0). Confirmar também que o `main.js` publicado não contém `child_process`
  (ver seção review).
- **Mensagens de commit sem `!`** (o history expansion do bash quebra) — usar aspas simples.
- Atualizar as notas da release depois que a Action criar: `gh release edit X --notes-file <arquivo>`.

## Armadilhas da review da comunidade
- A review do Obsidian **escaneia o código-fonte** (não só o bundle). Portanto:
  - **Nada de `child_process` / execução de shell** no código publicado — vira flag de
    "Risk"/"Shell Execution" e derruba o score. Se precisar de ponte local pessoal, manter
    fora do build da comunidade.
  - Regra `obsidianmd/prefer-create-el`: usar `createDiv()` / `createEl()`, **nunca**
    `document.createElement`. (`activeDocument.createElementNS` para SVG é OK e necessário.)
  - **Não usar `eslint-disable` de `@typescript-eslint/no-deprecated`** — a review proíbe
    (e comentário de disable sem descrição também vira erro). Corrigir a causa raiz.
    Ex.: `PluginSettingTab.display()` é deprecado desde 1.13.0 → extraímos o corpo para
    `renderSettings()` privado e o `display()` só delega.
  - O warning **`getSettingDefinitions()`** (API declarativa de settings do 1.13) é só
    **recomendação** — decidimos NÃO migrar por ora (a aba tem partes dinâmicas e subiria o
    `minAppVersion`). Não derruba o score ("Excellent").
- **"No release matches your manifest version"** no portal costuma ser cache/atraso — se a
  release com a tag certa existe, o rótulo atualiza sozinho; clicar em **"Review branch"**
  força o re-scan.

## Modal "What's new"
- `src/whatsnew.ts` tem um `CHANGELOG` versionado + rastreio de `lastSeenVersion` nas
  settings. Ao lançar uma versão com **mudança visível ao usuário**, adicionar uma entrada
  no topo do CHANGELOG (New / Improved / Fixed). O modal abre uma vez por upgrade.

## Spec-driven vs vibe coding
- **Mudança estrutural, migração, ou que mexe em dados/arquivos do usuário** → fazer via
  **spec** (design → requisitos → tarefas) antes de codar. Reduz risco de corromper dados e
  deixa registro rastreável. Specs ficam em `.kiro/specs/<feature>/`.
- **Ajuste pequeno, visual ou de baixo risco** → vibe coding direto, sem cerimônia.
- Regra de bolso: se der pra desfazer facilmente e não toca em dados do usuário, é vibe;
  senão, spec.
