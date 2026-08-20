# Requirements Document

## Introduction

O Momentum Life sincroniza tasks com o Google Tasks usando um escopo **sensível**
(`https://www.googleapis.com/auth/tasks`). O app hoje está publicado ("In production") porém
**não verificado**, o que gera duas consequências: a tela de aviso "Google hasn't verified this
app" antes do consentimento, e um teto rígido de 100 usuários autorizados para toda a vida do
projeto Google Cloud (`obsidian-tasks-499613`), sem possibilidade de reset.

Esta spec cobre tudo que precisa existir para submeter e passar pela verificação OAuth do Google:
domínio próprio verificado, homepage do app, política de privacidade fiel ao modelo de dados real,
consent screen/branding coerente, migração dos endpoints OAuth para o domínio próprio **sem quebrar
instalações antigas do plugin**, justificativa de escopo, vídeo demonstrativo e o processo de
submissão/acompanhamento do review.

Duas restrições dominam o escopo:

1. **Upgrade transparente.** Nenhum usuário — nem quem está numa versão antiga do plugin — pode
   perder a conexão com o Google, ser obrigado a reautorizar ou executar passo manual por causa
   desta mudança.
2. **Fidelidade da declaração.** O que a política de privacidade e a justificativa de escopo dizem
   tem que descrever exatamente o que o código faz. Divergência entre declaração e comportamento é
   a causa mais comum de recusa no review.

O escopo solicitado é sensível e **não** restrito, portanto **não** exige avaliação de segurança
por terceiro (CASA/assessor independente). Exige review humano do Google.

## Glossary

- **Momentum_Life**: o plugin Obsidian distribuído em `github.com/jnagase/obsidian-momentum`, incluindo o módulo de sync com Google Tasks (`src/gtSync.ts`, `src/googletasks.ts`).
- **OAuth_Broker**: o Cloudflare Worker `momentum-google` (código em `worker/src/index.js`) que guarda `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` server-side e expõe `/auth`, `/callback`, `/exchange` e `/refresh`.
- **Legacy_Origin**: o host atual do OAuth_Broker, `https://momentum-google.jaime-nagase.workers.dev`, embarcado como `WORKER_BASE` nas versões do Momentum_Life já instaladas.
- **App_Domain**: o domínio próprio, registrado e controlado pelo autor, que passará a representar o app perante o Google.
- **Canonical_Redirect_Uri**: a única URL de callback registrada no OAuth_Client e enviada ao Google como `redirect_uri`, servida sob App_Domain.
- **App_Homepage**: a página pública do app sob App_Domain, informada na Consent_Screen como "Application home page".
- **Privacy_Policy_Page**: a página pública de política de privacidade sob App_Domain, informada na Consent_Screen como "Application privacy policy link".
- **Consent_Screen**: a configuração de OAuth branding/consent do projeto Google Cloud `obsidian-tasks-499613` (nome do app, emails, links, authorized domains, logo).
- **OAuth_Client**: o client OAuth do tipo Web do projeto `obsidian-tasks-499613` cujo id começa com `8btbj3o6...`.
- **Sensitive_Scope**: `https://www.googleapis.com/auth/tasks`.
- **Search_Console**: o Google Search Console, usado para verificar a propriedade do App_Domain na mesma conta Google que administra o projeto Google Cloud.
- **Scope_Justification**: o texto submetido ao Google explicando por que o app precisa do Sensitive_Scope.
- **Demo_Video**: o vídeo publicado no YouTube exigido pelo review de escopo sensível.
- **Verification_Submission**: a submissão feita no Verification Center do Google Cloud para o projeto `obsidian-tasks-499613`.
- **Submission_Checklist**: o documento de acompanhamento, versionado no repositório, com o estado de cada pré-requisito, cada pedido do Google e cada resposta enviada.
- **Release_Process**: o processo de release do Momentum_Life descrito no steering do projeto (bump de versão, tag, GitHub Action, `whatsnew.ts`, README).

## Requirements

### Requirement 1: Domínio próprio verificado

**User Story:** Como autor do plugin, quero um domínio próprio verificado no Google, para que o app tenha uma identidade que o review aceite e não dependa de um sufixo público compartilhado.

#### Acceptance Criteria

