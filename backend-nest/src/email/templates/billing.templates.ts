/**
 * Institutional Billing & Subscription Email Templates
 * Covers: PAYMENT_INITIATED, PAYMENT_SUCCESS, PAYMENT_FAILED, TRIAL_WELCOME,
 *         SUBSCRIPTION_EXPIRING, SUBSCRIPTION_EXPIRED, SUBSCRIPTION_CANCELLED, REMARKETING_FOLLOWUP
 */

import {
    renderActionButton,
    renderCalloutBox,
    renderGreeting,
    renderHeading,
    renderKeyValueTable,
    renderStepList,
} from './layout';
import { EmailTemplateDefinition, EmailTemplatePayloadMap } from './types';
import { buildAppUrl, escapeHtml, formatCurrency, formatInstitutionalDate } from './utils';

export const CRYPTO_QR_CID = 'crypto-payment-qr@torexjournal.com';

export const billingTemplates: {
    [K in
        | 'PAYMENT_INITIATED'
        | 'CRYPTO_PAYMENT_INITIATED'
        | 'PAYMENT_SUCCESS'
        | 'PAYMENT_FAILED'
        | 'TRIAL_WELCOME'
        | 'SUBSCRIPTION_EXPIRING'
        | 'SUBSCRIPTION_EXPIRED'
        | 'SUBSCRIPTION_CANCELLED'
        | 'REMARKETING_FOLLOWUP']: EmailTemplateDefinition<EmailTemplatePayloadMap[K]>;
} = {
    PAYMENT_INITIATED: {
        category: '',
        tone: 'amber',
        subject: (data) =>
            data.subject ||
            `Instrução de pagamento pendente (Ref. ${data.reference}) — Torex Journal`,
        preheader: (data) =>
            `Confirme a transação ${data.method?.toUpperCase() || ''} de ${formatCurrency(data.amount, data.currency || 'MZN')} para ativar sua assinatura.`,
        renderBody: (data) => {
            const currency = data.currency || 'MZN';
            const paymentsUrl = buildAppUrl('/payments');

            return `
                ${renderHeading('Solicitação de pagamento registrada')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Iniciamos o processamento da sua assinatura no <strong>Torex Journal</strong>. Confira abaixo os dados da transação gerada:
                </p>
                ${renderKeyValueTable([
                    ...(data.plan ? [{ label: 'Plano Selecionado', value: data.plan }] : []),
                    {
                        label: 'Valor Total',
                        value: formatCurrency(data.amount, currency),
                        mono: true,
                    },
                    { label: 'Método de Pagamento', value: (data.method || '').toUpperCase() },
                    { label: 'Referência da Transação', value: data.reference, mono: true },
                ])}
                ${renderCalloutBox(
                    'Autorize a cobrança diretamente na notificação enviada ao seu telemóvel (M-Pesa / e-Mola) ou no canal selecionado. Assim que liquidada, sua assinatura será ativada automaticamente.',
                    'amber',
                )}
                ${renderActionButton('Consultar Histórico de Pagamentos', paymentsUrl, 'slate')}
            `;
        },
    },

    CRYPTO_PAYMENT_INITIATED: {
        category: 'Pagamento Cripto',
        tone: 'amber',
        subject: (data) =>
            data.subject ||
            `Carteira e QR Code para pagamento em ${data.cryptoCurrency} (Ref. ${data.reference}) — Torex Journal`,
        preheader: (data) =>
            `Envie exatamente ${data.cryptoAmount} ${data.cryptoCurrency} na rede ${data.network}. QR Code e botão para copiar o endereço incluídos.`,
        buildInlineQr: (data) =>
            data.walletAddress
                ? {
                      cid: CRYPTO_QR_CID,
                      data: String(data.walletAddress).trim(),
                      filename: 'qrcode-pagamento-cripto.png',
                  }
                : undefined,
        renderBody: (data) => {
            const safeWallet = escapeHtml(data.walletAddress);
            const safeExtraId = data.payinExtraId ? escapeHtml(data.payinExtraId) : '';
            const safeCopyUrl = escapeHtml(buildAppUrl(data.copyWalletUrl));
            const safeCheckoutUrl = escapeHtml(buildAppUrl(data.checkoutUrl));
            const safeCryptoAmount = escapeHtml(String(data.cryptoAmount));
            const safeCryptoCurrency = escapeHtml(data.cryptoCurrency);
            const safeNetwork = escapeHtml(data.network);
            const expiryText = data.expiresAt
                ? (() => {
                      const d = new Date(data.expiresAt);
                      return Number.isNaN(d.getTime())
                          ? escapeHtml(String(data.expiresAt))
                          : d.toLocaleString('pt-PT', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZoneName: 'short',
                            });
                  })()
                : undefined;

            return `
                ${renderHeading(`Pagamento em ${data.displayName} iniciado`)}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Geramos o endereço exclusivo da carteira e o QR Code para concluir a ativação da sua assinatura no <strong>Torex Journal</strong>. Envie o valor exato indicado abaixo usando a rede correta:
                </p>
                ${renderKeyValueTable([
                    ...(data.plan ? [{ label: 'Plano Selecionado', value: data.plan }] : []),
                    ...(data.cycle ? [{ label: 'Ciclo de Faturamento', value: data.cycle }] : []),
                    {
                        label: 'Valor Equivalente',
                        value: formatCurrency(data.amountUsd, 'USD'),
                        mono: true,
                    },
                    {
                        label: 'Valor Exato a Enviar',
                        value: `${data.cryptoAmount} ${data.cryptoCurrency}`,
                        mono: true,
                        tone: 'warning',
                    },
                    { label: 'Criptomoeda', value: data.displayName },
                    { label: 'Rede (Network)', value: data.network, tone: 'positive' },
                    { label: 'Referência', value: data.reference, mono: true },
                    ...(expiryText ? [{ label: 'Validade da Cotação', value: expiryText, mono: true }] : []),
                ])}

                <!-- QR CODE & WALLET ID BOX -->
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin: 24px 0; background-color: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 8px; overflow: hidden;">
                    <tr>
                        <td align="center" style="padding: 24px 20px 18px 20px;">
                            <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.9px; text-transform: uppercase; color: #475569; margin-bottom: 14px;">
                                QR Code de Pagamento (${safeCryptoCurrency})
                            </div>
                            <div style="display: inline-block; padding: 12px; background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;">
                                <img src="cid:${CRYPTO_QR_CID}" alt="QR Code da Carteira ${safeCryptoCurrency}" width="200" height="200" style="display: block; width: 200px; height: 200px;" />
                            </div>
                            <div style="margin-top: 10px; font-size: 12px; color: #64748B;">
                                Escaneie com sua carteira ou corretora (${safeNetwork})
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 20px 22px 20px;">
                            <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #475569; margin-bottom: 8px; text-align: center;">
                                ID da Carteira de Pagamento (Endereço)
                            </div>
                            <div style="background-color: #FFFFFF; border: 1px dashed #94A3B8; border-radius: 6px; padding: 14px 16px; text-align: center; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 13px; font-weight: 700; color: #0F172A; word-break: break-all; -webkit-user-select: all; user-select: all;">
                                ${safeWallet}
                            </div>
                            ${
                                safeExtraId
                                    ? `
                                <div style="margin-top: 12px; background-color: #FFFBEB; border: 1px solid #FDE68A; border-radius: 6px; padding: 10px 14px; text-align: center;">
                                    <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #92400E; margin-bottom: 4px;">
                                        Memo / Destination Tag (Obrigatório)
                                    </div>
                                    <div style="font-family: 'SFMono-Regular', Consolas, monospace; font-size: 14px; font-weight: 700; color: #78350F; word-break: break-all; -webkit-user-select: all; user-select: all;">
                                        ${safeExtraId}
                                    </div>
                                </div>
                            `
                                    : ''
                            }
                            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top: 16px;">
                                <tr>
                                    <td align="center">
                                        <a href="${safeCopyUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 26px; background-color: #D97706; color: #FFFFFF; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 6px; letter-spacing: 0.2px;">
                                            Copiar ID da Carteira
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            <div style="margin-top: 8px; font-size: 11px; color: #64748B; text-align: center;">
                                Clique no botão acima para copiar o endereço verificado com 1 toque ou selecione o código acima.
                            </div>
                        </td>
                    </tr>
                </table>

                ${renderCalloutBox(
                    `ATENÇÃO DE SEGURANÇA: Envie exclusivamente ${data.cryptoAmount} ${data.cryptoCurrency} através da rede ${data.network}. Transferências feitas em outra rede ou abaixo do valor indicado podem não ser reconhecidas automaticamente. Assim que a transação for confirmada na blockchain, sua assinatura será ativada automaticamente.`,
                    'amber',
                    'Instrução Importante',
                )}

                <table cellpadding="0" cellspacing="0" role="presentation" style="margin: 20px 0 8px 0;">
                    <tr>
                        <td align="left" style="border-radius: 6px; background-color: #0F172A;">
                            <a href="${safeCheckoutUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 11px 22px; font-size: 13px; font-weight: 600; color: #FFFFFF; text-decoration: none; border-radius: 6px;">
                                Acompanhar Pagamento no Checkout
                            </a>
                        </td>
                    </tr>
                </table>
            `;
        },
    },

    PAYMENT_SUCCESS: {
        category: '',
        tone: 'emerald',
        subject: (data) =>
            data.subject ||
            `Confirmação de pagamento: plano ${data.plan || 'Profissional'} ativo — Torex Journal`,
        preheader: (data) =>
            `Pagamento confirmado. Sua assinatura ${data.plan || ''} está vigente até ${formatInstitutionalDate(data.expiryDate)}.`,
        renderBody: (data) => {
            const dashboardUrl = buildAppUrl('/dashboard');
            return `
                ${renderHeading('Pagamento confirmado com sucesso')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Confirmamos a liquidação do seu pagamento. Todos os recursos analíticos, sincronizações automáticas e ferramentas de gestão do seu plano encontram-se integralmente habilitados.
                </p>
                ${renderKeyValueTable([
                    { label: 'Plano Contratado', value: data.plan, tone: 'positive' },
                    ...(data.cycle ? [{ label: 'Ciclo de Faturamento', value: data.cycle }] : []),
                    ...(data.amount !== undefined
                        ? [
                              {
                                  label: 'Valor Liquidado',
                                  value: formatCurrency(data.amount, data.currency || 'MZN'),
                                  mono: true,
                              },
                          ]
                        : []),
                    ...(data.reference
                        ? [{ label: 'Referência', value: data.reference, mono: true }]
                        : []),
                    {
                        label: 'Vigência Atual',
                        value: formatInstitutionalDate(data.expiryDate),
                        mono: true,
                    },
                ])}
                ${renderActionButton('Acessar Painel', dashboardUrl, 'emerald')}
            `;
        },
    },

    PAYMENT_FAILED: {
        category: '',
        tone: 'crimson',
        subject: (data) =>
            data.subject ||
            `Não foi possível concluir seu pagamento (Ref. ${data.reference}) — Torex Journal`,
        preheader: (data) =>
            `A transação ${data.reference} não foi autorizada pela operadora. Nenhum valor indevido foi retido.`,
        renderBody: (data) => {
            const pricingUrl = buildAppUrl('/pricing');
            return `
                ${renderHeading('Pagamento não concluído')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    A operadora financeira não confirmou a conclusão da transação referente à sua assinatura no Torex Journal.
                </p>
                ${renderKeyValueTable([
                    ...(data.plan ? [{ label: 'Plano Solicitado', value: data.plan }] : []),
                    { label: 'Referência', value: data.reference, mono: true },
                    {
                        label: 'Diagnóstico Reportado',
                        value:
                            data.reason ||
                            'Transação expirada, cancelada no terminal móvel ou saldo insuficiente.',
                        tone: 'negative',
                    },
                ])}
                <p class="body-p">
                    Você pode iniciar uma nova tentativa a qualquer momento utilizando o mesmo método ou uma alternativa disponível na página de planos.
                </p>
                ${renderActionButton('Selecionar Método de Pagamento', pricingUrl, 'slate')}
            `;
        },
    },

    TRIAL_WELCOME: {
        category: '',
        tone: 'emerald',
        subject: (data) =>
            data.subject ||
            `Período de avaliação habilitado (${data.days || 14} dias) — Torex Journal`,
        preheader: (data) =>
            `Acesso completo liberado por ${data.days || 14} dias, válido até ${formatInstitutionalDate(data.expiryDate)}.`,
        renderBody: (data) => {
            const dashboardUrl = buildAppUrl('/dashboard', data.dashboardUrl);
            const planLabel = data.plan || 'Acesso Completo (Avaliação)';

            return `
                ${renderHeading(`${data.days} dias de acesso integral liberados`)}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Habilitamos um período de avaliação gratuita de <strong>${escapeHtml(String(data.days))} dias</strong> na sua conta para que você avalie os recursos institucionais do Torex Journal em condições reais de operação.
                </p>
                ${renderKeyValueTable([
                    { label: 'Modalidade', value: planLabel, tone: 'positive' },
                    { label: 'Duração Concedida', value: `${data.days} dias corridos` },
                    {
                        label: 'Válido Até',
                        value: formatInstitutionalDate(data.expiryDate),
                        mono: true,
                    },
                ])}
                ${renderStepList('Escopo Habilitado Durante a Avaliação', [
                    {
                        title: 'Sincronização Contínua',
                        description:
                            'Integração automática com terminais MetaTrader 5, contas Deriv e importação de relatórios.',
                    },
                    {
                        title: 'Análise Quantitativa & Backtesting',
                        description:
                            'Estatísticas detalhadas por ativo, sessão, setup e simulador de replay gráfico.',
                    },
                    {
                        title: 'Governança Comportamental',
                        description:
                            'Registro estruturado de diário, auditoria de disciplina e alertas de risco operacional.',
                    },
                ])}
                ${renderActionButton('Acessar Painel', dashboardUrl, 'emerald')}
            `;
        },
    },

    SUBSCRIPTION_EXPIRING: {
        category: '',
        tone: 'amber',
        subject: (data) =>
            data.subject ||
            `Aviso de vencimento: sua assinatura expira em ${data.daysRemaining} dia(s) — Torex Journal`,
        preheader: (data) =>
            `Seu plano ${data.plan} encerra o ciclo atual em ${formatInstitutionalDate(data.expiryDate)}.`,
        renderBody: (data) => {
            const renewalUrl = buildAppUrl(data.renewalUrl || '/pricing');
            return `
                ${renderHeading('Vigência da assinatura próxima do vencimento')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Informamos que o ciclo vigente da sua assinatura no Torex Journal aproxima-se da data de encerramento. Para manter a sincronização contínua de contas e o acesso ininterrupto aos relatórios, realize a renovação antes do término.
                </p>
                ${renderKeyValueTable([
                    { label: 'Plano Atual', value: data.plan },
                    {
                        label: 'Prazo Restante',
                        value: `${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}`,
                        tone: 'warning',
                    },
                    {
                        label: 'Data de Vencimento',
                        value: formatInstitutionalDate(data.expiryDate),
                        mono: true,
                    },
                ])}
                ${renderActionButton('Renovar Assinatura', renewalUrl, 'slate')}
            `;
        },
    },

    SUBSCRIPTION_EXPIRED: {
        category: '',
        tone: 'amber',
        subject: (data) =>
            data.subject || `Vigência encerrada: assinatura ${data.plan || ''} — Torex Journal`,
        preheader: () =>
            'Sua assinatura expirou. Todo o seu histórico operacional permanece preservado para reativação.',
        renderBody: (data) => {
            const renewalUrl = buildAppUrl(data.renewalUrl || '/pricing');
            return `
                ${renderHeading('Encerramento do ciclo da assinatura')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    O período contratado para o plano <strong>${escapeHtml(data.plan || 'Profissional')}</strong> chegou ao fim e os recursos exclusivos de assinantes foram pausados.
                </p>
                ${renderKeyValueTable([
                    { label: 'Plano Encerrado', value: data.plan || 'Profissional' },
                    ...(data.expiredAt
                        ? [
                              {
                                  label: 'Data de Encerramento',
                                  value: formatInstitutionalDate(data.expiredAt),
                                  mono: true,
                              },
                          ]
                        : []),
                    { label: 'Integridade de Dados', value: 'Histórico preservado integralmente', tone: 'positive' },
                ])}
                ${renderCalloutBox(
                    'Todas as suas operações registradas, anotações de diário, estratégias e estatísticas históricas permanecem armazenadas com segurança e serão restabelecidas imediatamente após a renovação.',
                    'slate',
                )}
                ${renderActionButton('Reativar Assinatura', renewalUrl, 'slate')}
            `;
        },
    },

    SUBSCRIPTION_CANCELLED: {
        category: '',
        tone: 'slate',
        subject: (data) =>
            data.subject || 'Confirmação de cancelamento de assinatura — Torex Journal',
        preheader: (data) =>
            `Cancelamento registrado para o plano ${data.plan || 'atual'}.`,
        renderBody: (data) => {
            const paymentsUrl = buildAppUrl('/payments');
            return `
                ${renderHeading('Confirmação de cancelamento de assinatura')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Confirmamos o processamento do cancelamento da sua assinatura no Torex Journal. Nenhuma nova cobrança recorrente será gerada.
                </p>
                ${renderKeyValueTable([
                    { label: 'Plano', value: data.plan || 'Assinatura Torex Journal' },
                    {
                        label: 'Data Efetiva',
                        value: formatInstitutionalDate(data.effectiveDate || new Date()),
                        mono: true,
                    },
                    ...(data.reason ? [{ label: 'Observação', value: data.reason }] : []),
                ])}
                <p class="body-p">
                    Seu histórico operacional permanece arquivado na sua conta caso deseje retomar suas análises futuramente.
                </p>
                ${renderActionButton('Consultar Detalhes da Conta', paymentsUrl, 'slate')}
            `;
        },
    },

    REMARKETING_FOLLOWUP: {
        category: '',
        tone: 'slate',
        subject: (data) =>
            data.subject || 'Conclusão de assinatura pendente — Torex Journal',
        preheader: () =>
            'Sua solicitação de plano permanece disponível para conclusão no painel de assinaturas.',
        renderBody: (data) => {
            const pricingUrl = buildAppUrl(data.pricingUrl || '/pricing');
            return `
                ${renderHeading('Ativação de plano pendente')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Identificamos uma solicitação de assinatura iniciada recentemente na sua conta${
                        data.plan ? ` para o plano <strong>${escapeHtml(data.plan)}</strong>` : ''
                    } cuja confirmação financeira não foi concluída.
                </p>
                <p class="body-p">
                    Caso tenha ocorrido instabilidade na operadora móvel ou deseje utilizar outro método de pagamento (M-Pesa, e-Mola, Cartão ou Criptomoeda), você pode retomar a contratação diretamente no painel.
                </p>
                ${renderActionButton('Visualizar Planos Disponíveis', pricingUrl, 'slate')}
                <p class="muted-note">
                    Caso já tenha regularizado sua assinatura ou optado por não prosseguir neste momento, desconsidere este lembrete.
                </p>
            `;
        },
    },
};
