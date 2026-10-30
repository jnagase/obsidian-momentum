# Design — Consolidação mensal de Finance / Nutrition / Fitness

## Princípio norteador
**Trocar só a camada de armazenamento, preservando a API pública do data layer.** As telas
(`finances.ts`, `nutrition.ts`, `fitness.ts`, `cockpit.ts`, `side.ts`) chamam métodos como
`loadTransactions()`, `addTransaction()`, `deleteTransaction()`, `loadMealLogs()`, `logMeal()`,
`loadWorkouts()`, `logWorkout()`, `deleteWorkout()`, `updateWorkoutExercises()`, `monthSummary()`.
**Essas assinaturas não mudam** — só a implementação passa a ler/escrever a nota mensal em vez de
notas-por-item. Blast radius mínimo: idealmente **zero** mudança de UI.

## 1. Formato da nota mensal
Reusa o caminho/nome do hub atual (decisão Q1). A antiga nota-hub (que só linkava itens) é
**transformada in place** na nota consolidada (que contém os itens no frontmatter + tabela no
corpo). Ou seja: o hub não vai pra lixeira — ele *vira* a nota mensal; só as notas-por-item vão
pra lixeira.

Exemplo `Finance/Months/Finance 2026-10 October.md`:
```yaml
---
type: finance-month          # nutrition-month | fitness-month
month: "2026-10"
entries:
  - id: "a1b2c3"
    tx_type: expense          # income | expense
    amount: 84.2
    category: Food
    note: "Market"
    date: "2026-10-03"
  - id: "d4e5f6"
    tx_type: income
    amount: 5000
    category: Salary
    date: "2026-10-05"
modified: "2026-10-26T12:00:00.000Z"
---
# Finance — October 2026

**Income:** R$ 5.000,00 · **Expenses:** R$ 84,20 · **Balance:** R$ 4.915,80

| Date | Type | Category | Amount | Note |
|------|------|----------|-------:|------|
| 2026-10-05 | income | Salary | +5000,00 | |
| 2026-10-03 | expense | Food | −84,20 | Market |
```
- **`entries` no frontmatter = fonte da verdade.** O corpo (tabela + totais) é **sempre
  regenerado** a partir de `entries` em toda escrita.
- Campos por entrada = exatamente os de hoje (Req 1.5). Para Finance uso `tx_type` (evita colisão
  com o `type: finance-month` da nota). Nutrition: `meal`, `meal_name`, `date`, `items[]`, `id`.
  Fitness: `split`, `date`, `duration`, `exercises[]`, `kind`, `logged`, `id`.
- **Tabela por módulo (corpo):**
  - Finance: Date · Type · Category · Amount · Note
  - Nutrition: Date · Meal · Cal · Protein · Carbs (itens detalhados em sub-linha opcional)
  - Fitness: Date · Split · Duration · Kind · Exercises (resumo)

## 2. Abstração genérica `MonthLedgerConfig<T>` (evolução do `ModuleHubConfig`)
O `ModuleHubConfig`/`syncMonthHub` atual gera um hub que **linka** itens. Evolui para uma config
que **serializa os itens dentro** da nota:
```ts
interface MonthLedgerConfig<T extends { id: string; date: string }> {
  module: string;            // "Finance"      (prefixo do nome, via monthHubTitle)
  hubFolder: string;         // "Finance/Months"
  noteType: string;          // "finance-month"
  legacyFolder: string;      // "Finance/Transactions" (ler leftovers + trash na migração)
  legacyHubType?: string;    // tipo do hub antigo, p/ reconhecer e sobrescrever
  toEntry(item: T): FM;              // domínio -> objeto de frontmatter
  fromEntry(e: FM, notePath: string): T;   // frontmatter -> domínio (reusa mapTransaction/…)
  renderBody(items: T[], monthKey: string): Promise<string> | string; // tabela + totais
}
```
Métodos compartilhados novos em `PADataStore` (um lugar só, módulo-agnóstico):
- `loadLedger<T>(cfg): T[]` — lê todas as notas `noteType` em `hubFolder` → achata `entries` via
  `fromEntry`; **une** com as notas-por-item que ainda restarem em `legacyFolder` (migração
  parcial, Req 8.2); dedup por `id` preferindo a entrada da nota mensal.
