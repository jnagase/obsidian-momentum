# Tasks — Sync bidirecional com Google Drive + navegador de Drive embutido

Ordem pensada para entregar valor cedo e deixar o sync destrutivo por último.

- [x] 1. **Escopo + OAuth do Drive** (Requisitos 1, 2). Adicionar o escopo de Drive a `SCOPES`
  no Worker; expor nas settings a escolha Escopo_Arquivo (`drive.file`, padrão) vs
  Escopo_Restrito (`drive`, opt-in com aviso de verificação); re-consentimento quando o
  conjunto de escopos muda. — `worker/src/index.js`, `src/googletasks.ts` (ou novo
  `src/googledrive.ts`), `src/main.ts` (settings + `PASettings`)

- [x] 2. **Cliente da Drive API** (Requisitos 3, 7). Novo `src/googledrive.ts`: `files.list`
  (navegação por `parents`), `files.get?alt=media` (download), `files.create`/`files.update`
  (upload), `files.export` (Doc→Markdown, Sheet→CSV), `changes.getStartPageToken` +
  `changes.list`. Reusar `ensureFreshToken()`. — `src/googledrive.ts`

- [x] 3. **Navegador de Drive (view nativa)** (Requisito 7). `DriveBrowserView extends
  ItemView` registrada como as views existentes; lista pastas/arquivos, abre texto/markdown
  para edição e re-sobe via `files.update`; Arquivos_Nativos_Google como importação one-way
  com aviso. SEM iframe. — `src/driveBrowser.ts`, `src/main.ts` (`registerView`)

- [x] 4. **Baseline_Drive + Delta_Cursor (persistência)** (Requisito 6). Campos/estrutura para
  guardar `{fileId, md5Checksum/etag, modifiedTime, path}` por arquivo e o `startPageToken`,
  seguindo o precedente de `gtBaselines`. — `src/main.ts` (`PASettings`), `src/driveSync.ts`

- [x] 5. **Detecção bidirecional** (Requisito 3). Lado Drive via Changes API + Delta_Cursor;
  lado local por comparação com o Baseline_Drive; enriquecimento de hash via `md5Checksum`
  antes de decidir match vs conflito; cold-start faz reconciliação completa. — `src/driveSync.ts`

- [x] 6. **Admissão: decideAction + merge de 3 vias** (Requisito 4). Tabela de decisão
  `base × local × remote × mudou?`; merge de 3 vias para texto elegível (allowlist + ≤ 1 MiB);
  fallback para duplicação em sobreposição/JSON inválido; naming `nome.conflict.<ext>` com
  contador. — `src/driveSync.ts`

- [x] 7. **Deleção segura** (Requisito 5). Edit-vence-deleção (ambiguidade → conflito);
  deleção soft (lixeira); reconfirmação por re-check antes de deletar; circuit breaker de
  mudança em massa reusando o padrão do `gtSync.ts`. — `src/driveSync.ts`

- [x] 8. **Execução + commit atômico** (Requisito 6). Aplicar só o plano autorizado; atualizar
  Baseline_Drive por arquivo com êxito; avançar o Delta_Cursor só em ciclo limpo; ciclo parcial
  re-observa. Gatilhos: manual, on-startup, intervalo (reusar padrão de `googleSyncInterval`).
  — `src/driveSync.ts`, `src/main.ts`

- [ ] 9. **Paridade MCP** (Requisito 8.1). Espelhar em `mcp/src/store.mjs` qualquer mudança de
  store que o MCP leia. — `mcp/src/store.mjs`

- [x] 10. **Testes + não-regressão** (Requisito 8). Testes de `decideAction` (matriz base/local/
  remote), de deleção segura, do naming de conflito e do enriquecimento de hash; confirmar que
  o sync de Tasks e a UI existente não mudam; build + lint + testes verdes. — `tests/`

- [ ] 11. **Verificação OAuth restricted (OBRIGATÓRIA — escopo `drive` completo escolhido)**
  (Requisito 2). Estender `docs/oauth-verification/` (justificativa de escopo + checklist)
  para o escopo `drive`; preparar política de privacidade e o material da revisão restricted
  do Google. — `docs/oauth-verification/`
