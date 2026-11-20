/**
 * Institutional Email Layout & Composable UI Primitives
 * Aesthetic: Minimalist FinTech / Architectural Slate (Zero Visual Clutter)
 */

import { EmailAccentTone } from './types';
import { buildAppUrl, escapeHtml } from './utils';

export const TOREX_LOGO_URL =
    'https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg';

const ACCENT_COLORS: Record<
    EmailAccentTone,
    { bar: string; badgeBg: string; badgeText: string; badgeBorder: string; buttonBg: string }
> = {
    slate: {
        bar: '#0F172A',
        badgeBg: '#F1F5F9',
        badgeText: '#334155',
        badgeBorder: '#CBD5E1',
        buttonBg: '#0F172A',
    },
    emerald: {
        bar: '#059669',
        badgeBg: '#ECFDF5',
        badgeText: '#065F46',
        badgeBorder: '#A7F3D0',
        buttonBg: '#0F172A',
    },
    amber: {
        bar: '#D97706',
        badgeBg: '#FFFBEB',
        badgeText: '#92400E',
        badgeBorder: '#FDE68A',
        buttonBg: '#0F172A',
    },
    crimson: {
        bar: '#DC2626',
        badgeBg: '#FEF2F2',
        badgeText: '#991B1B',
        badgeBorder: '#FECACA',
        buttonBg: '#DC2626',
    },
    blue: {
        bar: '#2563EB',
        badgeBg: '#EFF6FF',
        badgeText: '#1E40AF',
        badgeBorder: '#BFDBFE',
        buttonBg: '#0F172A',
    },
};

export interface InstitutionalLayoutOptions {
    category: string;
    preheader?: string;
    tone?: EmailAccentTone;
    contentHtml: string;
    footerNote?: string;
}

export function renderStatusEyebrow(label: string, tone: EmailAccentTone = 'slate'): string {
    const palette = ACCENT_COLORS[tone] || ACCENT_COLORS.slate;
    return `
        <div style="margin: 0 0 14px 0;">
            <span style="display: inline-block; padding: 3px 10px; background-color: ${palette.badgeBg}; color: ${palette.badgeText}; border: 1px solid ${palette.badgeBorder}; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;">
                ${escapeHtml(label)}
            </span>
        </div>
    `;
}

export function renderHeading(title: string): string {
    return `<h1 class="h1-title">${escapeHtml(title)}</h1>`;
}

export function renderGreeting(userName?: string): string {
    const cleanName = userName ? escapeHtml(userName.trim()) : '';
    return cleanName
        ? `<p class="body-p">Prezado(a) <strong>${cleanName}</strong>,</p>`
        : `<p class="body-p">Prezado(a) cliente,</p>`;
}

export interface KeyValueRow {
    label: string;
    value: string;
    mono?: boolean;
    tone?: 'default' | 'positive' | 'negative' | 'warning' | 'muted';
}

export function renderKeyValueTable(rows: KeyValueRow[]): string {
    const validRows = rows.filter((r) => r.value !== undefined && r.value !== null && r.value !== '');
    if (validRows.length === 0) return '';

    const valueColor = (tone?: KeyValueRow['tone']) => {
        switch (tone) {
            case 'positive':
                return '#047857';
            case 'negative':
                return '#B91C1C';
            case 'warning':
                return '#B45309';
            case 'muted':
                return '#64748B';
            default:
                return '#0F172A';
        }
    };

    const renderedRows = validRows
        .map((row, idx) => {
            const borderTop = idx > 0 ? 'border-top: 1px solid #E2E8F0;' : '';
            const fontFamily = row.mono
                ? "font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;"
                : '';
            return `
                <tr>
                    <td style="padding: 11px 16px; ${borderTop} color: #64748B; font-size: 12px; font-weight: 600; letter-spacing: 0.3px; vertical-align: middle; width: 42%;">
                        ${escapeHtml(row.label)}
                    </td>
                    <td style="padding: 11px 16px; ${borderTop} text-align: right; color: ${valueColor(row.tone)}; font-size: 13px; font-weight: 600; ${fontFamily} vertical-align: middle;">
                        ${escapeHtml(row.value)}
                    </td>
                </tr>
            `;
        })
        .join('');

    return `
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin: 22px 0; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; border-collapse: separate; overflow: hidden;">
            ${renderedRows}
        </table>
    `;
}

