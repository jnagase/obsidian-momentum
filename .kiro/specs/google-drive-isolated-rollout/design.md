# Design — Google Drive isolado, rollout local → beta → produção

## Visão geral

Retomar o Google Drive **como um subsistema paralelo e isolado** do Google Tasks. O acoplamento
que causou o incidente do 0.7.2 (Drive escrevendo escopo no worker do Tasks e reusando o token do
Tasks) é eliminado por construção: **worker próprio, client OAuth próprio, token próprio, deep-link
próprio, flag própria**. O Tasks (`worker/`, escopo `tasks`, `googleToken`) não é tocado.

Reaproveitamos o código de `backup/drive-full-20260921` (browser, sync engine, worker-drive,
build drivetest), aplicando por cima o **diff de desacoplamento**.

```
Tasks (produção, intocável)              Drive (novo, isolado)
────────────────────────────            ────────────────────────────
worker/  momentum-google                worker-drive/  momentum-drive
scope: tasks                            scope: drive (full, restrito)
client OAuth: Tasks                     client OAuth: Drive (2º client)
deep-link: obsidian://momentum-google   deep-link: obsidian://momentum-drive
token: settings.googleToken             token: settings.driveToken
flag: googleTasksEnabled                flag: googleDriveEnabled (off)
```

## Camada 1 — Workers (Cloudflare)

- **Tasks (inalterado):** `worker/` = `momentum-google`, `SCOPES = "…/auth/tasks"`. Nenhuma
  mudança. Um teste de regressão trava isso (ver Testes).
