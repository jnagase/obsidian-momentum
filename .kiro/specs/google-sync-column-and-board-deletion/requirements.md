# Requisitos — Preservar coluna e propagar deleção de board no Google Tasks sync

## Contexto

O Momentum Life sincroniza os boards de tasks (pastas sob `Tasks/`, cada nota é uma task
com frontmatter YAML) com listas do Google Tasks (uma lista por board). O motor de sync vive
em `src/gtSync.ts`, o data layer em `src/data.ts`. Com o mesmo vault espelhado por **Obsidian
Sync** em dois dispositivos e o Google sync ligado nos dois, apareceram dois defeitos reais,
reportados pelo autor (2026-09):

1. **Coluna "in progress" vira "backlog" ao trocar de dispositivo.** O Google Tasks só guarda
   `needsAction` / `completed` — **não tem coluna** (backlog / in progress / done). A coluna
   existe só no frontmatter (`status`) da nota. Quando uma task é **materializada a partir do
   lado do Google** (caminho `pullCreate` em `gtSync.ts`), o código fixa `status: firstCol`
   (= "backlog"). Na corrida multi-device — celular cria a task em "in progress", empurra pro
   Google e carimba `google_id`; o Obsidian Sync ainda não entregou a nota (ou o `google_id`,
   ou o frontmatter chegou malformado) quando o macbook roda o Google sync — a task do Google
   é vista como **remota não-vinculada** e o `pullCreate` a recria em "backlog", perdendo a
   coluna. Para tasks já vinculadas o merge preserva a coluna; o dano é no `pullCreate` e na
   reconciliação de duplicatas.

2. **Board deletado por fora do botão do plugin não propaga.** O único caminho que registra
   uma deleção de board é o botão **"Delete board"** do plugin (`deleteBoard` →
   `addIgnoredBoard`), que escreve o tombstone em `Config/deleted-boards.md`, move as tasks
   pra "My Tasks", apaga a pasta e — no próximo sync confirmado — o `consolidateLists` apaga a
   lista no Google. **Não existe listener de deleção de pasta** (`main.ts` só escuta `modify`,
   `rename`, `create`). Então deletar o board via **MCP/Claude, Finder ou celular** (apagando
   a pasta ou as notas) **não escreve tombstone** e não toca no Google. Pior: no sync seguinte
   a **descoberta** vê a lista ainda viva no Google e **recria o board** nos dois dispositivos.

O objetivo é: (a) a coluna sobreviver à corrida multi-device sem depender do Google guardá-la;
(b) uma deleção de board feita por qualquer via ser detectada e propagada com segurança — **sem
nunca** transformar uma pasta temporariamente ausente (Obsidian Sync no meio do download) numa
deleção real que apaga a lista no Google. Tudo transparente num upgrade (sem passo manual, sem
perda de dado), como manda o steering.

## Glossário

- **Coluna**: o campo `status` do frontmatter da nota, que casa com uma chave de coluna do
  Kanban (`backlog` | `in progress` | `done`). É um conceito **local**; o Google não a conhece.
- **Done_Bit**: o único estado que o Google guarda — `needsAction` (não-concluída) ou
  `completed`. Toda coluna não-done mapeia para `needsAction`.
- **pullCreate**: a operação de sync que cria uma nota local a partir de uma task remota do
  Google sem nota correspondente. Hoje fixa `status: firstCol` (backlog).
- **Board**: pasta sob `Tasks/`. A pasta é a fonte de verdade. Board default: "My Tasks".
- **Tombstone_De_Board**: entrada em `Config/deleted-boards.md` que marca um board como
  removido; a descoberta ignora listas do Google com esse nome (não ressuscita o board).
- **Registro_De_Boards_Conhecidos**: novo estado persistido que lista os boards que o plugin
  já viu, usado para detectar por diff quando um board some.
- **Escudo_De_Sanidade**: guarda que impede uma ausência suspeita (muitos boards/pastas sumindo
  de uma vez, ou o vault ainda carregando) de virar deleção destrutiva automática — mesma
  filosofia do escudo de deleção de tasks já existente no sync.
- **consolidateLists**: passo do sync confirmado que realoca tasks mal-vinculadas e apaga as
  listas do Google cujos nomes estão tombstonados.

## Requisitos

### Requisito 1 — Coluna preservada quando a task volta do lado do Google

**User story:** Como usuário com dois dispositivos, quero que uma task que eu deixei em
"in progress" continue em "in progress" depois que outro dispositivo sincroniza, para não ter
que reorganizar o Kanban toda vez.

#### Acceptance Criteria
1. WHEN o `pullCreate` for criar uma nota a partir de uma task do Google que **casa** (mesmo
   `google_id`, ou mesma assinatura título+due+Done_Bit) com uma nota local já existente, THE
   Sync_Engine SHALL herdar a **coluna** dessa nota local em vez de fixar "backlog".
2. WHEN não existir nenhuma nota local equivalente (task genuinamente nova vinda do Google),
   THE Sync_Engine SHALL manter o comportamento atual (materializar na primeira coluna), pois
   não há coluna local a preservar.
3. WHEN uma task do Google estiver marcada `completed`, THE Sync_Engine SHALL materializá-la na
   coluna done (comportamento já existente), independente do Requisito 1.1.
4. THE preservação de coluna NÃO SHALL depender de o Google guardar a coluna (a solução padrão
   não grava metadado de coluna no Google Tasks, para não poluir o app do Google).
5. WHEN a reconciliação de duplicatas escolher a nota vencedora (Winner) entre duplicatas do
   mesmo logical task, THE Sync_Engine SHALL preservar a coluna **mais avançada** entre as
   duplicatas não-done (precedência: done > in progress > backlog, usando a ordem das colunas
   configuradas), em vez de deixar a coluna do Winner sobrescrever com "backlog".

