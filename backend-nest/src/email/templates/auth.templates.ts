/**
 * Institutional Auth & Security Email Templates
 * Covers: OTP_CODE, WELCOME_EMAIL, LOGIN_ALERT, PASSWORD_RECOVERY, ACCOUNT_LOCKED
 */

import {
    renderActionButton,
    renderCalloutBox,
    renderGreeting,
    renderHeading,
    renderKeyValueTable,
    renderStatusEyebrow,
    renderStepList,
    renderUrlFallback,
    renderVerificationCodeBox,
} from './layout';
import { EmailTemplateDefinition, EmailTemplatePayloadMap } from './types';
import { buildAppUrl, escapeHtml, sanitizeUserAgent } from './utils';

const PURPOSE_LABELS: Record<string, { eyebrow: string; context: string }> = {
    REGISTRATION: {
        eyebrow: 'Confirmação de Cadastro',
        context: 'concluir a validação do seu endereço de e-mail',
    },
    TWO_FACTOR: {
        eyebrow: 'Autenticação em Dois Fatores',
        context: 'autorizar o acesso em duas etapas à sua conta',
    },
    ADMIN_LOGIN: {
        eyebrow: 'Acesso Administrativo',
        context: 'autenticar sua sessão administrativa',
    },
    VERIFICATION: {
        eyebrow: 'Verificação de Identidade',
        context: 'confirmar a operação solicitada na sua conta',
    },
};

