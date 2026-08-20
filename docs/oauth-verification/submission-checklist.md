# Submission checklist — Google OAuth verification

Tracking document for the verification of project `obsidian-tasks-499613`.

**Estados:** `não iniciado` · `em andamento` · `concluído` · `bloqueado` — exatamente um por linha.

**Regra de envio:** a submissão só sai quando **todos** os itens estiverem `concluído`. A seção
[Gate de submissão](#gate-de-submissão) lista o que falta.

**Hosts desta submissão** (fonte: `app-domain.json`):

| Papel | Valor |
| --- | --- |
| Domínio raiz (Authorized domains) | `jnagase.com` |
| Homepage | `https://momentumlife.jnagase.com/` |
| Privacy policy | `https://momentumlife.jnagase.com/privacy` |
| Canonical redirect URI | `https://momentumlife-auth.jnagase.com/callback` |
| OAuth client | Web, id inicia em `8btbj3o6` |

---

## Requirement 1 — Domínio próprio verificado

| ID | Critério (resumo) | Estado | Evidência | Última mudança |
| --- | --- | --- | --- | --- |
| 1.1 | Domínio registrado ao autor, fora de sufixo público, expiração ≥ 90 d da submissão | concluído | `jnagase.com` já registrado; confirmar validade no painel | 2026-08-15 |
| 1.2 | HTTPS válido em cada host usado, resposta ≤ 5 s, cert com cadeia completa e ≥ 15 d | não iniciado | saída de `curl -sSI` (tarefa 4.7) | — |
| 1.3 | Propriedade verificada no Search Console por conta com papel **Owner** no projeto | concluído | domínio `jnagase.com` verificado via TXT (integração direta Google↔Cloudflare); dashboard confirmado | 2026-08-19 |
| 1.4 | "Authorized domains" recebe o domínio raiz, sem esquema/subdomínio/caminho/barra | concluído | Consent Screen mostra apenas `jnagase.com` | 2026-08-19 |
| 1.5 | Todo domínio raiz de URL registrada consta em "Authorized domains" | concluído | homepage, política e redirect canônico todos sob `jnagase.com`, único domínio listado | 2026-08-19 |
| 1.6 | Recusa de verificação registrada em 1 dia útil, máx. 3 tentativas por método | não iniciado | [Registro de verificação](#registro-de-verificação-de-domínio) | — |
| 1.7 | URL em sufixo público fica fora de "Authorized domains", com exceção registrada | concluído | `jaime-nagase.workers.dev` removido de Authorized domains após remover o redirect URI legado (ver [Exceções](#exceções-e-desvios)) | 2026-08-19 |
| 1.8 | Durante o review: domínio ativo, propriedade verificada, TXT publicado | não iniciado | recheck periódico | — |
| 1.9 | Perda do estado verificado registrada e bloqueia interação com o Verification Center | não iniciado | [Registro de verificação](#registro-de-verificação-de-domínio) | — |

## Requirement 2 — Homepage do app

| ID | Critério (resumo) | Estado | Evidência | Última mudança |
| --- | --- | --- | --- | --- |
| 2.1 | URL fixa, HTTPS, ≤ 5 s, sem auth/cadastro/paywall/redirect externo | concluído | Cloudflare Pages publicado; `https://momentumlife.jnagase.com/` responde 200 direto | 2026-08-19 |
| 2.2 | Nome do app idêntico caractere a caractere ao da Consent Screen | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 2.3 | Autor e email de contato idênticos ao developer contact | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 2.4 | Descreve plugin, sync bidirecional, opt-in e dados acessados com finalidade | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 2.5 | Link para a política e para o repositório público, alcançáveis só com rolagem | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 2.6 | Todo conteúdo textual renderiza sem JavaScript | concluído | Property 12 (`test/site.property.test.ts`) | 2026-08-15 |
| 2.7 | Acessível a rastreadores: sem bloqueio em `robots.txt`, sem `noindex` | concluído | Property 12 + `site/robots.txt` | 2026-08-15 |
| 2.8 | Conteúdo exigido em inglês | concluído | revisão humana + `lang="en"` | 2026-08-15 |
| 2.9 | Falha de resposta durante o review registrada com erro e correção | não iniciado | este arquivo | — |
| 2.10 | Mudança de URL bloqueia submissão até Consent Screen e política apontarem para a nova | concluído | Property 11 amarra as URLs a `app-domain.json` | 2026-08-15 |

## Requirement 3 — Política de privacidade fiel ao modelo de dados

| ID | Critério (resumo) | Estado | Evidência | Última mudança |
| --- | --- | --- | --- | --- |
| 3.1 | URL fixa sob o mesmo domínio, HTTPS, sem auth/paywall/redirect, sem JS, indexável | concluído | `https://momentumlife.jnagase.com/privacy` responde 200 direto (sem `.html`, que redireciona 308 para a URL canônica) | 2026-08-19 |
| 3.2 | Declara dados de task apenas em markdown no vault local | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.3 | Declara chamadas do dispositivo direto a `tasks.googleapis.com` | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.4 | Declara broker só no handshake, sem receber/processar/armazenar task | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.5 | Declara broker sem persistir token, code ou identificador | concluído | `test/site.content.test.ts` + guarda stateless em `test/worker-config.test.ts` | 2026-08-15 |
| 3.6 | Declara tokens só no `data.json` local, até desconectar ou remover | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.7 | Enumera os 6 campos de task, exaustivo, e nada além | concluído | `test/site.content.test.ts` + Property 10 | 2026-08-15 |
| 3.8 | Declara as 4 restrições de Limited Use e uso só para o sync pedido | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.9 | Descreve os 2 caminhos de revogação, com notas preservadas em ambos | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.10 | Descreve exclusão: `data.json` para tokens, notas do vault para conteúdo | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.11 | Informa data da última atualização (YYYY-MM-DD) e email de privacidade | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.12 | Declara ausência de telemetria e analytics | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.13 | README linka a política na mesma URL da Consent Screen | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 3.14 | Declarações em inglês | concluído | revisão humana + `lang="en"` | 2026-08-15 |
| 3.15 | Mudança de comportamento atualiza a política no mesmo release, com nova data | concluído | `site/privacy.html` atualizado para v2 (revogação real), `Last updated: 2026-08-19`, publica no mesmo push do release | 2026-08-19 |
| 3.16 | Erro/divergência na política bloqueia a submissão, com URL e comportamento registrados | não iniciado | este arquivo + Property 13 | — |

## Requirement 4 — Revogação e exclusão de acesso pelo plugin

| ID | Critério (resumo) | Estado | Evidência | Última mudança |
| --- | --- | --- | --- | --- |
| 4.1 | Envia revogação ao Google, 1 tentativa, sem retry, limite 10 s | concluído | `revokeGoogleToken` + Property 7 | 2026-08-15 |
| 4.2 | Falha/timeout: remove token local, avisa que não confirmou, registra erro | concluído | `disconnectGoogleTasks` + Property 7 | 2026-08-15 |
| 4.3 | Preserva notas do vault, `google_id`/`google_list` e tasks no Google | concluído | `disconnectGoogleTasks` não toca vault; gate I4 | 2026-08-15 |
| 4.4 | Tokens só para broker, endpoints do Google e `data.json`; nunca em log | concluído | `redactSecrets` + Property 9 | 2026-08-15 |
| 4.5 | Confirmação explícita antes de revogar; cancelar não envia nada | concluído | `ConfirmModal` em `disconnectGoogleTasks` | 2026-08-15 |
| 4.6 | Sucesso: remove access/refresh/email do `data.json` e confirma ao usuário | concluído | **Gate I4 concluído** (2026-08-20): disconnect real no vault de teste; Notice de sucesso exibida; `hasToken: false` no `data.json`; app **removido** de myaccount.google.com/permissions (busca por "mo" não retorna Momentum Life) | 2026-08-20 |
| 4.7 | Sem token: UI mostra desconectado e nenhum gatilho de sync executa | concluído | guarda em `syncGoogleTasks` + Property 10 | 2026-08-15 |

## Requirement 5 — Consent screen e branding coerentes

| ID | Critério (resumo) | Estado | Evidência | Última mudança |
| --- | --- | --- | --- | --- |
| 5.1 | Todos os campos preenchidos, links sob o domínio, HTTPS, sem auth | concluído | App name, support email, homepage e privacy link preenchidos; ambos os links respondem 200 | 2026-08-19 |
| 5.2 | Só o escopo sensível do Tasks; nenhum restrito | concluído | guarda de escopo em `test/worker-config.test.ts` + Property 5 | 2026-08-15 |
| 5.3 | Mantém `External` / `In production` durante todo o review | em andamento | já em "In production" desde 2026-08-15 | 2026-08-15 |
| 5.4 | Logo (se enviado): PNG/JPG quadrado ≥ 120px, ≤ 1 MB, sob o domínio | concluído | **não aplicável**: sem logo nesta submissão (D4) | 2026-08-15 |
| 5.5 | Divergência de nome/links entre os 3 lugares bloqueia a submissão | concluído | `test/site.content.test.ts` | 2026-08-15 |
| 5.6 | Status fora de "In production" é restaurado antes de nova autorização | não iniciado | monitoramento | — |
| 5.7 | Mudança de status registrada com data, motivo e impacto dos 7 dias | não iniciado | este arquivo | — |
| 5.8 | Registra contas que autorizaram e vagas restantes do cap de 100 | em andamento | [Contador de vagas](#contador-de-vagas) | 2026-08-15 |

## Requirement 6 — Endpoints OAuth sob o domínio próprio

| ID | Critério (resumo) | Estado | Evidência | Última mudança |
| --- | --- | --- | --- | --- |
| 6.1 | Os 4 caminhos atendem sob o domínio, só HTTPS | concluído | deploy feito; `/auth` e `/callback` verificados por `curl` nos dois hosts | 2026-08-19 |
| 6.2 | Redirect canônico é constante literal, nunca derivado do host | concluído | `worker/src/config.js` + Property 1 + confirmado em produção (mesma URL de consent em ambos os hosts) | 2026-08-19 |
| 6.3 | Redirect canônico registrado no OAuth client, idêntico caractere a caractere | concluído | print do Google Cloud (URIs 3) + Gate I1 completou o fluxo real | 2026-08-19 |
| 6.4 | `/auth` envia o canônico e repassa `code_challenge`/`state` intactos | concluído | Properties 1 e 3 | 2026-08-15 |
| 6.5 | `/exchange` envia o mesmo canônico do `/auth` | concluído | Property 1 | 2026-08-15 |
| 6.6 | `/callback` repassa `code`/`state` ao deep link em ≤ 2 s, com link manual | concluído | Property 3 | 2026-08-15 |
| 6.7 | Secrets só do env; nunca em resposta, redirect, deep link ou página | concluído | Property 5 | 2026-08-15 |
| 6.8 | Erro do Google repassado cru, com `error` e `error_description` | concluído | Property 3 | 2026-08-15 |
| 6.9 | Parâmetro obrigatório ausente é rejeitado sem contatar o Google | concluído | Property 4 | 2026-08-15 |
| 6.10 | Callback com `error` e sem `code` repassa os dois campos, sem trocar token | concluído | Property 3 | 2026-08-15 |
| 6.11 | Timeout de 10 s sem retentativa, sem alterar token armazenado | concluído | Property 6 | 2026-08-15 |

## Requirement 7 — Compatibilidade com instalações existentes

| ID | Critério (resumo) | Estado | Evidência | Última mudança |
| --- | --- | --- | --- | --- |
| 7.1 | Legacy origin atende os 4 caminhos com o mesmo comportamento | concluído | Property 2 + guarda `workers_dev` | 2026-08-15 |
| 7.2 | Autorização pelo legacy usa o redirect canônico, sem exigir upgrade | concluído | Property 1 | 2026-08-15 |
| 7.3 | Refresh pelo legacy com token pré-migração devolve access token em ≤ 10 s | concluído | **Gate I2 concluído** (2026-08-19): `expires_at` forçado para expirado (12:38:49); "Sync now" na 0.5.9 renovou sem pedir reconexão; `expires_at` novo = 13:34:39, provando refresh bem-sucedido via `workers.dev` | 2026-08-19 |
| 7.4 | Upgrade com token existente sincroniza sem tela de consentimento | concluído | **Gate I3 concluído** (2026-08-20): upgrade 0.5.9 → 0.6.0 no vault de teste; `expires_at` idêntico antes/depois; log de auth sem nova entrada; sync completou sem erro | 2026-08-20 |
| — | **Gate I1 concluído** (2026-08-19): plugin 0.5.9 (WORKER_BASE = legacy) conectou do zero. Google mostrou consent para `jnagase.com`; callback caiu em `momentumlife-auth.jnagase.com/callback`; `google-auth-debug.md` registrou o token novo (hasAccess/hasRefresh true); sync subsequente completou sem erro | concluído | logs do vault de teste + prints do fluxo de consent | 2026-08-19 |
| 7.5 | Versões novas usam o domínio como único `WORKER_BASE`, sem fallback | concluído | `src/appdomain.ts` + Property 11 | 2026-08-15 |
| 7.6 | Redirect URI ainda usado por versão em suporte permanece registrado | concluído | Fase 2 é aditiva; remoção só na Fase 6 | 2026-08-15 |
| 7.7 | Encerrar o legacy registra data, versão mínima e ≥ 90 d de aviso | não iniciado | **fora do escopo desta submissão** | — |
| 7.8 | Release informa no changelog que nada precisa ser feito | não iniciado | `src/whatsnew.ts` | — |
| 7.9 | `/exchange` pelo legacy envia o mesmo canônico do `/auth` | concluído | Property 1 | 2026-08-15 |
| 7.10 | Refresh recusado preserva token e notas, sem reautorização automática | concluído | `GoogleAuthExpiredError` + Property 8 | 2026-08-15 |
| 7.11 | Sem versão usando o legacy, o canônico é o único redirect registrado | concluído | redirect URI `workers.dev/callback` removido do client; revalidado por `curl` nos dois hosts (mesma resposta, mesmo redirect_uri) | 2026-08-19 |

## Requirement 8 — Justificativa de escopo

| ID | Critério (resumo) | Estado | Evidência | Última mudança |
| --- | --- | --- | --- | --- |
| 8.1 | Identifica a string exata do escopo e a única funcionalidade dependente | concluído | `scope-justification.md` | 2026-08-15 |
| 8.2 | Enumera as 4 escritas e por que `tasks.readonly` não basta | concluído | `scope-justification.md` | 2026-08-15 |
| 8.3 | Declara dados só no dispositivo e ausência de servidor de armazenamento | concluído | `scope-justification.md` | 2026-08-15 |
| 8.4 | Declara as 4 restrições de Limited Use explicitamente | concluído | `scope-justification.md` | 2026-08-15 |
| 8.5 | Texto único em inglês, ≤ 4.000 caracteres | concluído | `test/submission-docs.test.ts` | 2026-08-15 |
| 8.6 | Consistente com a política em armazenamento, compartilhamento e retenção | concluído | revisão cruzada | 2026-08-15 |
| 8.7 | Versionado no repo, cópia idêntica no Verification Center, hash registrado | em andamento | hash registrado no envio | 2026-08-15 |
| 8.8 | Divergência entre justificativa, política e código bloqueia a submissão | não iniciado | Property 13 | — |

## Requirement 9 — Vídeo demonstrativo

| ID | Critério (resumo) | Estado | Evidência | Última mudança |
| --- | --- | --- | --- | --- |
| 9.1 | YouTube público/unlisted, URL única e estável até a decisão | não iniciado | URL do vídeo | — |
| 9.2 | Início nas settings do plugin, contínuo até o consent | não iniciado | roteiro tomada 1 | — |
| 9.3 | Consent screen com nome do app e lista completa de permissões | não iniciado | roteiro tomada 1 | — |
| 9.4 | Barra de endereço com `client_id` e `redirect_uri` legíveis | não iniciado | roteiro tomada 1 | — |
| 9.5 | Retorno ao Obsidian pelo deep link, sem corte desde o consent | não iniciado | roteiro tomada 1 | — |
| 9.6 | Uso do escopo nas duas direções, cada uma em tomada contínua | não iniciado | roteiro tomadas 2 e 3 | — |
| 9.7 | Narração ou legenda própria em inglês, sem legenda automática | não iniciado | roteiro | — |
| 9.8 | Conta de teste e dados fictícios, sem dado pessoal real em quadro | não iniciado | revisão humana (tarefa 12.5) | — |
| 9.9 | 2 a 10 min, ≥ 1280×720, texto legível em pausa | não iniciado | revisão humana | — |
| 9.10 | Registra URL, data, conta de teste e o consumo de 1 vaga | não iniciado | [Contador de vagas](#contador-de-vagas) | — |
| 9.11 | Dado pessoal ou nome divergente bloqueia a submissão | não iniciado | revisão humana | — |

---

## Gate de submissão

A submissão **não sai** enquanto houver item em estado diferente de `concluído`.
`test/checklist.property.test.ts` calcula a lista a partir deste arquivo.

**Bloqueadores no momento** (resumo por fase):

- **Fase 3 — plataforma**: 1.2, 1.3, 1.4, 1.5, 2.1, 3.1, 5.1
- **Fase 2/6 — OAuth client**: 6.3, 7.11
- **Fase 4/5 — deploy do Worker**: 6.1
- **Gates de integração**: 7.3 (I2), 7.4 (I3)
- **Fase 7 — release**: 3.15, 7.8, 8.7
- **Fase 8 — vídeo**: 9.1 a 9.11
- **Processo (durante o review)**: 1.6, 1.8, 1.9, 2.9, 3.16, 5.3, 5.6, 5.7, 5.8, 8.8
- **Fora do escopo desta submissão**: 7.7 (encerrar o legacy)

## Registro de verificação de domínio

| Data | Método | Tentativa | Resultado | Mensagem de erro | Método alternativo |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |

Máximo de 3 tentativas com o mesmo método antes de trocar. Registrar em até 1 dia útil.

## Contador de vagas

Cap de **100 contas** para app não verificado, válido para toda a vida do projeto
`obsidian-tasks-499613`, **sem reset**.

| Data | Contas que autorizaram | Vagas restantes | Observação |
| --- | --- | --- | --- |
| 2026-08-15 | 1 | 99 | Estado observado na Audience antes da migração |

Atualizar a cada envio de submissão e a cada resposta a pedido do Google. A conta de teste do
vídeo consome 1 vaga.

## Diário do review

| Data | Evento | Conteúdo | Resposta | Data da resposta |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |

Pedido de informação: registrar data de recebimento, **texto integral** e prazo informado, em até
1 dia útil. Recusa: registrar motivo, critério afetado (marcado `bloqueado`) e item de correção.

## Exceções e desvios

| Item | Situação | Resolução |
| --- | --- | --- |
| Requirement 1, critério 7 | O `workers.dev` era redirect URI registrado, mas não pode entrar em "Authorized domains" por ser sufixo público | **Resolvido por design.** O redirect canônico fixo faz o Google redirecionar sempre para o domínio próprio, então a URL `workers.dev` deixa de ser exercida e sai do OAuth client na Fase 6. Nenhuma exceção a declarar ao Google. Evidência: Property 1, Property 2, tarefa 9.1 |
| Requirement 7, critério 7 | Encerramento do legacy origin exige aviso de 90 dias | Fora do escopo desta submissão. O legacy permanece no ar indefinidamente |
| Requirement 5, critério 4 | Logo na consent screen | Não enviado (D4): dispararia brand review em paralelo e alongaria o prazo |
