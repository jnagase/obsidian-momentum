# Design — Preservar coluna e propagar deleção de board no Google Tasks sync

## Visão geral

Dois problemas independentes, dois blocos de mudança:

- **Bloco A (coluna):** a coluna do Kanban (`status`) é local e nunca trafega pelo Google.
  Ela some sempre que uma task é (re)materializada pelo lado do Google. A correção NÃO grava a
  coluna no Google; ela garante que a coluna **local** seja preservada nos dois pontos onde
  hoje se perde: o `pullCreate` (fixa "backlog") e a reconciliação de duplicatas (o Winner pode
  ser a cópia "backlog").
- **Bloco B (deleção de board):** hoje só o botão "Delete board" registra a deleção. A correção
  adiciona **detecção por diff** de boards que sumiram (por qualquer via), com **escudo de
  sanidade** (debounce de dois sweeps + guarda de massa) antes de tombstonar. Um `delete_board`
  no MCP fecha o buraco de deletar via Claude. Uma limpeza pontual acerta o estado atual.

Princípio transversal (steering): upgrade transparente, sem passo manual, sem perda de dado; a
primeira observação **nunca** dispara deleção; ausência suspeita **nunca** vira deleção
destrutiva automática.

## Bloco A — Preservar a coluna

### A.1 Helper de precedência de coluna (parte pura, testável)

Em `src/gtSync.ts`, novo helper puro:

```ts
/** Rank de "avanço" de uma coluna = índice na ordem configurada (desconhecida → -1). */
function colRank(status: string, cols: string[]): number { return cols.indexOf(status); }

/** A coluna mais avançada de um grupo de tasks (maior índice na ordem configurada). */
function mostAdvancedCol(tasks: Task[], cols: string[]): string {
  return tasks.reduce((best, t) =>
    colRank(t.status, cols) > colRank(best, cols) ? t.status : best, tasks[0].status);
}
```

Observação importante que torna isso seguro: no `reconcileDuplicates`, o agrupamento note-side
usa `sigKey` = `baseTitle + due + normStatus`, e `normStatus` colapsa em `needsAction` /
`completed`. Logo, **todos os membros de um grupo compartilham o mesmo Done_Bit**. A precedência
só decide entre colunas de mesmo Done_Bit (ex.: backlog vs in progress; ou entre várias done).
Nunca marca uma task como done por engano.

### A.2 `pullCreate` herda a coluna de uma nota local equivalente

Precisamos de um lookup barato de "existe nota local com esta assinatura e qual sua coluna". No
início de `sync()`, depois de carregar `tasks`, montar uma vez:

```ts
// Assinatura (baseTitle+due+doneBit) → coluna local mais avançada já existente.
const localColBySig = new Map<string, string>();
for (const t of tasks) {
  if (isBlankBase(t.title)) continue;
  const k = sigKey(t.title, t.due, localStatus(t));
  const prev = localColBySig.get(k);
  if (prev === undefined || colRank(t.status, cols) > colRank(prev, cols)) localColBySig.set(k, t.status);
}
```

`localColBySig` é passado ao `applyOp`. No caso `pullCreate`:

```ts
case "pullCreate": {
  const sig = sigKey(op.gt.title, fromGTDue(op.gt.due), op.gt.status);
  const inherited = localColBySig.get(sig);
  const status = op.gt.status === "completed" ? doneCol : (inherited ?? firstCol);
  await this.store.createTask({ title: op.gt.title, status, priority: "medium", kanbanName: op.board, ... });
}
```

- `op.gt.status === "completed"` → done (Req 1.3).
- Senão, se há coluna local equivalente → herda (Req 1.1); senão → `firstCol` (Req 1.2).
- `applyOp` passa a receber `localColBySig` (e `doneCol`) além de `firstCol`. Assinatura muda de
  `(at, op, result, localStatus, firstCol)` para incluir os novos parâmetros; atualizar as
  chamadas (loop APPLY e o ramo do breaker que só aplica `link`s — links não usam coluna, então
  passar um mapa vazio/`doneCol` é inócuo ali).

