/**
 * Unified Institutional Email Template Registry (18 Situations)
 * Torex Journal
 */

import { authTemplates } from './auth.templates';
import { billingTemplates } from './billing.templates';
import { BASE_LAYOUT, renderInstitutionalLayout, TOREX_LOGO_URL } from './layout';
import { systemTemplates } from './system.templates';
import { tradingTemplates } from './trading.templates';
import {
    EmailAccentTone,
    EmailTemplateData,
    EmailTemplateDefinition,
    EmailTemplateName,
    EmailTemplatePayloadMap,
    OtpPurpose,
    RenderedEmail,
} from './types';
import { htmlToPlainText } from './utils';

export {
    BASE_LAYOUT,
    TOREX_LOGO_URL,
    EmailAccentTone,
    EmailTemplateData,
    EmailTemplateDefinition,
    EmailTemplateName,
    EmailTemplatePayloadMap,
    OtpPurpose,
    RenderedEmail,
};
export * from './utils';
export * from './layout';

export const EmailTemplateRegistry: {
    [K in EmailTemplateName]: EmailTemplateDefinition<EmailTemplatePayloadMap[K]>;
} = {
    ...authTemplates,
    ...billingTemplates,
    ...tradingTemplates,
    ...systemTemplates,
};

/**
 * Renders an institutional email template into `{ subject, preheader, html, text }`.
 */
export function renderEmailTemplate<K extends EmailTemplateName>(
    template: K,
    data: EmailTemplatePayloadMap[K],
): RenderedEmail {
    const registry = EmailTemplateRegistry as Record<string, EmailTemplateDefinition<any>>;
    const def = registry[template];
    if (!def) {
        throw new Error(`Email template "${String(template)}" is not registered.`);
    }

    const safeData = (data || {}) as EmailTemplatePayloadMap[K];
    const tone: EmailAccentTone =
        typeof def.tone === 'function' ? def.tone(safeData) : def.tone || 'slate';
    const subject = def.subject(safeData);
    const preheader = def.preheader(safeData);
    const contentHtml = def.renderBody(safeData);
    const footerNote = def.footerNote ? def.footerNote(safeData) : undefined;

    const html = renderInstitutionalLayout({
        category: def.category,
        preheader,
        tone,
        contentHtml,
        footerNote,
    });

    const text = htmlToPlainText(html);
    const inlineQr = def.buildInlineQr ? def.buildInlineQr(safeData) : undefined;

    return {
        subject,
        preheader,
        html,
        text,
        ...(inlineQr ? { inlineQr } : {}),
    };
}

/**
 * Backward-compatible HTML render map (`Templates[name](data)` -> HTML string)
 */
export const Templates: {
    [K in EmailTemplateName]: (data: EmailTemplatePayloadMap[K]) => string;
} = Object.keys(EmailTemplateRegistry).reduce((acc, key) => {
    const name = key as EmailTemplateName;
    acc[name] = (data: any) => renderEmailTemplate(name, data).html;
    return acc;
}, {} as any);

/**
 * Backward-compatible Subject generator map (`TemplateSubjects[name](data)` -> subject string)
 */
export const TemplateSubjects: {
    [K in EmailTemplateName]: (data: Partial<EmailTemplatePayloadMap[K]>) => string;
} = Object.keys(EmailTemplateRegistry).reduce((acc, key) => {
    const registry = EmailTemplateRegistry as Record<string, EmailTemplateDefinition<any>>;
    acc[key] = (data: any) => registry[key].subject((data || {}) as any);
    return acc;
}, {} as any);
