# Implementation Plan

## Bloco A — Preservar a coluna

- [ ] 1. Helpers puros de precedência de coluna em `src/gtSync.ts`
  - `colRank(status, cols)` e `mostAdvancedCol(tasks, cols)`
  - _Requisitos: 1.5_

- [ ] 2. `pullCreate` herda a coluna de nota local equivalente
  - Montar `localColBySig` uma vez em `sync()` (após carregar `tasks`)
  - Passar `localColBySig` + `doneCol` ao `applyOp`; ajustar a assinatura e todas as chamadas
    (loop APPLY e ramo do breaker que aplica só `link`s)
  - No caso `pullCreate`: `completed → doneCol`; senão `localColBySig.get(sig) ?? firstCol`
  - _Requisitos: 1.1, 1.2, 1.3_

- [ ] 3. Reconciliação preserva a coluna mais avançada no Winner
  - Em `reconcileDuplicates` (note-side), antes de deletar losers, `updateTask(winner, {status: mostAdvancedCol(g, cols)})` quando diferente
  - Adicionar `cols: string[]` aos parâmetros de `reconcileDuplicates` e passar de `sync()`
  - _Requisitos: 1.5_

## Bloco B — Detecção de board deletado

- [ ] 4. Estado persistido `Config/known-boards.md` no data layer
  - `loadKnownBoards()` / `writeKnownBoards()` em `PADataStore` (padrão `deleted-boards.md`)
  - _Requisitos: 2.1, 6.1_

- [ ] 5. Função pura `planBoardDeletions(current, known, pendingRemoval, tombstoned, guard)`
  - Retorna `{ toTombstone, nextBoards, nextPending, suspicious }`; exclui "My Tasks"; debounce; guarda de massa
  - _Requisitos: 2.2, 3.1, 3.2, 6.1_

- [ ] 6. `detectDeletedBoards()` no plugin (orquestra a função pura + efeitos)
  - Ler current/known/tombstoned; abster se `current.size===0`; inicializar na 1ª vez
  - `suspicious` → `confirmMass` (se disponível) ou abster + log; senão tombstonar via `addIgnoredBoard`
  - Salvar registro; se tombstonou algo e Google ligado → `void syncGoogleTasks(true)`
  - _Requisitos: 2.2, 2.3, 3.1, 3.3, 3.4_

- [ ] 7. Chamar `detectDeletedBoards()` no sweep periódico e uma vez pós-startup
  - Em `maintainTaskFolders` (5 min) + uma chamada após o load inicial assentar em `main.ts`
  - _Requisitos: 2.2, 3.2_

- [ ] 8. Manter o registro em sincronia nas mutações de board
  - `createBoard` (add), `renameBoard` (substitui old→new), `deleteBoard` (remove) atualizam `known-boards.md`
  - _Requisitos: 2.5, 6.1_

## Bloco C — MCP

- [ ] 9. `deleteBoard(name)` em `mcp/src/store.mjs` + tool `delete_board` em `server.mjs`
  - Move notas → My Tasks (frontmatter via `JSON.stringify`), escreve tombstone, remove pasta, recusa "My Tasks", no-op se ausente; não toca no Google
  - `node --check` nos dois arquivos
  - _Requisitos: 4.1, 4.2, 4.3, 4.4_

## Bloco D — Limpeza pontual (Req 5)

- [ ] 10. Procedimento guiado de limpeza dos boards já ressuscitados
  - Com Obsidian fechado, escrever tombstones dos boards deletados (via MCP/edição), listar o que será apagado no Google, confirmar, reabrir e rodar "Sync now"
  - _Requisitos: 5.1, 5.2_

## Testes, build e deploy

- [ ] 11. Testes unitários (vitest) das partes puras
  - `colRank`/`mostAdvancedCol`; `planBoardDeletions` (1ª obs, debounce, guarda, My Tasks, board que volta); escolha de status no `pullCreate`
  - _Requisitos: 1.1, 1.2, 1.3, 1.5, 2.2, 3.1, 3.2, 6.1_

- [ ] 12. Build + lint (perguntar antes de buildar, conforme steering)
  - `npm run build`; `npx eslint src --ext .ts` (warning `ymdLocal` é aceitável)
  - _Requisitos: 6.4_

- [ ] 13. Deploy local no vault de teste + recarregar o plugin; reiniciar o MCP no Kiro
  - `cp main.js manifest.json styles.css` para a pasta do plugin no vault de teste; avisar pra recarregar
  - _Requisitos: 6.2, 6.3_

- [ ] 14. Entrada no "What's new" (`src/whatsnew.ts`) se houver mudança visível ao usuário
  - Fixed: coluna preservada entre dispositivos; deleção de board propaga por qualquer via
  - _Requisitos: 6.1_
