# Design — Sync multi-dispositivo com Google Drive (robusto e rápido)

## Filosofia

A pesquisa nos três sistemas de referência converge num único princípio:

- **Google/Dropbox/OneDrive** (arquivos binários): não fundem conteúdo; usam um
  **servidor central com número de versão** (OCC) como fonte da verdade e resolvem
  conflito com **Last-Write-Wins + cópia de conflito** (nunca apagam).
- **remotely-save**: TENTOU um arquivo de metadados compartilhado no remoto e o
  **REMOVEU na 0.4.1**; voltou para estado local por-dispositivo + LWW + "cálculo de
  deleção real" + aviso de limite.
- **obsidian-air-sync**: baseline por-dispositivo + merge 3-way + fallback LWW +
  keep-both + "edição vence deleção" + a regra de **ser o único sincronizador**.

Conclusão de projeto: **não** construímos um ledger nosso. Em vez disso, usamos o que o
Google Drive **já é** — um servidor central com um fluxo de eventos explícitos (Changes
API) que inclui deleções, e um relógio compartilhado (`modifiedTime`). Trocamos a
**inferência de deleção por ausência** pelo **consumo de eventos explícitos**, e damos
identidade estável ao arquivo via `appProperties`.

Isso é o mínimo de mudança para máxima robustez: o cliente do Changes API já existe;
estamos ligando o que está desligado e corrigindo o modelo de decisão.

---

## Visão geral da arquitetura

```
                    ┌──────────────────────────────────────────┐
                    │            Google Drive (SoT)             │
                    │  files + appProperties.momentumPath       │
                    │  Changes API: startPageToken → eventos    │
                    │     (create/modify/removed/trashed)       │
                    └───────────────┬───────────────────────────┘
                                    │  listChanges(cursor) → {changes[], newStartPageToken}
                                    ▼
   ┌────────────────────────────── runDriveSync ──────────────────────────────┐
   │  1. OBSERVE                                                                │
   │     • cursor válido  → DELTA: aplica só os fileIds dos eventos             │
   │                        (removed → deleção EXPLÍCITA)                        │
   │     • sem cursor / inválido / reconciliação → FULL WALK (adoção, sem       │
   │                        inferir deleção)                                     │
   │  2. DECIDE (decideAction v2)                                              │
   │     • usa evidência de deleção EXPLÍCITA (não ausência)                    │
   │     • casa por appProperties.momentumPath antes de path                    │
   │     • LWW por modifiedTime como desempate; edição vence deleção            │
   │  3. GUARD                                                                  │
   │     • mass-delete guard conta só deleções explícitas                       │
   │     • decisão recusada → tombstone local (não re-pergunta)                 │
   │  4. APPLY  (pull/push/merge/keep-both/delete soft)                         │
   │     • push/create grava appProperties.momentumPath                         │
   │     • keep-both atualiza baseline (não re-conflita)                        │
   │  5. COMMIT                                                                 │
   │     • avança cursor com newStartPageToken (encadeado), só em ciclo limpo   │
   └───────────────────────────────────────────────────────────────────────────┘
                                    │
                        DriveBaselineStore (data.json, por-dispositivo)
                        + declined-deletions tombstones (local)
```

---

## Componentes e mudanças por arquivo

### `src/googledrive.ts` (cliente REST)

**Mudanças pequenas e aditivas:**

1. `FILE_FIELDS` passa a incluir `appProperties`:
   ```ts
   const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,md5Checksum,size,trashed,appProperties";
   ```
2. `listChanges` passa a incluir `restrictToMyDrive=false` (recomendação da doc/SO para
   não perder remoções) e continua com `includeRemoved=true`. Já retorna
   `newStartPageToken` — passaremos a **usá-lo**.
3. Novas funções finas:
   - `createTextFile`/`createBinaryFile`/`updateTextFile` ganham um parâmetro opcional
     `appProperties?: Record<string,string>` (gravado no metadata do multipart / num
     PATCH de metadata após o upload de media).
   - `setAppProperties(token, fileId, props)` — PATCH `{ appProperties }` para marcação
     preguiçosa de arquivos já existentes (Req 7.3).
   - `InvalidDeltaToken` detectável: `listChanges` distingue o erro de token inválido
     (status/reason) e o sinaliza para o motor cair no full-scan (Req 1.3).

