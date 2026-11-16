/**
 * Institutional Governance, Risk Alerts & System Communication Templates
 * Covers: SYSTEM_ALERT, GENERAL_NOTIFICATION
 */

import {
    renderActionButton,
    renderCalloutBox,
    renderGreeting,
    renderHeading,
    renderKeyValueTable,
    renderStatusEyebrow,
} from './layout';
import { EmailAccentTone, EmailTemplateDefinition, EmailTemplatePayloadMap } from './types';
import { buildAppUrl, renderCleanParagraphs } from './utils';

function resolveAlertCategory(rawType?: string): {
    eyebrow: string;
    category: string;
    tone: EmailAccentTone;
} {
    const normalized = (rawType || '').toLowerCase();

    if (normalized.includes('risk') || normalized.includes('drawdown') || normalized.includes('loss')) {
        return {
            eyebrow: 'Controle de Risco',
            category: 'Governança de Risco',
            tone: 'crimson',
        };
    }
    if (normalized.includes('discipline') || normalized.includes('rule') || normalized.includes('warning')) {
        return {
            eyebrow: 'Aderência Operacional',
            category: 'Disciplina Operacional',
            tone: 'amber',
        };
    }
    if (normalized.includes('psychology') || normalized.includes('mental') || normalized.includes('insight')) {
        return {
            eyebrow: 'Análise Comportamental',
            category: 'Gestão Comportamental',
            tone: 'blue',
        };
    }
    if (normalized.includes('performance') || normalized.includes('coaching') || normalized.includes('success')) {
        return {
            eyebrow: 'Indicador de Performance',
            category: 'Performance',
            tone: 'emerald',
        };
    }
    return {
        eyebrow: 'Notificação Operacional',
        category: 'Monitoramento',
        tone: 'slate',
    };
}

export const systemTemplates: {
    [K in 'SYSTEM_ALERT' | 'GENERAL_NOTIFICATION']: EmailTemplateDefinition<
        EmailTemplatePayloadMap[K]
    >;
} = {
    SYSTEM_ALERT: {
        category: 'Monitoramento',
        tone: (data) => resolveAlertCategory(data.type).tone,
        subject: (data) =>
            data.subject ||
            `${data.title || 'Alerta Operacional'} — Torex Journal`,
        preheader: (data) =>
            (data.message || data.title || 'Atualização registrada no monitoramento da sua conta.')
                .replace(/\s+/g, ' ')
                .slice(0, 140),
        renderBody: (data) => {
            const meta = resolveAlertCategory(data.type);
            const targetUrl = buildAppUrl(data.actionUrl || '/dashboard');
            const buttonLabel = data.actionLabel || 'Verificar no Painel';

            return `
                ${renderStatusEyebrow(meta.eyebrow, meta.tone)}
                ${renderHeading(data.title || 'Alerta de monitoramento operacional')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    O motor de monitoramento do Torex Journal registrou um evento relevante com base nos parâmetros configurados na sua conta:
                </p>
                ${renderCalloutBox(data.message || '', meta.tone)}
                ${renderActionButton(buttonLabel, targetUrl, meta.tone)}
            `;
        },
    },

    GENERAL_NOTIFICATION: {
        category: 'Comunicado',
        tone: 'slate',
        subject: (data) =>
            data.subject || `${data.title || 'Comunicado Institucional'} — Torex Journal`,
        preheader: (data) =>
            (data.message || data.title || 'Comunicado oficial do Torex Journal.')
                .replace(/[*👉👈]/g, '')
                .replace(/\s+/g, ' ')
                .slice(0, 140),
        footerNote: (data) => data.footerText,
        renderBody: (data) => {
            const eyebrow = data.subtitle || 'Comunicado Institucional';
            const buttonUrl = data.buttonUrl ? buildAppUrl(data.buttonUrl) : undefined;

            return `
                ${renderStatusEyebrow(eyebrow, 'slate')}
                ${renderHeading(data.title || 'Comunicado Institucional')}
                ${renderGreeting(data.userName)}
                ${renderCleanParagraphs(data.message || '')}
                ${
                    data.metadata && data.metadata.length > 0
                        ? renderKeyValueTable(
                              data.metadata.map((m) => ({
                                  label: m.label,
                                  value: m.value,
                                  mono: m.mono,
                              })),
                          )
                        : ''
                }
                ${
                    buttonUrl
                        ? renderActionButton(
                              data.buttonLabel || 'Acessar Painel',
                              buttonUrl,
                              'slate',
                          )
                        : ''
                }
            `;
        },
    },
};
