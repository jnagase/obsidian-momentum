# Plano de implementação

## Bloco A — Worker de Drive isolado (infra)

- [ ] 1. Restaurar `worker-drive/` do backup e ajustar para o Drive_Client
  - `SCOPES = "https://www.googleapis.com/auth/drive"`; deep-link de retorno `obsidian://momentum-drive`; `CANONICAL_REDIRECT_URI` próprio
  - _Requisitos: 1.1, 1.2_

- [ ] 2. Provisionar Cloudflare + Google (passo a passo p/ o autor)
  - Criar 2º client OAuth (Drive) no Google Cloud; criar workers `momentum-drive` e `momentum-drive-dev`; `wrangler secret put` com os secrets do Drive_Client; registrar redirects
  - _Requisitos: 1.2, 3.1, 3.3_

- [ ] 3. Teste de regressão de isolamento
  - Afirmar: `worker/` só `tasks`; `worker-drive/` só `drive`; nenhum vazamento de escopo entre eles
  - _Requisitos: 1.1, 1.5_

## Bloco B — Auth do Drive desacoplada (plugin)

- [ ] 4. `src/driveAuth.ts` — PKCE do Drive (espelha o Tasks, sem tocá-lo)
  - `authorizeDrive`, `ensureFreshDriveToken`, `completeDriveAuth`, `DRIVE_PROTOCOL_ACTION`, `DRIVE_WORKER_BASE`
  - _Requisitos: 1.2, 1.3, 1.4_

- [ ] 5. Token separado + deep-link no `main.ts`
  - `settings.driveToken`; `driveAccessToken()` lê/refresca só o `driveToken`; `registerObsidianProtocolHandler("momentum-drive", …)`; conectar/desconectar Drive não toca `googleToken`
  - _Requisitos: 1.3, 1.4_

## Bloco C — Feature de Drive atrás da flag (reaproveitar backup)

- [ ] 6. Restaurar `googledrive.ts`, `driveBrowser.ts`, `driveSync.ts` do backup
  - Reapontar para `driveAuth`/`driveToken`; manter o motor de sync e suas guardas
  - _Requisitos: 6.1, 6.2, 6.3, 7.1_

- [ ] 7. Reintroduzir wiring de Drive em `main.ts` atrás de `googleDriveEnabled` (off)
  - View/comandos/settings/timer só quando a flag on; rótulo "(beta)"; File Manager local intacto + seção Drive opcional
  - _Requisitos: 2.1, 2.2, 2.3, 7.2_

## Bloco D — Canais de build (estágios)

- [ ] 8. Restaurar o modo `drivetest` no `esbuild.config.mjs` + `package.json`
  - `app-domain.json` (prod `momentum-drive`) e `app-domain.test.json` (dev); alias só no drivetest; artefato de teste nunca publicado
  - _Requisitos: 3.1, 3.2_

## Bloco E — Testes

- [ ] 9. Reaproveitar/adaptar `test/drive-sync.test.ts` (engine puro) + testes de auth/worker do Drive
  - `threeWayMerge`/`decideAction`/`conflictName`; broker/worker-config para `momentum-drive`; isolamento de token
  - _Requisitos: 1.5, 6.1, 8.1_

## Bloco F — Estágios de rollout (gates)

- [ ] 10. Estágio 1 (local): build drivetest + Drive_Client em Testing + smoke test do fluxo completo
  - consent → callback → exchange → refresh → list/open/sync, na máquina do autor
  - _Requisitos: 3.1, 3.3_

- [ ] 11. Estágio 2 (beta): release normal com flag off + worker/client `momentum-drive` (Testing ≤100)
  - Rótulo "(beta)"; comunicação de test-user; garantir que Tasks nunca vê tela de não-verificado
  - _Requisitos: 4.1, 4.2, 4.3_

- [ ] 12. Estágio 3 (produção): após Verificação_Restrita aprovada
  - Documentar materiais em `docs/oauth-verification/` (justificativa full-scope, privacidade, domínio, vídeo, CASA); liberar geral removendo o rótulo beta
  - _Requisitos: 5.1, 5.2, 5.3_

## Transversal

- [ ] 13. Build + lint + suíte de Tasks verdes a cada bloco; paridade MCP se surgir campo novo; upgrade transparente
  - _Requisitos: 8.1, 8.2, 8.3_

## Bloco G — Hardening do sync (informado pelas referências públicas)

### Beta-blockers (antes de conectar uma conta real)

- [x] 14. First-run content-aware — não gerar `.conflict` para arquivos idênticos sem baseline
  - Em `runDriveSync`/`decideAction`: quando `localExists && remoteExists && !base`, comparar
    hash/conteúdo; iguais → adotar baseline (noop); diferentes → conflito. Teste do caso.
  - _Requisitos: 9.1_

- [x] 15. Segurança de binário — bloquear-e-avisar arquivos não-texto (beta)
  - Detectar não-texto (extensão/tamanho) e pular com aviso, em vez de `TextDecoder`; documentar.
  - _Requisitos: 9.5_

