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
    renderStatusEyebrow,
    renderStepList,
} from './layout';
import { EmailTemplateDefinition, EmailTemplatePayloadMap } from './types';
import { buildAppUrl, escapeHtml, formatCurrency, formatInstitutionalDate } from './utils';

export const billingTemplates: {
    [K in
        | 'PAYMENT_INITIATED'
        | 'PAYMENT_SUCCESS'
        | 'PAYMENT_FAILED'
        | 'TRIAL_WELCOME'
        | 'SUBSCRIPTION_EXPIRING'
        | 'SUBSCRIPTION_EXPIRED'
        | 'SUBSCRIPTION_CANCELLED'
        | 'REMARKETING_FOLLOWUP']: EmailTemplateDefinition<EmailTemplatePayloadMap[K]>;
} = {
    PAYMENT_INITIATED: {
        category: 'Faturamento',
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
                ${renderStatusEyebrow('Aguardando Confirmação', 'amber')}
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
                    'Autorize a cobrança diretamente na notificação enviada ao seu telemóvel (M-Pesa / e-Mola). Assim que liquidada pela operadora, sua assinatura será ativada automaticamente.',
                    'amber',
                )}
                ${renderActionButton('Consultar Histórico de Pagamentos', paymentsUrl, 'slate')}
            `;
        },
    },

    PAYMENT_SUCCESS: {
        category: 'Faturamento',
        tone: 'emerald',
        subject: (data) =>
            data.subject ||
            `Confirmação de pagamento: plano ${data.plan || 'Profissional'} ativo — Torex Journal`,
        preheader: (data) =>
            `Pagamento confirmado. Sua assinatura ${data.plan || ''} está vigente até ${formatInstitutionalDate(data.expiryDate)}.`,
        renderBody: (data) => {
            const dashboardUrl = buildAppUrl('/dashboard');
            return `
                ${renderStatusEyebrow('Assinatura Ativa', 'emerald')}
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
        category: 'Faturamento',
        tone: 'crimson',
        subject: (data) =>
            data.subject ||
            `Não foi possível concluir seu pagamento (Ref. ${data.reference}) — Torex Journal`,
        preheader: (data) =>
            `A transação ${data.reference} não foi autorizada pela operadora. Nenhum valor indevido foi retido.`,
        renderBody: (data) => {
            const pricingUrl = buildAppUrl('/pricing');
            return `
                ${renderStatusEyebrow('Falha na Liquidação', 'crimson')}
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
        category: 'Assinatura',
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
                ${renderStatusEyebrow('Período de Avaliação Ativo', 'emerald')}
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
        category: 'Faturamento',
        tone: 'amber',
        subject: (data) =>
            data.subject ||
            `Aviso de vencimento: sua assinatura expira em ${data.daysRemaining} dia(s) — Torex Journal`,
        preheader: (data) =>
            `Seu plano ${data.plan} encerra o ciclo atual em ${formatInstitutionalDate(data.expiryDate)}.`,
        renderBody: (data) => {
            const renewalUrl = buildAppUrl(data.renewalUrl || '/pricing');
            return `
                ${renderStatusEyebrow('Renovação Programada', 'amber')}
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
        category: 'Faturamento',
        tone: 'amber',
        subject: (data) =>
            data.subject || `Vigência encerrada: assinatura ${data.plan || ''} — Torex Journal`,
        preheader: () =>
            'Sua assinatura expirou. Todo o seu histórico operacional permanece preservado para reativação.',
        renderBody: (data) => {
            const renewalUrl = buildAppUrl(data.renewalUrl || '/pricing');
            return `
                ${renderStatusEyebrow('Assinatura Expirada', 'amber')}
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
        category: 'Faturamento',
        tone: 'slate',
        subject: (data) =>
            data.subject || 'Confirmação de cancelamento de assinatura — Torex Journal',
        preheader: (data) =>
            `Cancelamento registrado para o plano ${data.plan || 'atual'}.`,
        renderBody: (data) => {
            const paymentsUrl = buildAppUrl('/payments');
            return `
                ${renderStatusEyebrow('Cancelamento Registrado', 'slate')}
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
        category: 'Assinatura',
        tone: 'slate',
        subject: (data) =>
            data.subject || 'Conclusão de assinatura pendente — Torex Journal',
        preheader: () =>
            'Sua solicitação de plano permanece disponível para conclusão no painel de assinaturas.',
        renderBody: (data) => {
            const pricingUrl = buildAppUrl(data.pricingUrl || '/pricing');
            return `
                ${renderStatusEyebrow('Solicitação em Aberto', 'slate')}
                ${renderHeading('Ativação de plano pendente')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Identificamos uma solicitação de assinatura iniciada recentemente na sua conta${
                        data.plan ? ` para o plano <strong>${escapeHtml(data.plan)}</strong>` : ''
                    } cuja confirmação financeira não foi concluída.
                </p>
                <p class="body-p">
                    Caso tenha ocorrido instabilidade na operadora móvel ou deseje utilizar outro método de pagamento (M-Pesa, e-Mola ou Cartão), você pode retomar a contratação diretamente no painel.
                </p>
                ${renderActionButton('Visualizar Planos Disponíveis', pricingUrl, 'slate')}
                <p class="muted-note">
                    Caso já tenha regularizado sua assinatura ou optado por não prosseguir neste momento, desconsidere este lembrete.
                </p>
            `;
        },
    },
};
