# Requisitos — Sync multi-dispositivo com Google Drive (robusto e rápido)

## Contexto

O Momentum Life sincroniza o vault (ou uma subpasta) com uma pasta do Google Drive.
O motor atual (`src/driveSync.ts`) é bidirecional e baseado em **baseline por-arquivo**,
mas tem quatro fraquezas que causam o comportamento relatado pelo usuário —
"pede muitas confirmações de deleção" e "arquivos deletados voltam ou duplicam em
outros aparelhos":

1. **Deleção é adivinhada por ausência.** O motor faz o diff de duas listagens
   (Drive `files.list` × vault) e conclui "sumiu de um lado = foi apagado". Um arquivo
   que só ainda não chegou naquele aparelho (Obsidian Sync baixando, listagem
   transitoriamente incompleta) é indistinguível de uma deleção real.
2. **Recusar uma deleção não grava nada.** O plano é só filtrado; a mesma deleção é
   re-derivada e re-perguntada no próximo ciclo, para sempre.
3. **O Changes API está implementado mas desligado.** `listChanges`/`getStartPageToken`
   existem, mas são usados só como interruptor liga/desliga: os eventos de remoção
   (`removed:true`) são ignorados e o `newStartPageToken` é descartado (o cursor é
   resetado para "agora", abrindo uma janela de corrida).
4. **Sem identidade estável no Drive.** Nada marca o arquivo do Drive com o seu caminho
   lógico; a identidade é só o par (path, fileId no baseline local). Dois aparelhos criam
   a MESMA nota como dois arquivos diferentes → duplicata que o de-dupe por path não pega.

A fonte da verdade é — e continua sendo — **o próprio Google Drive** (não um servidor
nosso, não um ledger JSON nosso). O objetivo é **consumir os eventos explícitos que o
Drive já oferece** em vez de adivinhar, e tornar a identidade do arquivo estável entre
aparelhos.

## Princípios (herdados do steering do projeto)

- **Upgrade transparente.** O usuário atualiza e continua funcionando; migração roda
  sozinha e avisa com Notice. Sem perda de dados, sem passo manual.
- **Nunca perder edição.** Qualquer ambiguidade onde uma edição possa se perder vira
  conflito (keep-both), nunca uma deleção silenciosa.
- **Deleção é soft e explícita.** Sempre trash (reversível), nunca hard-delete; e só
  quando houver evidência explícita de deleção, não por ausência.
- **Sem infra nova nossa.** Só a Drive API (que já é o "servidor central"); os únicos
  workers continuam sendo os de OAuth, sem dado do usuário passando por eles.

---

## Requisito 1 — Deleção guiada por evento, não por ausência

**User story:** Como usuário com vários aparelhos, quero que só uma deleção real (feita
por mim) apague o arquivo nos outros aparelhos, para que nada volte do "além" nem seja
apagado por engano quando um aparelho ainda não terminou de sincronizar.

### Acceptance Criteria

1. QUANDO o motor consegue um cursor de mudanças válido do Drive (`startPageToken`
   encadeado) ENTÃO o sistema DEVE consumir os registros do Changes API e tratar
   `removed:true` (ou `file.trashed:true`) como o **único** sinal de deleção remota,
   em vez de inferir deleção pela ausência do arquivo na listagem.
2. QUANDO um arquivo local em escopo some E existe baseline para ele E NÃO há evidência
   de que o arquivo remoto sumiu (nenhum evento de remoção e o arquivo ainda aparece no
   Drive) ENTÃO o sistema NÃO DEVE apagar o arquivo remoto; DEVE tratar como "local
   ainda não presente" e re-baixar (pull) na direção Drive→local.
3. QUANDO o Changes API retorna `InvalidDeltaToken` (cursor expirado/inválido) ENTÃO o
   sistema DEVE cair uma vez para um full-scan de reconciliação e re-semear o cursor,
   sem perder dados e sem tratar o full-scan como uma enxurrada de deleções.
