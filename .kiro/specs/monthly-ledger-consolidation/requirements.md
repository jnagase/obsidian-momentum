# Consolidação mensal de Finance / Nutrition / Fitness — Requirements

## Visão geral
Hoje cada lançamento de **Finance** (transação), **Nutrition** (refeição logada) e **Fitness**
(sessão de treino) vira **uma nota própria**, mais uma nota "hub" por mês. Isso enche o vault de
centenas de arquivos e polui o Graph View. Esta feature consolida cada módulo em **uma nota por
mês** — os lançamentos viram entradas estruturadas no frontmatter dessa nota, e o corpo é um
resumo legível regenerado automaticamente. É o mesmo padrão já usado e provado em **água**
(`Nutrition/water.md`) e **peso** (`Fitness/weight.md`), agora escalado por mês.

Mudança estrutural que mexe em dados do usuário → tratada via spec, com migração **reversível**.

## Decisões propostas (confirmar/ajustar antes do design)
- **D1. Granularidade:** uma nota por módulo por mês. A nota mensal **substitui** tanto as
  notas-por-item quanto o hub separado do mês (o mês passa a ser a única nota).
- **D2. Caminho/nome:** reaproveitar o local e o nome legível do hub atual, como nota única:
  `Finance/Months/Finance 2026-10 October.md`, `Nutrition/Months/Nutrition 2026-10 October.md`,
  `Fitness/Months/Fitness 2026-10 October.md`. (Alternativa mais enxuta: `Finance/2026-10.md`.)
- **D3. Fonte da verdade:** as entradas ficam numa **lista estruturada no frontmatter**
  (autoritativa); o corpo é uma **tabela/resumo renderado** regenerado a cada escrita. Igual
  água/peso.
- **D4. Migração:** uma vez, guardada por schema version, **automática** com Notice, e
  **não-destrutiva** — as notas-por-item e os hubs antigos vão para a **lixeira do Obsidian**
  (recuperável) só após a consolidação daquele mês ter sido escrita com sucesso. Também exposta
  como comando manual.
- **D5. Escopo:** afeta só os **lançamentos logados**. Ficam como estão: planos de refeição
  (`Nutrition/Plan`), exercícios (`Fitness/Exercises`), splits (`Fitness/splits.md`), e os
  trackers já consolidados (água, peso).
- **D6. Drive sync:** a nota mensal é sincronizada normalmente (não é task), escrita de forma
  **idempotente** (sem reescrever se nada mudou), e o layout é append-mostly (baixo conflito).
- **D7. Paridade no MCP:** o `mcp/src/store.mjs` e as tools espelham o novo modelo.

## Glossário
- **Entrada (entry):** um lançamento individual — uma transação, uma refeição logada, uma sessão.
- **Nota mensal (month note):** a nota única que guarda todas as entradas de um mês de um módulo.
- **Nota-por-item (legado):** o modelo antigo de 1 arquivo por lançamento.

---

## Requisito 1 — Modelo de nota mensal consolidada
**História:** Como usuário, quero que todos os lançamentos de um mês de um módulo vivam em uma
nota só, para não encher o vault de arquivos nem poluir o Graph View.

Critérios de aceitação:
1.1. QUANDO existe pelo menos uma entrada de um módulo num mês, ENTÃO o sistema DEVE manter
     exatamente uma nota mensal para aquele módulo+mês.
1.2. A nota mensal DEVE armazenar as entradas como uma lista estruturada no frontmatter (cada
     entrada com um id estável e os campos do módulo), e o corpo DEVE ser um resumo legível
     derivado dessa lista.
1.3. QUANDO o frontmatter e o corpo divergirem, ENTÃO o frontmatter DEVE prevalecer como fonte
     da verdade; o corpo é sempre regenerado a partir dele.
1.4. QUANDO não há nenhuma entrada de um módulo num mês, ENTÃO não DEVE existir nota mensal vazia
     para aquele mês (e uma que ficar vazia após remoções DEVE ir para a lixeira).
1.5. A nota mensal DEVE carregar os mesmos campos por entrada que o modelo atual expõe:
     - Finance: `type` (income|expense), `amount`, `category`, `note`, `date`, `id`.
     - Nutrition: `meal`/`meal_name`, `date`, `items` [{name, qty, unit, cal, protein, carbs}], `id`.
     - Fitness: `split`, `date`, `duration`, `exercises` [...], `kind`, `id`, `logged`.

## Requisito 2 — Registrar um lançamento
**História:** Como usuário, quero adicionar uma transação/refeição/treino e vê-la aparecer, sem
notar que agora é uma nota mensal.

2.1. QUANDO o usuário adiciona uma entrada (via UI ou MCP), ENTÃO o sistema DEVE anexá-la ao
     frontmatter da nota mensal do mês da entrada, criando a nota se ainda não existir.
2.2. QUANDO a nota mensal é criada ou alterada, ENTÃO o corpo legível (tabela/resumo + totais)
     DEVE ser regenerado para refletir o estado atual.
2.3. QUANDO o lançamento é de um mês diferente do atual (data retroativa), ENTÃO ele DEVE ir para
     a nota mensal correta daquele mês.
2.4. Cada entrada DEVE receber um id estável na criação, usado para edição/remoção posteriores.

