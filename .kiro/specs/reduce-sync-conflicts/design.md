# Design — Reduzir conflitos do Obsidian Sync / Air Sync

## Camada de sync real

O vault do autor sincroniza por **Air Sync** (plugin de terceiros, backend Google Drive),
em celular + desktop, com `conflictStrategy: "auto_merge"` e `enableThreeWayMerge: true`.
Os arquivos de conflito têm o padrão do Air Sync: `nome.conflict.md` / `nome.conflict-<n>.md`
(função interna `rs()`), e aninham (`nome.conflict.conflict.md`) porque o Air Sync
sincroniza e re-conflita as próprias cópias (o `ignorePatterns` estava vazio).

Portanto a solução tem 3 frentes independentes, e nenhuma sozinha basta:

| Frente | Onde | Efeito | Status |
| --- | --- | --- | --- |
| Leitura ignora conflitos | plugin (`isSyncConflictFile` em `listMarkdown`) | duplicatas somem da UI em todos os módulos | **feito** |
| Air Sync ignora conflitos | config `air-sync/data.json` → `ignorePatterns:["**/*.conflict*"]` | para a bola de neve | **feito** (config do usuário) |
| Escrita determinística | plugin (esta spec) | conflito não nasce | **parcial** (hub feito; ver tasks) |
| Limpeza dos existentes | `tools/clean-conflicts.sh --apply` | remove os 164 já criados (backup reversível) | **feito** |

## Decisões

- **D1 — Hub do mês sem timestamp volátil (feito).** `syncMonthHub` não grava mais
  `generated: <now>`. O corpo do hub já é 100% derivado dos itens do mês, então dois
  dispositivos geram **bytes idênticos** para o mesmo estado → o Air Sync mescla sem
  conflito. Era o maior gerador (98 de 164 conflitos, em `Fitness/Months`). Espelhado no
  MCP (`mcp/src/store.mjs`) para paridade. `writeHubIfBodyChanged` foi mantido (compara só
  o corpo), o que também torna a mudança tolerante a hubs legados que ainda tenham o campo
  antigo — eles só reconvergem quando o corpo mudar, sem reescrita forçada.

- **D2 — `isSyncConflictFile` cobre `.conflict` e `.conflict-<n>` (feito).** Regex
  `/\.conflict(-\d+)?\./i` + `conflicted copy`. Estreito de propósito para não esconder uma
  nota legítima como "Resolve merge conflict.md".

- **D3 — Itens (meal-log/workout/transaction) NÃO são alvo de "write-if-changed".** São
  criados uma vez com nome único; conflito neles vem de **criação concorrente real** (mesmo
  nome legível gerado nos dois aparelhos). Não há como o plugin evitar isso sem mudar o
  esquema de nomes (arriscado). Mitigação: leitura ignora + Air Sync ignora + hábito de
  deixar o sync terminar num aparelho antes de editar no outro.

## Pendências desta spec (não implementadas ainda)

- **Requisito 1 (Write_If_Changed genérico):** `writeFile` sempre grava via
  `vault.process`, mesmo com conteúdo idêntico. Só compensa se combinado com D-abaixo,
  porque a maioria dos escritores injeta `modified: <now>`.
- **Requisito 3 (arquivos-únicos):** `water.md`, `savings.md`, `recurring.md`,
  `splits.md`, planos de refeição são reescritos por inteiro com `modified: <now>` volátil.
  Fazer o compare ignorando `modified` (ou torná-lo determinístico) para virar no-op quando
  o dado não muda. Menor impacto que o hub, mas mesmo padrão de conflito.

## Riscos

- **Merge de 3 vias do Air Sync em Markdown** pode corromper frontmatter YAML (chave
  duplicada → card travado). As frentes acima reduzem a frequência, mas a causa de fundo é
  a estratégia de merge do Air Sync — fora do controle do plugin. `repairFrontmatterText`
  já cura o sintoma no load/adopt.