4. ENQUANTO não houver cursor (primeira sincronização de um aparelho) o sistema DEVE
   fazer o full-scan de adoção (comportamento atual: adotar idênticos, keep-both nos
   diferentes) e NUNCA inferir deleção nesse primeiro contato.
5. QUANDO uma deleção remota explícita é detectada E o arquivo local mudou desde o
   baseline ENTÃO vale "edição vence deleção": o sistema DEVE re-enviar (push) o local,
   nunca apagá-lo.

---

## Requisito 2 — Identidade estável do arquivo entre aparelhos (anti-duplicata)

**User story:** Como usuário, quero que a mesma nota criada/renomeada em aparelhos
diferentes seja reconhecida como o MESMO arquivo, para não acumular cópias `nome 2.md`
nem `nome.conflict.md` toda vez.

### Acceptance Criteria

1. QUANDO o motor cria ou atualiza um arquivo no Drive ENTÃO DEVE gravar em
   `appProperties` do arquivo do Drive uma chave estável de identidade lógica
   (ex.: `momentumPath` = caminho relativo, e opcionalmente `momentumOrigin` = deviceId
   de origem), usando o campo `appProperties` da Drive API.
2. QUANDO o motor observa o Drive ENTÃO DEVE preferir casar arquivo local ↔ remoto por
   essa chave de identidade (`appProperties.momentumPath`) antes de casar por caminho,
   de modo que um arquivo movido/renomeado por fora não vire duplicata.
3. QUANDO dois arquivos remotos distintos declaram a MESMA `momentumPath` (duplicata de
   corrida multi-dispositivo) ENTÃO o sistema DEVE consolidá-los de forma não destrutiva:
   manter o de `modifiedTime` mais recente como canônico e preservar o outro como
   `.conflict` (nunca apagar conteúdo), registrando o motivo no log.
4. A leitura de `appProperties` DEVE ser adicionada ao `FILE_FIELDS`/consultas relevantes
   sem quebrar chamadas existentes.

---

## Requisito 3 — Memória de decisão de deleção (parar de re-perguntar)

**User story:** Como usuário, quando eu recuso uma deleção em massa, não quero ser
perguntado de novo pela mesma coisa em todo sync.

### Acceptance Criteria

1. QUANDO o usuário RECUSA a confirmação de deleção em massa ENTÃO o sistema DEVE
   persistir a decisão (um tombstone de "recusa" por caminho, com timestamp) de forma que
   as MESMAS deleções não sejam re-propostas no próximo ciclo.
2. QUANDO uma deleção recusada é re-avaliada e a situação mudou (ex.: o arquivo
   reapareceu, ou o usuário realmente o apagou depois) ENTÃO o tombstone de recusa DEVE
   ser invalidado e a decisão reconsiderada.
3. QUANDO o usuário ACEITA a confirmação de deleção ENTÃO o sistema DEVE executar as
   deleções soft normalmente e limpar quaisquer tombstones de recusa correspondentes.
4. O tombstone de recusa é estado local por-dispositivo (não precisa sincronizar) e
   NÃO DEVE impedir uma deleção real futura, apenas suprimir o re-prompt imediato.

---

## Requisito 4 — Baseline atualizado após conflito (parar o crescimento de `.conflict-N`)

**User story:** Como usuário, quando um conflito é resolvido com keep-both, não quero que
o mesmo par gere `.conflict-2`, `.conflict-3`… em cada sync seguinte.

### Acceptance Criteria

1. QUANDO um conflito é resolvido por keep-both ENTÃO o sistema DEVE atualizar o baseline
   do arquivo original para o estado que ficou de fato local+remoto após a resolução, de
   modo que o par não seja re-detectado como divergente no próximo ciclo.
2. QUANDO um arquivo `.conflict` é criado ENTÃO ele DEVE receber seu próprio baseline
   (tratado como arquivo novo), para sincronizar normalmente dali em diante sem re-conflitar.
3. O sistema NÃO DEVE criar um novo `.conflict-N` para um par cujo conteúdo já está
   representado por um `.conflict` existente idêntico.

---

## Requisito 5 — Cursor de mudanças correto e encadeado