## Requisito 3 — Editar e remover um lançamento
**História:** Como usuário, quero corrigir ou apagar um lançamento específico.

3.1. QUANDO o usuário edita uma entrada, ENTÃO o sistema DEVE atualizar apenas aquela entrada
     (por id) no frontmatter da nota mensal e regenerar o corpo.
3.2. QUANDO o usuário remove uma entrada, ENTÃO o sistema DEVE removê-la da lista e regenerar o
     corpo; se a lista ficar vazia, a nota mensal DEVE ir para a lixeira.
3.3. QUANDO uma edição muda a **data** da entrada para outro mês, ENTÃO ela DEVE migrar para a
     nota mensal do novo mês (removida da antiga).
3.4. As escritas de edição/remoção DEVEM ser idempotentes: nenhuma gravação se o conteúdo
     resultante for idêntico (mantém o Drive sync quieto).

## Requisito 4 — Leitura e agregação
**História:** Como usuário, quero que as telas (Finance/Nutrition/Fitness e o Cockpit) continuem
mostrando tudo certinho.

4.1. QUANDO uma tela lista ou soma lançamentos, ENTÃO ela DEVE ler as entradas das notas mensais
     e produzir os mesmos totais/visões que hoje (saldo do mês, calorias/dia, minutos/dia, etc.).
4.2. A leitura NÃO DEVE depender do nome do arquivo; os dados vêm só do frontmatter.
4.3. O desempenho de carregar um módulo NÃO DEVE piorar de forma perceptível (ler ~12 notas/ano
     em vez de centenas de itens-nota é esperado como melhora).

## Requisito 5 — Migração do modelo antigo (reversível)
**História:** Como usuário existente, quero atualizar e ter meus dados antigos consolidados
sozinhos, sem perder nada.

5.1. QUANDO o plugin inicia com uma schema version antiga, ENTÃO ele DEVE rodar a migração uma
     vez, automaticamente, e avisar com um Notice.
5.2. A migração DEVE, por mês e por módulo: coletar as notas-por-item daquele mês, escrevê-las
     como entradas na nota mensal consolidada e só então mover as notas-por-item e o hub antigo
     daquele mês para a **lixeira do Obsidian** (recuperável).
5.3. A migração NÃO DEVE apagar nada permanentemente nem perder entradas; uma entrada com
     frontmatter malformado DEVE ser preservada/pulada com aviso, nunca descartada silenciosamente.
5.4. A migração DEVE ser idempotente e segura para rodar mais de uma vez (itens já consolidados
     não são duplicados).
5.5. DEVE existir um comando manual "Momentum: consolidate monthly notes" que roda a mesma
     migração sob demanda, com um resumo (quantos itens/meses consolidados).
5.6. A migração NÃO DEVE rodar operações destrutivas em massa sem o caminho reversível de 5.2
     (coerente com a regra do steering: destrutivo = manual/guardado).

## Requisito 6 — Compatibilidade com Drive sync
6.1. A nota mensal DEVE estar no escopo do Drive sync (não é task) e ser escrita de forma
     idempotente (Req 3.4), para não gerar churn.
6.2. QUANDO a mesma nota mensal é editada em dois devices, ENTÃO o merge DEVE se comportar como
     qualquer nota de texto (keep-both em conflito real); o layout append-mostly minimiza isso.
6.3. Frontmatter malformado por merge (ex.: chave duplicada) DEVE ser reparável pelo mesmo
     mecanismo de reparo já existente, sem travar o módulo.

## Requisito 7 — Paridade no MCP
7.1. O `mcp/src/store.mjs` DEVE ler/escrever as notas mensais no mesmo formato do plugin
     (add/list/delete de transações, refeições, treinos; resumo do mês).
7.2. As tools do `mcp/src/server.mjs` DEVEM continuar funcionando (mesmos nomes e contratos),
     agora operando sobre as notas mensais.
7.3. Qualquer campo novo no modelo DEVE ser lido E escrito no MCP (evitar o bug de campo apagado
     no rewrite).

## Requisito 8 — Robustez
8.1. QUANDO uma nota mensal tem frontmatter inválido, ENTÃO o módulo DEVE degradar com elegância
     (pular/relatar) sem quebrar o carregamento dos outros meses.
8.2. QUANDO sobram notas-por-item ainda não migradas (migração parcial/interrompida), ENTÃO a
     leitura DEVE considerá-las também, para nunca "sumir" dados no meio da migração.

## Não-objetivos (fora desta spec)
- Tasks (é a spec #2, separada).
- Água e peso (já consolidados — ficam como estão).
- Definições: planos de refeição, exercícios, splits (poucos arquivos, continuam 1-por-item).
- Mudar as métricas/visões em si — só a camada de armazenamento muda.

---

## Decisões fechadas (aprovadas)
- **Q1 → nome/local do hub mantido:** a nota mensal reusa o caminho e o nome legível do hub
  atual (`Finance/Months/Finance 2026-10 October.md`, idem Nutrition/Fitness). Preserva links e
  memória muscular.
- **Q2 → corpo em tabela:** o resumo renderado no corpo é uma **tabela** por mês (mais navegável
  que bullets), além dos totais no topo.
- **Q3 → migração reversível pra lixeira:** os itens-nota e os hubs antigos vão para a **lixeira
  do Obsidian** após a consolidação bem-sucedida do mês (recuperável).