1. THE App_Domain SHALL ser um domínio com registro ativo cujo registro público (WHOIS/RDAP) apresente como registrante o autor ou o serviço de proteção de privacidade contratado pelo autor, com data de expiração do registro no mínimo 90 dias posterior à data prevista da Verification_Submission, e fora de sufixos públicos compartilhados como `workers.dev`, `github.io` e `pages.dev`.
2. THE App_Domain SHALL responder a requisições HTTPS no domínio raiz e em cada subdomínio usado pelo app com resposta bem-sucedida em no máximo 5 segundos por requisição, apresentando certificado válido para o nome consultado, cadeia completa até uma autoridade certificadora pública, validade restante de no mínimo 15 dias e nenhum aviso de certificado no navegador.
3. THE App_Domain SHALL constar como propriedade verificada no Search_Console de uma conta Google que detenha o papel Owner no projeto `obsidian-tasks-499613`, não bastando os papéis Editor, Viewer ou acesso delegado apenas no Search_Console.
4. WHEN a propriedade do App_Domain estiver verificada no Search_Console, THE Consent_Screen SHALL listar App_Domain no campo "Authorized domains" na forma de domínio raiz registrável — somente o nome com seu sufixo público, sem esquema (`https://`), sem `www` ou qualquer outro subdomínio, sem caminho, sem porta e sem barra final.
5. THE Consent_Screen SHALL listar em "Authorized domains" o domínio raiz de cada URL registrada na própria Consent_Screen e no OAuth_Client, cobrindo a App_Homepage, a Privacy_Policy_Page, a URL do logo quando enviado e o Canonical_Redirect_Uri.
6. IF a verificação do App_Domain no Search_Console for recusada, THEN THE Submission_Checklist SHALL registrar, em até 1 dia útil da recusa, o método de verificação usado, o número da tentativa, a data e hora, a mensagem de erro retornada e o método alternativo escolhido, admitindo no máximo 3 tentativas com o mesmo método antes da troca de método.
7. IF uma URL registrada no OAuth_Client pertencer a um sufixo público compartilhado, como o Legacy_Origin em `workers.dev`, THEN THE Consent_Screen SHALL manter esse domínio fora do campo "Authorized domains" e THE Submission_Checklist SHALL registrar a exceção ao critério 5, o motivo da omissão e a versão mínima do Momentum_Life que deixa de usar essa URL.
8. WHILE a Verification_Submission estiver pendente, THE App_Domain SHALL permanecer com registro ativo, com a propriedade verificada no Search_Console e com o registro de verificação (entrada DNS ou arquivo de verificação) publicado, sem alteração dos valores declarados em "Authorized domains" na submissão.
9. IF o Search_Console deixar de apresentar App_Domain como propriedade verificada, THEN THE Submission_Checklist SHALL registrar a data da detecção, a causa identificada e a data da reverificação, e bloquear novas interações com o Verification Center até que a reverificação esteja concluída.

### Requirement 2: Homepage do app

**User Story:** Como revisor do Google, quero uma homepage pública que descreva o app e sua relação com os dados do Google, para que eu possa confirmar que o app existe e faz o que declara.

#### Acceptance Criteria

1. THE App_Homepage SHALL ser servida em uma URL fixa sob App_Domain, por HTTPS com certificado válido, retornando o conteúdo da página em no máximo 5 segundos, sem exigir autenticação, sem exigir cadastro, sem paywall e sem redirecionar para host fora do App_Domain.
2. THE App_Homepage SHALL exibir o nome do app idêntico caractere a caractere ao nome configurado na Consent_Screen, incluindo maiúsculas, acentuação e espaçamento.
3. THE App_Homepage SHALL exibir o nome do autor responsável e um endereço de email de contato idêntico ao email de contato do desenvolvedor declarado na Consent_Screen.
4. THE App_Homepage SHALL descrever em texto: que o app é um plugin do Obsidian; que a sincronização com o Google Tasks é bidirecional entre notas do vault e listas do Google Tasks; que a sincronização é opcional e desligada por padrão, ativada pelo próprio usuário; e quais dados da conta Google o app acessa — tasks e listas de tasks — com a finalidade de cada acesso.
5. THE App_Homepage SHALL conter um link para a Privacy_Policy_Page sob App_Domain e um link para o repositório público `github.com/jnagase/obsidian-momentum`, ambos no conteúdo textual da página, alcançáveis sem interação além de rolagem, e ambos retornando conteúdo sem autenticação.
6. WHEN a App_Homepage é carregada com execução de JavaScript desabilitada, THE App_Homepage SHALL apresentar todo o conteúdo textual exigido pelos critérios 2 a 5.
7. THE App_Homepage SHALL ser acessível a rastreadores automatizados, sem regra que bloqueie sua URL no `robots.txt` do App_Domain e sem diretiva `noindex` em meta tag ou em cabeçalho de resposta.
8. THE App_Homepage SHALL apresentar em inglês todo o conteúdo textual exigido pelos critérios 2 a 5.
9. IF a App_Homepage não retornar seu conteúdo em uma verificação feita enquanto a Verification_Submission estiver pendente, THEN THE Submission_Checklist SHALL registrar a data da verificação, o erro observado e a correção aplicada.
10. IF a URL da App_Homepage mudar, THEN THE Submission_Checklist SHALL bloquear a submissão até que a Consent_Screen e a Privacy_Policy_Page apontem para a nova URL.

### Requirement 3: Política de privacidade fiel ao modelo de dados

