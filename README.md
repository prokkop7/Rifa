# Ações — Plataforma de campanhas (em desenvolvimento)

## Estado real
- ✅ Protótipo responsivo em `index.html`.
- ✅ Modelo inicial do banco em `database/schema.sql`.
- ⏳ Backend, autenticação, persistência, painel e integração Asaas ainda não implementados.
- ⛔ Nenhuma cobrança real nem sorteio em produção.

## Modelo de operação
Campanhas numeradas podem ser criadas em demonstração. A publicação de campanhas reais é reservada a modalidades elegíveis com autorização e regulamento conferidos. A tabela `commercial_orders` destina-se à venda separada de bens/serviços legítimos; o pagamento não pode comprar chance em sorteio particular.

## Ambiente proposto
- Frontend responsivo
- API server-side com autenticação e separação por organizador
- PostgreSQL gerenciado (por exemplo Supabase)
- Asaas Sandbox e produção para cobranças comerciais permitidas
- Webhook autenticado, idempotente, com reconciliação do estado remoto
- Identificadores UUID para registros, solicitações e auditoria

## Antes de produção
1. Definir provedor de hospedagem, banco, domínio e usuário administrador.
2. Criar ambiente de testes e configurar segredos apenas no servidor.
3. Implementar APIs e transações de inscrição com `unique(campaign_id,number)`, validar intervalo e estado publicado.
4. Implementar autenticação, LGPD, consentimentos, logs e políticas de acesso.
5. Desenvolver checkout para vendas legítimas e testar PIX/cartão no Sandbox.
6. Validar configuração fiscal, documental, regulamento e autorização antes de publicar qualquer campanha real.

Documentos de referência:
- https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-premios-e-apostas/promocao-comercial/promocao-comercial/promocoes-comerciais/36-as-rifas-sao-permitidas
- https://docs.asaas.com/docs/visao-geral
- https://docs.asaas.com/docs/introdu%C3%A7%C3%A3o-1