### A.3 Reconciliação preserva a coluna mais avançada no Winner

Em `reconcileDuplicates`, na parte note-side, **antes** de deletar os losers, patchear a coluna do
Winner para a mais avançada do grupo (Req 1.5):

```ts
const winner = pickWinnerNote(g);
const advanced = mostAdvancedCol(g, cols);
if (advanced !== winner.status) {
  try { await this.store.updateTask(winner, { status: advanced }); winner.status = advanced; }
  catch (e) { result.errors.push(`Reconcile keep-column "${winner.title}": ${String(e)}`); }
}
for (const t of g) { /* deleta losers como hoje */ }
```

`cols` (as colunas configuradas) já estão disponíveis no `sync()`; passar para
`reconcileDuplicates` (novo parâmetro) ou recarregar `cfg.taskColumns` dentro dele. Como
`reconcileDuplicates` já recebe vários parâmetros, adiciono `cols: string[]`.

### A.4 Por que isso resolve a corrida

- **Caso comum (as duas notas coexistem após o Sync):** macbook cria a cópia "backlog" via
  `pullCreate`; o Sync entrega a nota "in progress" do celular (mesmo `google_id`). Vira grupo
  de duplicatas → `reconcileDuplicates` colapsa e A.3 mantém "in progress" no Winner.
- **Janela reduzida no próprio `pullCreate`:** se no momento do `pullCreate` já existir uma nota
  local equivalente (Sync chegou antes), A.2 já materializa na coluna certa, sem nem virar
  duplicata.
- **Caso degenerado (a nota "in progress" nunca chegou a este device):** não há coluna local a
  preservar aqui; mas o outro device mantém "in progress", e na convergência A.3 corrige. Sem
  gravar nada no Google.

## Bloco B — Detecção e propagação de deleção de board

### B.1 Estado persistido: `Config/known-boards.md`

Arquivo plugin-only (o MCP não precisa conhecê-lo — sem ônus de paridade), no mesmo padrão de
`Config/deleted-boards.md`:

```yaml
---
type: known-boards
boards: [AWS, Personal, Work]      # boards já observados (fonte do diff)
pending_removal: [AWS]             # candidatos a deleção (ausentes no último sweep) — debounce
---
```

API nova em `PADataStore` (espelhando `loadIgnoredBoards`/`writeIgnoredBoards`):
`loadKnownBoards(): { boards: string[]; pendingRemoval: string[] }` e
`writeKnownBoards(state)`.

### B.2 Sweep de detecção: `detectDeletedBoards()`

Roda no **sweep periódico** (`maintainTaskFolders`, a cada 5 min) e uma vez pouco depois do
startup (após o load inicial assentar). Nunca nos listeners de `create`/`rename`/`modify`.

Algoritmo (com escudo de sanidade embutido):

```
current   = loadBoards() names  − {"My Tasks"}
tombstoned = loadIgnoredBoards()
reg       = loadKnownBoards()   // { boards, pendingRemoval }

// R3.2 — vault não pronto: nada a fazer.
if current.size === 0: return

// R6.1 — primeira observação: só inicializa, nunca deleta.
if reg.boards.length === 0:
    writeKnownBoards({ boards: current, pendingRemoval: [] }); return

// Aprender boards novos e limpar tombstones de boards que voltaram (createBoard já faz isso,
// aqui é reforço idempotente).
learned = current − reg.boards
missing = reg.boards − current − tombstoned − {"My Tasks"}

// Debounce: só confirma quem estava faltando TAMBÉM no sweep anterior.
confirmedNow = missing ∩ reg.pendingRemoval

// R3.1 — guarda de massa: muita coisa sumindo de uma vez = suspeito.
guard = max(2, ceil(reg.boards.length * 0.5))
if confirmedNow.size > guard:
    if confirmMass disponível: ask(...) ; se recusar → abstém (mantém pendingRemoval), loga
    else: abstém, loga  // nunca deleta às cegas (R3.3)
    confirmedToTombstone = (usuário confirmou) ? confirmedNow : ∅
else:
    confirmedToTombstone = confirmedNow

for name in confirmedToTombstone:
    addIgnoredBoard(name)          // tombstone → consolidateLists apaga a lista no Google
    remove name de reg.boards

// Atualiza estado: novos boards entram; candidatos = quem está faltando agora (menos os já
// tombstonados). Quem voltou some de pendingRemoval automaticamente.
reg.boards = (reg.boards ∪ learned) − confirmedToTombstone
reg.pendingRemoval = missing − confirmedToTombstone
writeKnownBoards(reg)

// Propagação imediata (opcional): se algo foi tombstonado e o Google está ligado, dispara um
// sync confirmado para apagar a lista agora em vez de esperar o próximo ciclo.
if confirmedToTombstone.size > 0 && googleEnabled: void syncGoogleTasks(true)
```

