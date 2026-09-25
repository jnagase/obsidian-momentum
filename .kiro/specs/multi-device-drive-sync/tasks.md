# Tarefas — Sync multi-dispositivo com Google Drive

Cada fase é shippável sozinha (build + testes verdes + deploy no vault de teste +
entrada no whatsnew). Nada é commitado/publicado sem ordem explícita.

## Fase 1 — Cursor correto + delta real via Changes API

- [ ] 1.1 Em `src/googledrive.ts`, adicionar `appProperties` ao `FILE_FIELDS` e
  `restrictToMyDrive=false` ao `listChanges`; confirmar que `listChanges` retorna e expõe
  `newStartPageToken`. (Req 5.1, 8.2)
- [ ] 1.2 Em `src/googledrive.ts`, detectar `InvalidDeltaToken` em `listChanges` e expor
  isso ao motor (tipo de erro dedicado ou flag no retorno). (Req 1.3)
- [ ] 1.3 Em `src/driveSync.ts`, reescrever o bloco OBSERVE: quando há cursor válido,
  consumir os eventos (`changes[]`) e construir `remoteChangedIds` e `remoteRemovedIds`;
  só cair no `walkRemoteTree` em primeiro contato, cursor inválido ou reconciliação.
  (Req 1.1, 5.3, 8.1, 8.3)
- [ ] 1.4 Em `src/driveSync.ts`, no COMMIT, avançar o cursor com o `newStartPageToken`
  do `listChanges` (encadeado), só quando `!fatal && !stopped`; usar `getStartPageToken`
  apenas na re-semeadura de full-scan. (Req 5.1, 5.2)
- [ ] 1.5 Ajustar `decideAction` para receber `remoteDeletedExplicit`/`remotePresent` e
  parar de derivar `delete_remote` de ausência sem evento. (Req 1.1, 1.5)
- [ ] 1.6 Testes: cursor encadeia; delta aplica só o que mudou; ausência remota sem
  evento NÃO apaga; cursor inválido → full-scan sem deleções. (Req 1, 5, 8)
- [ ] 1.7 Build + deploy no vault de teste; entrada no `whatsnew.ts`.

## Fase 2 — Evidência de deleção local (fim do apagar-por-ausência local)

- [ ] 2.1 Em `src/main.ts`, adicionar `driveLocalDeletes` a `PASettings`/DEFAULT e ao
  `driveBaselineStore`; no watcher `vault.on("delete")`, registrar o path deletado. (Req 1.2)
- [ ] 2.2 Em `src/driveSync.ts`, `delete_remote` só quando há evidência de deleção local
  (buffer) OU evento remoto; ausência local sem evidência vira `pull` (re-baixa). (Req 1.2, 6.1)
- [ ] 2.3 Consumir/limpar o buffer `driveLocalDeletes` ao final de um ciclo limpo.
- [ ] 2.4 Manter o "escudo de deleção" (varredura incompleta → blindar, não apagar). (Req 6.2)
- [ ] 2.5 Testes: deleção local real propaga; arquivo "ainda não baixado" não é apagado. (Req 1.2)
- [ ] 2.6 Build + deploy; whatsnew.

## Fase 3 — Tombstone de recusa de deleção

- [ ] 3.1 Em `src/main.ts`, adicionar `driveDeclinedDeletions` a `PASettings`/DEFAULT e
  métodos no store (`getDeclined`/`setDeclined`/`clearDeclined`). (Req 3.1)
- [ ] 3.2 Em `src/driveSync.ts`, ao recusar a confirmação de deleção em massa, gravar
  tombstone por path com `sig`; filtrar deleções com tombstone válido nos próximos ciclos. (Req 3.1)
- [ ] 3.3 Invalidar tombstone quando a `sig` muda (situação mudou); limpar tombstone
  quando o usuário ACEITA a deleção. (Req 3.2, 3.3)
- [ ] 3.4 Mensagem de confirmação explica o motivo da deleção proposta. (Req 6.3)
- [ ] 3.5 Testes: recusa suprime re-prompt; mudança de sig reconsidera; aceite limpa. (Req 3)
- [ ] 3.6 Build + deploy; whatsnew.

## Fase 4 — keep-both fecha o ciclo

- [ ] 4.1 Em `src/driveSync.ts` (`this_conflict`/keep-both), após criar `.conflict`,
  atualizar o baseline do original para o estado pós-resolução e criar baseline do
  `.conflict` como arquivo novo. (Req 4.1, 4.2)
- [ ] 4.2 Antes de criar `.conflict-N`, não duplicar se já existe `.conflict` idêntico ao
  remoto. (Req 4.3)
- [ ] 4.3 Testes: par resolvido não re-conflita no ciclo seguinte; sem crescimento de
  `.conflict-N`. (Req 4)
- [ ] 4.4 Build + deploy; whatsnew.

## Fase 5 — Identidade estável (appProperties) + anti-duplicata

- [ ] 5.1 Em `src/googledrive.ts`, aceitar `appProperties` em create/update e adicionar
  `setAppProperties(token, fileId, props)`. (Req 2.1, 2.4)
- [ ] 5.2 Em `src/driveSync.ts`, no push/create, gravar
  `appProperties.momentumPath`/`momentumOrigin`. (Req 2.1)
- [ ] 5.3 Na observação, indexar/casar remoto por `momentumPath` antes de path (fallback
  para path). (Req 2.2)
- [ ] 5.4 Consolidação não destrutiva de dois fileIds com a mesma `momentumPath`
  (mantém mais novo, rebaixa o outro a `.conflict`, loga o motivo). (Req 2.3)
- [ ] 5.5 Marcação preguiçosa: arquivos já sincronizados recebem `appProperties` na
  próxima vez que forem tocados (sem re-upload em massa). (Req 7.3)
- [ ] 5.6 Testes: rename no Drive não vira duplicata; duplicata de corrida consolida sem
  perder conteúdo. (Req 2)
- [ ] 5.7 Build + deploy; whatsnew.

## Fase 6 — Migração, compatibilidade e fechamento

- [ ] 6.1 Em `src/main.ts`, migração guardada por `driveSyncSchema`: valida `driveCursor`
  antigo; se inválido, re-semeia via full-scan (sem deleção por ausência); Notice curto.
  (Req 7.1, 7.2)
- [ ] 6.2 Garantir que nenhuma operação destrutiva (consolidação) roda automática num
  upgrade sem confirmação; só as não-destrutivas. (Req 7.4)
- [ ] 6.3 Atualizar a guarda de deleção em massa para contar só deleções explícitas. (Req 6.1)
- [ ] 6.4 Atualizar `mcp/src/store.mjs` se algum campo novo de config precisar ser
  lido/preservado pelo MCP (loadConfig E saveConfig). (regra do steering)
- [ ] 6.5 Suite completa: `tsc -noEmit`, `eslint`, `vitest run` verdes; build; deploy.
- [ ] 6.6 Atualizar README (seção Drive/beta) e `docs/HANDOFF.md` com o novo modelo.
- [ ] 6.7 Entrada final no `whatsnew.ts` resumindo a robustez de sync multi-dispositivo.

## Notas de execução

- Ordem recomendada = ordem das fases (Fase 1 dá o maior ganho com menor risco).
- Cada checkbox só é marcada quando de fato concluída (steering: não marcar passo pulado).
- Perguntar ao usuário antes de cada build; nunca commitar/publicar sem ordem explícita.
- Testar com o Obsidian FECHADO ao mexer no vault de teste (steering).
