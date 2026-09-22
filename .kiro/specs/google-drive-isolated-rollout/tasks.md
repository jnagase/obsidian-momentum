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