Propriedades:
- **Debounce (2 sweeps):** um board só é tombstonado se estiver ausente em dois sweeps
  consecutivos (~5 min). Uma pasta ausente por download parcial do Obsidian Sync volta antes
  disso e sai de `pendingRemoval` — nunca chega a tombstone. (Req 3)
- **Guarda de massa:** vault meio-carregado (muitos boards sumindo juntos) → pergunta ou abstém.
  (Req 3.1/3.2)
- **Primeira observação inicializa** o registro sem deletar. (Req 6.1)
- **My Tasks** nunca entra em `missing`. (Req 2.4)

### B.3 Propagação pro Google e pros devices

- **Google:** o tombstone já é consumido pelo `consolidateLists` (sync confirmado), que apaga a
  lista de nome tombstonado (nunca a default). Nenhuma mudança necessária ali — só passamos a
  gerar o tombstone por mais um caminho.
- **Outro device:** `Config/deleted-boards.md` e `Config/known-boards.md` são espelhados pelo
  Obsidian Sync; a descoberta no outro device já respeita o tombstone (não ressuscita). Se o
  outro device tiver a pasta ainda presente, seu próprio sweep vai vê-la em `current`, mas o
  nome estará em `tombstoned` → excluído de `missing`; e como o tombstone existe, a descoberta
  não recria. Para efetivamente remover a pasta órfã no outro device, o `deleteBoard` (quando
  vier do botão) já move/apaga; para deleção detectada por diff, a pasta já não existe no device
  de origem — o outro device pode ainda ter a pasta e o usuário a verá até apagá-la, mas ela não
  ressuscita nem recria lista. (Comportamento aceitável; documentado.)

### B.4 Manter o registro em sincronia nas mutações de board

Para o diff não gerar falso-positivo em operações legítimas:
- `createBoard(name)`: já limpa tombstone; **adicionar** o nome a `known-boards.boards`.
- `renameBoard(old, new)`: **substituir** `old` por `new` em `boards` (senão `old` vira
  "missing" e seria tombstonado). Renome já move a pasta; só sincronizar o registro.
- `deleteBoard(name)` (botão): já tombstona; **remover** de `boards`/`pendingRemoval`.

## Bloco C — `delete_board` no MCP (Req 4)

Em `mcp/src/store.mjs`, novo método `deleteBoard(name)` espelhando o do plugin:
1. Se `name === "My Tasks"` → retorna `{ ok: false, reason: "cannot delete My Tasks" }`.
2. Se a pasta não existe → `{ ok: false, reason: "not found" }` (no-op, Req 4.4).
3. Move cada nota de `Tasks/<name>/` para `Tasks/My Tasks/`, setando `kanban_name: "My Tasks"`
   (usando o writer com frontmatter escapado via `JSON.stringify`, nunca shell).
4. Escreve o tombstone em `Config/deleted-boards.md` (append idempotente ao array `boards`).
5. Remove a pasta vazia.
6. **Não** fala com o Google (Req 4.2) — o plugin propaga no próximo sync.

Em `mcp/src/server.mjs`, expor a tool:

```js
delete_board: {
  description: "Delete a task board: move its tasks to My Tasks and tombstone it (so Google-list discovery won't resurrect it). Does not touch Google directly.",
  inputSchema: S.obj({ name: S.str("Board name") }, ["name"]),
  handler: (a) => store.deleteBoard(a.name),
}
```