**User Story:** Como usuário do plugin e como revisor do Google, quero uma política de privacidade que descreva com precisão onde os dados ficam e quem os toca, para que eu possa avaliar o risco real de conceder acesso.

#### Acceptance Criteria

1. THE Privacy_Policy_Page SHALL ser servida sob o mesmo App_Domain da App_Homepage, em uma URL fixa idêntica à registrada na Consent_Screen, acessível por HTTPS sem autenticação, sem paywall e sem redirecionamento para outro domínio, com o conteúdo textual completo renderizado sem execução de JavaScript e sem regra de bloqueio a rastreadores automatizados em `robots.txt` nem `noindex`.
2. THE Privacy_Policy_Page SHALL declarar que os dados de tasks obtidos do Google Tasks são gravados apenas em arquivos markdown dentro do vault local do Obsidian do próprio usuário.
3. THE Privacy_Policy_Page SHALL declarar que as chamadas à Google Tasks API partem do dispositivo do usuário direto para `tasks.googleapis.com`, sem passar por servidor do autor.
4. THE Privacy_Policy_Page SHALL declarar que o OAuth_Broker participa exclusivamente do handshake OAuth — troca do authorization code por tokens e renovação do access token — e não recebe, não processa e não armazena conteúdo de tasks.
5. THE Privacy_Policy_Page SHALL declarar que o OAuth_Broker não persiste tokens, authorization codes ou identificadores de usuário.
6. THE Privacy_Policy_Page SHALL declarar que os tokens de acesso e renovação ficam armazenados exclusivamente no arquivo de configuração local do plugin (`data.json`) no dispositivo do usuário, e que permanecem lá até que o usuário desconecte o Google no plugin ou remova o arquivo, sem retenção em qualquer sistema controlado pelo autor.
7. THE Privacy_Policy_Page SHALL enumerar como lista exaustiva os campos de task lidos e escritos pelo plugin — título, notas, data de vencimento, status de conclusão, identificador da task e identificador da lista — e declarar que nenhum outro dado da conta Google do usuário é lido ou escrito.
8. THE Privacy_Policy_Page SHALL declarar que os dados obtidos do Sensitive_Scope são usados somente para a sincronização solicitada pelo usuário, e que não são vendidos, não são transferidos a terceiros, não são usados para publicidade e não são usados para treinar modelos de inteligência artificial.
9. THE Privacy_Policy_Page SHALL descrever os dois caminhos de revogação de acesso — o comando de desconectar dentro do plugin e a página de permissões da conta Google — e, para cada caminho, declarar que o token local é removido, que o plugin deixa de acessar a Google Tasks API e que as notas de task já existentes no vault são preservadas.
10. THE Privacy_Policy_Page SHALL descrever como o usuário apaga os dados: remoção do arquivo de configuração local do plugin para os tokens, e remoção das notas do vault para o conteúdo sincronizado.
11. THE Privacy_Policy_Page SHALL informar a data da última atualização em formato ano-mês-dia e um endereço de email para contato sobre privacidade idêntico ao email de contato do desenvolvedor declarado na Consent_Screen.
12. THE Privacy_Policy_Page SHALL declarar que o plugin não coleta telemetria nem analytics sobre o uso do sync.
13. THE README SHALL conter um link para a Privacy_Policy_Page apontando para a mesma URL registrada na Consent_Screen.
14. THE Privacy_Policy_Page SHALL apresentar em inglês todas as declarações exigidas pelos critérios 2 a 12 desta seção.
15. IF o comportamento do Momentum_Life quanto a coleta, transmissão, armazenamento ou retenção de dados do usuário mudar, THEN THE Privacy_Policy_Page SHALL ser atualizada na mesma versão publicada dessa mudança e THE data da última atualização SHALL passar a ser a data da publicação.
16. IF a Privacy_Policy_Page, em verificação feita antes do envio, responder com erro, exigir autenticação, redirecionar para outro domínio ou apresentar declaração divergente do comportamento do Momentum_Life, THEN THE Submission_Checklist SHALL bloquear a Verification_Submission e registrar a URL verificada e o comportamento observado.

### Requirement 4: Revogação e exclusão de acesso pelo plugin

**User Story:** Como usuário, quero que desconectar no plugin realmente encerre o acesso do app à minha conta Google, para que a política de privacidade descreva a verdade e eu não fique com uma autorização órfã.

#### Acceptance Criteria

