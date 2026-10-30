# Tasks — Board note tasks (Modelo B, flag-gated)

Implementação incremental, test-first onde der. **Tudo atrás de `boardNoteTasks` (default OFF)** →
com OFF o modelo atual fica intocado, então dá pra construir sem risco pro uso diário. A migração
só roda quando a flag é ligada. Cada fase compila + passa na suíte antes da próxima. Nada é lançado
até o usuário mandar.

## Fase 0 — Fundações puras (loaders/types, sem tocar storage)
- [x] 0.1 `taskEntryToDomain` / `taskDomainToEntry` (round-trip de um item de task ⇄ objeto de
      frontmatter, preservando task_id/google_id/google_list/status/priority/group/due/eisenhower/
      order/created/modified). _(Req 1.2, 3.1)_
- [x] 0.2 `renderBoardNoteBody(tasks, cols, colNames)` puro: visão por coluna (read-only). _(Req 1.3)_
- [x] 0.3 `planBoardConsolidation(tasks)` → agrupar por board (pra migração). _(Req 4.2)_
- [x] 0.4 Testes das puras (round-trip sem perda de google_id; render determinístico; agrupamento).

## Fase 1 — Flag + modelo + data layer (modo ON isolado; OFF intocado)
- [x] 1.1 Setting `boardNoteTasks?: boolean` (default false) + `boardNoteTasksSchema?: number`.
      Helper `boardNoteMode()`. (store.boardNoteTasks espelhado do settings no onload)
- [x] 1.2 Leitura/escrita da board note: `boardNoteRel(board)`, `readBoardEntries(board)` (parse
      autoritativo do array via splitFrontmatter+JSON, igual readMonthEntries), `writeBoardNote(board,
      entries[])` (idempotente, `sortTaskEntries`, corpo via renderBoardNoteBody; board vazio fica).
- [x] 1.3 Branch pela flag em: `loadBoards`, `loadTasks`, `createTask`, `updateTask`, `deleteTask`,
      `setTaskGoogleLink`, `createBoard`/`renameBoard`/`deleteBoard`. `completeTaskAtTop` delega a
      updateTask/loadTasks (já ramificados). OFF = caminho atual, byte-idêntico.
- [x] 1.4 Testes das transforms puras de entrada (= o que o store aplica): sort determinístico,
      upsert/create, patch (move/reorder), remove/board-vazio, mover entre boards preserva google_id
      sem duplicar. (convenção do projeto = funções puras, sem mock de vault)

## Fase 2 — gtSync mode-aware (mudança mínima)
- [x] 2.1 `setTaskGoogleLink` grava `google_id`/`google_list` na ENTRADA (modo ON).
- [x] 2.2 `updateTask`/`createTask`/delete do sync operam sobre entradas (já ramificados na Fase 1).
      Board change move a entrada entre board notes. **rawGoogleIds** (escudo da deleção) agora
      lê os google_id do array JSON da board note; **orphanTaskNote** move a entrada p/ `Tasks/
      _orphaned.md` (type task-orphaned, nunca hard-delete).
- [x] 2.3 `shouldMaterializeBoard` cria board note (via createBoard ramificado); `syncMirrors`/
      `syncTaskLists`/`reconcileTaskLists` viram no-op no modo ON; guards de adopt/manutenção no
      main.ts (adoptOrphanTasks, adoptTaskFile, inbox create, maintainTaskFolders, fixOrphanTasks,
      migrações de pasta no onLayoutReady) pulam no modo ON pra não corromper a board note.
- [x] 2.4 Simulação gtSync: link/pullUpdate/pullCreate/orphan preservam `google_id` + coluna,
      sem duplicar; pullCreate anexa no board certo. (estilo board-column-sync.test.ts)

## Fase 3 — Migração + rollback + flag na UI
- [x] 3.1 `migrateToBoardNotes()` (per-task → board note, preserva task_id/google_id, write-then-
      trash, trash de pastas/loose/Lists, idempotente) + schema guard `boardNoteTasksSchema`/
      `BOARD_NOTE_TASKS_SCHEMA` no onLayoutReady.
- [x] 3.2 `migrateToPerTaskNotes()` (rollback ao desligar a flag), write-then-trash, reversível.
- [x] 3.3 Toggle "Board-note tasks (beta)" na seção Tasks (ConfirmModal c/ aviso de backup →
      `setBoardNoteTasks` dispara migração/rollback, Notice, re-render). Default OFF.
- [x] 3.4 Testes de fidelidade da migração (forward preserva task_id/google_id por board; round-trip
      forward→rollback preserva id/google_id/coluna/created; consolidação idempotente; título vazio).

## Fase 4 — Paridade no MCP
- [x] 4.1 `mcp/src/store.mjs`: `_boardNoteMode()` detecta pela presença de `type: task-board`;
      transforms mirror à mão (taskDomainToEntry/taskEntryToDomain/sort/upsert/patch/remove/render);
      branch em loadBoards/loadTasks/createTask/updateTask(move entre boards)/deleteTask/createBoard/
      deleteBoard; `syncTaskLists` no-op no modo ON. Contratos das tools intactos.
- [x] 4.2 `node --check` OK nos 2 arquivos; round-trip manual (vault temp) verde: create/load/
      update(coluna+board, id preservado)/delete, boards listados, sem mirror Lists/.

## Fase 5 — Fechamento
- [x] 5.1 tsc + eslint + vitest verdes (288 testes); build OK (RC_0).
- [x] 5.2 Deploy local feito (md5 confere workspace==vault). Validar com a flag OFF (nada muda) e
      ON (num vault de backup) — **validação ON pendente com o usuário**.
- [x] 5.3 whatsnew (entrada 0.9.0, beta/opt-in) + bump dos 4 arquivos + lock + steering atualizado
      (seção board-note + lições: migração concorrente, identidade por task_id, recuperação).
      Simulações de regressão em `test/board-note-recovery.test.ts` (9 testes). **NÃO publicado**
      (sem git push/tag) — flag continua OFF por default até validar mais dias.

## Ordem/segurança
0 → 1 → 2 → 3 → 4 → 5. Com a flag OFF por default, as fases 0-2 e 4 não afetam o uso; a fase 3
(migração) só age quando você liga a flag, num vault com backup. gtSync é o núcleo de risco →
simulação na 2.4 antes de considerar pronto.

## Não-objetivos
Finance/Nutrition/Fitness (spec #1), habits/studies/journal, e o modelo A (checkboxes/Kanban plugin).
