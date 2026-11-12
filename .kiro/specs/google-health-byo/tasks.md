# Google Health BYO — Tasks

- [x] 0. Prova de viabilidade (manual, com a conta do autor, SEM código)
  - [x] 0.1 Criar projeto Google Cloud separado; ativar Google Health API
  - [x] 0.2 Consent screen External; adicionar scopes readonly; tentar **Publish app → In production** (valida H1)
    - **Resultado 2026-11-12: H1 PASSOU.** Projeto `obsidianghealth` ficou **In production** com os 8
      scopes restritos `.readonly`, sem verificação. Aparece o aviso "Your app requires verification"
      (ignorar — NÃO enviar pra revisão) e o teto de 100 contas, que pro BYO não importa (1 conta por
      projeto). Branding exigiu home page + privacy policy (`momentumlife.jnagase.com`, `/privacy`) e
      domínio autorizado `jnagase.com`; **sem logo** (logo força verificação). Antes de publicar, o
      login dava `403 access_denied` (Testing sem test user).
  - [x] 0.3 Criar OAuth client **Web** com redirect `https://developers.google.com/oauthplayground`
  - [x] 0.4 No OAuth 2.0 Playground (own credentials) obter token e chamar `GET https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints` (valida H3)
    - **Resultado 2026-11-12: H3 PASSOU** (`200 OK`, ~20 KB). Achados que mudam o design:
      - Pontos são **por minuto** (crus) e **paginados** (`nextPageToken`) → pro resumo diário usar o
        endpoint de **rollup/agregado** por dia, não somar os crus.
      - **Duas fontes no mesmo período:** `platform: FITBIT` (`device.displayName: "Fitbit Air"`) e
        `platform: HEALTH_CONNECT` (celular Samsung, `com.android.healthconnect.phone`). Somar tudo
        **conta passo em dobro**. Regra: preferir uma fonte (Fitbit) ou deixar o rollup do Google
        deduplicar — validar qual dá o total igual ao app.
      - `count` vem como **string**; horário vem em UTC + `startUtcOffset` e em `civilStartTime`
        (hora local) → agrupar o dia pela hora **civil**, não pela UTC.
  - [x] 0.5 Registrar resultado aqui; se H1 falhar, decidir plano B antes de seguir
    - H1 e H3 passaram; decisões D1–D4 gravadas em `requirements.md`. Seguir para a tarefa 1.
- [ ] 1. Relay `worker-health/` (callback → deep-link), deploy, teste de H2
  - [x] 1.1 Código (`worker-health/src/index.js`, `config.js`, `wrangler.toml`, `health-domain.json`) +
    `test/health-relay.test.ts` (sem segredo, sem chamada ao Google, sem storage, escapa HTML).
  - [x] 1.2 Deploy 2026-11-12 (wrangler 4.161.0): `momentum-google-health` em
    `momentumlife-health.jnagase.com` (+ `momentum-google-health.jaime-nagase.workers.dev`).
    `/`, `/privacy` e `/callback` respondem 200; callback gera `obsidian://momentum-health?...`.
  - [ ] 1.3 H2: registrar `https://momentumlife-health.jnagase.com/callback` no client Web do autor
    e confirmar que o Google aceita (validado de ponta a ponta na tarefa 2, com o plugin).