export const authTemplates: {
    [K in
        | 'OTP_CODE'
        | 'WELCOME_EMAIL'
        | 'LOGIN_ALERT'
        | 'PASSWORD_RECOVERY'
        | 'ACCOUNT_LOCKED']: EmailTemplateDefinition<EmailTemplatePayloadMap[K]>;
} = {
    OTP_CODE: {
        category: 'Segurança',
        tone: 'slate',
        subject: (data) =>
            data.subject || `Código de verificação: ${data?.otp || ''} — Torex Journal`,
        preheader: (data) =>
            `Seu código de segurança Torex Journal é ${data?.otp || ''}. Válido por ${data?.expiresInMinutes || 10} minutos.`,
        renderBody: (data) => {
            const meta = PURPOSE_LABELS[data.purpose || 'VERIFICATION'] || PURPOSE_LABELS.VERIFICATION;
            const ttl = data.expiresInMinutes ?? 10;

            return `
                ${renderStatusEyebrow(meta.eyebrow, 'slate')}
                ${renderHeading('Código de verificação de segurança')}
                ${data.userName ? renderGreeting(data.userName) : ''}
                <p class="body-p">
                    Utilize o código numérico abaixo para ${escapeHtml(meta.context)} no <strong>Torex Journal</strong>.
                </p>
                ${renderVerificationCodeBox(data.otp, `Válido por ${ttl} minutos • Uso único`)}
                ${renderCalloutBox(
                    'Este código é confidencial e intransferível. A equipe Torex Journal nunca solicita códigos de verificação por telefone, e-mail ou aplicativos de mensagens.',
                    'slate',
                )}
                <p class="muted-note">
                    Caso não tenha originado esta solicitação, desconsidere esta mensagem. Nenhuma alteração foi efetuada na sua conta.
                </p>
            `;
        },
    },

    WELCOME_EMAIL: {
        category: 'Institucional',
        tone: 'emerald',
        subject: (data) =>
            data.subject || 'Conta ativada — Bem-vindo ao Torex Journal',
        preheader: () =>
            'Sua conta no Torex Journal está ativa. Configure a sincronização de operações e inicie sua auditoria de performance.',
        renderBody: (data) => {
            const dashboardUrl = buildAppUrl('/dashboard', data.dashboardUrl);
            return `
                ${renderStatusEyebrow('Cadastro Concluído', 'emerald')}
                ${renderHeading('Sua conta no Torex Journal está ativa')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Seu ambiente de análise quantitativa e governança operacional foi provisionado com sucesso. O Torex Journal centraliza o histórico das suas operações, métricas de risco e registros comportamentais em um único painel auditável.
                </p>
                ${renderStepList('Configuração Inicial Recomendada', [
                    {
                        title: 'Vincular conta de negociação',
                        description:
                            'Conecte seu terminal MetaTrader 5, conta Deriv ou realize a importação de histórico em Adicionar Trades.',
                    },
                    {
                        title: 'Definir parâmetros de risco',
                        description:
                            'Estabeleça limites diários de perda e critérios técnicos do seu plano operacional.',
                    },
                    {
                        title: 'Acompanhar indicadores objetivos',
                        description:
                            'Monitore fator de lucro, expectativa matemática, drawdown e consistência diretamente no Painel.',
                    },
                ])}
                ${renderActionButton('Acessar Painel Operacional', dashboardUrl, 'emerald')}
            `;
        },
    },

    LOGIN_ALERT: {
        category: 'Segurança',
        tone: 'amber',
        subject: (data) =>
            data.subject || 'Aviso de segurança: novo acesso registrado — Torex Journal',
        preheader: (data) =>
            `Novo acesso detectado em ${data.time || 'horário recente'} a partir do IP ${data.ip || 'desconhecido'}.`,
        renderBody: (data) => {
            const securityUrl = buildAppUrl('/configuration');
            return `
                ${renderStatusEyebrow('Monitoramento de Acesso', 'amber')}
                ${renderHeading('Novo início de sessão identificado')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Registramos uma nova autenticação na sua conta Torex Journal com os seguintes parâmetros técnicos:
                </p>
                ${renderKeyValueTable([
                    { label: 'Data e Hora', value: data.time || new Date().toLocaleString('pt-PT') },
                    { label: 'Dispositivo / Cliente', value: sanitizeUserAgent(data.device) },
                    { label: 'Endereço IP', value: data.ip || 'Não identificado', mono: true },
                ])}
                <p class="body-p">
                    Se este acesso foi realizado por você, nenhuma ação adicional é necessária. Caso desconheça esta atividade, altere sua senha imediatamente e revise a autenticação em dois fatores.
                </p>
                ${renderActionButton('Revisar Segurança da Conta', securityUrl, 'slate')}
            `;
        },
    },

    PASSWORD_RECOVERY: {
        category: 'Segurança',
        tone: 'slate',
        subject: (data) =>
            data.subject || 'Instruções para redefinição de senha — Torex Journal',
        preheader: (data) =>
            `Código de recuperação ${data.code}. Válido por ${data.expiresInMinutes ?? 15} minutos.`,
        renderBody: (data) => {
            const ttl = data.expiresInMinutes ?? 15;
            const resetUrl = buildAppUrl(data.resetUrl || '/forgot-password');

            return `
                ${renderStatusEyebrow('Recuperação de Credenciais', 'slate')}
                ${renderHeading('Solicitação de redefinição de senha')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Recebemos um pedido para redefinir a senha associada ao seu cadastro. Utilize o código de verificação abaixo ou acesse diretamente o formulário autenticado de redefinição:
                </p>
                ${renderVerificationCodeBox(data.code, `Expira em ${ttl} minutos`)}
                ${renderActionButton('Redefinir Senha Agora', resetUrl, 'slate')}
                ${renderUrlFallback(resetUrl)}
                <p class="muted-note">
                    Se você não solicitou a alteração de senha, ignore este comunicado. Suas credenciais atuais permanecem protegidas e inalteradas.
                </p>
            `;
        },
    },

    ACCOUNT_LOCKED: {
        category: 'Segurança Crítica',
        tone: 'crimson',
        subject: (data) =>
            data.subject || 'Alerta de segurança: acesso temporariamente bloqueado — Torex Journal',
        preheader: () =>
            'Bloqueio preventivo acionado após múltiplas tentativas de autenticação inválidas.',
        renderBody: (data) => {
            const attempts = data.failedAttempts ?? 9;
            const ttl = data.expiresInMinutes ?? 15;
            const unlockUrl = buildAppUrl(data.unlockUrl || '/forgot-password');

            return `
                ${renderStatusEyebrow('Bloqueio Preventivo', 'crimson')}
                ${renderHeading('Acesso suspenso preventivamente por segurança')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Identificamos <strong>${attempts} tentativas consecutivas</strong> de autenticação sem sucesso na sua conta. Por medida de proteção institucional, o início de sessão por senha foi temporariamente suspenso.
                </p>
                <p class="body-p">
                    Para restabelecer o acesso imediatamente e cadastrar uma nova senha segura, utilize o código de desbloqueio abaixo:
                </p>
                ${renderVerificationCodeBox(data.code, `Código de reativação válido por ${ttl} minutos`)}
                ${renderActionButton('Reativar Acesso e Alterar Senha', unlockUrl, 'crimson')}
                ${renderUrlFallback(unlockUrl)}
            `;
        },
    },
};
