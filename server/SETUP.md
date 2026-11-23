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
