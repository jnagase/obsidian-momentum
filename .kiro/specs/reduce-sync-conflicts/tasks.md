# Tasks — Reduzir conflitos do Obsidian Sync / Air Sync

- [x] 1. **Leitura ignora arquivos de conflito** (Req da leitura, fora do escopo original
  mas entregue junto). `isSyncConflictFile` + filtro em `listMarkdown`. Regex cobre
  `.conflict`, `.conflict-<n>` e cadeias aninhadas. — `src/data.ts`

- [x] 2. **Hub do mês byte-determinístico** (Requisito 2). Remover `generated: <now>` do
  frontmatter do hub no plugin e no MCP; manter `writeHubIfBodyChanged`. — `src/data.ts`,
  `mcp/src/store.mjs`

- [x] 3. **Air Sync ignora os próprios conflitos.** `ignorePatterns: ["**/*.conflict*"]`
  em `air-sync/data.json`. (Config do usuário; exige recarregar o Air Sync.)

- [x] 4. **Limpar os conflitos já existentes.** `tools/clean-conflicts.sh --apply` moveu os
  164 para backup reversível fora do vault.

- [ ] 5. **Write_If_Changed genérico** (Requisito 1). Fazer `writeFile` tratar gravação de
  conteúdo idêntico como no-op. Só vale junto da task 6. — `src/data.ts`

- [ ] 6. **Arquivos-únicos sem reescrita à toa** (Requisito 3). Comparar ignorando o
  `modified` volátil (ou torná-lo determinístico) em `water.md`, `savings.md`,
  `recurring.md`, `splits.md` e planos de refeição, para gravação sem mudança virar no-op.
  Espelhar no MCP. Adicionar teste do contrato (idêntico=no-op; diferente=grava;
  inexistente=cria).

- [ ] 7. **Regressão.** Rodar build/lint/testes; confirmar que nomes de arquivo,
  frontmatter e dado exibido não mudaram.
