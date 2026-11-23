# Ambiente local — Ações

## Pré-requisitos
- Node.js 20 ou superior
- PostgreSQL 16 (ou Docker + Docker Compose)
- Credenciais armazenadas fora do repositório

## Rodar localmente
1. Na raiz, configure `POSTGRES_PASSWORD` no terminal (não inclua em arquivos versionados).
2. Execute `docker compose up -d db`. A primeira inicialização executa `database/schema.sql`.
3. Entre em `server/` e execute `npm install`.
4. Copie `server/.env.example` para `server/.env` e substitua todos os segredos.
5. Para banco local com Docker, use DATABASE_URL para localhost:5432, usuário `acoes` e a senha escolhida; DATABASE_SSL=false.
6. Execute `npm start`.
7. Consulte `GET http://localhost:3000/api/health`. Deve retornar `{"ok":true}` quando o banco estiver disponível.

## Inicialização de organizador
`POST /api/admin/organizers` exige Bearer ADMIN_API_KEY e JSON `{"ownerUserId":"UUID","displayName":"Organizador"}`.
Use um UUID do usuário administrador do futuro provedor de autenticação.
`POST /api/admin/campaigns` exige o UUID do organizador, título, tipo e número de posições. O resultado é **rascunho**.

## Limitações atuais
- Nenhuma interface está conectada às rotas reais (index.html é protótipo).
- Não há autenticação completa, confirmação de telefone ou OTP.
- Inscrições são gratuitas e apenas para campanhas publicadas/autorizadas.
- Não há rota de publicação, de seleção de vencedores, nem pagamentos Asaas.
- Não há testes automatizados ou validação de produção.
- O banco exige políticas adicionais e revisão de proteção de dados para operação real.
- A publicação de campanhas requer documentação e verificação jurídica e operacional independente.
- Nunca coloque ADMIN_API_KEY ou credenciais do banco no frontend.


## Frontend conectado
- Abra `app.html` servindo os arquivos por HTTP(S), não como `file://`.
- A aplicação consulta `/api/campaigns` e utiliza `?campaign=UUID` para selecionar uma campanha específica.
- Se o frontend estiver em outro domínio, defina `window.ACOES_API_URL="https://seu-backend.example"` em `config.js`. Use o domínio real e HTTPS.
- Inclua a origem exata do frontend na variável `APP_ORIGIN` do backend, separando origens por vírgula.
- Antes de existir uma campanha publicada e autorizada, a interface exibirá **Campanha indisponível**. Isto é o comportamento esperado.
- Atualmente a interface de produção **não** mostra fotos reais; os prêmios vêm da tabela `prizes` e ainda não existe upload de imagens.
- O retorno de `participantId` não é uma credencial de acesso. É necessário implementar identidade verificada, sessão segura e histórico privado antes de liberar a área do participante.
- O código não deve ser considerado pronto para internet pública sem testes, revisão da conformidade da promoção e proteção contra abuso, inclusive verificação de identidade e limites por participante.


## Autenticação de participantes (etapa atual)
- `conta.html`: criação de conta, login, consulta de histórico e logout.
- `app.html`: exige token de sessão válido para confirmar inscrições gratuitas.
- `POST /api/auth/register`: cria conta para telefone ainda não registrado. **Não verifica a posse do telefone**.
- `POST /api/auth/login`: autentica com senha e retorna token aleatório revogável de 7 dias.
- `GET /api/me`: retorna dados da conta autenticada.
- `GET /api/me/entries`: retorna somente participações da conta autenticada.
- `POST /api/auth/logout`: revoga a sessão no banco.
- Os tokens ficam no `sessionStorage` da aba e não no banco em texto puro. Há exigência de HTTPS em produção.
- A criação de conta requer senha de pelo menos 12 caracteres. Uma implementação de produção deverá adicionar verificação de telefone (OTP), recuperação de senha, proteção adicional contra tentativas de login distribuídas, revisão de privacidade e consentimento e testes.
- O schema foi alterado. Docker inicializa `database/schema.sql` somente em um banco **novo**; bancos existentes precisam aplicar somente as instruções adicionais de migração, sem recriar tabelas nem apagar dados.
- Não envie o identificador de participante como prova de identidade; todas as consultas privadas exigem sessão.