1. WHEN o usuário confirma a desconexão do Google, THE Momentum_Life SHALL enviar o refresh token armazenado — ou, na ausência dele, o access token — ao endpoint de revogação de tokens do Google, em uma única tentativa, sem retry, e com limite de 10 segundos para a resposta.
2. IF a solicitação de revogação retornar erro do Google, falhar por indisponibilidade de rede ou exceder o limite de 10 segundos, THEN THE Momentum_Life SHALL remover o token armazenado localmente, exibir mensagem informando que a revogação não foi confirmada e que o acesso também pode ser removido na página de permissões da conta Google, e registrar o erro retornado em `Config/google-auth-debug.md`.
3. WHEN o usuário confirma a desconexão do Google, THE Momentum_Life SHALL preservar, sem apagar, mover ou alterar conteúdo: todas as notas de task existentes no vault, incluindo os campos `google_id` e `google_list` do frontmatter, e todas as tasks e listas existentes na conta Google.
4. THE Momentum_Life SHALL restringir a transmissão e a gravação de access tokens e refresh tokens ao OAuth_Broker, aos endpoints do Google e ao arquivo local `data.json`, sem gravá-los em notas do vault nem nos logs de debug em `Config/`.
5. WHEN o usuário aciona o comando de desconectar do Google, THE Momentum_Life SHALL exibir uma confirmação explícita informando que o acesso do app à conta Google será revogado e que as notas de task do vault serão preservadas, enviar a requisição de revogação somente após essa confirmação, e manter o token armazenado inalterado caso o usuário cancele.
6. WHEN o Google responder à solicitação de revogação indicando sucesso, THE Momentum_Life SHALL remover do `data.json` o access token, o refresh token e o email da conta conectada, e exibir mensagem confirmando que o acesso do app à conta Google foi revogado.
7. WHILE não existir token do Google armazenado no `data.json`, THE Momentum_Life SHALL exibir nas configurações o estado desconectado e não executar sync com o Google Tasks em nenhum dos gatilhos — startup, intervalo automático ou manual.

### Requirement 5: Consent screen e branding coerentes

**User Story:** Como autor, quero a consent screen configurada com dados consistentes com as páginas publicadas, para que o review não seja recusado por divergência de identidade.

#### Acceptance Criteria

1. THE Consent_Screen SHALL declarar, com todos os campos preenchidos e nenhum vazio, o nome do app, o email de suporte ao usuário, o link da App_Homepage, o link da Privacy_Policy_Page e ao menos um email de contato do desenvolvedor, sendo que os dois links declarados apontam para URLs sob App_Domain, servidas por HTTPS, acessíveis sem autenticação e sem redirecionamento para fora do App_Domain.
2. THE Consent_Screen SHALL listar o Sensitive_Scope como único escopo sensível e nenhum escopo restrito, admitindo além dele apenas os escopos não sensíveis de identificação básica adicionados por padrão pelo Google.
3. WHILE a Verification_Submission não estiver aprovada pelo Google, THE Consent_Screen SHALL permanecer com user type "External" e publishing status "In production", sem retorno a "Testing" em nenhum momento.
4. WHERE o autor optar por enviar um logo, THE Consent_Screen SHALL usar uma imagem em formato PNG ou JPG, com lados iguais de no mínimo 120 × 120 pixels, arquivo de no máximo 1 MB, hospedada sob App_Domain e acessível por HTTPS sem autenticação, e THE Submission_Checklist SHALL registrar a data de envio do logo e acompanhar o brand review como item separado do review de escopo, que corre em paralelo e pode concluir depois dele.
5. IF o nome do app, o link da App_Homepage ou o link da Privacy_Policy_Page divergirem entre Consent_Screen, App_Homepage e Privacy_Policy_Page em comparação caractere a caractere — incluindo esquema, host, caminho e barra final nos links, e maiúsculas/minúsculas no nome do app —, THEN THE Submission_Checklist SHALL registrar cada divergência encontrada e marcar a submissão como bloqueada até que os três valores estejam idênticos.
6. IF o publishing status da Consent_Screen deixar de ser "In production" antes da aprovação da Verification_Submission, THEN THE Consent_Screen SHALL ser restaurada para "In production" antes de qualquer nova tentativa de autorização de usuário.
7. IF o publishing status da Consent_Screen deixar de ser "In production" antes da aprovação da Verification_Submission, THEN THE Submission_Checklist SHALL registrar a data da mudança, o motivo e o impacto conhecido de revogação do refresh token a cada 7 dias enquanto o status estiver em "Testing".
8. WHILE a Verification_Submission não estiver aprovada pelo Google, THE Submission_Checklist SHALL registrar o número de contas Google que já autorizaram o app e as vagas restantes dentro do limite de 100 usuários não verificados, válido para toda a vida do projeto `obsidian-tasks-499613` e sem reset.

### Requirement 6: Endpoints OAuth sob o domínio próprio

**User Story:** Como autor, quero os endpoints OAuth servidos pelo domínio próprio, para que o redirect_uri registrado pertença a um domínio verificado que eu controlo.

#### Acceptance Criteria

