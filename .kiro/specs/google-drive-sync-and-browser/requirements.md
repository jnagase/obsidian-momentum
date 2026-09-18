# Requisitos — Sync bidirecional com Google Drive + navegador de Drive embutido

## Contexto

Hoje o Momentum Life sincroniza **Google Tasks** de forma bidirecional (`src/gtSync.ts`),
usando OAuth PKCE por um Cloudflare Worker (`src/googletasks.ts` + `worker/`), com merge de
3 vias sobre um *baseline* por item guardado no `data.json` (`gtBaselines`). O único escopo
OAuth pedido hoje é `https://www.googleapis.com/auth/tasks` (`worker/src/index.js`).

O usuário quer estender essa capacidade para o **Google Drive** (arquivos), com dois
objetivos:

1. **Sync bidirecional de arquivos** entre uma pasta do Drive e uma pasta do vault, de modo
   que mudanças feitas **no Drive** (inclusive pela web) apareçam no Obsidian e vice-versa,
   com o plugin entendendo as diferenças (o que mudou de cada lado) e resolvendo conflitos.
2. **Um navegador de Drive dentro do Momentum Life** (uma view do Obsidian) onde o usuário
   vê, abre e edita arquivos do Drive sem sair do Obsidian.

Duas restrições externas, confirmadas por pesquisa (2026-09), moldam o desenho e são
tratadas como decisões, não como detalhes:

- **iframe do Drive é inviável.** `drive.google.com`/`docs.google.com` enviam
  `X-Frame-Options: SAMEORIGIN`; o Electron do Obsidian recusa renderizá-los embutidos, e o
  Google Picker exige uma origem `https://` registrada que o protocolo `app://` do Obsidian
  não satisfaz. Logo, o "navegador de Drive" é uma **UI nativa própria** sobre a Drive API
  REST, não um iframe.
- **Escopo do Drive define o que é visível.** `drive.file` (não-sensível) só enxerga
  arquivos que o **próprio app criou/abriu**; arquivos adicionados pela web ficam invisíveis.
  Para ver arquivos adicionados fora do app é preciso o escopo `drive` **completo**
  (restricted), que exige verificação de restricted scope do Google (política de
  privacidade, revisão de segurança, possível auditoria). O requisito de "mexer no Drive
  pela web e aparecer no Obsidian" **depende** dessa escolha.

O objetivo desta spec é definir o comportamento observável do sync de Drive e do navegador
embutido, reaproveitando o padrão de baseline + merge de 3 vias + guarda de mudança em massa
já validado no `gtSync.ts`, e explicitar o trade-off de escopo como uma decisão de produto.

## Glossário

- **Pasta_Espelho**: a pasta no Drive que o Momentum mantém em sincronia com uma pasta do
  vault (subpasta local dedicada, ex. `Drive/`).
- **Baseline_Drive**: estado por-arquivo do último sync bem-sucedido (`{fileId, md5Checksum
  ou etag, modifiedTime, path}`), guardado localmente, usado como terceira via do merge.
- **Delta_Cursor**: `startPageToken` da Drive Changes API que marca "sincronizado até aqui";
  avança a cada ciclo limpo.
- **Escopo_Restrito**: o escopo OAuth `https://www.googleapis.com/auth/drive` (vê o Drive
  inteiro), sujeito a verificação restricted do Google.
- **Escopo_Arquivo**: o escopo OAuth `https://www.googleapis.com/auth/drive.file` (vê só o
  que o app criou/abriu), não-sensível.
- **Arquivo_Nativo_Google**: Google Docs/Sheets/Slides (não são arquivos binários; só saem
  por `files.export`, ex. Doc→Markdown, Sheet→CSV).
- **Navegador_De_Drive**: view do Obsidian que lista/abre/edita arquivos do Drive via API.

## Requisitos

### Requisito 1 — Autorização do Drive reaproveitando o fluxo existente

**User story:** Como usuário que já conecta o Google Tasks, quero autorizar o acesso ao Drive
pelo mesmo mecanismo, para não configurar OAuth de novo.

