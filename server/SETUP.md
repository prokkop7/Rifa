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