- **Drive (novo):** `worker-drive/` = `momentum-drive` (restaurado do backup), com:
  - `SCOPES = "https://www.googleapis.com/auth/drive"` (full).
  - Secrets **do Drive_Client** (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` do 2º client), via
    `wrangler secret put` — **nunca** os do Tasks.
  - `CANONICAL_REDIRECT_URI` próprio (subdomínio do `momentum-drive`), registrado no Drive_Client.
  - Deep-link de retorno **`obsidian://momentum-drive`** (distinto do `momentum-google`).
  - Mesma mecânica de passthrough do token (o corpo do Google volta intacto), herdada do Tasks.
- **Ambientes do Drive_Worker:**
  - **dev/local:** um worker de teste (ex.: `momentum-drive-dev`) apontado pelo Drivetest_Build.
  - **beta/prod:** `momentum-drive`. Mesmo código, secrets/redirect de produção-beta.
  - O modo "Testing" vs "In production" é config **do Drive_Client no Google Cloud**, não do worker.

## Camada 2 — Auth no plugin (o desacoplamento crítico)

O código de auth do Tasks vive em `googletasks.ts` (`authorizeGoogle`, `ensureFreshToken`,
`completeGoogleAuth`, `GOOGLE_PROTOCOL_ACTION`, `WORKER_BASE`). O antigo Drive **reusava** isso +
`googleToken`. Duas opções:

- **(A) Parametrizar** um core PKCE compartilhado (workerBase, protocolAction, token getter/setter)
  usado por Tasks e Drive.
- **(B) Módulo de auth do Drive separado** (`driveAuth.ts`) que espelha a mecânica, com
  worker/deep-link/token do Drive.

**Decisão: (B)**, com uma pequena função utilitária PKCE compartilhada e sem tocar no fluxo do
Tasks. Motivo: isolamento e **risco zero** ao Tasks (já verificado/estável) valem mais que evitar
uma duplicação pequena. `driveAuth.ts` expõe: `authorizeDrive`, `ensureFreshDriveToken`,
`completeDriveAuth`, `DRIVE_PROTOCOL_ACTION = "momentum-drive"`, `DRIVE_WORKER_BASE`.

- **Token:** `settings.driveToken` (novo, separado). `driveAccessToken()` no plugin passa a ler/
  refrescar **só** o `driveToken` (removido o `googleDriveEnabled || googleTasksEnabled` que
  compartilhava o `googleToken`).
- **Deep-link:** `registerObsidianProtocolHandler("momentum-drive", …)` além do de Tasks.
- **Conectar/desconectar Drive** mexe só em `driveToken`/`googleDriveEnabled`; nunca em
  `googleToken`/`googleTasksEnabled`.

## Camada 3 — Feature (plugin) atrás da Drive_Flag

Restaurar do backup, atrás de `googleDriveEnabled` (off por padrão):
- `googledrive.ts` (REST client), `driveBrowser.ts` (DrivePanel + view), `driveSync.ts` (engine).
- Seção de Drive **opcional** no File Manager (o File Manager local do 0.7.5+ **não regride**; a
  seção volta como bloco atrás da flag).
- Settings de Drive (mirror dir, folder, intervalo) e comandos/`VIEW_TYPE_DRIVE`, todos criados
  **somente** quando a flag está on.
- Rótulo **"(beta)"** em toda a UI de Drive enquanto não for produção verificada.
- Token/worker/deep-link vindos da Camada 2 (desacoplados).

## Camada 4 — Canais de build (estágios)

- `esbuild.config.mjs`: modos `production` | `dev` | `drivetest` (restaura o alias do backup).
- `app-domain.json` guarda o `DRIVE_WORKER_BASE` de produção-beta (`momentum-drive`).
- `app-domain.test.json` (só local) aponta pro worker de dev; o `drivetest` faz o alias
  `app-domain.json → app-domain.test.json` no bundle. **Nunca** publicado (gitignore do artefato +
  regra de não-release).
- `npm run build` (prod/beta) e `npm run build:drivetest` (local).

## Gates de rollout

| Estágio | Worker Drive | Drive_Client (Google) | Quem usa | Publicação |
|---|---|---|---|---|
| **1. Local** | `momentum-drive-dev` | Testing, autor como test user | só a máquina do autor | Drivetest_Build, nunca publicado |
| **2. Beta** | `momentum-drive` | Testing (≤100 test users) | beta testers (test users) | release normal, flag off, rótulo "(beta)" |
| **3. Produção** | `momentum-drive` | **In production (verificado)** | todos | release; remove rótulo beta |

- **Gate 1→2:** fluxo completo (consent→callback→exchange→refresh→list/open/sync) funciona local.
- **Gate 2→3:** **Verificação_Restrita aprovada** pelo Google (bloqueante). Sem ela, produção não
  abre — o beta segue em Testing.
- Em **nenhum** estágio o fluxo de Tasks vê tela de "app não verificado" (isolado por client).

## Segurança do sync (herdado do backup, preservado)

`driveSync.ts`: baseline por arquivo + 3-way merge + edit-beats-delete + soft-trash + guarda de
deleção em massa (`DRIVE_MAX_WRITES_PER_RUN`) + trilha de auditoria em log. Deleção sempre para a
lixeira (reversível), nunca hard-delete. `syncGoogleDrive` roda só com flag on + `driveToken`
válido; qualquer erro/expiração de Drive é capturado e **não** afeta `syncGoogleTasks`.

## Verificação de escopo restrito (pré-requisito do estágio 3)

Documentar/reaproveitar `docs/oauth-verification/`:
- Justificativa do escopo `drive` full (por que `drive.file` não basta — enxergar arquivos que o
  usuário adiciona pelo Drive web).
- Política de privacidade publicada + homepage + **domain verification** do redirect do
  `momentum-drive`.
- Vídeo demo do fluxo. Provável **CASA/security assessment** (custo/prazo) para escopo restrito.
- Tudo isso corre em paralelo enquanto local+beta rodam em Testing.

## Modelo de dados (settings)

Novos/retomados, todos Drive-namespaced e independentes do Tasks:
`googleDriveEnabled` (bool, default false), `driveToken` (novo, separado do `googleToken`),
`driveFolderId`, `driveMirrorDir`, `driveSyncInterval`, `driveBaselines`, `driveCursor`.
MCP não faz sync de Drive → sem paridade nova (a menos que algo do File Manager compartilhe campo).

## Estratégia de testes

- **Regressão de isolamento (guard):** teste afirma que `worker/src/index.js` tem escopo
  **só `tasks`** (nada de `drive`) E que `worker-drive/src/index.js` tem escopo `drive`. Isso
  trava o incidente do 0.7.2 no CI.
- **Auth do Drive:** property/unit no `driveAuth`/`worker-drive` espelhando os testes do Tasks
  (broker/worker-config), mas para o worker de Drive — sem tocar nos do Tasks.
- **Sync engine (puro):** reaproveitar `test/drive-sync.test.ts` do backup (`threeWayMerge`,
  `decideAction`, `conflictName`).
- **Token isolado:** teste garantindo que conectar/desconectar Drive não altera `googleToken`
  (na medida do testável com o stub; senão, cobrir a função pura de seleção de token).
- Build + lint + suíte de Tasks verdes (sem mudança de comportamento do Tasks).

## Decisões e trade-offs

- **(B) auth separado** em vez de core parametrizado: aceita uma duplicação pequena em troca de
  risco zero ao Tasks. Reavaliar unificar depois que o Drive estabilizar.
- **`drive` full** (decisão do autor): melhor UX (enxerga tudo), custo = verificação restrita antes
  da produção. Local/beta não bloqueiam (Testing).
- **Worker/client separados** dobram um pouco a infra (2 workers, 2 clients, 2 redirects), mas é o
  que garante o isolamento — o objetivo central.

## Addendum — Hardening do sync (baseado em referências públicas)

Pesquisa de repositórios públicos e do padrão-ouro (rclone bisync) para endurecer o
`driveSync.ts` antes do beta. Conteúdo parafraseado das fontes.

### Consenso das referências
- **3 vias (baseline) é o padrão.** [obsidian-s3-sync](https://github.com/sipamungkas/obsidian-s3-sync-plugin)
  compara `localHash × remoteETag × lastSyncedHash`; [rclone bisync](https://rclone.org/bisync/)
  guarda a listagem do ciclo anterior de cada lado e compara com o atual. Nosso `driveSync.ts`
  já faz isso (baseline por-arquivo) — **manter**.
- **Conteúdo idêntico NÃO é conflito** ([rclone](https://rclone.org/bisync/); [diogopalhais](https://github.com/diogopalhais/obsidian-google-drive-synced-vault)
  chama de "content-aware, prevents false conflicts"). Nosso `decideAction` no primeiro contato
  (sem baseline, ambos existem) devolve `conflict` mesmo se idênticos → **corrigir** (comparar
  hash/conteúdo antes de marcar conflito).
- **Conflito preserva os dois** (renomeia o perdedor). rclone: `newer/older/larger/smaller/path1/path2`
  + destino do perdedor `num`(.conflictN)/`pathname`/`delete`. s3-sync: `Ask/local-wins/remote-wins/keep-both/newer-wins`.
  Adotar estratégia **configurável** com **`keep-both` como padrão**.
- **Incremental via Changes API** (Google [manage-changes](https://developers.google.com/workspace/drive/api/guides/manage-changes),
  padrão CDC). É o jeito confiável de pegar edição/deleção feita DIRETO no Drive. Nosso código
  guarda o `startPageToken` mas re-lista tudo → **evoluir** para `changes.list`.
- **Editar direto no Drive** exige detecção por `md5Checksum` (que temos) e **não** o modelo do
  [RichardX366](https://github.com/RichardX366/Obsidian-Google-Drive), que proíbe edição fora do
  Obsidian por rastrear via API do app. Nosso caminho suporta o requisito do autor.
- **Broker multi-device**: [remotely-save](https://github.com/remotely-save/remotely-save) usa a
  nuvem como broker e estado por-device no `data.json`. Igual ao nosso baseline por-device.

### Addendum 2 — Motor path-based, subpastas, vault-inteiro e seletor de pasta (Req 10)

Implementado (antecipando as tasks 20 de subpastas) para atender ao pedido de "vault inteiro":

- **Identidade por caminho relativo.** O motor (`driveSync.ts`) passou a chavear tudo por
  **relPath** (ex.: `sub/nota.md`), não mais por nome plano. Baselines, planos, conflitos e
  deleções usam o caminho. `conflictName` já é path-safe (o último ponto está no basename).
- **Observação recursiva.** `walkRemoteTree(token, rootId)` faz BFS a partir de
  `driveFolderId || "root"`, listando cada pasta (`listFiles({folderId})`) e montando dois mapas:
  `files: relPath→DriveFile` e `folders: relDir→folderId` (com `""→rootId`). Docs nativos do
  Google são excluídos.
- **Subpastas no push/pull.** `ensureRemoteFolderPath(dir)` cria a cadeia de pastas no Drive
  (reusando `findChildFolder`, criando com `createFolder`) e cacheia `relDir→id`. No pull, o
  `VaultFS.write` cria as subpastas locais (`ensureFolders`).
- **`VaultFS` por caminho.** `main.ts` reescreveu o port: `list()` varre `vault.getFiles()` e
  devolve caminhos relativos à base; `read/write/exists/trash/mtime` operam por relPath.
- **Vault inteiro (`driveMirrorDir === ""`).** Sincroniza tudo, **exceto** `dataRoot` (a pasta do
  próprio plugin) — proteção contra loop de feedback (logs/notas do Momentum) e contra um pull
  sobrescrever o estado vivo. Binário segue block-and-warn (a maior parte do vault do autor é
  binária), então no vault-inteiro só o texto sobe no beta.
- **Seletor de pasta próprio** (`driveFolderPicker.ts`): modal que navega o Drive com a própria
  Drive API (sem o Google Picker widget, que é ruim no Electron e exige API key/appId extra),
  permite criar subpasta e devolve `{id, name}`. Guardado em `driveFolderId` + `driveFolderName`.
  Settings: dropdown "Vault folder to sync" (com "Whole vault") + botão "Choose folder…".
- **Guardas mantidas** no modo vault-inteiro: deleção em massa, disjuntor de writes, 3-way merge,
  first-run content-aware, block-and-warn de binário.

### Decisões de hardening
1. **First-run content-aware** (beta-blocker): antes de `conflict`, se `localExists && remoteExists && !base`,
   baixar/heshear o remoto e comparar com o local; iguais → adotar baseline (noop); diferentes → conflito.
2. **Binário** (beta-blocker): para o beta, **bloquear-e-avisar** arquivos não-texto (evita
   corromper via `TextDecoder`); upload/download binário real fica pós-beta.
3. **Estratégia de conflito configurável** com `keep-both` padrão; `ask` abre modal de resolução
   (como s3-sync/bookbridge).
4. **Guarda de deleção em massa** (`max-delete`), separada do disjuntor de writes.
5. **Changes API incremental** (pós-beta, otimização + deleção confiável no Drive).
6. **Subpastas** (pós-beta): recursão por `parents`/caminho relativo (hoje é pasta plana).
7. **Teste de integração** do `runDriveSync` com `VaultFS` fake + Drive fake (o engine já é
   port-agnostic — o design foi feito pra isso).
8. **Backup + status**: aviso de backup ao ligar o beta; contadores ↑/↓/⇄/⚠/🗑.
