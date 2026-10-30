# Tasks como itens dentro de uma nota de board — Requirements

## Visão geral
Hoje cada task é **uma nota** em `Tasks/<Board>/<título>.md` (pasta = fonte da verdade), com
`google_id`/`status`/`priority`/… no frontmatter, e sincroniza via **Google Tasks** (1 nota ↔ 1
task do Google). A proposta: cada **board vira UMA nota**, e as tasks viram **itens dentro dela**
— drasticamente menos arquivos.

Esta é a mudança mais arriscada do app: mexe em (1) o modelo de dados das tasks, (2) a UI do
board, e (3) o **Google Tasks sync** — o subsistema que já causou perda de dados. Por isso:
migração **reversível**, **feature flag** pra ligar/desligar, e o sync como o ponto central de
risco. Spec obrigatória antes de qualquer código.

## Contexto importante (muda o desenho)
- **Tasks NÃO sincronizam pelo Google Drive** (a pasta `Tasks/` é excluída do Drive). O único
  canal entre devices é o **Google Tasks**. Logo, a nota de board é uma **materialização LOCAL
  por device**, reconciliada via Google Tasks (cada item carrega seu `google_id`). O formato da
  nota é, em essência, uma representação local — o que dá liberdade de formato, mas exige que a
  identidade por item (`google_id`) seja preservada dentro da nota.
- O fix de **coluna via notes do Google** (0.8.13) já faz a coluna sobreviver entre devices —
  esta spec precisa manter esse comportamento.

## O que se GANHA
- Pouquíssimos arquivos (1 por board em vez de 1 por task).
- Graph View limpo; o board é uma nota só, fácil de ler/editar.
- (Dependendo do modelo) interop com o plugin Kanban/Tasks da comunidade.

## O que se PERDE (explicitar e aceitar)
- **Nota rica por task**: hoje a task É uma nota, dá pra escrever um documento, anexar imagens,
  etc. Virando um item, isso some (a menos que a gente mantenha um detalhe opcional — ver Q3).
- **Backlink/nó no Graph por task**: linkar `[[aquela task]]` de outra nota deixa de existir.
- **Arquivo por task**: automações/outros plugins que agem sobre notas-de-task individuais param.

## Glossário
- **Board note**: a nota única que representa um board e contém suas tasks.
- **Item/linha de task**: uma task dentro da board note.
- **google_id**: id estável da task no Google Tasks (chave de sync por item).

---

## Requisito 1 — Board como nota única
**História:** Como usuário, quero que cada board seja uma nota só, com suas tasks dentro, pra não
encher o vault.
1.1. QUANDO existe um board, ENTÃO deve haver exatamente uma board note para ele.
1.2. A board note deve conter todas as tasks daquele board, cada uma com: título, **coluna/status**,
     priority, due, group, eisenhower, order, e os campos de sync `google_id`/`google_list`.
1.3. A **coluna** de cada task deve ser representada de forma inequívoca dentro da nota (ex.: seção
     por coluna, ou um campo por item — decidir no design).
1.4. Mover uma task entre colunas e reordenar devem ser representáveis e persistentes.

## Requisito 2 — Paridade funcional da UI do board
**História:** Como usuário, quero que o board (Kanban/Matrix) funcione igual: criar, editar,
mover, completar, reabrir, deletar, buscar.
2.1. Todas as ações atuais do board devem continuar funcionando sobre o novo modelo, sem regressão
     perceptível de UX.
2.2. Marcar done manda pro topo de done (comportamento atual); card novo aparece no topo; etc.
2.3. A busca de tasks continua encontrando e saltando pro card.

## Requisito 3 — Google Tasks sync preservado (o ponto crítico)
**História:** Como usuário multi-device, quero que minhas tasks continuem sincronizando pelo Google
Tasks, sem perder nada e sem duplicar.
3.1. Cada item deve manter `google_id`/`google_list` DENTRO da board note, de forma estável, para
     que o sync case por id (nunca por título) — rename seguro, sem duplicata.
3.2. Push/pull/3-way-merge, deleção (com guarda de massa), consolidação de duplicatas e a coluna
     via notes (0.8.13) devem continuar valendo, agora operando sobre itens-em-nota.
3.3. A migração de 1-nota-por-task → board note NÃO pode perder `google_id` de nenhuma task (senão
     o sync recria/duplica tudo no Google).
