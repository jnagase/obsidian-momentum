# Google Health (Fitbit / Pixel Watch) no Fitness — Requirements

## Visão geral
Trazer para o módulo Fitness os dados do relógio do usuário (Fitbit Air, outros Fitbit, Pixel
Watch) pela **Google Health API** (`https://health.googleapis.com/v4`), sucessora do Fitbit Web API
(desligado em 2026-11-02) e do Google Fit (fechado para apps novos desde 2024-05, desliga no fim de
2026).

Modelo **BYO ("bring your own") client**: cada usuário cria o **próprio** OAuth client no Google
Cloud e cola Client ID/Secret nas settings. Motivo: todos os scopes da Health API são
**Restricted** → um client do autor exigiria verificação OAuth + auditoria CASA anual (US$
500–4.500) para passar de 100 usuários, cada um cadastrado à mão. Com BYO, cada usuário é o único
usuário do próprio app: sem teto, sem auditoria, sem custo.

Feature **beta, opt-in, OFF por padrão** e **somente leitura** (Google → Obsidian). Nada é escrito
no Google Health.

## Fatos validados (docs oficiais, 2026-11-05)
- Fitbit Air entrega: steps, distance, floors, exercise, sleep, heart-rate, daily-resting-heart-rate,
  heart-rate-variability, oxygen-saturation, total-calories, active-minutes, active-zone-minutes,
  VO2 max, entre outros.
- **Peso NÃO vem do Air** — só de balança Fitbit Aria ou registro manual no app Google Health
  (`weight`, scope `health_metrics_and_measurements.readonly`).
- Scopes começam com `https://www.googleapis.com/auth/googlehealth.` (ex.:
  `activity_and_fitness.readonly`, `health_metrics_and_measurements.readonly`, `sleep.readonly`).
- **Decisão do autor (2026-11-12): pedir TODOS os scopes `.readonly`** da Health API, para usar mais
  dados no plugin no futuro: `activity_and_fitness`, `health_metrics_and_measurements`, `sleep`,
  `nutrition`, `location`, `logged_symptoms`, `ecg`, `irn` (todos `.readonly`). Nenhum scope de
  gravação apareceu na lista do Google (gravar Obsidian → Google fica para uma fase 2, se existir).
  O guia BYO do usuário deve listar exatamente esses scopes, e o plugin pede só os que o usuário
  marcou (pedir um scope ausente no projeto dele faz o login falhar).
- Publishing status **Testing** → refresh token expira em **7 dias**. **In production** → não expira
  (salvo revogação ou ~6 meses sem uso).
- App não verificado: teto de 100 usuários e o usuário precisa estar na lista de **Test users**.

## Hipóteses a validar ANTES de codar (tarefa 0)
**H1 e H3 passaram em 2026-11-12** (ver `tasks.md` 0.2/0.4). H2 é validada na tarefa 1.
- **H1:** um client pessoal com scope restrito pode ir para **In production** sem verificação (só
  com a tela "app não verificado"). Se NÃO puder → o login expira a cada 7 dias → a feature precisa
  de "reconectar" semanal (pior UX) ou é abortada.
- **H2:** o client tipo **Web** do usuário aceita como redirect o endereço do nosso Worker relay.
- **H3:** os dados do Fitbit Air do autor aparecem via `users/me/dataTypes/<tipo>/dataPoints`.

## Requisitos

### R1 — Conexão BYO
1. Settings → Fitness → "Google Health (beta)": campos Client ID e Client Secret, botão
   **Connect**, status, botão **Disconnect**.
2. Um link "Como configurar" abre o guia passo a passo (doc no README/site, com prints).
3. Antes do consentimento, mostrar o **aviso exigido pelo Google**: quais dados são lidos e para quê
   ("Momentum life lê seus passos, sono, batimentos e treinos para mostrar no painel de Fitness").
4. Fluxo: plugin abre o Google com o client do usuário (PKCE) → redirect para o **Worker relay** →
   relay faz deep-link `obsidian://momentum-health?code=…&state=…` → **o plugin** troca o código
   pelo token. O relay **nunca** recebe o Client Secret nem o token.
5. Funciona em desktop e mobile (mesmo caminho do deep-link do Tasks/Drive).
6. Client Secret e tokens ficam só no `data.json` local (por device), nunca em nota do vault e nunca
   sincronizados pelo Drive.
