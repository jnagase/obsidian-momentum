# Google Health BYO — Design

## Peças
| Peça | Onde | Papel |
|---|---|---|
| Auth | `src/healthAuth.ts` (novo) | PKCE, URL de consentimento, troca code→token e refresh direto em `https://oauth2.googleapis.com/token` com o client do usuário |
| Cliente da API | `src/googlehealth.ts` (novo) | `listDataPoints(token, dataType, start, end)`, `dailyRollup(...)`; `requestUrl` com `throw: false`; erro inclui o corpo |
| Sync | `src/healthSync.ts` (novo) | Janela de datas, mapeia data points → `days[...]`, grava via store; idempotente |
| Store | `src/data.ts` | `readHealthMonth`/`writeHealthMonth` (texto cru autoritativo, igual `readMonthEntries`) |
| Transforms | `src/loaders.ts` | `healthDomainToEntry`, `mergeHealthDays` (puros, testáveis) |
| Relay | `worker-health/` (novo Worker Cloudflare) | Só `GET /callback?code&state` → página que faz deep-link `obsidian://momentum-health?...`. Sem secrets, sem token, sem storage |
| UI | `src/modules/fitness.ts` | Painel "Today from your watch" + gráficos; settings em `main.ts` |
| MCP | `mcp/src/store.mjs` | Leitura de `health-month` |

## Fluxo de login
```
Connect → healthAuth.buildAuthUrl(clientId, verifier, state)
       → navegador: accounts.google.com (client DO USUÁRIO, scopes readonly)
       → redirect https://<relay>/callback?code&state
       → relay: deep-link obsidian://momentum-health?code&state
       → plugin: confere state, POST token endpoint (client_id, client_secret, code, code_verifier, redirect_uri)
       → guarda { refresh_token, access_token, expiry } em data.json (healthToken)
```
O relay é stateless e não sabe nada do usuário — por isso não precisa guardar secret. É um Worker
**separado** de `momentum-google` (Tasks) e `momentum-google-drive`, para não misturar callbacks.

Erros conhecidos tratados como no Tasks: `400 invalid_grant` → `HealthAuthExpiredError` + Notice
"reconecte" (cobre o caso H1 negativo / modo Testing de 7 dias).

## Formato da nota mensal
```yaml
---
type: "health-month"
month: "2026-11"
days: {"2026-11-05":{"steps":8421,"sleepMin":412,"restingHr":58,"calories":2310,"distanceKm":6.1}}
modified: "2026-11-05T20:00:00.000Z"
---
# Health 2026-11 November
| Day | Steps | Sleep | Resting HR | kcal | km |
|---|---|---|---|---|---|
| 05 | 8,421 | 6h52 | 58 | 2,310 | 6.1 |
```
Frontmatter = fonte da verdade (JSON.stringify, escapado). Corpo regenerado a cada escrita.
Merge por campo: valor novo do Google substitui o antigo do mesmo dia (dado do relógio), campo
ausente na resposta mantém o valor gravado.

## Segurança e privacidade
- Scopes só `.readonly`. Nunca `writeonly`.
- `healthClientSecret`/`healthToken` no `data.json`; adicionar ao `DRIVE_DATA_EXCLUDE`/escopo para
  nunca viajar pelo Drive (data.json já não sincroniza; conferir).
- Disconnect revoga o token (`https://oauth2.googleapis.com/revoke`) e apaga do data.json. As notas
  ficam (são do usuário).
- Aviso in-app antes do consentimento (exigência do Google para dados de saúde).

## Riscos
| Risco | Mitigação |
|---|---|
| H1 falha (app pessoal não vai a produção) | Tarefa 0 valida antes; plano B = reconectar semanal com Notice claro |
| Configuração difícil para leigo | Guia com prints + validação dos campos com mensagem clara |
| Review da comunidade: domínio novo | Declarar no README a rede usada (health.googleapis.com, oauth2, relay) |
| API muda (v4 é estável, v4beta não) | Usar só `v4` |
