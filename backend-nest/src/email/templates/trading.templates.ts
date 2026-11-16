/**
 * Institutional Trading, Connectivity & Reporting Email Templates
 * Covers: MT5_STATUS, TRADE_IMPORTED, WEEKLY_SUMMARY
 */

import {
    renderActionButton,
    renderCalloutBox,
    renderGreeting,
    renderHeading,
    renderKeyValueTable,
    renderMetricStrip,
    renderStatusEyebrow,
} from './layout';
import { EmailAccentTone, EmailTemplateDefinition, EmailTemplatePayloadMap } from './types';
import { buildAppUrl, escapeHtml, formatCurrency, formatInstitutionalDate } from './utils';

export const tradingTemplates: {
    [K in 'MT5_STATUS' | 'TRADE_IMPORTED' | 'WEEKLY_SUMMARY']: EmailTemplateDefinition<
        EmailTemplatePayloadMap[K]
    >;
} = {
    MT5_STATUS: {
        category: 'Conectividade',
        tone: (data): EmailAccentTone => {
            if (data.status === 'CONNECTED') return 'emerald';
            if (data.status === 'AUTH_FAILED') return 'crimson';
            return 'amber';
        },
        subject: (data) => {
            if (data.subject) return data.subject;
            if (data.status === 'CONNECTED') {
                return `Conexão estabelecida: conta MT5 ${data.mt5Id || ''} — Torex Journal`;
            }
            if (data.status === 'AUTH_FAILED') {
                return `Falha de autenticação na conta MT5 ${data.mt5Id || ''} — Torex Journal`;
            }
            return `Sincronização interrompida: conta MT5 ${data.mt5Id || ''} — Torex Journal`;
        },
        preheader: (data) => {
            if (data.status === 'CONNECTED') {
                return `A sincronização automática da conta MT5 ${data.mt5Id || ''} encontra-se operacional.`;
            }
            if (data.status === 'AUTH_FAILED') {
                return `Credenciais recusadas pelo servidor na conta MT5 ${data.mt5Id || ''}. Atualize sua senha de investidor.`;
            }
            return `Sem comunicação recente com a conta MT5 ${data.mt5Id || ''}. Verifique sua conexão.`;
        },
        renderBody: (data) => {
            const syncUrl = buildAppUrl('/add-trades/mt5-sync');

            if (data.status === 'CONNECTED') {
                return `
                    ${renderStatusEyebrow('Terminal Conectado', 'emerald')}
                    ${renderHeading('Sincronização MetaTrader 5 ativa')}
                    ${renderGreeting(data.userName)}
                    <p class="body-p">
                        A comunicação com sua conta MetaTrader 5 foi estabelecida com sucesso. Suas operações encerradas e métricas de conta passam a ser sincronizadas automaticamente com o painel.
                    </p>
                    ${renderKeyValueTable([
                        { label: 'Conta MT5', value: data.mt5Id, mono: true },
                        ...(data.broker ? [{ label: 'Corretora', value: data.broker }] : []),
                        ...(data.server ? [{ label: 'Servidor', value: data.server, mono: true }] : []),
                        { label: 'Estado Operacional', value: 'CONECTADO', tone: 'positive' },
                    ])}
                    ${renderActionButton('Gerenciar Conexões MT5', syncUrl, 'emerald')}
                `;
            }

            if (data.status === 'AUTH_FAILED') {
                return `
                    ${renderStatusEyebrow('Erro de Credenciais', 'crimson')}
                    ${renderHeading('Falha de autenticação na conta MetaTrader 5')}
                    ${renderGreeting(data.userName)}
                    <p class="body-p">
                        O servidor da corretora recusou a autenticação da sua conta MetaTrader 5. A sincronização automática foi pausada até que as credenciais sejam atualizadas.
                    </p>
                    ${renderKeyValueTable([
                        { label: 'Conta MT5', value: data.mt5Id, mono: true },
                        ...(data.server ? [{ label: 'Servidor', value: data.server, mono: true }] : []),
                        { label: 'Estado Operacional', value: 'AUTENTICAÇÃO RECUSADA', tone: 'negative' },
                        ...(data.reason ? [{ label: 'Detalhe Técnico', value: data.reason }] : []),
                    ])}
                    ${renderCalloutBox(
                        'Verifique se o número da conta, o servidor da corretora e a senha de investidor (somente leitura) estão atualizados na central de sincronização.',
                        'crimson',
                    )}
                    ${renderActionButton('Atualizar Credenciais MT5', syncUrl, 'crimson')}
                `;
            }

            return `
                ${renderStatusEyebrow('Comunicação Interrompida', 'amber')}
                ${renderHeading('Ausência prolongada de sinal na conta MT5')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Identificamos ausência prolongada de comunicação com a sua conta MetaTrader 5. Caso utilize sincronização via Expert Advisor (EA), certifique-se de que o terminal esteja aberto e com negociação automatizada/WebRequest habilitados.
                </p>
                ${renderKeyValueTable([
                    { label: 'Conta MT5', value: data.mt5Id, mono: true },
                    ...(data.broker ? [{ label: 'Corretora', value: data.broker }] : []),
                    ...(data.server ? [{ label: 'Servidor', value: data.server, mono: true }] : []),
                    { label: 'Estado Operacional', value: 'AGUARDANDO SINAL', tone: 'warning' },
                ])}
                ${renderActionButton('Verificar Status de Sincronização', syncUrl, 'slate')}
            `;
        },
    },

    TRADE_IMPORTED: {
        category: 'Operações',
        tone: 'emerald',
        subject: (data) =>
            data.subject ||
            `Importação concluída: ${data.count || 0} operações processadas — Torex Journal`,
        preheader: (data) =>
            `${data.count || 0} operações foram auditadas e incorporadas ao seu histórico operacional.`,
        renderBody: (data) => {
            const tradesUrl = buildAppUrl('/trades');
            const currency = data.currency || 'USD';
            const hasProfit = typeof data.profit === 'number' && !Number.isNaN(data.profit);
            const hasWinLoss =
                typeof data.wins === 'number' && typeof data.losses === 'number';

            const methodLabels: Record<string, string> = {
                FILE: 'Arquivo de Relatório',
                EA: 'Expert Advisor (MT5)',
                AUTO_SYNC: 'Sincronização em Nuvem',
                MANUAL: 'Registro Manual',
            };
            const cleanMethod = methodLabels[data.method] || data.method || 'Importação';

            return `
                ${renderStatusEyebrow('Processamento Concluído', 'emerald')}
                ${renderHeading('Histórico de operações atualizado')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    O processamento da sua importação foi concluído e os registros já estão disponíveis para auditoria estatística no seu histórico.
                </p>
                ${renderKeyValueTable([
                    ...(data.accountName
                        ? [{ label: 'Conta de Destino', value: data.accountName }]
                        : []),
                    { label: 'Operações Processadas', value: `${data.count || 0}`, mono: true },
                    { label: 'Origem dos Dados', value: cleanMethod },
                    ...(hasWinLoss
                        ? [
                              {
                                  label: 'Ganhos / Perdas',
                                  value: `${data.wins}W / ${data.losses}L`,
                                  mono: true,
                              },
                          ]
                        : []),
                    ...(hasProfit
                        ? [
                              {
                                  label: 'Resultado Líquido do Lote',
                                  value: formatCurrency(data.profit!, currency, {
                                      showPlusSign: true,
                                  }),
                                  mono: true,
                                  tone: (data.profit! >= 0 ? 'positive' : 'negative') as
                                      | 'positive'
                                      | 'negative',
                              },
                          ]
                        : []),
                ])}
                ${renderActionButton('Inspecionar Operações', tradesUrl, 'slate')}
            `;
        },
    },

    WEEKLY_SUMMARY: {
        category: 'Relatório Semanal',
        tone: 'slate',
        subject: (data) =>
            data.subject ||
            `Relatório semanal de performance (${formatInstitutionalDate(data.period?.start)} a ${formatInstitutionalDate(data.period?.end)}) — Torex Journal`,
        preheader: (data) =>
            `Resumo da semana: ${data.totalTrades} operações, ${Number(data.winRate || 0).toFixed(1)}% de acerto e resultado de ${formatCurrency(data.totalPnL || 0, data.currency || 'USD', { showPlusSign: true })}.`,
        renderBody: (data) => {
            const reportsUrl = buildAppUrl('/reports');
            const currency = data.currency || 'USD';
            const pnl = Number(data.totalPnL || 0);
            const winRate = Number(data.winRate || 0);
            const startStr = formatInstitutionalDate(data.period?.start);
            const endStr = formatInstitutionalDate(data.period?.end);

            const lessonsHtml =
                data.topLessons && data.topLessons.length > 0
                    ? `
                    <div style="margin: 22px 0; padding: 16px 18px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;">
                        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #475569; margin-bottom: 10px;">
                            Observações Recorrentes no Diário
                        </div>
                        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                            ${data.topLessons
                                .slice(0, 5)
                                .map((item, idx) => {
                                    const borderTop =
                                        idx > 0 ? 'border-top: 1px solid #E2E8F0;' : '';
                                    return `
                                        <tr>
                                            <td style="padding: 8px 10px 8px 0; ${borderTop} width: 38px; vertical-align: top; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; font-weight: 700; color: #0F172A;">
                                                ${escapeHtml(String(item.count))}x
                                            </td>
                                            <td style="padding: 8px 0; ${borderTop} font-size: 13px; line-height: 1.5; color: #334155;">
                                                ${escapeHtml(item.lesson)}
                                            </td>
                                        </tr>
                                    `;
                                })
                                .join('')}
                        </table>
                    </div>
                `
                    : '';

            return `
                ${renderStatusEyebrow(`Período: ${startStr} — ${endStr}`, 'slate')}
                ${renderHeading('Consolidado semanal de performance')}
                ${renderGreeting(data.userName)}
                <p class="body-p">
                    Apresentamos a síntese quantitativa das operações encerradas na sua conta entre <strong>${escapeHtml(startStr)}</strong> e <strong>${escapeHtml(endStr)}</strong>:
                </p>
                ${renderMetricStrip([
                    {
                        label: 'Resultado Líquido',
                        value: formatCurrency(pnl, currency, { showPlusSign: true }),
                        tone: pnl >= 0 ? 'positive' : 'negative',
                    },
                    {
                        label: 'Taxa de Acerto',
                        value: `${winRate.toFixed(1)}%`,
                    },
                    {
                        label: 'Operações',
                        value: String(data.totalTrades || 0),
                    },
                ])}
                ${lessonsHtml}
                <p class="body-p">
                    Revise a distribuição completa por ativo, expectativa matemática e aderência ao plano operacional na seção de relatórios.
                </p>
                ${renderActionButton('Abrir Relatório Completo', reportsUrl, 'slate')}
            `;
        },
    },
};