Nenhuma assinatura existente quebra (parâmetros novos são opcionais).

### `src/driveSync.ts` (motor — o coração da mudança)

**a) OBSERVE — dois modos explícitos**

- **DELTA (padrão quando há cursor válido):** chama `listChanges(cursor)`, e monta:
  - `remoteChangedIds`: fileIds com `file` presente (create/modify/untrash) → candidatos
    a pull/merge.
  - `remoteRemovedIds`: fileIds com `removed:true` OU `file.trashed:true` → **deleções
    explícitas**.
  Combina com o baseline (que mapeia path ↔ fileId) para saber quais paths tocar.
  Só lê a árvore local para os paths afetados + detecção de mudanças locais.
- **FULL WALK (primeiro contato / cursor inválido / reconciliação):**
  `walkRemoteTree` como hoje, mas o resultado NÃO gera `delete_*` por ausência — só
  adoção/keep-both/pull/push. Deleção só via evento (delta) ou tombstone remoto.

**b) DECIDE — `decideAction` v2**

Nova entrada: em vez de só `remoteExists`, o motor passa `remoteDeletedExplicit: boolean`
(veio de um evento `removed`/`trashed`) e `remotePresent: boolean` (apareceu na
observação). Regra nova:

| Situação | Antiga (por ausência) | Nova (por evento) |
|---|---|---|
| Local existe, remoto ausente na listagem, **sem** evento de remoção | `delete_local` se local inalterado | `pull` re-baixa / `noop` — trata como "ainda não presente", **não apaga** |
| Local existe, **evento de remoção explícito**, local inalterado | (igual) | `delete_local` |
| Local existe, evento de remoção, local **mudou** | `push` | `push` (edição vence deleção) |
| Local sumiu, remoto presente, baseline existe, remoto inalterado | `delete_remote` | `delete_remote` **apenas** se houver evidência de que o LOCAL foi apagado por evento local (o watcher do vault dá esse sinal); senão `pull` (re-baixa) |

O ponto crítico: **ausência deixa de ser prova de deleção**. Some do lado remoto só conta
como deleção se veio um evento; some do lado local só conta se o próprio Obsidian emitiu
um evento `delete` para aquele path (o plugin já escuta `vault.on("delete")` no watcher —
podemos registrar o path deletado num buffer curto para o próximo sync usar como
evidência), caso contrário é "ainda não baixado" → re-pull.

**c) Identidade por `appProperties.momentumPath`**

- Na observação, indexa o remoto por `appProperties.momentumPath` quando presente, com
  fallback para o path derivado da árvore. Isso torna rename/move no Drive não
  destrutivo (o arquivo continua sendo "o mesmo").
- No push/create, grava `appProperties.momentumPath = <relpath>` (e `momentumOrigin`).
- Consolidação de duplicatas (Req 2.3): quando dois fileIds diferentes têm a mesma
  `momentumPath`, mantém o `modifiedTime` mais novo como canônico (atualiza baseline para
  o fileId dele) e rebaixa o outro para `.conflict` (não apaga). Roda como parte do
  apply, não como migração automática destrutiva.

**d) Tombstone de recusa de deleção (Req 3)**

- Novo port no `DriveBaselineStore` (ou store irmão): `getDeclinedDeletions()` /
  `setDeclinedDeletion(path, sig)` / `clearDeclinedDeletion(path)`.
- `sig` = assinatura da situação (ex.: `fileId+md5` remoto ou `mtime` local) para
  detectar quando a situação mudou e o tombstone deve ser invalidado (Req 3.2).
- Persistido em `data.json` (por-dispositivo). Ao montar `deletePlans`, filtra os que têm
  tombstone válido; se a `sig` mudou, ignora o tombstone e re-considera.

**e) keep-both atualiza baseline (Req 4)**

- Após escrever `<name>.conflict.ext` com o conteúdo remoto e manter o local:
  - baseline do arquivo original passa a refletir o estado atual (local mantido + fileId
    remoto atual) → não re-detecta divergência.
  - baseline do novo `.conflict` é criado (arquivo novo) → passa a sincronizar sozinho.