1. THE OAuth_Broker SHALL atender, sob App_Domain e exclusivamente por HTTPS, os caminhos `/auth` (GET), `/callback` (GET), `/exchange` (POST) e `/refresh` (POST).
2. THE Canonical_Redirect_Uri SHALL ser um valor literal fixo composto pelo esquema `https`, pelo App_Domain e pelo caminho `/callback`, sem query string e sem fragmento, definido como constante de configuração do OAuth_Broker e nunca derivado do host da requisição recebida.
3. THE OAuth_Client SHALL ter registrado como authorized redirect URI uma string idêntica caractere a caractere ao Canonical_Redirect_Uri, sem divergência de esquema, de subdomínio, de caixa no host ou de barra final.
4. WHEN o OAuth_Broker monta a URL de consentimento do Google, THE OAuth_Broker SHALL enviar como `redirect_uri` o Canonical_Redirect_Uri idêntico caractere a caractere e repassar sem alteração os valores de `code_challenge` e `state` recebidos do Momentum_Life, independentemente do host pelo qual a requisição chegou, incluindo o Legacy_Origin.
5. WHEN o OAuth_Broker troca um authorization code por tokens, THE OAuth_Broker SHALL enviar como `redirect_uri` a mesma string do Canonical_Redirect_Uri usada na requisição de consentimento correspondente, idêntica caractere a caractere.
6. WHEN o OAuth_Broker recebe o callback do Google contendo `code`, THE OAuth_Broker SHALL redirecionar os valores de `code` e `state`, sem alteração, para o deep link `obsidian://momentum-google` em no máximo 2 segundos, e SHALL apresentar um link acionável manualmente para o mesmo deep link caso o redirecionamento automático não ocorra.
7. THE OAuth_Broker SHALL obter `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` exclusivamente da sua configuração server-side, ignorando qualquer valor desses parâmetros vindo da requisição, e SHALL nunca incluir o valor de `GOOGLE_CLIENT_SECRET` em resposta, redirecionamento, deep link ou página servida.
8. IF o Google recusar a requisição de token, THEN THE OAuth_Broker SHALL repassar ao Momentum_Life o corpo de erro retornado pelo Google sem alteração, preservando os campos `error` e `error_description` sem substituí-los por mensagem genérica, e SHALL sinalizar a falha de forma distinguível de uma resposta bem-sucedida.
9. IF uma requisição chegar sem os parâmetros obrigatórios do respectivo endpoint — `code_challenge` e `state` em `/auth`, `code` e `code_verifier` em `/exchange`, `refresh_token` em `/refresh` — THEN THE OAuth_Broker SHALL rejeitar a requisição com erro indicando qual parâmetro está ausente, sem encaminhar a requisição ao Google.
10. IF o OAuth_Broker receber o callback do Google contendo `error` e sem `code`, THEN THE OAuth_Broker SHALL repassar os valores de `error` e `error_description` ao Momentum_Life pelo deep link `obsidian://momentum-google`, sem iniciar a troca de token.
11. IF uma requisição do OAuth_Broker ao endpoint de token do Google não retornar resposta em até 10 segundos, THEN THE OAuth_Broker SHALL encerrar a tentativa e responder ao Momentum_Life com erro indicando esgotamento de tempo na comunicação com o Google, sem retentativa automática e sem alterar o token já armazenado no Momentum_Life.

### Requirement 7: Compatibilidade com instalações existentes

**User Story:** Como usuário que não atualizou o plugin, quero continuar conectando e sincronizando normalmente, para que a mudança de domínio do autor não me obrigue a nada.

#### Acceptance Criteria

1. WHILE o suporte ao Legacy_Origin não tiver sido encerrado conforme o critério 7, THE OAuth_Broker SHALL atender no Legacy_Origin os caminhos `/auth`, `/callback`, `/exchange` e `/refresh` com o mesmo comportamento observável das mesmas requisições recebidas no App_Domain.
2. WHEN uma requisição de autorização chega no Legacy_Origin, THE OAuth_Broker SHALL enviar ao Google o Canonical_Redirect_Uri como `redirect_uri`, independentemente do host pelo qual a requisição chegou, sem exigir atualização do Momentum_Life.
3. WHEN uma requisição de renovação de token chega no Legacy_Origin com um refresh token emitido antes da migração, THE OAuth_Broker SHALL retornar, em no máximo 10 segundos, um access token aceito pela Google Tasks API, sem exigir nova autorização do usuário.
4. WHEN o Momentum_Life é atualizado para a versão que usa App_Domain e existe refresh token armazenado localmente, THE Momentum_Life SHALL reutilizar esse refresh token nas requisições ao App_Domain e concluir o primeiro sync após o upgrade sem exibir tela de consentimento.
5. WHERE os quatro caminhos do OAuth_Broker já respondem sob App_Domain e o Canonical_Redirect_Uri já está registrado no OAuth_Client, THE Momentum_Life SHALL usar App_Domain como único valor de `WORKER_BASE` em toda versão publicada a partir de então, sem manter Legacy_Origin como fallback.
6. WHILE alguma versão do Momentum_Life ainda em suporte fizer o Google redirecionar para um redirect URI diferente do Canonical_Redirect_Uri, THE OAuth_Client SHALL manter esse redirect URI registrado como authorized redirect URI.
7. WHEN o autor decidir encerrar o suporte ao Legacy_Origin, THE Submission_Checklist SHALL registrar a data da decisão, a versão mínima do Momentum_Life exigida e a data prevista de desativação, com no mínimo 90 dias entre o registro e a desativação.
8. THE Release_Process SHALL publicar a mudança de `WORKER_BASE` numa versão cuja entrada de CHANGELOG em `whatsnew.ts` informe que a conexão com o Google continua ativa e que nenhuma ação do usuário é necessária.
9. WHEN uma requisição de troca de authorization code chega no Legacy_Origin, THE OAuth_Broker SHALL enviar ao Google o mesmo Canonical_Redirect_Uri enviado na requisição de autorização correspondente.
10. IF uma requisição de renovação de token for recusada pelo Google, THEN THE Momentum_Life SHALL preservar o refresh token armazenado e as notas de task do vault, exibir mensagem indicando falha na renovação do acesso e não disparar reautorização automática.
11. IF nenhuma versão do Momentum_Life ainda em suporte fizer o Google redirecionar para um redirect URI sob Legacy_Origin, THEN THE OAuth_Client SHALL manter o Canonical_Redirect_Uri como único authorized redirect URI registrado.

