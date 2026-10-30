# Tasks — Consolidação mensal de Finance / Nutrition / Fitness

Implementação incremental e test-first. Cada fase compila + passa na suíte antes da próxima.
Nada é lançado até o usuário mandar (padrão do projeto). A API pública do data layer é preservada
(ver design §1), então a UI não deve mudar.

## Fase 0 — Fundações puras (sem tocar storage ainda)
- [ ] 0.1 Em `loaders.ts`, criar as funções puras de serialização round-trip por módulo:
      `txDomainToEntry/txEntryToDomain`, `mealDomainToEntry/mealEntryToDomain`,
      `workoutDomainToEntry/workoutEntryToDomain` (reusando `mapTransaction/mapMealLog/mapWorkout`).
      _(Req 1.5, 7.3)_
- [ ] 0.2 Em `loaders.ts`, criar os renderizadores de tabela puros:
      `renderFinanceTable/renderNutritionTable/renderFitnessTable` (recebem itens + currency →
      markdown). _(Req 1.2, Q2)_
- [ ] 0.3 Em `loaders.ts`, criar o planner puro `planMonthlyConsolidation(items)` →
      `Map<monthKey, entries[]>`. _(Req 5.2)_
- [ ] 0.4 Testes das puras: round-trip sem perda de campo; render determinístico; agrupamento por
      mês + idempotência do planner. _(Req 8, plano §8)_

## Fase 1 — Abstração `MonthLedger` no data layer
- [ ] 1.1 Definir `MonthLedgerConfig<T>` e os métodos compartilhados em `data.ts`:
      `loadLedger / addLedgerEntry / updateLedgerEntry / deleteLedgerEntry / writeMonthNote`
      (escrita idempotente; trash quando `entries` fica vazio). _(Req 1, 2, 3)_
- [ ] 1.2 `loadLedger` lê notas `*-month` do `hubFolder` E faz a **união** com leftovers do
      `legacyFolder`, dedup por `id`. _(Req 8.2)_
- [ ] 1.3 Testes de `loadLedger` (mix mensal + legado → união correta, dedup) e de
      `writeMonthNote` (idempotência: 2ª escrita não altera o arquivo). _(Req 3.4, 6.1, 8.2)_

## Fase 2 — Ligar cada módulo (API pública intacta)
- [ ] 2.1 Finance: declarar `financeLedgerCfg`; reimplementar `loadTransactions/addTransaction/
      deleteTransaction` sobre o ledger; `monthSummary` continua consumindo `loadTransactions`.
      _(Req 2, 3, 4)_
- [ ] 2.2 Nutrition: `nutritionLedgerCfg`; `loadMealLogs/logMeal/deleteMealLog`. (Planos e água
      intocados.) _(Req 2, 3, 4, 5-não-objetivos)_
- [ ] 2.3 Fitness: `fitnessLedgerCfg`; `loadWorkouts/logWorkout/deleteWorkout/
      updateWorkoutExercises` (patch por id; move de mês se a data mudar). _(Req 2, 3.3, 4)_
- [ ] 2.4 Smoke manual no vault de teste: criar/editar/apagar um item de cada módulo e conferir a
      nota mensal + as telas (sem mudança de UI esperada). _(Req 4)_

## Fase 3 — Migração guardada e reversível
- [ ] 3.1 `MONTHLY_LEDGER_SCHEMA = 1` + `monthlyLedgerSchema` nas settings (default 0).
- [ ] 3.2 `store.consolidateMonthlyLedgers()`: por módulo → `planMonthlyConsolidation` → merge na
      nota mensal (dedup por id) → `writeMonthNote` → **só então** manda as notas-por-item do mês
      pra lixeira (`app.vault.trash`). Hub antigo sobrescrito in place. _(Req 5.2, 5.4)_
- [ ] 3.3 Disparo guardado no `onLayoutReady` (padrão das outras migrações) + Notice; falha deixa
      o guard pra retry. _(Req 5.1, 5.6)_
- [ ] 3.4 Comando manual "Momentum: consolidate monthly notes" com relatório. _(Req 5.5)_
- [ ] 3.5 Testes do planner de migração + idempotência (rodar 2x = mesmo estado) e robustez
      (entrada malformada preservada/pulada, nunca descartada). _(Req 5.3, 5.4, 8.1)_

## Fase 4 — Simulação de Drive sync (o ponto frágil)
- [ ] 4.1 Teste de integração (estilo `drive-sync-integration.test.ts`): dois "devices" anexam
      entradas diferentes à MESMA nota mensal; roda o sync; asserta que **ambas sobrevivem** e que
      não há churn (escrita idempotente quando nada muda). _(Req 6.1, 6.2)_
- [ ] 4.2 Teste: nota mensal fica em escopo do Drive (não cai em `Tasks/`/`DRIVE_DATA_EXCLUDE`).
      _(Req 6.1)_
- [ ] 4.3 Teste: frontmatter de `entries` malformado por "merge" é reparável e não trava a leitura
      dos outros meses. _(Req 6.3, 8.1)_

## Fase 5 — Paridade no MCP
- [ ] 5.1 Espelhar em `mcp/src/store.mjs`: ler/escrever notas `*-month` (ledger), unindo leftovers
      legados; `loadTransactions/addTransaction/deleteTransaction`, `loadMealLogs/logMeal/
      deleteMealLog`, `loadWorkouts/logWorkout/deleteWorkout`, `monthSummary`. _(Req 7.1, 7.2)_
- [ ] 5.2 Garantir que todo campo lido é reescrito (writeback reescreve o arquivo inteiro). _(7.3)_
- [ ] 5.3 Validar sintaxe (`node --check`) e um round-trip manual via MCP. _(Req 7)_

## Fase 6 — Fechamento
- [ ] 6.1 `tsc` + `eslint` + `vitest` verdes; build.
- [ ] 6.2 Deploy local + smoke no Obsidian (telas + migração rodando com Notice).
- [ ] 6.3 Entrada no `whatsnew.ts` (só quando for lançar): "notas consolidadas por mês, nada
      exigido de você".
- [ ] 6.4 Steering: registrar o padrão MonthLedger (frontmatter = fonte da verdade, corpo
      derivado, migração reversível), após aprovação do usuário.

## Ordem de dependência
0 → 1 → 2 → 3 → 4 → 5 → 6. As fases 0/1 são puras/isoladas (seguras). A fase 3 (migração) só entra
depois de 2 estável. A fase 4 valida o sync ANTES de considerar pronto.

## Não-objetivos (reafirmando)
Tasks (spec #2), água, peso, planos de refeição, exercícios, splits.
