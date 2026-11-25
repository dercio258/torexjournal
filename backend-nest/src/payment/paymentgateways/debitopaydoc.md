IMPLEMENTAÇÃO DA INTEGRAÇÃO DE PAGAMENTOS DEBITO PAY NO TOREXJOURNAL
leia a documentacao https://debitopay.com/developers/payments-api/
1. Objetivo

Implementar e integrar completamente a API de pagamentos Debito Pay no ecossistema TorexJournal, aproveitando a arquitetura, os serviços, os modelos de dados e os mecanismos de cobrança já existentes no projeto.

A implementação deve ser nativa, consistente com a arquitetura atual e preparada para produção.

IMPORTANTE: Não desenvolver uma integração genérica nem criar uma arquitetura paralela desnecessária. Primeiro analisar o código existente, identificar as estruturas de pagamentos e subscrições já implementadas e adaptar a integração à realidade do TorexJournal.

A integração deve suportar exclusivamente pagamentos C2B (Customer to Business).

Não implementar B2C, payouts, transferências ou levantamentos através desta integração.

2. Métodos de pagamento a integrar

Implementar quatro métodos de pagamento:

2.1 M-Pesa — MZN

Pagamentos C2B.

Moeda: MZN.

Valor mínimo: 10 MZN.

Utilizar o fluxo de cobrança M-Pesa através do Payment Orchestrator.

A solicitação de pagamento deve acontecer através de popup na interface do TorexJournal.

Não utilizar Hosted Checkout para M-Pesa.

Não redirecionar o utilizador para uma página externa de checkout.

Apresentar o estado do pagamento no popup.

Aguardar a confirmação real da transação.

Atualizar automaticamente o estado da encomenda ou subscrição após confirmação.

Request:

POST /payment-orchestrator

{
  "action": "process",
  "payment_method": "mpesa",
  "merchant_id": "MERCHANT_UUID",
  "wallet_code": "12345",
  "amount": 150,
  "currency": "MZN",
  "phone": "+258841234567",
  "source": "to rexjournal",
  "source_id": "ORDER_123"
}

O valor de source deve ser definido de forma consistente com a convenção já utilizada no projeto, sem espaços ou identificadores artificiais.

2.2 e-Mola — MZN

Pagamentos C2B.

Moeda: MZN.

Valor mínimo: 5 MZN.

Utilizar o Payment Orchestrator.

O pagamento deve ser iniciado através de popup.

Não utilizar Hosted Checkout.

Não redirecionar para checkout externo.

Apresentar o estado pending enquanto aguarda confirmação.

Processar o callback e o webhook.

Atualizar a encomenda ou subscrição quando o pagamento for confirmado.

Request:

{
  "action": "process",
  "payment_method": "emola",
  "merchant_id": "MERCHANT_UUID",
  "wallet_code": "12345",
  "amount": 750,
  "currency": "MZN",
  "phone": "258861234567",
  "source": "torexjournal",
  "source_id": "ORDER_123"
}

2.3 Visa / Mastercard — MZN

Pagamentos C2B.

Moeda: MZN.

Valor mínimo: 50 MZN.

Utilizar payment_method: visa_mastercard.

Utilizar Hosted Checkout da Debito Pay.

Criar o pagamento no backend.

Receber o checkout_url.

Redirecionar o utilizador para o checkout.

Após o pagamento, o utilizador regressa ao return_url do TorexJournal.

Confirmar sempre o resultado através de webhook ou consulta de estado.

Request:

{
  "action": "process",
  "payment_method": "visa_mastercard",
  "merchant_id": "MERCHANT_UUID",
  "wallet_code": "12345",
  "amount": 500,
  "currency": "MZN",
  "customer_email": "cliente@example.com",
  "customer_name": "Cliente TorexJournal",
  "return_url": "https://torexjournal.com/payment/result"
}

O frontend nunca deve recolher ou armazenar diretamente os dados do cartão.

2.4 PayFast — ZAR

Pagamentos C2B.

Moeda exclusivamente ZAR.

Valor mínimo: 5 ZAR.

Utilizar payment_method: payfast.

Utilizar Hosted Checkout da Debito Pay.

Suportar cartões e EFT disponibilizados pelo PayFast.

Criar o pagamento no backend.

