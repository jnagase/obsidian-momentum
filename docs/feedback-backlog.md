# Community feedback backlog

Pedidos vindos da comunidade (fórum/Reddit), triados com avaliação de escopo e risco.
Não implementados ainda — aguardando decisão de priorização.

## 1. Métricas imperiais (Lbs) — QOL ✅ FEITO (0.9.0, local, não publicado)
**Pedido (ULT-Ginger):** permitir unidades imperiais (libras), não só kg.

**Implementado:** seletor de unidade `kg/lb` (config `unitSystem`) INLINE no painel ⚖️ body weight
do Fitness (tirado das settings do plugin — suspeita de freeze + UX melhor perto dos dados).
Armazenamento sempre em **kg** (canônico); conversão só no display/entrada via helpers puros em
`loaders.ts` (`kgToDisplay`/`displayToKg`/`weightUnit`, `KG_PER_LB`). Cobre: peso corporal (valor,
delta, meta, gráfico, lista), pesos de exercício (plano, tabelas log/editor, modal, gráfico de
progresso) e o painel lateral. MCP espelha o config. Testes em `test/units.test.ts`. Água e distância
de cardio ficaram de fora (métrico), como combinado.


**Estado hoje:** tudo em métrico. Peso corporal é logado em **kg** (`Fitness/weight.md`, `date→kg`),
`weightTarget` em kg, pesos de exercício (`Exercise.weight`/`WorkoutExercise.weight`) em kg, água em
litros, distância de cardio em km.

**Proposta de escopo (enxuto = só o que o pedido cita):**
- Setting `unitSystem: "metric" | "imperial"` no `PAConfig`.
- **Armazenar sempre canônico (kg)** e só **converter na exibição e na entrada** (usuário digita lbs
  → grava kg). Isso mantém o dado portátil e reversível (trocar a unidade nunca reescreve arquivo).
- Cobertura mínima: peso corporal + meta de peso + pesos de exercício (o "Lbs" do pedido).
- Opcional depois: água (L ↔ fl oz) e distância de cardio (km ↔ mi).

**Risco:** médio-baixo se gravar canônico e converter só display/input (nada de reescrever dados).
**Recomendação:** dá pra vibe com cuidado, escopado em peso. Se incluir água/distância vira spec.

## 2. Conectar ao Journal / daily note do Obsidian — QOL
**Pedido (ULT-Ginger):** usar o Journal/daily note existente em vez de uma seção de journal própria.

**Estado hoje:** o plugin tem seu **próprio** Journal em `Journal/YYYY/YYYY-MM-DD.md`, com frontmatter,
check-ins (mood/tags) e templates — separado do core **Daily Notes** / Periodic Notes do Obsidian.

**Proposta de escopo:**
- Setting pra apontar o módulo Journal pro **daily note** do usuário (pasta/formato/template lidos da
  config do core Daily Notes), em vez de `Journal/`.
- Decidir onde vivem os dados de check-in (frontmatter do daily note) e como não conflitar com o que
  o usuário já escreve no daily note dele.

**Risco:** **alto** — mexe nas **notas pessoais diárias** do usuário (conteúdo dele). Leitura/escrita
no daily note é sensível; conflito com o texto existente é fácil de causar.
**Recomendação:** **spec obrigatória** (design → requisitos → tarefas) antes de qualquer código.
Começar read-only/opt-in (apenas ler o daily note; ou escrever só num bloco demarcado).