## Painel administrativo de homologação — etapa 6
- A nova página `admin.html` consulta relatórios e gerencia rascunhos e prêmios.
- Rotas: `GET /api/admin/overview`, `GET /api/admin/organizers`, `GET /api/admin/campaigns`, `GET /api/admin/campaigns/:id/entries`, `POST /api/admin/campaigns/:id/prizes`.
- A interface de homologação pede a chave `ADMIN_API_KEY` em memória. **Não publique essa página**, não use a chave de produção nela e não compartilhe a chave. O painel definitivo precisa de autenticação administrativa individual e autorização por organizador (tenant).
- `POST /api/admin/organizers` continua disponível apenas via cliente administrativo de servidor, para inicialização de organizadores.
- Um prêmio só pode ser adicionado a campanha em `draft`. Não existe função de publicação/sorteio/cobrança nesta etapa.
- O SQL de instalação nova foi corrigido para remover bloco duplicado e restaurar a validação do telefone. Bancos já existentes precisam de migrações específicas; não recrie tabelas.
- **Código escrito e conferido no GitHub; execução contra PostgreSQL e testes de integração ainda não realizados.**

## Publicação da demonstração no GitHub Pages
- O site de demonstração pública fica em `docs/index.html` e funciona sem backend, sem cobrança e sem inscrições reais.
- Em GitHub > Settings > Pages, selecione `Deploy from a branch`, `main` e `/docs` e salve.
- Depois que o GitHub indicar publicação concluída, confira a URL fornecida pelo próprio GitHub Pages. Para este projeto, o endereço esperado é `https://prokkop7.github.io/Rifa/`; não é uma confirmação de que já esteja publicado.
- Não selecione `/ (root)`: a raiz contém o painel de homologação e arquivos de integração que não devem ser tratados como produção.
- GitHub Pages só publica arquivos estáticos. API Node.js, PostgreSQL, autenticação e integração Asaas exigem hospedagem backend separada.


## Publicação automática e testes (etapa seguinte)
- Fluxo de publicação: `.github/workflows/pages.yml`, acionado por alterações em `docs/` e também manualmente.
- Em **Settings > Pages > Build and deployment > Source**, escolha **GitHub Actions**. A orientação antiga de usar `Deploy from a branch /docs` foi substituída para utilizar o novo workflow.
- Em **Actions**, consulte o fluxo `Publicar demonstração`; a URL final será mostrada na execução bem-sucedida. Não assumir site publicado até verificar essa confirmação.
- O workflow envia **somente `docs/`**. Não inclui `admin.html`, API, banco de dados ou segredos.
- Fluxo de verificações: `.github/workflows/check.yml`; instala dependências, verifica sintaxe do backend, inicia um PostgreSQL temporário, aplica `schema.sql` e verifica `/api/health`.
- O teste automatizado precisa executar e ficar verde para confirmar que o código inicializa. Ele **não** substitui testes de segurança, concorrência, autenticação, LGPD ou produção.


## Layout principal para a comunidade brasileira em Londres
- `docs/index.html` agora oferece espaços para fotos em `docs/images/dell.jpg` e `docs/images/hp.jpg`, grade de 100 números, preço ilustrativo em BRL, resumo e simulação de bloqueio por 3 minutos.
- O contador do site está marcado como **simulação local**; ele não chama `POST /api/campaigns/:id/reservations`. Não confundir com reservas reais.
- O botão **Pagar** permanece desabilitado até confirmação de elegibilidade jurídica e habilitação de provedor financeiro apropriado.
- Para adicionar fotos reais, envie arquivos JPEG para os dois caminhos acima (em GitHub > Add file > Upload files). Não usar imagens de outros modelos como se fossem fotos dos prêmios.
- O backend tem `database/002_reservations.sql` com reservas de três minutos para campanhas gratuitas autorizadas; a migração precisa ser aplicada no PostgreSQL. O frontend público ainda não consome essa API.
- Para operação real, integrar sessão autenticada, consulta de reservas, expiração e confirmação transacional; criar testes de concorrência e proteção contra reservas abusivas.

## Conexão Asaas Sandbox
- Defina `ASAAS_ENV=sandbox`, `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` no arquivo `server/.env` privado (nunca no frontend ou GitHub).
- `GET /api/admin/asaas/status` com Bearer `ADMIN_API_KEY` testa a conexão no Sandbox via `GET /v3/myAccount/status/`. Retorna apenas status, sem dados financeiros.
- `POST /api/webhooks/asaas` valida o token em `asaas-access-token` e grava eventos idempotentemente em `payment_events`; o evento ainda NÃO efetiva pagamento no banco nem concede participações.
- Configure o webhook apenas depois de hospedar o backend em HTTPS. Os eventos não devem ser tratados como comprovante de pagamento sem conciliação.
- Produção, criação de cobrança, conversão de moeda e vinculação da campanha não estão ativadas. Confirme elegibilidade da conta e aprovação do Asaas para o negócio/país.
- Use credenciais distintas para Sandbox e produção. A chave de API nunca deve ser colada no chat ou gravada no código público.