- [x] 16. Estratégia de conflito configurável (`keep-both` padrão)
  - Setting `driveConflictStrategy` = keep-both|local-wins|remote-wins|newer-wins|ask; `ask` abre
    modal de resolução. Testes das variantes de `decideAction`/aplicação.
  - _Requisitos: 9.2_

- [x] 17. Guarda de deleção em massa (`max-delete`) separada do disjuntor de writes
  - Acima do limite, abster/pedir confirmação (padrão do rclone `--max-delete`).
  - _Requisitos: 9.7_

- [x] 18. Teste de integração do `runDriveSync` (VaultFS fake + Drive fake)
  - Cobrir push/pull/merge/conflict/delete + first-run idêntico + multi-device (baseline por-device).
  - _Requisitos: 9.1, 9.2, 9.8_

### Escopo configurável + subpastas + vault-inteiro (Req 10) — FEITO

- [x] 23. Motor path-based: chavear por caminho relativo; `walkRemoteTree` (BFS); `ensureRemoteFolderPath`
  - `dirOf`/`baseOf`; folderCache; helpers push/pull/merge/conflict/delete por relPath.
  - _Requisitos: 10.1_

- [x] 24. `VaultFS` recursivo + vault-inteiro (`driveMirrorDir` ""), excluindo `dataRoot`; cria subpastas locais
  - _Requisitos: 10.1, 10.3, 10.4_

- [x] 25. Seletor de pasta do Drive (`driveFolderPicker.ts`) + settings de dois campos (pasta local + pasta Drive)
  - `createFolder`/`findChildFolder` na Drive API; `driveFolderId`+`driveFolderName`.
  - _Requisitos: 10.2, 10.5_

- [x] 26. Testes path-based (fake Drive parent-aware) + casos de subpasta
  - _Requisitos: 10.1_

### Pós-beta

- [x] 19. Changes API incremental (`getStartPageToken` + `changes.list`) — opt-in `driveIncremental`
  - Sem mudanças remotas desde o cursor → pula o walk completo e reconstrói remoto pelas baselines;
    qualquer mudança/erro cai no walk completo (seguro). Detecção de edição direta no Drive.
  - _Requisitos: 9.3, 9.4_

- [x] 20. Subpastas — preservar estrutura (caminho relativo + `parents`)  ← entregue junto do Req 10
  - _Requisitos: 9.6_

- [x] 21. Upload/download binário real (media upload) — opt-in `driveSyncBinaries` (off = block-and-warn)
  - `createBinaryFile`/`updateBinaryFile`; VaultFS `readBinary`/`writeBinary`; branch binário no motor
    (sem 3-way merge; conflito = estratégia/keep-both); detecção por FNV hash local × md5 remoto.
  - _Requisitos: 9.5_

- [x] 22. Backup + status bar — aviso de backup ao conectar; status bar `Drive: ↑/↓/⇄/⚠/🗑`
  - _Requisitos: 9.9_

### Backlog acumulado (decisões de UX/arquitetura pendentes)

- [x] 27. Sync no startup (opcional) — `driveSyncOnStartup` dispara um sync ~4s após o launch (guardado)
  - _Requisitos: 9.x_

- [x] 28. **Gatilho event-driven** — `driveSyncOnChange`: `vault.on(modify/create/delete/rename)` com
    debounce (8s), guarda `driveSyncing` p/ ignorar as próprias escritas, e filtro de escopo.
  - _Requisitos: 9.x_

- [x] 29. **Multi-device** — lockfile advisory na pasta do Drive (`.momentum-drive-sync.lock`,
    TTL 15min, `driveDeviceId` por dispositivo); segundo device aborta com aviso. Excluído do sync.
  - _Requisitos: 9.8_

- [x] 30. Painel "Google Drive ⇄ vault" recursivo/whole-vault (reusa `walkRemoteTree`/relPath) — conta certo.

## Nota de arquitetura — "por tempo" vs event-driven (pergunta do autor)

Ferramentas de sync de verdade (Obsidian Sync, app do Google Drive/Dropbox, remotely-save,
obsidian-git) são majoritariamente **event-driven + incremental**, não um timer burro:
- **Local:** observam o filesystem (no Obsidian, os eventos `vault.on(...)`) e empurram só o
  arquivo que mudou, com debounce — sync quase em tempo real.
- **Remoto:** usam **delta/push** (a Changes API do Drive, webhooks, cursores) para saber o que
  mudou no servidor sem re-listar tudo.
- Muitas ainda oferecem um intervalo/backup periódico, mas como **rede de segurança**, não como
  mecanismo principal.

**Por que o nosso nasceu "por tempo/manual":** foi **portado do sync de Google Tasks** (que é um
poller por intervalo) e faz um **full reconcile a cada rodada** — o caminho mais simples e correto
pro primeiro corte, sem depender ainda da Changes API nem dos eventos de vault. É robusto, mas
lento e pouco responsivo (como você viu no whole-vault).

**Evolução desejada:** tasks 28 (event-driven local) + 19 (Changes API remoto), mantendo o
full-scan manual/periódico só como fallback de segurança.
