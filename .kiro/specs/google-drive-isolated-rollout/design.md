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