export function renderVerificationCodeBox(code: string, validityNote?: string): string {
    return `
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin: 24px 0;">
            <tr>
                <td align="center" style="background-color: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 6px; padding: 24px 20px;">
                    <div style="font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #64748B; margin-bottom: 10px;">
                        Código de Verificação
                    </div>
                    <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 32px; font-weight: 700; letter-spacing: 10px; color: #0F172A; line-height: 1.2;">
                        ${escapeHtml(code)}
                    </div>
                    ${
                        validityNote
                            ? `<div style="margin-top: 12px; font-size: 12px; color: #64748B;">${escapeHtml(validityNote)}</div>`
                            : ''
                    }
                </td>
            </tr>
        </table>
    `;
}

export interface MetricItem {
    label: string;
    value: string;
    tone?: 'default' | 'positive' | 'negative';
}

export function renderMetricStrip(metrics: MetricItem[]): string {
    if (!metrics.length) return '';
    const widthPct = Math.floor(100 / metrics.length);

    const cells = metrics
        .map((m, idx) => {
            const borderLeft = idx > 0 ? 'border-left: 1px solid #E2E8F0;' : '';
            const color =
                m.tone === 'positive' ? '#047857' : m.tone === 'negative' ? '#B91C1C' : '#0F172A';
            return `
                <td width="${widthPct}%" style="padding: 16px 14px; ${borderLeft} text-align: left; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: #64748B; margin-bottom: 6px;">
                        ${escapeHtml(m.label)}
                    </div>
                    <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 18px; font-weight: 700; color: ${color}; line-height: 1.2;">
                        ${escapeHtml(m.value)}
                    </div>
                </td>
            `;
        })
        .join('');

    return `
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin: 22px 0; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; border-collapse: separate; overflow: hidden;">
            <tr>
                ${cells}
            </tr>
        </table>
    `;
}

export function renderCalloutBox(
    text: string,
    tone: EmailAccentTone = 'slate',
    title?: string,
): string {
    const palette = ACCENT_COLORS[tone] || ACCENT_COLORS.slate;
    return `
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin: 20px 0;">
            <tr>
                <td style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid ${palette.bar}; border-radius: 4px; padding: 14px 16px;">
                    ${
                        title
                            ? `<div style="font-size: 12px; font-weight: 700; color: #0F172A; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;">${escapeHtml(title)}</div>`
                            : ''
                    }
                    <div style="font-size: 13px; line-height: 1.6; color: #334155;">
                        ${escapeHtml(text)}
                    </div>
                </td>
            </tr>
        </table>
    `;
}

export interface StepItem {
    title: string;
    description: string;
}

export function renderStepList(heading: string, steps: StepItem[]): string {
    if (!steps.length) return '';
    const rows = steps
        .map((step, index) => {
            const num = String(index + 1).padStart(2, '0');
            const borderTop = index > 0 ? 'border-top: 1px solid #F1F5F9;' : '';
            return `
                <tr>
                    <td style="padding: 10px 12px 10px 0; ${borderTop} width: 28px; vertical-align: top; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; font-weight: 700; color: #059669;">
                        ${num}
                    </td>
                    <td style="padding: 10px 0; ${borderTop} vertical-align: top; font-size: 13px; line-height: 1.55; color: #334155;">
                        <strong style="color: #0F172A;">${escapeHtml(step.title)}:</strong> ${escapeHtml(step.description)}
                    </td>
                </tr>
            `;
        })
        .join('');

    return `
        <div style="margin: 22px 0; padding: 18px 20px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #475569; margin-bottom: 8px;">
                ${escapeHtml(heading)}
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                ${rows}
            </table>
        </div>
    `;
}