- Antes de criar mais um `.conflict-N`, checa se já existe um `.conflict` com conteúdo
  idêntico ao remoto → se sim, não duplica (Req 4.3).

**f) COMMIT — cursor encadeado (Req 5)**

- No modo delta, guarda o `newStartPageToken` retornado por `listChanges` e o grava no
  commit **apenas** se `!fatal && !stopped`.
- No full-scan de re-semeadura, aí sim usa `getStartPageToken` (é o único momento
  legítimo de "agora").

### `src/main.ts` (wiring)

- `PASettings`: novos campos
  - `driveDeclinedDeletions?: Record<string, { sig: string; ts: number }>`
  - `driveLocalDeletes?: Record<string, number>` (buffer de paths que o watcher viu
    `delete` localmente, com timestamp; consumido e limpo pelo próximo sync)
  - `driveSyncSchema?: number` (guarda de migração)
- `driveBaselineStore()` ganha os métodos de tombstone e do buffer de deleção local.
- `registerDriveChangeWatcher`: no handler de `vault.on("delete")`, além de agendar o
  sync, registra o path em `driveLocalDeletes` (evidência de deleção local real).
- Migração guardada por `driveSyncSchema`: valida o `driveCursor` antigo; se `listChanges`
  devolver InvalidDeltaToken, re-semeia via full-scan; Notice curto "Momentum Drive:
  sincronização atualizada".

### `src/googledrive.ts` + testes

- `test/drive-sync.test.ts` (já existe, engine é testável com VaultFS/Store fakes):
  adicionar casos para:
  - deleção só acontece com evento explícito, não por ausência (Req 1.1/1.2);
  - cursor inválido → full-scan sem deleções (Req 1.3);
  - tombstone de recusa suprime re-prompt e é invalidado quando a sig muda (Req 3);
  - keep-both não re-conflita no ciclo seguinte (Req 4);
  - casamento por `momentumPath` evita duplicata em rename (Req 2);
  - cursor avança com `newStartPageToken` (Req 5).

---

## Modelo de dados (data.json, por-dispositivo)

```jsonc
{
  "driveBaselines": {
    "Journal/2026-09-25.md": {
      "fileId": "1AbC...",
      "md5": "…",
      "modifiedTime": "2026-09-25T12:00:00.000Z",
      "base": "…conteúdo texto…"
    }
  },
  "driveCursor": "907853",                 // agora avançado via newStartPageToken
  "driveDeclinedDeletions": {              // Req 3 — tombstone de recusa
    "Old/thing.md": { "sig": "1AbC…:md5abc", "ts": 1790000000000 }
  },
  "driveLocalDeletes": {                   // Req 1 — evidência de deleção local real
    "Old/thing.md": 1790000000000
  },
  "driveSyncSchema": 1
}
```

No Drive (fonte da verdade), a marcação de identidade fica em `appProperties`:

```jsonc
{ "appProperties": { "momentumPath": "Journal/2026-09-25.md", "momentumOrigin": "dev-abc" } }
```

---

## Estratégia de conflito (inalterada na intenção, endurecida na execução)

- Default continua **keep-both** (nunca perde edição). `newer-wins` usa `modifiedTime`
  do Drive como o relógio compartilhado (LWW do artigo do Dropbox).
- A diferença é que keep-both agora **fecha o ciclo** (atualiza baseline), então não vira
  fonte de proliferação.

---

## Ordem de implementação (fases — cada uma shippável e transparente)

1. **Fase 1 — Cursor correto + delta real (Req 5, Req 1.1, Req 8).**
   Consumir os eventos do Changes API (create/modify/removed) e encadear
   `newStartPageToken`. Deleção passa a exigir evento. Full-scan vira caminho de
   primeiro contato/reconciliação. *Maior ganho de robustez e velocidade, menor
   superfície de risco.*
2. **Fase 2 — Evidência de deleção local + fim do apagar-por-ausência (Req 1.2, Req 6).**
   Watcher registra deleções locais reais; ausência sem evento vira re-pull.
