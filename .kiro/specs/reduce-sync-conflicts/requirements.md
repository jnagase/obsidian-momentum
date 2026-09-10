# Requisitos — Reduzir conflitos do Obsidian Sync

## Contexto

Com o mesmo vault espelhado por **Obsidian Sync** em mais de um dispositivo, o Momentum
Life gera arquivos de conflito (`nome.conflict.md`, e cadeias aninhadas
`nome.conflict.conflict…md`) em volume alto. Diagnóstico real de um vault do autor
(2026-09): **164** arquivos de conflito — **Fitness/Months (98)**, Nutrition/Logs (51),
Finance/Transactions (10), Fitness/Workouts (1), Tasks (4).

Duas causas independentes:

1. **Leitura (JÁ CORRIGIDO, fora desta spec):** `listMarkdown` lia os `.conflict.md` como
   dados reais, então cada cópia virava uma refeição/treino/transação duplicada na UI e
   inflava os totais. Corrigido por `isSyncConflictFile()`, que faz todo loader ignorar
   arquivos de conflito. Esta spec **não** re-trata a leitura.

2. **Geração (ESCOPO DESTA SPEC):** duas gravações concorrentes do mesmo arquivo em
   dispositivos diferentes viram um conflito no Sync. Já existe mitigação parcial — o hub do
   mês usa `writeHubIfBodyChanged`, que **não** grava quando o corpo não mudou. Mas quando o
   corpo muda (e em Fitness muda a cada treino), **o hub é regravado com um frontmatter
   `generated: <timestamp de agora>`**. Dois dispositivos que gravam o mesmo mês produzem o
   **mesmo corpo, mas timestamps diferentes** → bytes diferentes → conflito garantido. É a
   causa provável dos 98 conflitos em Fitness/Months. O mesmo padrão afeta os arquivos-únicos
   reescritos por inteiro com um `modified` volátil (`Nutrition/water.md`, `Finance/savings.md`,
   `Finance/recurring.md`, `Fitness/splits.md`, planos de refeição).

   Os arquivos de **item** (meal-log/workout/transaction) são criados uma vez com nome único
   (`uniquePath`), então seus conflitos vêm de **criação concorrente real** nos dois
   dispositivos — não são resolvíveis por "gravar só quando muda". O dano deles já foi
   neutralizado na leitura (`isSyncConflictFile`, fora desta spec); reduzir a criação
   concorrente é orientação de uso (Sync ligado num dispositivo só), não código.

O objetivo é **tornar as gravações determinísticas e idempotentes** — mesmo estado ⇒ mesmos
bytes ⇒ sem conflito — sem mudar o dado que o usuário vê nem exigir passo manual num upgrade.

## Glossário

- **Write_If_Changed**: gravar um arquivo só quando o conteúdo novo difere do conteúdo já em
  disco (byte a byte), tratando gravação idêntica como no-op.
- **Hub_Do_Mes**: nota-resumo `<Módulo>/Months/<Módulo> <YYYY-MM Mês>.md` regenerada a
  partir dos itens do mês.
- **Espelho_De_Tasks**: arquivo `Tasks/Lists/<board>.md` (checklist em Markdown para
  interop com outros plugins).

## Requisitos

### Requisito 1 — Gravação idempotente (Write_If_Changed)

**User story:** Como usuário com Sync em dois dispositivos, quero que o plugin não reescreva
um arquivo cujo conteúdo não mudou, para que gravações redundantes não virem conflitos.

#### Acceptance Criteria
1. WHEN o plugin for gravar qualquer arquivo de dado, THE plugin SHALL comparar o conteúdo
   novo com o conteúdo atual em disco e, se forem idênticos, NÃO gravar (no-op).
2. THE Write_If_Changed SHALL preservar exatamente o resultado observável (mesmo dado, mesmo
   arquivo final) de quando a gravação sempre ocorria.
3. WHERE o arquivo não existe ainda, THE plugin SHALL gravá-lo normalmente.

### Requisito 2 — Hub do mês byte-determinístico

**User story:** Como usuário com Sync em dois dispositivos, quero que o hub do mês seja
idêntico byte a byte quando o estado do mês é o mesmo, para que os dois dispositivos não
briguem por causa de um timestamp.

#### Acceptance Criteria
1. THE frontmatter do hub NÃO SHALL conter um campo que varie a cada gravação (remover o
   `generated: <agora>` ou substituí-lo por um valor determinístico derivado dos itens do
   mês, ex.: o maior `modified`/`date` do conjunto).
2. WHEN dois dispositivos gerarem o hub para o mesmo mês a partir do mesmo conjunto de itens,
   THE conteúdo resultante SHALL ser idêntico byte a byte.
3. THE guarda `writeHubIfBodyChanged` (não gravar quando o corpo não muda) e a remoção do hub
   em mês vazio SHALL ser preservadas.

### Requisito 3 — Arquivos-únicos reescritos por inteiro

**User story:** Como usuário, quero que os arquivos de estado reescritos por inteiro
(`water.md`, `savings.md`, `recurring.md`, `splits.md`, planos de refeição) não gerem
conflito só por causa do timestamp `modified`.

#### Acceptance Criteria
1. WHEN um desses arquivos for gravado, THE plugin SHALL usar Write_If_Changed comparando o
   conteúdo **ignorando o campo `modified` volátil** (ou tornando-o determinístico), de modo
   que uma gravação sem mudança real de dado seja um no-op.
2. THE dado exibido e o schema dos arquivos SHALL permanecer inalterados.

### Requisito 4 — Sem regressão e sem passo manual

#### Acceptance Criteria
1. THE mudança SHALL ser transparente num upgrade: sem migração, sem passo manual, sem perda
   de dado.
2. THE suíte de testes existente SHALL continuar passando, e novos testes SHALL cobrir o
   contrato do Write_If_Changed (idêntico = no-op; diferente = grava; inexistente = cria).
3. THE mudança NÃO SHALL alterar nomes de arquivo, frontmatter, nem o dado exibido.

## Fora de escopo

- Lock de sincronização entre dispositivos ou merge automático de conflitos.
- Reconciliar/limpar conflitos já existentes (feito pelo utilitário `tools/clean-conflicts.sh`).
- Qualquer mudança na leitura (`isSyncConflictFile`, já entregue).