Nota: o MCP roda sem build; "aplicar" = reiniciar o servidor MCP. Validar com `node --check`.

## Bloco D — Limpeza pontual do estado atual (Req 5)

Procedimento guiado (não é código novo; usa o que passa a existir):
1. Usuário fecha o Obsidian (regra do steering: não editar o vault com o Obsidian aberto).
2. Com os **nomes** dos boards já deletados, escrever os tombstones em
   `Config/deleted-boards.md` (via MCP/edição de arquivo, nunca shell).
3. Usuário reabre o Obsidian e roda **"Sync now"** (sync confirmado) → `consolidateLists` apaga
   as listas órfãs no Google e realoca tasks perdidas para My Tasks.
4. Confirmação explícita e listagem do que será apagado no Google **antes** de agir (Req 5.2).

## Modelo de dados

Novo arquivo `Config/known-boards.md` (frontmatter `type: known-boards`, arrays `boards` e
`pending_removal`). Nenhuma mudança em `Config/settings.md` → **sem ônus de paridade no MCP**
para o registro (o MCP só ganha `delete_board`, que escreve em `deleted-boards.md`, já suportado).

## Tratamento de erros / auditoria

- Toda ação destrutiva (tombstone automático, deleção de lista no Google) grava motivo em
  `result.notes` e no log `Config/google-sync-debug.md`. (Req 3.4)
- Detecção é best-effort: qualquer falha de leitura do registro → abstém no ciclo, nunca deleta.
- `pullCreate`/reconcile com falha isolada não abortam o sync (padrão try/catch já existente).

## Estratégia de testes

Partes puras (vitest), sem tocar no vault:
- `colRank` / `mostAdvancedCol`: precedência done > in progress > backlog; grupo de mesmo
  Done_Bit; coluna desconhecida → -1; determinismo em input embaralhado. (Req 1.5)
- Lógica de diff/escudo de `detectDeletedBoards` extraída para função pura
  `planBoardDeletions(current, known, pendingRemoval, tombstoned, guard)` → retorna
  `{ toTombstone, nextBoards, nextPending, suspicious }`, testando: primeira observação não
  deleta; debounce (falta em 1 sweep não deleta, em 2 deleta); guarda de massa marca
  `suspicious`; My Tasks nunca entra; board que volta sai de pending. (Req 2/3/6)
- `pullCreate` herda coluna: teste de unidade do cálculo `localColBySig` + escolha de status
  (completed→done; sig conhecida→herda; desconhecida→firstCol). (Req 1.1/1.2/1.3)

Manual/integração (vault de teste):
- Simular a corrida: nota "in progress" + cópia "backlog" mesma assinatura → após sync, sobra
  uma em "in progress".
- Deletar pasta de board via MCP → após ≤2 sweeps, tombstone escrito e (com Google ligado) lista
  apagada no próximo sync confirmado; sem ressurreição.
- Falso-positivo: remover e re-adicionar a pasta dentro de um ciclo → nenhum tombstone.

Build + lint verdes (`npm run build`, `npx eslint src --ext .ts`); warning pré-existente do
`ymdLocal` é aceitável.

## Decisões e trade-offs

- **Não gravar coluna no Google (`notes`)**: mantém o app do Google limpo; custo é o caso
  degenerado (coluna só existe num device até a convergência). Aceito — reabrir só se
  insuficiente na prática. (Req 1.4 / fora de escopo)
- **Debounce de 2 sweeps** em vez de detecção imediata: troca ~5 min de latência por segurança
  forte contra falso-positivo de Obsidian Sync. Aceito.
- **Registro plugin-only** (`known-boards.md`) em vez de campo em `settings.md`: evita o risco
  do `saveConfig` do MCP apagar um campo que ele não conhece (armadilha já registrada no
  steering) e não exige paridade. Aceito.
- **Deleção detectada não remove a pasta no outro device**: apenas impede ressurreição e apaga a
  lista no Google. Remover a pasta órfã remota exigiria propagar um comando de deleção entre
  devices (fora de escopo); o tombstone já evita o pior (recriação + lista viva).
