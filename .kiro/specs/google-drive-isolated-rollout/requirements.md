# Requisitos — Google Drive isolado, com rollout local → beta → produção

## Contexto

O Momentum Life integra com **Google Tasks** (worker de produção `worker/` = `momentum-google`,
escopo `tasks` apenas, app verificado). Uma tentativa anterior de integrar **Google Drive** foi
revertida (release 0.7.2) porque **encostou no Tasks**: adicionou o escopo `drive` ao worker
compartilhado, o que muda o consent screen de todos os usuários de Tasks e arrasta o app para uma
verificação de escopo restrito. Todo o código de Drive daquela tentativa está preservado no branch
`backup/drive-full-20260921` (módulos `driveBrowser.ts`, `driveSync.ts`, `googledrive.ts`, a seção
de Drive no File Manager, o worker `worker-drive/`, o build `drivetest`, e a spec
`google-drive-sync-and-browser`).

O objetivo agora é **retomar o Drive com isolamento total do Tasks** e um caminho de entrega em
três estágios — **teste local → beta → produção** — de forma que **nada do Drive** (escopo OAuth,
worker, token, verificação, sync) possa afetar a integração de Tasks já em produção.

## Decisões já tomadas (pelo autor)
- **Escopo:** `https://www.googleapis.com/auth/drive` (FULL, restrito). Consequência: **produção
  exige verificação de escopo restrito do Google** (com security assessment). Local e beta usam o
  modo "Testing" do Google (≤100 test users) enquanto a verificação não sai.
- **Client OAuth separado:** o Drive usa um **segundo client OAuth do Google Cloud**, dedicado,
  distinto do client do Tasks.

## Glossário

- **Tasks_Prod**: a integração de Google Tasks já em produção — worker `momentum-google`, escopo
  `tasks`, client OAuth do Tasks, token `googleToken`. **Invariante: não muda.**
- **Drive_Worker**: um worker Cloudflare **separado** (evolução do `worker-drive/` do backup) que
  faz o fluxo OAuth do Drive com o **client OAuth do Drive**, guardando os secrets server-side.
- **Drive_Client**: o segundo client OAuth do Google Cloud, dedicado ao Drive (escopo full).
- **Drive_Token**: token OAuth do Drive, **persistido separadamente** do `googleToken` do Tasks.
- **Drive_Flag**: setting `googleDriveEnabled`, **off por padrão**.
- **Drivetest_Build**: variante de build local (`npm run build:drivetest`) que aponta o plugin
  para o Drive_Worker de dev/teste; nunca publicada.
- **Verificação_Restrita**: o processo do Google de aprovar o escopo `drive` full (CASA/security
  assessment) — pré-requisito só do estágio de produção.

## Requisitos

### Requisito 1 — Isolamento do Tasks (invariante inegociável)

**User story:** Como usuário de Google Tasks, quero que a volta do Drive não mude nada no Tasks —
nem o consent, nem a conexão, nem o sync.

#### Acceptance Criteria
1. THE worker `worker/` (Tasks_Prod) SHALL permanecer escopo `tasks` apenas; o Drive NÃO SHALL
   adicionar escopo algum a ele.
2. THE Drive SHALL usar um **worker separado** (Drive_Worker) e um **client OAuth separado**
   (Drive_Client); o consentimento de Drive é um fluxo distinto do de Tasks.
3. THE Drive SHALL persistir seu próprio **Drive_Token**, independente do `googleToken` do Tasks;
   conectar/desconectar o Drive NÃO SHALL alterar o estado de conexão do Tasks.
4. WHERE o código antigo compartilhava token/worker entre Drive e Tasks, THE nova implementação
   SHALL desacoplar (nada de `googleDriveEnabled || googleTasksEnabled` gating um token comum).
5. THE suíte de testes de Tasks (sync, auth, worker-config, broker) SHALL continuar verde sem
   alteração de comportamento do Tasks.

### Requisito 2 — Drive atrás de flag, off por padrão

#### Acceptance Criteria
1. THE Drive_Flag SHALL ser `false` por padrão; com ela off, nenhuma UI, comando, view, timer ou
   chamada de rede de Drive SHALL existir/rodar.
2. WHEN a Drive_Flag estiver off, THE plugin SHALL se comportar exatamente como um plugin sem
   Drive (sem regressão de performance ou de superfície).
3. THE UI de Drive SHALL ser rotulada **"(beta)"** enquanto não estiver em produção verificada.