- `addLedgerEntry<T>(cfg, item)` — resolve a nota do mês por `monthKeyOf(item.date)`;
  `patchFrontmatter` para anexar a entrada; regenera o corpo; cria a nota se faltar.
- `updateLedgerEntry<T>(cfg, id, patch, newDate?)` — acha a entrada por id; se `newDate` cair em
  outro mês, **move** a entrada para a nota daquele mês (remove da origem).
- `deleteLedgerEntry<T>(cfg, id)` — remove por id; se a nota ficar com `entries` vazio, manda a
  nota pra lixeira (Req 1.4/3.2).
- `writeMonthNote<T>(cfg, monthKey, entries)` — escrita **idempotente**: monta frontmatter+corpo
  e só grava se o conteúdo mudou (usa a comparação já existente do `patchFrontmatter`/`writeFile`).

Cada módulo passa a declarar seu `MonthLedgerConfig` (substituindo `financeHubConfig()` etc.).

## 3. Funções puras (testáveis) em `loaders.ts`
Mantém a filosofia atual (mappers puros, sem Obsidian) para o `loadinvariance.test.ts`:
- `txEntryToDomain` / `txDomainToEntry`, idem meal e workout — round-trip determinístico.
- `renderFinanceTable` / `renderNutritionTable` / `renderFitnessTable` — puras (recebem itens +
  currency, devolvem markdown).
- `planMonthlyConsolidation(legacyItems): Map<monthKey, entries[]>` — planner puro de migração
  (agrupa por mês), unit-testável exaustivamente.
Os `mapTransaction/mapMealLog/mapWorkout` continuam existindo e são reusados por `fromEntry`
(agora recebendo o objeto-entrada em vez do frontmatter de um arquivo).

## 4. Reescrita por módulo (internos, API intacta)
- **Finance:** `loadTransactions()` → `loadLedger(financeLedgerCfg)`. `addTransaction()` →
  `addLedgerEntry`. `deleteTransaction()` → `deleteLedgerEntry(tx.id)` (se `tx.path` for nota
  legada, apaga o arquivo). `monthSummary()` inalterado (consome `loadTransactions`).
- **Nutrition:** `loadMealLogs()`/`logMeal()`/`deleteMealLog()` idem. `loadMeals` (planos) e água
  **não mudam**.
- **Fitness:** `loadWorkouts()`/`logWorkout()`/`deleteWorkout()` idem;
  `updateWorkoutExercises()` → `updateLedgerEntry(id, {exercises, kind, duration})`. Splits,
  exercícios e peso **não mudam**.

## 5. Migração (Req 5) — guardada, automática, reversível
- Nova constante `MONTHLY_LEDGER_SCHEMA = 1` + campo `monthlyLedgerSchema?: number` nas settings
  (default 0), no mesmo padrão de `readableNotesSchema`.
- Disparo no `onLayoutReady` (junto das outras migrações guardadas): se
  `(settings.monthlyLedgerSchema ?? 0) < MONTHLY_LEDGER_SCHEMA`, roda
  `store.consolidateMonthlyLedgers()`; em sucesso grava o schema + Notice; em falha deixa o guard
  pra reter próxima tentativa (igual às atuais).