#### Acceptance Criteria
1. WHEN o usuário habilitar a integração de Drive, THE plugin SHALL reutilizar o fluxo PKCE +
   Cloudflare Worker existente, adicionando o escopo de Drive à lista de `SCOPES` do Worker.
2. THE plugin SHALL guardar o token do Drive na mesma infraestrutura de `data.json` já usada
   por `googleToken`, com refresh via `ensureFreshToken()`.
3. WHERE o usuário já tinha só o escopo `tasks` concedido, THE plugin SHALL solicitar novo
   consentimento (re-autorização) porque o conjunto de escopos mudou, e SHALL comunicar isso
   claramente.
4. IF o refresh retornar `invalid_grant`, THEN THE plugin SHALL tratar como
   `GoogleAuthExpiredError` e pedir reconexão, igual ao Tasks.

### Requisito 2 — Escolha de escopo explícita (Escopo_Arquivo vs Escopo_Restrito)

**User story:** Como usuário, quero entender e escolher entre "o plugin só vê o que ele criou"
e "o plugin vê arquivos que eu adiciono pela web", para decidir de forma informada.

#### Acceptance Criteria
1. THE plugin SHALL suportar Escopo_Arquivo (`drive.file`) como padrão não-sensível.
2. WHERE o usuário exige que arquivos adicionados pela web do Drive apareçam no Obsidian,
   THE plugin SHALL requerer Escopo_Restrito (`drive`) e SHALL informar que isso depende da
   verificação restricted do Google.