Receber o checkout_url.

Redirecionar o utilizador para o checkout.

Processar a confirmação através do mecanismo ITN e do webhook da Debito Pay.

Request:

{
  "action": "process",
  "payment_method": "payfast",
  "merchant_id": "MERCHANT_UUID",
  "wallet_code": "67890",
  "amount": 250,
  "currency": "ZAR",
  "customer_email": "cliente@example.co.za",
  "customer_name": "TorexJournal Customer",
  "customer_phone": "+27821234567",
  "return_url": "https://torexjournal.com/payment/result"
}

A carteira PayFast deve estar configurada em ZAR.

Não misturar MZN e ZAR na mesma transação.

3. Arquitetura de integração

A integração deve utilizar um serviço central de pagamentos.

Fluxo:

TOREXJOURNAL
     |
     v
Payment Interface
     |
     v
Payment Controller
     |
     v
Payment Service
     |
     v
DEBITO PAY API
     |
     +------ M-Pesa
     |
     +------ e-Mola
     |
     +------ Visa/Mastercard
     |
     +------ PayFast
     |
     v
Payment Confirmation
     |
     v
Webhook Receiver
     |
     v
Payment Verification
     |
     v
Order / Subscription Update
     |
     v
TorexJournal Database

Centralizar a comunicação com a Debito Pay num serviço próprio, respeitando a organização atual do backend.

Não espalhar requests HTTP da Debito Pay por controllers, páginas ou componentes frontend.

4. Autenticação e configuração

Utilizar autenticação Bearer.

URL base:

https://gyqoaningqhurhvdugne.supabase.co/functions/v1

Headers:

Authorization: Bearer sk_live_xxxxxxxxx
Content-Type: application/json
Accept: application/json
X-Idempotency-Key: UUID

As credenciais devem ficar exclusivamente no backend.

Criar ou reutilizar as variáveis de ambiente:

DEBITO_PAY_BASE_URL=
DEBITO_PAY_API_KEY=
DEBITO_PAY_MERCHANT_ID=
DEBITO_PAY_WALLET_MZN=
DEBITO_PAY_WALLET_ZAR=
DEBITO_PAY_WEBHOOK_SECRET=
DEBITO_PAY_RETURN_URL=

Os nomes devem ser adaptados às convenções já existentes no projeto.

Nunca colocar API Keys ou webhook secrets no frontend.

5. Sistema de pagamentos por popup

Para M-Pesa e e-Mola, implementar uma experiência de pagamento integrada na interface do TorexJournal.

O popup deve conter:

Identificação do método selecionado.

Valor da transação e moeda.

Campo de telefone.

Botão para iniciar pagamento.

Estado de processamento.

Estado de espera pela confirmação.

Mensagem de sucesso ou falha.

Opção para fechar o popup quando apropriado.

Fluxo:

Cliente seleciona M-Pesa ou e-Mola
             |
             v
Abre popup de pagamento
             |
             v
Introduz número de telefone
             |
             v
Confirma pagamento
             |
             v
Backend chama Debito Pay
             |
             v
Pedido aceite?
       /          \
      SIM          NÃO
       |            |
       v            v
   PENDING        ERRO
       |
       v
Aguardar confirmação
       |
       v
Webhook / consulta
       |
       v
Pagamento confirmado?
       /          \
      SIM          NÃO
       |            |
       v            v
   SUCCESS       FAILED
       |
       v
Atualizar encomenda

O popup não deve declarar o pagamento concluído apenas porque o pedido foi aceite pela API.

Para e-Mola, respeitar a confirmação assíncrona. Para M-Pesa, respeitar a resposta de confirmação disponibilizada pela API.

Implementar atualização de estado sem obrigar o utilizador a atualizar manualmente a página.

Não criar um sistema de polling excessivo. Reutilizar mecanismos existentes ou implementar polling controlado quando necessário.

6. Visa/Mastercard e PayFast

Estes dois métodos utilizam Hosted Checkout.

Fluxo:

Cliente seleciona cartão ou PayFast
             |
             v
Backend cria pagamento
             |
             v
Debito Pay devolve checkout_url
             |
             v
TorexJournal redireciona cliente
             |
             v
Cliente conclui pagamento
             |
             v
Regresso ao TorexJournal
             |
             v