3.4. O conflito multi-device deve degradar com segurança (nunca apagar silenciosamente; preferir
     manter ambos / exigir confirmação em deleção de massa, como hoje).

## Requisito 4 — Migração reversível e feature flag
**História:** Como usuário existente, quero migrar sem risco e poder voltar atrás.
4.1. Uma **feature flag** (setting) liga o modelo board-note; OFF = modelo atual (1 nota/task).
     Default OFF até a feature estar madura.
4.2. QUANDO a flag é ligada, ENTÃO uma migração guardada converte as notas-de-task em itens da
     board note, **preservando `google_id`**, e arquiva as notas-de-task antigas na **lixeira do
     Obsidian** (reversível) só após a board note ser escrita com sucesso.
4.3. A migração é idempotente e não-destrutiva (item malformado é preservado/pulado com aviso).
4.4. Deve haver caminho de **rollback** (desligar a flag → regenerar 1-nota-por-task a partir da
     board note) OU, no mínimo, a reversibilidade via lixeira + um backup orientado antes.

## Requisito 5 — Robustez e dados do usuário
5.1. Frontmatter/estrutura malformada numa board note degrada com elegância (não trava o board nem
     some task).
5.2. Nenhuma operação destrutiva automática fora do caminho reversível (coerente com o steering).
5.3. Backup/commit do vault recomendado e avisado antes da migração.

## Requisito 6 — Paridade no MCP
6.1. O `mcp/src/store.mjs` lê/escreve o novo modelo de board note (list/create/update/complete/
     delete/move de tasks), mantendo os contratos das tools.
6.2. Todo campo lido é reescrito (não apagar no writeback).

## Não-objetivos
- Mudar o comportamento do Kanban em si (só o armazenamento).
- Mexer em Finance/Nutrition/Fitness (já consolidados na spec #1) ou em habits/studies/journal.

---

## DECISÕES FECHADAS (aprovadas)
- **D1 → B (lista no frontmatter + corpo renderizado).** Menor risco, `google_id` por item
  trivial, reaproveita o padrão MonthLedger da spec #1. (Sem interop com o plugin Kanban da
  comunidade — trade-off aceito.) Confirmar se você na verdade queria A.
- **D2 → Sim.** Aceita perder a nota-rica por task (descrição longa/anexos).
- **D3 → Sem híbrido.** Task é sempre item; nenhuma "abre" nota própria.
- **D4 → Sim.** Feature flag OFF por default, migração reversível (lixeira) + rollback
  (regenerar 1-nota-por-task a partir da board note).

## (histórico) DECISÕES CRÍTICAS discutidas

### D1 — Formato da board note: **A) checkboxes (Kanban-compatível)** vs **B) lista no frontmatter**
- **A) Checkboxes no corpo**, seções por coluna (`## Backlog`, `## In progress`, `## Done`), cada
  task uma linha `- [ ] Título ^blockid`, metadados inline (due/priority) + um **mapa no
  frontmatter** (`^blockid → {google_id, google_list, …}`). **Ganha:** interop com o plugin
  Kanban/Tasks, nota editável à mão, coluna = heading. **Custa:** parsing de markdown mais frágil,
  mapa lateral de sync por block-id, mais risco.
- **B) Lista estruturada no frontmatter** (`tasks: [{id,title,status,priority,due,google_id,…}]`),
  corpo = tabela/visão renderada (igual ao que fizemos em Finance/Nutrition/Fitness). **Ganha:**
  robusto, metadados fáceis, `google_id` por item trivial, consistente com a spec #1, baixo risco.
  **Custa:** SEM interop com Kanban/Tasks plugin; o corpo não é editável à mão (é derivado).
- **Minha recomendação:** depende do seu uso. Se você usa (ou quer usar) o **plugin Kanban da
  comunidade** nessas notas → **A**. Se o board é sempre pela UI do Momentum e você quer o menor
  risco → **B** (reaproveita tudo que acabamos de validar na spec #1).

### D2 — Perda da nota-rica por task: aceita?
Confirmar que tá OK perder descrição longa/anexos por task. Se for importante, dá pra um **híbrido**
(ver Q3) ao custo de complexidade.

### D3 — Híbrido opcional (só se D2 for problema)
Manter a possibilidade de uma task "abrir" uma nota de detalhe própria sob demanda (poucas tasks),
enquanto a maioria vive como item. Aumenta a complexidade; só se você precisar.

### D4 — Feature flag + rollback: topa começar OFF por default e com rollback (regenerar 1-nota/task)?