### Requirement 8: Justificativa de escopo

**User Story:** Como revisor do Google, quero uma justificativa que explique por que o app precisa de escrita no Google Tasks, para que eu possa avaliar se o escopo é o mínimo necessário.

#### Acceptance Criteria

1. THE Scope_Justification SHALL identificar o Sensitive_Scope pela string exata `https://www.googleapis.com/auth/tasks`, nomear a sincronização bidirecional de tasks entre o vault do Obsidian e o Google Tasks como a única funcionalidade que depende dele, e declarar que nenhum outro escopo sensível ou restrito é solicitado além dos escopos não sensíveis de identificação básica adicionados por padrão pelo Google.
2. THE Scope_Justification SHALL enumerar as quatro operações de escrita que o Momentum_Life executa na conta do usuário — criar task, atualizar task, marcar task como concluída e deletar task — e declarar que o escopo alternativo `https://www.googleapis.com/auth/tasks.readonly` não permite nenhuma das quatro, sendo portanto insuficiente para a funcionalidade.
3. THE Scope_Justification SHALL declarar que os dados de task obtidos do Sensitive_Scope são gravados apenas em arquivos markdown no vault local do Obsidian do próprio usuário, que o autor não opera servidor de armazenamento, e que o OAuth_Broker participa exclusivamente do handshake OAuth — troca do authorization code por tokens e renovação do access token — sem receber, processar ou persistir conteúdo de tasks, tokens ou identificadores de usuário.
4. THE Scope_Justification SHALL declarar conformidade com a política de Limited Use do Google afirmando as quatro restrições de forma explícita: os dados obtidos do Sensitive_Scope não são vendidos, não são transferidos a terceiros, não são usados para publicidade e não são usados para treinar modelos de inteligência artificial; e que são usados somente para a sincronização solicitada pelo usuário.
5. THE Scope_Justification SHALL ser um texto único redigido em inglês, com no máximo 4.000 caracteres e dentro do limite do campo de justificativa do Verification Center.
6. THE Scope_Justification SHALL ser consistente com a Privacy_Policy_Page em armazenamento, compartilhamento e retenção de dados, de modo que nenhuma afirmação de um dos dois documentos contradiga ou omita uma afirmação equivalente do outro nesses três tópicos.
7. THE Scope_Justification SHALL existir como documento versionado no repositório, referenciado por URL ou caminho na Submission_Checklist, com conteúdo idêntico ao texto enviado na Verification_Submission.
8. IF for identificada divergência entre a Scope_Justification, a Privacy_Policy_Page ou o comportamento implementado no código do Momentum_Life e do OAuth_Broker, THEN THE Submission_Checklist SHALL registrar a divergência e bloquear a submissão até que os três estejam alinhados.

### Requirement 9: Vídeo demonstrativo

**User Story:** Como revisor do Google, quero ver o fluxo de consentimento e o uso real do escopo em vídeo, para que eu possa confirmar que o app se comporta como declara.

#### Acceptance Criteria