**User story:** Como usuário, quero que a sincronização incremental seja confiável e não
pule mudanças que aconteceram durante o próprio sync.

### Acceptance Criteria

1. QUANDO um ciclo termina limpo ENTÃO o sistema DEVE avançar o cursor usando o
   `newStartPageToken` retornado pelo próprio `listChanges` (encadeamento correto), e
   NÃO um `getStartPageToken` de "agora" que pode pular mudanças ocorridas durante o run.
2. QUANDO o ciclo é interrompido (Stop) ou falha (fatal) ENTÃO o cursor NÃO DEVE avançar,
   para que o próximo run re-observe a partir do último ponto seguro.
3. QUANDO há mudanças remotas desde o cursor ENTÃO o sistema DEVE aplicar apenas o delta
   (os arquivos que os eventos indicam) em vez de re-observar a árvore inteira, exceto
   quando um full-scan de reconciliação for necessário (Req 1.3 / primeiro contato).

---

## Requisito 6 — Guarda de segurança mantida e mais precisa

**User story:** Como usuário, quero manter a proteção contra "storm" de deleção/escrita,
mas sem falsos positivos que hoje disparam confirmação à toa.

### Acceptance Criteria

1. O sistema DEVE manter a guarda de deleção em massa (soft-delete, reversível) e o
   circuit breaker de escrita, mas contando apenas deleções **explícitas** (Req 1),
   reduzindo os falsos positivos da inferência por ausência.
2. QUANDO uma varredura de arquivos falha ou fica incompleta ENTÃO o sistema DEVE
   blindar (não apagar) — manter o comportamento do "escudo de deleção" já existente.
3. A mensagem de confirmação DEVE explicar por que a deleção está sendo proposta
   (evento explícito de remoção × ausência inesperada) para o usuário decidir informado.

---

## Requisito 7 — Migração transparente e compatibilidade

**User story:** Como usuário existente do sync do Drive, quero atualizar sem reconfigurar
nada e sem re-sincronizar o vault inteiro do zero.

### Acceptance Criteria

1. QUANDO o plugin sobe com baselines/cursor no formato antigo ENTÃO o sistema DEVE
   continuar funcionando: baselines existentes são reaproveitados; o cursor antigo (se
   houver) é validado e, se inválido, re-semeado via full-scan (Req 1.3) sem perda.
2. A migração DEVE ser guardada por schema version, rodar uma vez, de forma automática,
   e avisar com um Notice curto.
3. `appProperties.momentumPath` DEVE ser preenchido preguiçosamente: arquivos já
   sincronizados recebem a marcação na próxima vez que forem tocados, sem exigir um
   re-upload em massa imediato.
4. Nenhuma operação destrutiva (consolidação de duplicatas, limpeza) DEVE rodar
   automaticamente num upgrade sem confirmação; só as não-destrutivas.

---

## Requisito 8 — Performance

**User story:** Como usuário com um vault grande, quero que o sync do dia-a-dia seja
rápido, tocando só o que mudou.

### Acceptance Criteria

1. QUANDO nada mudou remotamente desde o cursor E nada mudou localmente ENTÃO o sync
   DEVE terminar sem full-scan e sem leitura de conteúdo dos arquivos (fast-path).
2. O sistema DEVE continuar usando partial responses (`fields=`) e `pageSize` alto nas
   chamadas, e DEVE evitar baixar conteúdo de arquivo quando o md5/hash já prova que não
   mudou.
3. O caminho incremental (delta via Changes API) DEVE ser o caminho padrão do sync
   automático quando há um cursor válido, com o full-scan reservado para primeiro
   contato, cursor inválido, ou reconciliação.

---

## Fora de escopo (por ora)

- Ledger/op-log compartilhado no remoto (rejeitado: remotely-save tentou e removeu).
- Lock de sync forte/atômico entre dispositivos além do lock advisório já existente.
- Merge de conteúdo de arquivos binários (continua keep-both/skip conforme hoje).
- Trocar OAuth ou a arquitetura de workers.
