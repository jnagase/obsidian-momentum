# Design — Tasks como itens dentro de uma board note (Modelo B, flag-gated)

## Princípios
1. **Tudo atrás de uma feature flag** (`boardNoteTasks`, default OFF). Com OFF, o modelo atual
   (1 nota por task, board = pasta) fica **100% intocado**. Com ON, o board vira uma nota única
   com as tasks no frontmatter. Isso isola todo o risco.
2. **`google_id` por item é sagrado.** Ele vive dentro da board note, por entrada, e nunca pode
   se perder na migração — senão o Google Tasks sync duplica/recria tudo.
3. **Reaproveita o padrão MonthLedger** (spec #1): frontmatter = fonte da verdade; corpo = visão
   renderada (read-only), agrupada por coluna.
4. **gtSync muda o MÍNIMO:** ele continua chamando os mesmos métodos do store
   (`loadTasks`, `createTask`, `updateTask`, `setTaskGoogleLink`, `deleteTask`); só a
   IMPLEMENTAÇÃO desses métodos passa a operar sobre entradas-em-nota quando a flag está ON.

## 1. Formato da board note (`Tasks/<Board>.md`)
Com a flag ON, um board é o arquivo `Tasks/<Board>.md` (não mais a pasta `Tasks/<Board>/`).
```yaml
---
type: task-board
board: "Work"
tasks:
  - task_id: "a1b2c3"
    title: "Ler Tech Driven Growth"
    status: "in progress"        # coluna (chave de taskColumns)
    priority: "medium"
    group: ""
    due: ""
    eisenhower: ""
    order: 0
    google_id: "xYz..."          # sync key (pode faltar = ainda não linkada)
    google_list: "MDk..."
    created: "2026-10-01T..."
    modified: "2026-10-26T..."
modified: "2026-10-26T..."
---
# Work

## 🔄 In progress
- Ler Tech Driven Growth

## 📌 Backlog
- …
```
- `tasks` no frontmatter = **fonte da verdade**. O corpo é uma visão legível (por coluna),
  **regenerada** a cada escrita (não editável à mão — trade-off do Modelo B, aceito em D2).
- Identidade da task = `task_id` (o `cryptoId` de hoje). O `Task.path` passa a apontar pra board
  note; o item é localizado por `(board note, task_id)`.
- `Tasks/Lists/` (mirrors) e `Tasks/<Board>/` (pastas) **não são usados** no modo ON.

## 2. Camada de dados (branch pela flag)
Um helper `private boardNoteMode(): boolean { return !!this.settings.boardNoteTasks; }`. Cada
método de task passa a ter dois caminhos. Para não espalhar ifs, encapsular o modo ON num conjunto
de métodos `taskBoardNote*`:
- `loadBoards()` — ON: os board notes (`Tasks/*.md` com `type: task-board`, + "My Tasks" fixo).
  OFF: pastas (hoje).
- `loadTasks()` — ON: lê cada board note, achata `tasks[]`, cada um vira `Task` com `path` = board
  note e `kanbanName` = board. OFF: hoje.
- `createTask(partial)` — ON: anexa uma entrada (com `task_id` novo) ao board note do board alvo
  (cria a board note se faltar). OFF: hoje.
- `updateTask(task, changes)` — ON: localiza a entrada por `task_id` no board note e aplica o
  patch; **mudança de board** move a entrada entre board notes. OFF: hoje.
- `completeTask` / mover coluna / reordenar — ON: patch de `status`/`order` na entrada.
- `deleteTask(task)` — ON: remove a entrada; se a board note ficar sem tasks, mantém a nota (board
  vazio é válido) — só o delete de BOARD remove a nota.
- `createBoard` / `deleteBoard` — ON: criar = criar `Tasks/<Board>.md` vazia; deletar = trash da
  board note + tombstone (igual hoje).
- Escrita **idempotente** e `tasks` ordenado de forma determinística (por `order`, depois
  `task_id`) — mesmo princípio byte-estável da spec #1.

## 3. Google Tasks sync (o ponto crítico) — mudanças mínimas
O `gtSync` lê `Task[]` (via `loadTasks`, já mode-aware) e chama métodos do store. O que muda é só
a implementação desses métodos no modo ON:
- `setTaskGoogleLink(task, googleId, googleList)` — ON: `patch` da entrada (por `task_id`) na board
  note, gravando `google_id`/`google_list`. OFF: hoje (frontmatter da nota).
- `updateTask(task, changes)` — ON: patch da entrada; `changes.status` muda coluna; `changes.title`
  etc. idem; board change move a entrada.
- `createTask(partial)` (usado no `pullCreate`) — ON: anexa entrada ao board note do `kanbanName`.
- Deleção (orphan/pending) — ON: remove a entrada por `task_id`.
- **Inalterado:** o 3-way merge, a guarda de massa, o `pullCreateStatus`, e a **coluna via notes**
  (encodeCol/decodeCol, 0.8.13). O board↔lista do Google continua por NOME do board.
- **Descoberta/consolidação de listas:** `shouldMaterializeBoard` cria uma **board note** em vez de
  pasta; `consolidateLists` opera igual (por nome de board).
- **Mirrors** (`Tasks/Lists/*.md`): desligados no modo ON (a board note já é legível). `syncMirrors`
  vira no-op quando a flag está ON.

Assim o núcleo arriscado (reconciliação) não é reescrito — só a leitura/escrita do item muda de
"um arquivo" para "uma entrada no frontmatter da board note".

## 4. Migração (flag ON) + rollback (flag OFF) — reversível
- Setting `boardNoteTasks` + schema guard `boardNoteTasksSchema` (pra migração rodar uma vez ao
  ligar). Default flag OFF.
- **Ligar a flag → `migrateToBoardNotes()`:** para cada pasta `Tasks/<Board>/`: ler as notas-de-
  task (preservando `task_id`, `google_id`, `google_list`, `status`, `priority`, `group`, `due`,
  `eisenhower`, `order`, `created`), escrever `Tasks/<Board>.md` com o array `tasks`, e **só após
  gravar** mandar as notas-de-task e a pasta pra **lixeira do Obsidian**. Idempotente; item sem
  `task_id` recebe um id estável ANTES de migrar; nada é perdido.
- **Desligar a flag → `migrateToPerTaskNotes()` (rollback):** para cada board note, regenerar
  `Tasks/<Board>/<título>.md` por entrada (preservando `google_id` etc.) e mandar a board note pra
  lixeira. Também idempotente.
- **Ordem de segurança** idêntica à spec #1: escreve o destino, confere, só então lixeira a origem.
- Backup/commit do vault avisado antes.

## 5. UI do board (paridade)
As telas (Kanban/Matrix/busca em `tasks.ts`/`ui.ts`) consomem `loadTasks()` + `createTask`/
`updateTask`/etc. — que preservam a API. Objetivo: **nenhuma mudança de UI** no modo ON. Pontos de
atenção: reordenação (`order`) e mover coluna/board agora patcham entradas (não movem arquivos);
validar que o drag-and-drop e o "done vai pro topo" continuam.

## 6. Paridade no MCP
`mcp/src/store.mjs` espelha o modo board-note (mesma leitura/escrita do array `tasks`, mesma
identidade por `task_id`/`google_id`), atrás da MESMA flag (lida de `Config/settings.md` ou
`data.json`? — a flag de device fica em `data.json`, que o MCP não lê). **Decisão:** o MCP detecta
o modo pela PRESENÇA de board notes (`type: task-board`) no vault, não pela flag de device — assim
funciona sem depender do `data.json`. Contratos das tools intactos.

## 7. Testes (test-first onde der)
- **Puro:** serializar/parsear a entrada de task (round-trip sem perder `google_id`/campos);
  render da visão por coluna determinístico; migração-planner agrupando por board.
- **Simulação gtSync (crítico):** uma task em board note com `google_id` → push/pull round-trip →
  `google_id` e coluna preservados, **sem duplicação**; e o caso de `pullCreate` anexando entrada
  ao board certo. Reusar o estilo de `board-column-sync.test.ts`.
- **Migração:** ida (per-task→board note) e volta (rollback) preservam `task_id`/`google_id`;
  idempotência; item malformado preservado.

## 8. Rollout
- Fase 1: modelo + flag + data layer (ON isolado), com OFF intocado.
- Fase 2: gtSync mode-aware (setTaskGoogleLink/update/create/delete sobre entradas).
- Fase 3: migração + rollback + schema guard + flag na UI de settings.
- Fase 4: testes (puros + simulação gtSync + migração).
- Fase 5: MCP (detecção por presença de board notes).
- Fase 6: verificar + build + deploy. Default continua OFF até você validar a fundo.
- `whatsnew` e steering só quando promover.

## 9. Riscos e mitigações
- **Perda de `google_id` → duplicação no Google:** migração preserva por id, testes de simulação,
  reversível por lixeira, flag OFF por default.
- **Reescrita do board-model (pasta→nota):** isolada atrás da flag; OFF = zero mudança.
- **Conflito multi-device:** tasks sincronizam por Google Tasks (não Drive); a board note é local
  por device e reconciliada por `google_id` — mesma garantia de hoje.
- **UI regressão:** API preservada; validar drag/reorder/done-no-topo explicitamente.

## Pontos que o design assume (confirmar no review)
- Board vira `Tasks/<Board>.md` (arquivo), pasta `Tasks/<Board>/` aposentada no modo ON.
- Mirrors `Tasks/Lists/` desligados no modo ON.
- MCP detecta o modo pela presença de board notes (não pela flag de device).
- "My Tasks" continua o board default e pareia com a lista `@default` do Google.