1. THE Demo_Video SHALL estar publicado no YouTube com visibilidade "public" ou "unlisted", em uma única URL informada na Verification_Submission, acessível sem login e sem restrição de idade, e SHALL permanecer acessível nessa mesma URL desde o envio da Verification_Submission até a decisão final do Google.
2. THE Demo_Video SHALL mostrar o início do fluxo na tela de configurações do Momentum_Life, incluindo o nome do plugin e o acionamento do controle de conexão com o Google, em gravação contínua sem corte desde esse acionamento até a exibição da tela de consentimento.
3. THE Demo_Video SHALL mostrar a tela de consentimento do Google exibindo o nome do app idêntico ao nome configurado na Consent_Screen e a lista completa de permissões solicitadas, incluindo a permissão correspondente ao Sensitive_Scope.
4. THE Demo_Video SHALL mostrar a barra de endereço do navegador durante o consentimento com, no mínimo, os 8 primeiros caracteres do `client_id` do OAuth_Client (`8btbj3o6`) e o valor de `redirect_uri` correspondente ao Canonical_Redirect_Uri legíveis na URL.
5. THE Demo_Video SHALL mostrar o retorno ao Obsidian pelo deep link `obsidian://momentum-google` e, sem corte entre o consentimento e esse retorno, a confirmação de conexão exibida na tela de configurações do Momentum_Life.
6. THE Demo_Video SHALL demonstrar o uso do Sensitive_Scope em ambas as direções — uma task criada no Obsidian aparecendo no Google Tasks e uma task criada no Google Tasks aparecendo no vault — com o mesmo título legível nas duas superfícies, o board e a lista correspondentes visíveis, e cada direção gravada em tomada contínua sem corte entre a criação da task e sua aparição do outro lado, incluindo o acionamento do sync quando este for manual.
7. THE Demo_Video SHALL apresentar narração em inglês ou legendas em inglês fornecidas pelo autor, cobrindo todos os passos exigidos nos critérios 2 a 6, sem depender de legenda gerada ou traduzida automaticamente pelo YouTube.
8. THE Demo_Video SHALL usar uma conta Google de teste e dados de task fictícios, sem exibir em nenhum quadro dado pessoal real de terceiros (nome, email, telefone ou endereço), incluindo abas do navegador, notificações do sistema e demais notas do vault.
9. THE Demo_Video SHALL ter duração total entre 2 e 10 minutos e resolução mínima de 1280x720 pixels, com todo texto exigido nos critérios 3, 4 e 6 legível com o vídeo pausado.
10. WHEN o Demo_Video for publicado, THE Submission_Checklist SHALL registrar a URL do vídeo, a data de publicação, a conta Google de teste utilizada e o consumo de 1 vaga do limite vitalício de 100 usuários do projeto `obsidian-tasks-499613`.
11. IF o Demo_Video exibir dado pessoal real, ou o nome do app mostrado no vídeo divergir do nome configurado na Consent_Screen, THEN THE Submission_Checklist SHALL bloquear a Verification_Submission até que uma nova gravação sem a divergência esteja publicada na URL registrada.

### Requirement 10: Submissão e acompanhamento do review

**User Story:** Como autor, quero um checklist e um registro do review, para que eu saiba o que falta, o que o Google pediu e o que eu respondi.

#### Acceptance Criteria

1. THE Submission_Checklist SHALL ser um documento markdown versionado no repositório que lista cada critério de aceitação dos Requirements 1 a 9 desta spec, cada um com exatamente um estado entre "não iniciado", "em andamento", "concluído" e "bloqueado", a URL ou o artefato que comprova o estado, e a data da última mudança de estado.
2. WHEN todos os critérios listados na Submission_Checklist estiverem no estado "concluído", THE Verification_Submission SHALL ser enviada pelo Verification Center do projeto `obsidian-tasks-499613`, com a data de envio registrada na Submission_Checklist.
3. WHEN o Google enviar um pedido de informação adicional, THE Submission_Checklist SHALL registrar, em até 1 dia útil do recebimento, a data do recebimento, o texto integral do pedido e o prazo de resposta informado pelo Google, e em até 1 dia útil do envio, a resposta enviada e a data do envio.
4. IF a Verification_Submission for recusada, THEN THE Submission_Checklist SHALL registrar a data da recusa, o motivo informado pelo Google, o critério desta spec afetado com estado "bloqueado" e o item de correção correspondente.
5. WHILE a Verification_Submission estiver pendente, THE Consent_Screen SHALL permanecer com user type "External" e publishing status "In production", sem retorno ao status "Testing".
6. WHILE a Verification_Submission estiver pendente, THE Momentum_Life SHALL continuar renovando o access token e sincronizando as tasks dos usuários já autorizados, sem solicitar nova autorização e sem exigir qualquer passo manual do usuário.
7. WHEN a Verification_Submission for aprovada, THE Release_Process SHALL, na primeira versão publicada após a aprovação, remover do README as instruções relativas à tela "Google hasn't verified this app" e o aviso do teto de contas autorizáveis, e registrar em `src/whatsnew.ts` que nenhuma ação do usuário é necessária.
8. IF pelo menos um critério listado na Submission_Checklist estiver em estado diferente de "concluído", THEN THE Verification_Submission SHALL não ser enviada e THE Submission_Checklist SHALL identificar os critérios pendentes ou bloqueados que impedem o envio.
9. THE Submission_Checklist SHALL registrar o número de contas Google que já autorizaram o app e o número de vagas restantes até o teto de 100 contas do projeto `obsidian-tasks-499613`, atualizado a cada envio de Verification_Submission e a cada resposta a pedido do Google.
10. IF a Consent_Screen deixar de estar com publishing status "In production" enquanto a Verification_Submission estiver pendente, THEN THE Consent_Screen SHALL ser retornada a "In production" antes de qualquer nova autorização de usuário e THE Submission_Checklist SHALL registrar a data, a causa e a consequência de revogação do refresh token a cada 7 dias enquanto o status estiver divergente.