Webhook confirma resultado
             |
             v
Atualização da encomenda

O parâmetro return_url deve apontar para uma rota segura do TorexJournal.

Criar ou adaptar uma página de resultado que consiga apresentar:

Pagamento em processamento.

Pagamento confirmado.

Pagamento recusado.

Pagamento expirado.

A página de retorno nunca deve assumir que o pagamento foi concluído apenas com base nos parâmetros da URL.

7. Sistema de cobranças recorrentes e subscrições

Esta parte é particularmente importante.

O TorexJournal já possui estruturas para gerir cobranças recorrentes e subscrições.

Antes de implementar, analisar os modelos, serviços, controllers, tarefas agendadas, emails e mecanismos de renovação existentes.

Não substituir o sistema atual de subscrições. Integrar a Debito Pay no sistema existente.

7.1 Modelo de funcionamento

O sistema deve permitir que uma subscrição tenha uma próxima data de cobrança.

Quando chegar o momento da renovação:

O sistema identifica as subscrições que precisam de renovação.

Gera uma cobrança pendente.

Cria um identificador único para essa cobrança.

Gera um link seguro de pagamento.

Envia um email ao utilizador.

O utilizador clica no link.

É redirecionado para a página de pagamento do TorexJournal.

Escolhe qualquer método de pagamento disponível.

Conclui o pagamento.

A Debito Pay confirma a transação.

O TorexJournal atualiza a subscrição.

7.2 Checkout universal de renovação

Criar ou reutilizar uma rota semelhante a:

/subscription/payment/:token

O link enviado por email deve abrir uma página de pagamento universal.

Exemplo:

https://torexjournal.com/subscription/payment/SECURE_TOKEN

Essa página deve identificar a cobrança e apresentar:

Nome do plano.

Valor da renovação.

Moeda.

Data da cobrança.

Estado da subscrição.

Métodos de pagamento disponíveis.

O utilizador poderá escolher:

Método

Moeda

Experiência

M-Pesa

MZN

Popup

e-Mola

MZN

Popup

Visa/Mastercard

MZN

Redirecionamento

PayFast

ZAR

Redirecionamento

A disponibilidade dos métodos deve respeitar a moeda da cobrança e a configuração das carteiras.

7.3 Link seguro de pagamento

O token deve:

Ser criptograficamente aleatório.

Ter validade configurável.

Estar associado a uma cobrança específica.

Não expor IDs internos sensíveis.

Não permitir alterar o valor da cobrança.

Não permitir pagar uma cobrança já liquidada.

Ser invalidado ou limitado quando a cobrança expirar ou for cancelada.

Não incluir API Keys, informações internas ou dados sensíveis no URL.

7.4 Email de renovação

Utilizar o serviço de email já existente no TorexJournal.

O email deve incluir:

Nome do utilizador.

Plano ou serviço.

Valor a pagar.

Data de renovação.

Link para concluir o pagamento.

Informação sobre a validade do link.

Exemplo de assunto:

Renovação da sua subscrição — TorexJournal

Não enviar um link direto para a API da Debito Pay. O link deve abrir o checkout universal do próprio TorexJournal.

7.5 Confirmação da renovação

Quando a Debito Pay confirmar o pagamento:

Marcar a cobrança como paga.

Atualizar a subscrição.

Atualizar a próxima data de renovação de acordo com o ciclo contratado.

Registar o método de pagamento utilizado.

Guardar a referência da transação.

Enviar email de confirmação.

Garantir que a mesma cobrança não pode renovar duas vezes.

Se o pagamento falhar:

Manter a cobrança como não liquidada.

Não prolongar a subscrição.

Permitir nova tentativa enquanto a cobrança estiver válida.

Permitir ao utilizador escolher outro método de pagamento.

Aplicar as regras de tolerância e suspensão já existentes no TorexJournal.

7.6 Natureza da recorrência

Neste modelo, a renovação é iniciada através de um link enviado por email e concluída pelo próprio utilizador.

Não implementar débito automático de cartão ou tokenização automática como requisito desta integração.

O sistema de subscrições gere o calendário, a criação das cobranças e o envio dos emails. A Debito Pay processa o pagamento quando o utilizador escolhe um método e confirma a operação.

8. Webhooks