3. THE settings SHALL deixar claro, em texto, a limitação do Escopo_Arquivo ("só vê arquivos
   criados/abertos pelo Momentum").
4. THE plugin SHALL NÃO pedir Escopo_Restrito silenciosamente; a escolha é explícita do
   usuário.

### Requisito 3 — Detecção bidirecional de diferenças

**User story:** Como usuário com a Pasta_Espelho em dois lados, quero que o plugin detecte o
que mudou em cada lado (criado, editado, deletado, renomeado), para sincronizar sem eu apontar.

#### Acceptance Criteria
1. THE plugin SHALL detectar mudanças no lado do Drive usando a Changes API
   (`changes.getStartPageToken` + `changes.list` + `newStartPageToken`), guardando o
   Delta_Cursor localmente.
2. THE plugin SHALL detectar mudanças no lado local comparando o estado atual do vault com o
   Baseline_Drive.
3. WHEN um arquivo tem `size` igual dos dois lados mas hash local desconhecido, THE plugin
   SHALL calcular o MD5 local e comparar com o `md5Checksum` do Drive antes de decidir
   igualdade vs conflito.
4. WHERE não há Delta_Cursor ainda (primeiro sync, ou reset), THE plugin SHALL fazer uma
   reconciliação completa (listagem dos dois lados) em vez de confiar no delta.

### Requisito 4 — Reconciliação e conflito com merge de 3 vias

**User story:** Como usuário que edita o mesmo arquivo em dois lugares, quero que o plugin
resolva sem perder meu trabalho.

#### Acceptance Criteria
1. THE plugin SHALL usar o Baseline_Drive como base do merge de 3 vias: só o lado que mudou
   desde o baseline vence; se os dois mudaram, é conflito.
2. WHERE o arquivo é texto elegível (allowlist de extensões e tamanho ≤ 1 MiB), THE plugin
   SHALL tentar merge de 3 vias; em sobreposição irresolvível SHALL preservar as duas versões.
3. IF o merge produzir conteúdo inválido (ex. JSON quebrado), THEN THE plugin SHALL cair para
   preservar as duas versões em vez de gravar arquivo corrompido.
4. THE arquivo de conflito SHALL ser nomeado `nome.conflict.<ext>` com contador incremental
   (`nome.conflict-2.<ext>`), sufixo antes da extensão — consistente com o padrão já tratado
   por `isSyncConflictFile` na leitura.

### Requisito 5 — Deleção segura (edição vence deleção)

**User story:** Como usuário, quero que uma edição nunca seja apagada por uma deleção do outro
lado, e que deleções sejam recuperáveis.

#### Acceptance Criteria
1. WHEN um arquivo sumiu de um lado mas foi editado no outro desde o Baseline_Drive, THE
   plugin SHALL preservar a edição (roteia para conflito) e NÃO deletar.
2. THE plugin SHALL fazer deleção *soft* (lixeira dos dois lados quando aplicável),
   recuperável.
3. THE plugin SHALL reconfirmar a ausência de um arquivo (re-stat/re-check) antes de autorizar
   qualquer deleção, para uma listagem incompleta não parecer deleção.
4. THE plugin SHALL aplicar uma guarda de mudança em massa (circuit breaker) análoga ao
   `MAX_WRITES_PER_RUN`/limites de delete do `gtSync.ts`, abortando o ciclo se o número de
   deleções exceder o limite.

### Requisito 6 — Commit atômico do progresso

**User story:** Como usuário, quero que uma interrupção (fechar o Obsidian, cair a conexão) não
corrompa o estado de sync.

#### Acceptance Criteria
1. THE plugin SHALL avançar o Delta_Cursor **somente** quando o ciclo inteiro terminar limpo.
2. IF um ciclo terminar parcial, THEN THE plugin SHALL manter o cursor anterior e re-observar
   no próximo ciclo (idempotente).
3. THE Baseline_Drive SHALL ser atualizado por arquivo só após a gravação daquele arquivo ter
   êxito nos dois lados.

### Requisito 7 — Navegador de Drive embutido (view nativa)

**User story:** Como usuário, quero abrir o Google Drive dentro do Momentum Life no Obsidian e
navegar/abrir/editar arquivos de lá.

#### Acceptance Criteria
1. THE plugin SHALL registrar uma view do Obsidian (padrão `ItemView`, como `view.ts`/`side.ts`)
   que lista pastas e arquivos do Drive via `files.list` (navegação por `parents`).
2. THE Navegador_De_Drive SHALL NÃO embutir `drive.google.com` em iframe (inviável por
   `X-Frame-Options`); a UI é desenhada pelo plugin.
3. WHEN o usuário abre um arquivo texto/markdown do Drive, THE plugin SHALL baixá-lo
   (`files.get?alt=media`), abri-lo para edição e, ao salvar, re-subir via `files.update`.
4. WHERE o arquivo é Arquivo_Nativo_Google, THE plugin SHALL exportá-lo (Doc→Markdown,
   Sheet→CSV via `files.export`) para leitura, e SHALL deixar claro que isso é importação
   one-way (re-subir não atualiza o Doc nativo original).
5. THE Navegador_De_Drive SHALL operar dentro do escopo concedido (Escopo_Arquivo só mostra o
   que o app criou/abriu).

### Requisito 8 — Paridade e não-regressão

**User story:** Como mantenedor, quero que o novo código não quebre o sync de Tasks nem a UI
existente.

#### Acceptance Criteria
1. THE mudanças no store SHALL ser espelhadas em `mcp/src/store.mjs` quando afetarem dados
   lidos pelo MCP, mantendo a paridade já exigida no projeto.
2. THE integração de Drive SHALL ser opcional (desligada por padrão) e não SHALL alterar o
   comportamento do Google Tasks quando desabilitada.
3. THE build, lint e testes SHALL passar; o sync de Tasks SHALL continuar funcionando.

## Fora de escopo

- Round-trip de edição de **Arquivos_Nativos_Google** (editar um Google Doc no Obsidian e
  atualizar o Doc original) — tratado como importação one-way.
- Push notifications via `changes.watch` (polling por intervalo basta na v1).
- Backends que não sejam Google Drive (S3, Dropbox, OneDrive, WebDAV).
- Sincronizar o vault inteiro do Obsidian pelo Drive (isso é papel do Air Sync/remotely-save);
  aqui o escopo é uma Pasta_Espelho dedicada + o navegador.