7. Consentimento parcial: se o usuário negar algum scope, o resto funciona e a UI diz o que falta.

### R2 — Importação (somente leitura)
1. MVP: **passos**, **sono** (duração), **frequência cardíaca de repouso**, **calorias**, **distância**,
   **treinos** (exercise) e **peso** (se existir).
2. Roda ao abrir o Obsidian, no botão "Sync now" e no máximo a cada N horas. Janela padrão: últimos 7
   dias; primeiro sync: últimos 30 dias.
3. Idempotente: rodar duas vezes não duplica nada (chave = data para métricas diárias; id do Google
   para treinos e pesos).
4. Erros com o corpo da resposta do Google no log (`Config/google-health-debug.md`), `requestUrl`
   com `throw: false`.

### R3 — Onde os dados ficam (fonte da verdade = vault)
1. Métricas diárias numa nota mensal **nova**: `Fitness/Health/Health YYYY-MM <Mês>.md`
   (`type: health-month`, frontmatter `days: { "YYYY-MM-DD": { steps, sleepMin, restingHr,
   calories, distanceKm } }`, corpo legível regenerado). Não mexe nas notas `fitness-month`.
2. Treinos do relógio entram na `fitness-month` como treino com `source: "google-health"` e
   `external_id` (D2 — no calendário, por padrão). Nunca alteram treinos manuais.
3. Peso: entra no `weight.md` (D3). **Registro manual do mesmo dia sempre ganha.**
4. Nada é apagado no vault por causa do Google. Um dado sumir no Google não remove do Obsidian.

### R4 — UI
1. No Fitness, painel "Today from your watch": passos, sono, FC de repouso, calorias.
2. Gráfico de passos e sono do mês (reaproveitar o estilo dos gráficos existentes).
3. Textos em sentence case (lint `obsidianmd/ui/sentence-case`).

### R5 — Upgrade transparente
1. Flag OFF por padrão: com ela OFF, nada muda (zero requests, zero arquivos novos).
2. Sem migração de dados existentes.
3. MCP (`mcp/src/store.mjs`) ganha leitura das notas `health-month` (paridade), sem sync.

## Fora de escopo (por agora)
- Escrever no Google Health (treinos do Obsidian → Google) — nenhum scope de gravação disponível.
- Webhooks (precisam de servidor; usamos polling).
- Client do autor com verificação/CASA (caminho "para todos").
- ECG, IRN, sintomas e GPS: o scope é pedido (D1), mas o mapeamento pra UI vem depois do MVP.

## Decisões do autor (2026-11-12) — substituem as antigas perguntas abertas
- **D1 (Q1) — Tudo:** baixar **todos** os tipos de dado disponíveis nos scopes pedidos (passos,
  distância, calorias, andares, minutos ativos, AZM, FC/FC de repouso, HRV, SpO2, VO2 max, sono,
  treinos, peso, nutrição…) e **popular o Fitness** com eles. O MVP do R2.1 vira só a primeira leva;
  o resto entra no painel/nota de saúde conforme o tipo for mapeado.
- **D2 (Q2) — Treinos no calendário:** treinos do relógio **entram no calendário do Fitness** como
  treino (`source: "google-health"`, `external_id`), por padrão (não é opt-in separado). Nunca
  alteram nem duplicam treino manual (casar por `external_id`; treino manual no mesmo horário ganha).
- **D3 (Q3) — Peso no registro:** peso do Google **entra no `weight.md`**. Registro manual do mesmo
  dia sempre ganha.
- **D5 — Alimentação no Nutrition (2026-11-12):** os dados de nutrição do Google entram como
  **refeições no módulo Nutrition** (mesma nota mensal de meal logs), com `source: "google-health"` e
  `external_id` (idempotente, nunca duplica nem altera registro manual). Risco aceito: se a mesma
  refeição foi registrada à mão no plugin E num app que manda pro Google, aparece duas vezes.
- **D4 — Fontes Fitbit E celular:** usar as duas fontes (`platform: FITBIT` e `HEALTH_CONNECT`), mas
  **sem contar em dobro** quando cobrem o mesmo período. Preferir o **rollup diário do Google** (que
  já mescla as fontes); se o rollup não deduplicar, por intervalo sobreposto ficar com o **maior**
  valor, nunca a soma. Validar contra o total do dia mostrado no app Google Health/Fitbit.