## Checkout visual / regulamentação UK (2026-11)
- A página pública `docs/index.html` oferece o botão **Comprar**, que abre uma janela de resumo dentro do aplicativo. O modal exibe números, quantidade e valor, mas **não cobra e não gera participações**.
- Para campanha de sorteio comercial no Reino Unido com pagamento e premiação por acaso, é necessário classificar e implementar legalmente a modalidade; um sorteio comercial com entrada paga e sem rota gratuita genuína pode configurar loteria proibida. Alternativas incluem free draw com rotas paga e gratuita equivalentes ou competição genuína de habilidade. Revisar com assessoria jurídica britânica.
- O Asaas Checkout documentado atualmente é **hospedado e redirecionado**, não há garantia de que funcione embutido em iframe; nunca hospedar formulários de cartão sem integração segura.
- O Asaas Checkout aceita `minutesToExpire` entre **10 e 1440 minutos**, enquanto o projeto planeja reserva local de **3 minutos**. É indispensável definir estratégia transacional para pagamentos tardios, expiração do bloqueio e reembolso; nunca confirmar um número após liberação e venda a outra pessoa.
- A finalização financeira não pode ser ativada somente alterando um botão. Requer backend público HTTPS, chaves privadas da conta autorizada, verificação de webhooks, ambiente de testes, aprovação do processador para a categoria e conformidade do free-entry flow.
- Fonte: https://docs.asaas.com/reference/criar-novo-checkout ; https://www.gamblingcommission.gov.uk/public-and-players/guide/page/free-draws-and-prize-competitions/


## Etapa Asaas — Checkout sandbox comercial (23/11/2026)
- Nova API `POST /api/admin/commercial-checkouts` (Bearer ADMIN_API_KEY, JSON com `organizerId`, `description`, `amountCents`): cria pedido comercial separado e solicita um Checkout Asaas em Sandbox. Retorna `checkoutUrl`, `checkoutId`, `orderId`. **Não compre números ou participações com esta API.**
- Nova consulta `GET /api/admin/commercial-orders/:id` (mesma autenticação) para acompanhamento do pedido comercial.
- Migração `database/003_asaas_checkout.sql` adiciona `provider_checkout_id` com índice único. Aplicar em instâncias existentes com backup antes de executar esses endpoints.
- `POST /api/webhooks/asaas` agora admite eventos `CHECKOUT_PAID`, `CHECKOUT_CANCELED` e `CHECKOUT_EXPIRED`, verifica token, persiste ID único e atualiza somente `commercial_orders`. Não atribui números de campanhas.
- `server/test/asaas.mjs` contém testes com `fetch` simulado, sem chamadas ou cobranças reais, integrados ao workflow de verificação.
- Configure no backend `ASAAS_ENV=sandbox`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` com pelo menos 32 caracteres, `COMMERCIAL_CHECKOUT_RETURN_BASE` com HTTPS, `DATABASE_URL` e `ADMIN_API_KEY`. Nunca coloque segredos no repositório ou navegador.
- O checkout hospedado Asaas **redireciona** o cliente à URL do Asaas; não é embutido por iframe garantido. O link de retorno não confirma o pagamento: apenas o webhook validado.
- Asaas Checkout: `minutesToExpire` mínimo de 10 minutos. **É incompatível com promessa automática de liberação aos 3 minutos** sem reconciliação, cancelamento e tratamento de pagamento tardio.
- Segundo o suporte do Asaas (23/09/2026), pagamentos internacionais necessitam aprovação prévia, não aceitam Pix, boleto e links de pagamento e são feitos por cartão internacional. Verifique expressamente se o produto Checkout é admitido nessa modalidade.
- O Reino Unido exige qualificação legal de free draw, incluindo via gratuita real com destaque e condições adequadas, ou outra modalidade permitida. **Nenhum checkout público de números deve ser ativado** antes dessa validação e aprovação do adquirente.
- Situação: código de sandbox enviado ao GitHub; nenhuma conta vinculada e nenhuma transação real executada.
