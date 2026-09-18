# Design — Sync bidirecional com Google Drive + navegador de Drive embutido

## Base existente reaproveitada

O Momentum já tem a fundação; o Drive encaixa nos mesmos idiomas:

| Peça existente | Arquivo | Reuso para o Drive |
| --- | --- | --- |
| OAuth PKCE + Worker | `src/googletasks.ts`, `worker/src/index.js` | adicionar escopo Drive a `SCOPES`; reusar `/auth /exchange /refresh` |
| Token em `data.json` | `src/main.ts` (`PASettings.googleToken`) | mesmo storage; refresh via `ensureFreshToken()` |
| Baseline + merge 3 vias | `src/gtSync.ts` (`gtBaselines`, `GTBaselineStore`) | mesmo padrão, `Baseline_Drive` por arquivo |
| Guarda de mudança em massa | `src/gtSync.ts` (`MAX_WRITES_PER_RUN`, delete guards) | reusar o circuit breaker no ciclo de Drive |
| Views customizadas | `src/view.ts`, `src/nav.ts`, `src/side.ts` (`registerView`) | nova `DriveBrowserView extends ItemView` |
| Leitura ignora conflitos | `src/data.ts` (`isSyncConflictFile`, regex `.conflict(-\d+)?.`) | o naming de conflito do Drive já é compatível |
| Paridade MCP | `mcp/src/store.mjs` | espelhar mudanças de store |

## Arquitetura proposta

Novo módulo `src/driveSync.ts` (espelhando a forma do `gtSync.ts`) + `src/googledrive.ts`
(cliente da Drive API, análogo ao `googletasks.ts`) + `src/driveBrowser.ts` (a `ItemView`).

**Pipeline em 4 estágios** (padrão do Air Sync, que dá crash-safety):

1. **Observação** — coleta fatos sem agir: `changes.list` desde o Delta_Cursor (lado Drive) +
   varredura da Pasta_Espelho comparada ao Baseline_Drive (lado local). Congela os fatos.
2. **Admissão** — único ponto de decisão: para cada arquivo, `decideAction(base, local,
   remote, localChanged, remoteChanged)` → `push | pull | merge | conflict | delete_local |
   delete_remote | noop`. Aplica política de conflito e de deleção; roda o circuit breaker.
   Emite um único plano autorizado.
3. **Execução** — aplica só o plano: baixa (`files.get?alt=media`), sobe (`files.create`/
   `files.update`), move para lixeira. Reporta resultado por arquivo.
4. **Commit** — grava o Baseline_Drive por arquivo com êxito e **só avança o Delta_Cursor se o
   ciclo inteiro ficou limpo** (Requisito 6).

## Decisões

- **D1 — DECISÃO DO USUÁRIO (2026-09-17): escopo `drive` COMPLETO (restricted).** O usuário
  exige ver arquivos adicionados pela web do Drive, então o alvo é
  `https://www.googleapis.com/auth/drive`. Isso torna o app "restricted" aos olhos do Google e
  **exige verificação de restricted scope** (política de privacidade, revisão, possível
  security assessment de terceiros por armazenar/transmitir dados de usuário). `drive.file`
  fica como fallback de desenvolvimento/teste enquanto a verificação não sai. A Task 11 passa
  a ser **obrigatória** (não mais condicional). A spec `google-oauth-verification` existente é
  o ponto de partida; `docs/oauth-verification/scope-justification.md` é estendida para o
  escopo `drive`.

- **D2 — Delta pela Changes API, não polling de `files.list`.** `changes.getStartPageToken`
  inicial → `changes.list(pageToken)` a cada ciclo → guardar `newStartPageToken`. `files.list`
  completo só no cold-start ou após "Rescan". Deleção vem nativa via `includeRemoved`.

- **D3 — Baseline_Drive local usa `md5Checksum`/`modifiedTime`, não wall-clock.** O `files.list`
  do Drive volta com hash vazio por performance mas expõe `md5Checksum`; enriquecemos o hash
  sob demanda (calcular MD5 local e comparar) antes de decidir match vs conflito (Requisito 3.3).
  Determinismo do baseline evita o mesmo problema de timestamp volátil já corrigido na spec
  `reduce-sync-conflicts` (D1 de lá).

- **D4 — Edit-vence-deleção, deleção soft, circuit breaker.** Ambiguidade
  (sumiu de um lado + editado no outro) → conflito, nunca delete (Requisito 5.1). Deleção vai
  para lixeira. Reusar a guarda de volume do `gtSync.ts` para abortar deleção em massa.

- **D5 — Navegador nativo, sem iframe.** `X-Frame-Options: SAMEORIGIN` no Drive/Docs torna
  iframe inviável e o Picker é frágil no `app://` do Obsidian. A `DriveBrowserView` desenha a
  UI e usa `files.list`/`files.get`/`files.update`. Docs→Markdown e Sheets→CSV via
  `files.export` são **importação one-way** (Requisito 7.4) — re-subir não atualiza o nativo.

- **D6 — Chave estável por `fileId`, não por path.** Como no `gtSync.ts` (`google_id`),
  rename ≠ delete+create. O Drive identifica por `fileId`; o path é atributo, não identidade.
  (O Drive permite dois arquivos de mesmo nome na mesma pasta — a chave por id evita ambiguidade.)

## Riscos

- **Verificação restricted do Google (se escolher `drive`).** Processo real: política de
  privacidade, revisão, possível auditoria paga. Mitiga: default `drive.file`; `drive` é opt-in.
- **Export de Docs complexos para Markdown é imperfeito** (links de cabeçalho, imagens). Mitiga:
  tratar como leitura/importação, avisar o usuário.
- **Merge de 3 vias em binário é impossível.** Mitiga: allowlist de texto + tamanho; fora dela,
  conflito por duplicação.
- **Paridade MCP.** Toda mudança de store que o MCP lê precisa ser espelhada em
  `mcp/src/store.mjs`, senão as duas visões divergem.

## Pendências

- Definir a allowlist exata de extensões de texto e o teto de tamanho para merge.
- Decidir a pasta local padrão da Pasta_Espelho (ex. `Drive/`) e se é configurável.
- Definir o formato de persistência do Baseline_Drive e do Delta_Cursor (campos novos em
  `PASettings` vs arquivo próprio) — seguir o precedente de `gtBaselines` no `data.json`.