### Requirement 11: Comunicação ao usuário enquanto o app não estiver verificado

**User Story:** Como usuário instalando o sync pela primeira vez, quero entender o aviso de app não verificado e o limite de usuários, para que eu não conclua que o plugin está quebrado.

#### Acceptance Criteria

1. WHILE o app não estiver verificado pelo Google, THE README SHALL descrever a tela "Google hasn't verified this app" e listar, em ordem numerada, cada passo que o usuário executa a partir dessa tela até o retorno ao Obsidian com a conexão concluída.
2. WHILE o app não estiver verificado pelo Google, THE README SHALL informar que no máximo 100 contas Google podem autorizar o app durante toda a vida do projeto `obsidian-tasks-499613`, que esse teto não pode ser resetado, e que ao ser atingido novas contas ficam impedidas de autorizar até a verificação ser aprovada.
3. IF o Google recusar a autorização por limite de usuários do projeto, THEN THE Momentum_Life SHALL exibir mensagem identificando o teto de 100 contas como causa, apontando o link de acompanhamento da verificação e informando que os usuários já autorizados continuam sincronizando.
4. WHEN uma autorização falhar, THE Momentum_Life SHALL registrar em `Config/google-auth-debug.md` uma entrada com data e hora, a etapa do fluxo em que a falha ocorreu (autorização, troca do authorization code ou renovação de token) e os campos `error` e `error_description` retornados pelo Google.
5. IF a resposta de erro do Google não contiver os campos `error` e `error_description`, THEN THE Momentum_Life SHALL registrar em `Config/google-auth-debug.md` uma entrada indicando que o corpo de erro veio ausente ou não interpretável, incluindo o conteúdo recebido truncado em no máximo 500 caracteres.
6. THE Momentum_Life SHALL não registrar em `Config/google-auth-debug.md` access tokens, refresh tokens, authorization codes ou client secret.
7. IF o Google recusar a autorização por limite de usuários do projeto, THEN THE Momentum_Life SHALL preservar o token já armazenado localmente e manter a sincronização das contas já autorizadas.

## Premissas e questões abertas

Estas decisões estão fora do meu alcance e mudam o desenho. Preciso da sua resposta antes do design.

**Todas resolvidas.** Decisões registradas em detalhe na seção "Decisões" do `design.md` (D1–D12).
Resumo:

1. **Domínio.** `jnagase.com`, **já registrado pelo autor** — nada a comprar. Site em
   `momentumlife.jnagase.com`, Broker em `momentumlife-auth.jnagase.com`. Em "Authorized domains"
   vai só a raiz, `jnagase.com`, que cobre os dois hosts. (D1, D3)
2. **Onde servir homepage e política.** Cloudflare Pages, com o conteúdo versionado em `site/` no
   repo do plugin — para a política subir no mesmo commit do código que ela descreve. (D2)
3. **Topologia.** Dois subdomínios **de primeiro nível**, irmãos. O hífen em
   `momentumlife-auth` é deliberado: o Universal SSL da Cloudflare cobre apex e um nível só, então
   `auth.momentumlife.jnagase.com` ficaria sem certificado automático. (D3b)
4. **Logo.** Não enviar na primeira submissão — dispara brand review em paralelo e alonga o prazo.
   Item opcional pós-aprovação. (D4)
5. **Revogação no desconectar.** Entra nesta spec. Sem ela, o critério 9 do Requirement 3 faria a
   política declarar algo que o código não faz. (D5)
6. **Nome do app na consent screen.** `Momentum Life`, caixa exata, idêntico ao `<h1>` da
   homepage. (D6)
7. **Conta de teste para o vídeo.** Conta Google separada, consumindo 1 vaga do cap de 100,
   registrada no checklist. (D7)
8. **Legacy_Origin nos authorized domains.** **Resolvido por design, sem trade-off.** Com o
   `redirect_uri` canônico fixo no Worker, o Google passa a redirecionar sempre para o App_Domain,
   independentemente do host que o plugin chamou. O redirect de `workers.dev` deixa de ser exercido
   e pode ser removido do OAuth_Client — nenhuma exceção a declarar ao Google — enquanto o
   Legacy_Origin continua servindo `/auth`, `/exchange` e `/refresh` para quem não atualizou. O
   critério 7 do Requirement 1 fica registrado no checklist como resolvido por design. (D8)