- [ ] 2. `healthAuth.ts` (PKCE, troca, refresh, revoke, `HealthAuthExpiredError`) + testes
  - [x] 2.1 `src/healthdomain.ts` (host do relay a partir de `health-domain.json`), `src/healthAuth.ts`
    (consent URL com o client DO USUÁRIO + 8 scopes `.readonly`, PKCE S256, troca e refresh direto
    em `oauth2.googleapis.com` com `throw:false`, `HealthAuthExpiredError` p/ `invalid_grant`,
    `HealthClientError` p/ `invalid_client`, escopos concedidos, revoke). `test/health-auth.test.ts` (10).
  - [x] 2.2 `main.ts`: settings `googleHealthEnabled`/`healthClientId`/`healthClientSecret`/`healthToken`
    (só no `data.json` do device), handler `obsidian://momentum-health`, `connectHealth`/
    `disconnectHealth`/`healthAccessToken`, card "Google health" `beta` (endereço de redirect com
    botão copiar, Client ID, Client secret mascarado, Connect/Disconnect, "X de 8 tipos permitidos").
  - [x] 2.3 Teste real no vault (fecha o H2): Connect → consentimento → volta ao Obsidian → "Connected".
    - **2026-11-12: H2 PASSOU.** O client Web do autor aceitou o redirect do relay e o login fechou.
      Bug achado e corrigido: o botão Connect ficava desabilitado (estado calculado só no render);
      agora sempre clicável, valida no clique.
- [x] 3. `googlehealth.ts` (dataPoints/rollup, `throw:false`, erro com corpo) + testes com mock
  - `listDataPoints` (filtro AIP-160, paginação, teto de 50 páginas) e `dailyRollUp` (blocos de 14
    dias, o limite mais apertado). O **dailyRollUp reconcilia todas as fontes** (doc oficial) → D4.
- [x] 4. Transforms puros (`src/healthTransforms.ts`) + `test/health-transforms.test.ts` (13)
  - rollup → dia (campo `*Sum` genérico; mm→km, ml→L), FC repouso, sono (dia do despertar, cochilos
    somam), peso (último do dia), treino → entrada `fitness-month` (cardio, `external_id` = name do
    data point), nutrição → refeição por dia+tipo, `upsertByExternalId` (manual intocado; item
    importado que sumiu do Google sai só dentro da janela relida).
- [x] 5. Store em `data.ts`: `upsertGoogleWorkouts`/`upsertGoogleMealLogs` (notas mensais existentes),
  `mergeHealthDays` (nova `Fitness/Health/Health YYYY-MM <Mês>.md`, `type: health-month`),
  `applyGoogleWeights`/`applyGoogleWater` (mapa `google` no `weight.md`/`water.md`: Google só
  preenche dia vazio ou dia que ele mesmo escreveu → o manual sempre ganha).
- [x] 6. `healthSync.ts` + `main.ts`: janela 30 dias no 1º sync, depois 7; roda 6 s após abrir, logo
  depois do Connect, no comando "Momentum: import from Google health now (beta)" e no botão
  "Import now"; cada tipo isolado (falha de um não para os outros); filtro snake_case com fallback
  camelCase em 400; log em `Config/google-health-debug.md` (fora do Drive).
  - [ ] 6.1 Teste real no vault.
- [ ] 7. Settings (flag beta OFF, Client ID/Secret, Connect/Disconnect, aviso de privacidade, guia)
- [ ] 8. UI no Fitness (painel do dia + gráficos)
- [ ] 9. Opcional conforme Q2/Q3: treinos → `fitness-month`; peso → `weight.md`
- [ ] 10. MCP: leitura de `health-month`
- [ ] 11. Guia "Como configurar" (README/site) + What's new + steering

- [x] 7. Multi-device (2026-11-12)
  - [x] 7.1 Client ID/secret numa nota do vault, `Config/google-health.md` (`type: google-health-client`),
    sincronizada pelo Drive: cola uma vez, o outro aparelho só clica Connect. O **token** continua por
    aparelho no `data.json` (nunca sincroniza).
  - [x] 7.2 **Aparelho importador** (`src/healthImporter.ts`, `test/health-importer.test.ts`): só um
    aparelho importa (um escritor só → sem `.conflict`). Registrado na mesma nota (`importer_device`/
    `importer_name`/`importer_last`, id = `driveDeviceId`). Outro aparelho: no startup pula calado; no
    "Import now" pergunta se quer virar o importador; assume sozinho após 24 h sem import. Card mostra
    "Importer device" com botão "Use this device". Só vale pro Google Health — o Google Tasks continua sem dono.
  - [ ] 7.3 Teste real com celular + desktop.