### Requisito 3 — Estágio 1: teste local (Drivetest_Build)

**User story:** Como desenvolvedor, quero rodar o Drive só na minha máquina, contra um worker de
teste e minha conta como test user, sem publicar nada.

#### Acceptance Criteria
1. THE Drivetest_Build SHALL apontar o `WORKER_BASE` do Drive para o Drive_Worker de dev/teste
   (via alias de build, ex.: `app-domain.test.json`), sem afetar os builds `dev`/`production`.
2. THE Drivetest_Build NÃO SHALL ser publicado (nem no git como artefato, nem em release).
3. THE Drive_Client em modo "Testing" SHALL permitir o autor como test user para exercitar o
   fluxo completo (consent → callback → exchange → refresh → listar/abrir/sync).

### Requisito 4 — Estágio 2: beta

**User story:** Como beta tester, quero ligar o Drive num release normal e autorizar com uma conta
de teste, sabendo que é beta, sem que isso afete meu Tasks.

#### Acceptance Criteria
1. THE Drive SHALL ir nos releases normais **atrás da Drive_Flag off**, usando Drive_Worker e
   Drive_Client de produção-beta (não o de dev local).
2. WHILE não verificado, THE beta SHALL operar no modo "Testing" do Google (≤100 test users); o
   app SHALL comunicar claramente que conectar Drive exige conta de test user e verificação em
   andamento.
3. THE limite/tela de "app não verificado" do Google NÃO SHALL, em hipótese alguma, aparecer para
   o fluxo de **Tasks** (que é isolado e verificado).

### Requisito 5 — Estágio 3: produção (gated por verificação)

#### Acceptance Criteria
1. THE Drive SHALL ser habilitável para qualquer usuário **somente após** a Verificação_Restrita
   do Drive_Client ser aprovada pelo Google.
2. WHEN a verificação for aprovada, THE remoção do rótulo "(beta)" e a liberação geral SHALL ser
   uma mudança mínima (flag/rótulo), sem re-arquitetura.
3. THE materiais de verificação (justificativa de escopo, vídeo demo, política de privacidade,
   homologação de domínio) SHALL estar documentados na spec (reaproveitar
   `docs/oauth-verification/` onde couber).

### Requisito 6 — Sync de Drive seguro e reversível

**User story:** Como usuário beta, quero que o sync de Drive não apague nem sobrescreva meus
arquivos de forma destrutiva silenciosa.

#### Acceptance Criteria
1. THE motor de sync de Drive (reaproveitado do backup: baseline + 3-way merge + edit-beats-delete
   + soft-trash) SHALL preservar as mesmas garantias de segurança (guarda de deleção em massa,
   trilha de auditoria em log).
2. THE deleção SHALL ser reversível (lixeira/soft-trash), nunca hard-delete silencioso.
3. THE sync de Drive SHALL rodar somente com a Drive_Flag on e Drive_Token válido; um erro/expiração
   do Drive NÃO SHALL afetar o sync de Tasks.

### Requisito 7 — Reaproveitar o backup sem reacoplar

#### Acceptance Criteria
1. THE implementação SHALL partir do código em `backup/drive-full-20260921` (Drive browser, sync
   engine, File Manager Drive section), **mas** com Drive_Token/Drive_Worker desacoplados do Tasks
   (corrigindo o acoplamento que causou o incidente do 0.7.2).
2. THE File Manager local (já em produção no 0.7.5+) NÃO SHALL regredir; a seção de Drive SHALL ser
   reintroduzida como um bloco opcional atrás da Drive_Flag.

### Requisito 8 — Sem regressão, build e testes

#### Acceptance Criteria
1. THE build (`npm run build`), o lint e a suíte de testes SHALL passar; o warning pré-existente do
   `ymdLocal` é aceitável.
2. THE paridade com o MCP SHALL ser mantida onde o modelo mudar (o MCP não faz sync de Drive; só
   ajustar se algum campo de config novo exigir).
3. THE mudança SHALL ser transparente num upgrade: usuários sem Drive não percebem nada; sem passo
   manual, sem perda de dado.

## Fora de escopo
- Mudar qualquer coisa do Google Tasks (worker, escopo, client, token, sync).
- Escopo `drive.file` (foi descartado; o autor optou pelo `drive` full).
- Sync de tipos nativos do Google (Docs/Sheets) além de export para leitura (herdado do backup).