### Requisito 2 — Detecção de board deletado por qualquer via

**User story:** Como usuário, quero que deletar um board (pelo botão, ou apagando a pasta via
MCP/Finder/celular) propague a deleção pro Google e pros outros dispositivos, para o board não
ressuscitar sozinho.

#### Acceptance Criteria
1. THE plugin SHALL manter um Registro_De_Boards_Conhecidos persistido (nomes de boards já
   observados), atualizado quando boards são carregados normalmente.
2. WHEN um board presente no Registro_De_Boards_Conhecidos deixar de existir como pasta E não
   houver sinal de que foi renomeado, THE plugin SHALL escrever o Tombstone_De_Board
   correspondente (mesmo efeito do botão "Delete board"), respeitando o Escudo_De_Sanidade.
3. WHEN o Tombstone_De_Board for escrito, THE Sync_Engine SHALL, no próximo sync confirmado,
   apagar a lista correspondente no Google via `consolidateLists` (nunca a lista default).
4. THE board "My Tasks" NÃO SHALL nunca ser tombstonado nem ter sua lista default apagada.
5. WHEN um board tombstonado for recriado (pasta volta a existir por ação do usuário), THE
   plugin SHALL limpar o tombstone (comportamento já existente de `createBoard`), sem exigir
   passo manual.

### Requisito 3 — Escudo de sanidade contra falsa deleção

**User story:** Como usuário, quero garantia de que uma pasta sumindo por causa do Obsidian
Sync (download incompleto, vault ainda carregando) NÃO apague minhas listas no Google.

#### Acceptance Criteria
1. WHEN mais de um limite de boards sumir de uma vez (limiar a definir no design, ex.: >1 e/ou
   proporção alta do total conhecido), THE plugin SHALL tratar como ausência suspeita e NÃO
   tombstonar automaticamente — perguntando ao usuário (ConfirmModal) com uma nota curta do
   porquê, no mesmo padrão do `confirmMass` de tasks.
2. WHEN o vault ou a lista de boards ainda não estiver totalmente carregada (ex.: leitura
   retorna zero/poucos boards logo no startup), THE plugin SHALL abster-se de detectar deleções
   nesse ciclo (nunca tombstonar às cegas).
3. WHEN a detecção automática for cancelada pelo usuário ou barrada pelo escudo, THE plugin
   SHALL manter tudo intacto (nenhum tombstone, nenhuma deleção no Google) e registrar o motivo
   em log auditável.
4. THE deleção destrutiva no Google (apagar lista) SHALL continuar ocorrendo só em sync
   confirmado, com trilha de auditoria em `result.notes` / logs (`Config/google-sync-debug.md`).

### Requisito 4 — `delete_board` seguro no MCP (opcional, recomendado)

**User story:** Como usuário que deleta boards pedindo pro Claude, quero que o MCP tenha uma
operação de deletar board que faça a coisa certa, para não gerar o estrago do Requisito 2.

#### Acceptance Criteria
1. THE MCP SHALL expor uma ferramenta `delete_board` que espelhe o `deleteBoard` do plugin:
   mover as tasks do board para "My Tasks" e escrever o Tombstone_De_Board.
2. THE `delete_board` do MCP NÃO SHALL apagar a lista no Google diretamente (o MCP não fala com
   o Google) — apenas deixar o tombstone para o plugin propagar no próximo sync.
3. THE `delete_board` do MCP SHALL recusar deletar "My Tasks".
4. WHERE o board não existir, THE `delete_board` SHALL ser um no-op reportando que não achou.

### Requisito 5 — Limpeza dos boards já ressuscitados (ação pontual)

**User story:** Como usuário, quero limpar agora os boards que já deletei mas voltaram, para o
estado ficar consistente antes do fix entrar.

#### Acceptance Criteria
1. THE spec SHALL prever um procedimento (comando ou passo manual guiado) para, dados os nomes
   dos boards que o usuário deletou, escrever os tombstones e deixar o próximo sync confirmado
   apagar as listas órfãs no Google.
2. THE procedimento SHALL exigir confirmação explícita do usuário e listar exatamente o que
   será apagado no Google antes de agir (operação destrutiva).

### Requisito 6 — Sem regressão e sem passo manual no upgrade

#### Acceptance Criteria
1. THE mudança SHALL ser transparente num upgrade: sem migração manual, sem perda de dado; o
   Registro_De_Boards_Conhecidos SHALL ser inicializado a partir do estado atual (primeira
   observação não dispara deleção).
2. THE sync bidirecional completo (push/pull/link/merge/dedupe) SHALL continuar funcionando.
3. THE paridade com o MCP (`mcp/src/store.mjs`) SHALL ser mantida onde o modelo mudar (novo
   campo de config = adicionar no `loadConfig` E no `saveConfig` do MCP também).
4. THE build (`npm run build`) e o lint SHALL passar; a suíte de testes existente SHALL
   continuar verde e novos testes SHALL cobrir a precedência de coluna (Req 1.5) e a lógica de
   detecção/escudo (Req 2/3) nas partes puras.

## Fora de escopo

- Lock de sincronização entre dispositivos ou merge automático de conflitos de frontmatter
  (tratado nas specs `google-tasks-multi-device-sync` e `reduce-sync-conflicts`).
- Gravar a coluna dentro do Google Tasks (campo `notes`) — considerado e **descartado** como
  padrão por poluir o app do Google; só reabrir se a solução local se mostrar insuficiente.
- Detecção de renomeação de board como evento distinto (renomear já é coberto por
  `renameBoard`; o foco aqui é deleção).