3. **Fase 3 — Tombstone de recusa (Req 3).** Parar de re-perguntar.
4. **Fase 4 — keep-both fecha o ciclo (Req 4).** Fim do `.conflict-N` crescente.
5. **Fase 5 — Identidade por appProperties + consolidação de duplicatas (Req 2).**
   Anti-duplicata multi-dispositivo. Marcação preguiçosa (Req 7.3).
6. **Fase 6 — Migração/compat + testes + doc (Req 7).**

Cada fase é um conjunto de mudanças com testes verdes, build, deploy no vault de teste, e
entrada no `whatsnew.ts`. Nada é commitado/publicado sem ordem explícita do usuário.

---

## Riscos e mitigação

- **InvalidDeltaToken em produção:** tratado por fallback único a full-scan + re-semeadura
  (padrão documentado). Sem isso, o delta poderia travar o sync.
- **appProperties limita a ~30 chaves / tamanho por arquivo:** usamos só 1–2 chaves
  curtas; sem risco prático.
- **Corrida entre delta e escrita concorrente de outro device:** o lock advisório já
  existente + keep-both cobrem o resíduo; o cursor encadeado fecha a janela de "mudou
  durante o sync".
- **Migração:** guardada por schema, não-destrutiva, com fallback a full-scan que nunca
  apaga por ausência — então um upgrade não pode disparar deleção em massa.


---

## Limitações conhecidas (assumidas conscientemente)

Estas são limitações **de projeto**, não bugs — documentadas para não serem
"descobertas" em campo:

1. **Estado por-dispositivo (baseline/cursor/tombstones em `data.json`, não sincronizado).**
   Se o `data.json` de um aparelho for perdido/resetado (reinstalação, novo aparelho,
   corrupção), ele fica sem baseline e sem cursor → vê arquivos locais como "novos" e pode
   **re-empurrar arquivos que foram deletados** em outro lugar (o evento de remoção ele
   nunca viu). `appProperties` resolve **identidade**, não **existência-pós-deleção**. O fix
   estrutural seria um tombstone/version log compartilhado no remoto — deliberadamente
   evitado (o remotely-save tentou e removeu). Mitigação: backup antes de ativar; e, ao
   trocar de aparelho, deixar o Drive semear o vault em vez de empurrar um vault "novo".

2. **Deleção com o app fechado não propaga.** A evidência de deleção local vem do evento
   `delete`/`rename` do vault (só dispara com o Obsidian aberto). Deletar via Finder/Explorer
   com o app fechado → no boot, o arquivo ausente + presente no Drive vira **re-pull** (o
   arquivo volta localmente). Orientação: deletar/renomear **de dentro do Obsidian**.

3. **`newer-wins` é LWW em wall-clock.** Compara `mtime` local (relógio do aparelho) com
   `modifiedTime` do Drive (relógio do servidor). Sob skew de relógio entre aparelhos, pode
   descartar a edição *genuinamente* mais nova. Por isso o **default é `keep-both`** (nunca
   perde); `newer-wins` é opt-in consciente.

4. **Sync não é transacional.** É uma sequência de chamadas REST independentes; uma queda no
   meio deixa parte aplicada. O cursor só avança em ciclo limpo, e cada arquivo grava seu
   baseline ao ser aplicado, então o próximo ciclo reconcilia o resto. Operações compostas
   (move) são idempotentes e re-tentáveis; seus dois endpoints são excluídos do ciclo enquanto
   pendentes, para nunca duplicar.

5. **Lock multi-dispositivo é advisório (best-effort), não exclusão mútua real.** Dois
   aparelhos sincronizando a MESMA pasta ao mesmo tempo é o cenário mais hostil. A segurança
   real vem de identidade estável + keep-both + deleção-por-evento, não do lock. Recomendação
   de uso desta beta: manter o Drive sync ativo em **um aparelho por vez** enquanto o modelo
   é validado em campo.

## Fora de escopo desta fase (candidatos futuros)
- Separar `runDriveSync` em **plan puro → apply com efeitos** (hoje move/consolidação fazem
  I/O na fase de observação).
- Batching / paralelismo controlado das chamadas Drive (primeiro sync de vault grande é
  O(arquivos) sequencial).
- Scope OAuth `drive.file` (menor blast radius) em vez de `drive` completo.
- Observabilidade estruturada (log JSONL rotativo por ciclo) para diagnosticar campo.