export function renderActionButton(
    label: string,
    url: string,
    tone: EmailAccentTone = 'slate',
): string {
    const bg = tone === 'crimson' ? '#DC2626' : '#0F172A';
    const safeUrl = escapeHtml(url);
    return `
        <table cellpadding="0" cellspacing="0" role="presentation" style="margin: 26px 0 10px 0;">
            <tr>
                <td align="left" style="border-radius: 6px; background-color: ${bg};">
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 24px; font-size: 14px; font-weight: 600; color: #FFFFFF; text-decoration: none; border-radius: 6px; letter-spacing: 0.1px;">
                        ${escapeHtml(label)}
                    </a>
                </td>
            </tr>
        </table>
    `;
}

export function renderUrlFallback(url: string): string {
    const safeUrl = escapeHtml(url);
    return `
        <p style="margin: 16px 0 0 0; font-size: 12px; line-height: 1.5; color: #64748B; word-break: break-all;">
            Caso o botão acima não funcione no seu cliente de e-mail, copie e cole o endereço abaixo no navegador:<br>
            <a href="${safeUrl}" style="color: #0F172A; text-decoration: underline;">${safeUrl}</a>
        </p>
    `;
}

export function renderInstitutionalLayout(options: InstitutionalLayoutOptions): string {
    const palette = ACCENT_COLORS[options.tone || 'slate'] || ACCENT_COLORS.slate;
    const preheaderText = escapeHtml(options.preheader || '');
    const dashboardUrl = escapeHtml(buildAppUrl('/dashboard'));
    const termsUrl = escapeHtml(buildAppUrl('/terms'));
    const privacyUrl = escapeHtml(buildAppUrl('/privacy'));
    const currentYear = new Date().getFullYear();

    // Hidden preheader whitespace padding prevents email clients from pulling body HTML into inbox snippet
    const preheaderPadding = '&zwnj;&nbsp;'.repeat(45);

    return `<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Torex Journal</title>
    <!--[if mso]>
    <style type="text/css">
        table {border-collapse: collapse; border-spacing: 0; margin: 0;}
        div, td {padding: 0;}
        div {margin: 0 !important;}
    </style>
    <![endif]-->
    <style>
        body {
            margin: 0 !important;
            padding: 0 !important;
            background-color: #F8FAFC !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            color: #0F172A;
        }
        table {
            border-spacing: 0;
            border-collapse: collapse;
        }
        img {
            border: 0;
            line-height: 100%;
            outline: none;
            text-decoration: none;
        }
        .wrapper-table {
            width: 100% !important;
            background-color: #F8FAFC;
            margin: 0;
            padding: 36px 16px;
        }
        .container-card {
            max-width: 600px;
            width: 100%;
            margin: 0 auto;
            background-color: #FFFFFF;
            border: 1px solid #E2E8F0;
            border-top: 3px solid ${palette.bar};
            border-radius: 8px;
            overflow: hidden;
        }
        .header-cell {
            padding: 24px 40px;
            background-color: #FFFFFF;
            border-bottom: 1px solid #F1F5F9;
        }
        .content-cell {
            padding: 36px 40px;
            color: #334155;
            font-size: 14px;
            line-height: 1.65;
        }
        .h1-title {
            margin: 0 0 18px 0;
            color: #0F172A;
            font-size: 21px;
            font-weight: 700;
            line-height: 1.3;
            letter-spacing: -0.3px;
        }
        .body-p {
            margin: 0 0 14px 0;
            color: #334155;
            font-size: 14px;
            line-height: 1.65;
        }
        .body-p strong, .body-p b {
            color: #0F172A;
            font-weight: 600;
        }
        .muted-note {
            margin: 18px 0 0 0;
            color: #64748B;
            font-size: 12px;
            line-height: 1.55;
        }
        .footer-cell {
            background-color: #FAFAFA;
            padding: 24px 40px 28px 40px;
            border-top: 1px solid #F1F5F9;
            font-size: 12px;
            color: #64748B;
        }
        .footer-nav a {
            color: #475569;
            text-decoration: none;
            font-size: 12px;
            font-weight: 500;
        }
        @media screen and (max-width: 600px) {
            .wrapper-table {
                padding: 16px 10px !important;
            }
            .header-cell {
                padding: 20px 22px !important;
            }
            .content-cell {
                padding: 26px 22px !important;
            }
            .footer-cell {
                padding: 20px 22px !important;
            }
            .h1-title {
                font-size: 19px !important;
            }
        }
    </style>
</head>
<body>
    <div class="preheader" style="display: none; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; mso-hide: all; visibility: hidden; font-size: 1px; line-height: 1px; color: #F8FAFC;">
        ${preheaderText}${preheaderPadding}
    </div>
    <table class="wrapper-table" width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
            <td align="center">
                <table class="container-card" width="600" cellpadding="0" cellspacing="0" role="presentation">
                    <!-- INSTITUTIONAL HEADER -->
                    <tr>
                        <td class="header-cell">
                            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                                <tr>
                                    <td align="left" style="vertical-align: middle;">
                                        <table cellpadding="0" cellspacing="0" role="presentation">
                                            <tr>
                                                <td style="vertical-align: middle; padding-right: 10px;">
                                                    <img src="${TOREX_LOGO_URL}" alt="Torex Journal" width="28" height="28" style="display: block; width: 28px; height: 28px; border-radius: 5px; object-fit: contain;">
                                                </td>
                                                <td style="vertical-align: middle;">
                                                    <span style="font-size: 14px; font-weight: 800; letter-spacing: 1px; color: #0F172A;">
                                                        TOREX <span style="color: #059669;">JOURNAL</span>
                                                    </span>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                    ${
                                        options.category && options.category.trim().length > 0
                                            ? `<td align="right" style="vertical-align: middle; font-size: 11px; font-weight: 600; letter-spacing: 0.9px; text-transform: uppercase; color: #64748B;">
                                        ${escapeHtml(options.category)}
                                    </td>`
                                            : ''
                                    }
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- BODY -->
                    <tr>
                        <td class="content-cell">
                            ${options.contentHtml}
                        </td>
                    </tr>

                    <!-- INSTITUTIONAL FOOTER -->
                    <tr>
                        <td class="footer-cell">
                            <div class="footer-nav" style="margin-bottom: 14px;">
                                <a href="${dashboardUrl}">Painel</a>
                                <span style="color: #CBD5E1; margin: 0 8px;">&bull;</span>
                                <a href="${termsUrl}">Termos de Uso</a>
                                <span style="color: #CBD5E1; margin: 0 8px;">&bull;</span>
                                <a href="${privacyUrl}">Privacidade</a>
                                <span style="color: #CBD5E1; margin: 0 8px;">&bull;</span>
                                <a href="mailto:suporte@torexjournal.com">Suporte Técnico</a>
                            </div>
                            ${
                                options.footerNote
                                    ? `<div style="margin-bottom: 12px; color: #475569; line-height: 1.5;">${escapeHtml(options.footerNote)}</div>`
                                    : ''
                            }
                            <div style="color: #64748B; line-height: 1.55; font-size: 11px;">
                                Mensagem transacional emitida automaticamente pela infraestrutura Torex Journal.<br>
                                &copy; ${currentYear} Torex Journal. Todos os direitos reservados.
                            </div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

/**
 * Backward-compatible BASE_LAYOUT wrapper used by raw fallback messages.
 */
export const BASE_LAYOUT = (content: string, footerExtra: string = ''): string =>
    renderInstitutionalLayout({
        category: 'Notificação Institucional',
        contentHtml: content,
        footerNote: footerExtra || undefined,
    });