- Comando manual novo: **"Momentum: consolidate monthly notes"** chama o mesmo método (Req 5.5).
- `consolidateMonthlyLedgers()` por módulo:
  1. Lê as notas-por-item do `legacyFolder` (loaders atuais).
  2. `planMonthlyConsolidation` agrupa por `monthKey`.
  3. Para cada mês: carrega a nota mensal existente (que pode ser o hub antigo), **mescla** as
     entradas (dedup por `id`), `writeMonthNote` (sobrescreve o hub antigo in place).
  4. Só após gravar o mês com sucesso, manda cada nota-por-item daquele mês pra **lixeira do
     Obsidian** (`app.vault.trash`, recuperável).
  - **Idempotente:** item cujo `id` já está na nota mensal não duplica; rodar de novo é seguro.
  - **Não-destrutivo:** nada é apagado permanentemente; entrada malformada é preservada/pulada
    com aviso (Req 5.3). Retorna um relatório (itens/meses consolidados) pro Notice/comando.

## 6. Drive sync
- As notas mensais vivem sob `dataRoot` (`Finance/Months` etc.), **em escopo** (não são `Tasks/`
  nem `DRIVE_DATA_EXCLUDE`) — sincronizam sozinhas.
- Escrita **idempotente** (Req 3.4/6.1): sem regravar quando o conteúdo final é igual → sem churn.
- Conflito cross-device = conflito de nota de texto comum (keep-both). Layout append-mostly
  minimiza. Frontmatter malformado por merge é reparável pelo mecanismo existente
  (`repairFrontmatterText`) — estender o reparo para reconhecer `entries` se necessário (Req 6.3).

## 7. Paridade no MCP (`mcp/src/store.mjs`, `server.mjs`)
- Espelhar `loadLedger`/`addLedgerEntry`/`deleteLedgerEntry`/`writeMonthNote` em JS, lendo/escre-
  vendo o mesmo formato (`type: *-month`, `entries`, tabela no corpo).
- `loadTransactions/addTransaction/deleteTransaction`, `loadMealLogs/logMeal/deleteMealLog`,
  `loadWorkouts/logWorkout/deleteWorkout`, `monthSummary` mantêm nome/contrato das tools.
- O MCP **não** roda a migração (quem migra é o plugin); mas o MCP **lê** os dois formatos
  (mensal + leftover legado) pra nunca "sumir" dado antes do plugin migrar.
- Regra de ouro reforçada: todo campo lido tem que ser reescrito (o `saveConfig`/writeback do MCP
  reescreve o arquivo inteiro).

## 8. Plano de testes (a detalhar nas tasks)
- Round-trip `*DomainToEntry`/`*EntryToDomain` (nenhum campo perdido).
- `render*Table` determinístico (dado um set fixo → markdown fixo).
- `planMonthlyconsolidation` agrupa por mês corretamente; idempotência (rodar 2x = mesmo estado).
- Invariância de leitura: `loadLedger` com mix de notas mensais + leftovers legados → união
  correta, dedup por id.
- Coerência: `loadinvariance.test.ts` continua válido para os mappers.

## 9. Rollout
- Tudo local, sem release até o usuário mandar (padrão do projeto).
- Entrará junto com uma entrada no `whatsnew.ts` quando for lançar (migração transparente: o
  modal explica que as notas foram consolidadas e nada é exigido do usuário).

## 10. Riscos e mitigações
- **Perda de dado na migração** → mitigado por: gravar-antes-de-lixeira, dedup por id, lixeira
  recuperável, idempotência, leitura de leftovers.
- **Conflito de nota grande no Drive** → append-mostly + idempotência + reparo de frontmatter.
- **Divergência plugin↔MCP** → mesma serialização, testes de round-trip, MCP lê ambos formatos.
- **Regressão de UI** → API pública preservada; se algum método precisar mudar, isola-se numa task
  com atualização do chamador.

## Pontos de decisão que o design deixa explícitos (ok seguir como está?)
- Finance usa `tx_type` na entrada (o `type` da nota é `finance-month`).
- O hub antigo é **sobrescrito in place** (vira a nota mensal), não vai pra lixeira; só as
  notas-por-item vão.
- Entradas ficam no **frontmatter** (não no corpo); o corpo é derivado e descartável.