Implementar um endpoint de receção de eventos da Debito Pay.

Exemplo:

POST /api/webhooks/debito-pay

Eventos:

payment.completed
payment.failed
payment.refunded
payment.chargeback

O foco da implementação é C2B. Não implementar fluxos B2C.

8.1 Exemplo de evento

{
  "event": "payment.completed",
  "data": {
    "payment_id": "PAYMENT_UUID",
    "merchant_id": "MERCHANT_UUID",
    "wallet_code": "12345",
    "amount": 150,
    "currency": "MZN",
    "method": "mpesa",
    "reference": "PROVIDER_REFERENCE",
    "paid_at": "2026-11-22T12:00:00Z"
  },
  "timestamp": "2026-11-22T12:00:01Z"
}

8.2 Validação

Validar a assinatura:

x-webhook-signature

Utilizar HMAC-SHA256 e o webhook secret.

A validação deve utilizar o corpo bruto da requisição e comparação segura de assinaturas.

8.3 Processamento

Implementar:

Verificação da assinatura.

Validação do payload.

Identificação do pagamento.

Verificação de duplicados.

Atualização transacional da base de dados.

Registo do evento.

Resposta HTTP 200 após aceitação segura do evento.

Tratar os eventos de forma idempotente.

Um webhook duplicado não pode duplicar pagamentos, encomendas, renovações ou períodos de subscrição.

9. Estados e consistência financeira

Utilizar os estados da Debito Pay:

pending
success
failed
expired

Mapear esses estados para os estados internos existentes no TorexJournal.

Garantir que:

Um pagamento pendente não ativa uma subscrição.

Um pagamento falhado não prolonga a subscrição.

Um pagamento concluído é contabilizado apenas uma vez.

Uma renovação já liquidada não pode ser paga novamente.

Um webhook duplicado não gera efeitos financeiros duplicados.

Um pagamento associado a uma encomenda não pode ser associado arbitrariamente a outra.

A atualização do pagamento, encomenda e subscrição deve ser consistente e protegida contra concorrência.

10. Consulta de estado e reconciliação

Utilizar:

POST /payment-orchestrator

{
  "action": "check-status",
  "payment_id": "PAYMENT_UUID"
}

Implementar consulta de estado para:

Pagamentos pendentes.

Webhooks não recebidos.

Recuperação de falhas temporárias.

Reconciliação de encomendas.

Recuperação de pagamentos após timeout.

Não criar pagamentos duplicados automaticamente quando existir incerteza sobre o resultado de um pedido anterior.

11. Persistência e modelos de dados

Primeiro inspecionar os modelos atuais.

Reutilizar as estruturas existentes de:

Payments.

Orders.

Subscriptions.

Subscription invoices ou renewal records.

Customers / Users.

Payment events.

Email notifications.

Adicionar campos ou tabelas apenas quando necessário.

Cada pagamento deve permitir identificar:

ID interno.

payment_id da Debito Pay.

Referência interna da encomenda ou cobrança.

Merchant.

Carteira.

Método de pagamento.

Moeda.

Montante.

Estado.

Referência do provedor.

Data de criação.

Data de confirmação.

Identificador de idempotência.

Cada cobrança recorrente deve manter a ligação à subscrição original.

Não duplicar entidades que já existam no projeto.

12. Segurança

Aplicar:

API Keys exclusivamente no backend.

Webhook HMAC-SHA256.

HTTPS.

Idempotência.

Validação de montantes e moedas no servidor.

Proteção contra manipulação de links de cobrança.

Proteção contra repetição de eventos.

Controlo de acesso às subscrições.

Logs sem credenciais ou dados sensíveis.

Verificação de domínio autorizado quando aplicável.

Nunca confiar no valor, estado ou método de pagamento enviado pelo frontend como fonte definitiva.

13. Tratamento de erros

Tratar corretamente:

INVALID_API_KEY
WALLET_DOMAIN_NOT_ALLOWED
WALLET_CODE_NOT_FOUND
WALLET_INACTIVE
INSUFFICIENT_MATURED_BALANCE
Rate limit exceeded
Internal server error

Os erros específicos de B2C não precisam de ser implementados no TorexJournal.

Para erros de comunicação e timeouts, verificar o estado da transação antes de tentar criar uma nova.