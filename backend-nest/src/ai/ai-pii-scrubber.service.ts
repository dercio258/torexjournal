import { Injectable } from '@nestjs/common';

export interface OutboundPiiScrubResult {
    text: string;
    redactionsCount: number;
    categories: string[];
}

/**
 * Outbound LLM PII & Secret Scrubber.
 * Strips personal identifiers and credentials BEFORE prompts/history leave Torex
 * towards external LLM providers (Gemini / Qwen), while strictly preserving
 * trading figures ($1,250.00, 62.5%, XAUUSD, dates, and performance metrics).
 */
@Injectable()
export class AiPiiScrubberService {
    scrubOutboundText(rawText: string): OutboundPiiScrubResult {
        if (!rawText || typeof rawText !== 'string') {
            return { text: '', redactionsCount: 0, categories: [] };
        }

        let working = rawText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
        let redactionsCount = 0;
        const categories = new Set<string>();

        const replace = (rx: RegExp, replacement: string, category: string) => {
            working = working.replace(rx, () => {
                redactionsCount += 1;
                categories.add(category);
                return replacement;
            });
        };

        // 1. JWTs, Bearer tokens, API keys (Google AIza, OpenAI/OpenRouter sk-, GitHub ghp_, Slack xox)
        replace(
            /\b(?:Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|sk-(?:proj-|or-v1-|live-|test-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g,
            '[SECRET_REDACTED]',
            'SECRET_TOKEN',
        );

        // 2. Explicit password / api_key / token assignments
        replace(
            /\b(password|passwd|senha|api[_-]?key|app[_-]?token|secret[_-]?key|access[_-]?token|mt5[_-]?password)\s*[:=]\s*["']?[^\s"',;]{4,}["']?/gi,
            '$1=[CREDENTIAL_REDACTED]',
            'CREDENTIAL',
        );

        // 3. Email addresses
        replace(
            /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
            '[EMAIL_REDACTED]',
            'EMAIL',
        );

        // 4. Phone / WhatsApp numbers (international +XXX... or country-prefixed mobile formats)
        replace(
            /(?:\+\d{1,3}[\s.-]?(?:\(?\d{2,3}\)?[\s.-]?)\d{3,5}[\s.-]?\d{3,4}\b|\+\d{8,15}\b|\b(?:whatsapp|telefone|celular|phone)\s*[:#-]?\s*\+?\d[\d\s().-]{7,18}\b)/gi,
            '[PHONE_REDACTED]',
            'PHONE',
        );

        // 5. Payment card-like 13-19 digit sequences (separated by spaces/dashes or contiguous)
        replace(
            /\b(?:\d{4}[-\s]){3}\d{3,4}\b|\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13})\b/g,
            '[CARD_REDACTED]',
            'PAYMENT_CARD',
        );

        return {
            text: working,
            redactionsCount,
            categories: Array.from(categories),
        };
    }

    scrubHistory<T extends { role: 'user' | 'assistant'; content: string }>(
        history: T[],
    ): { history: T[]; redactionsCount: number } {
        let total = 0;
        const cleaned = (history || []).map((item) => {
            const res = this.scrubOutboundText(item.content);
            total += res.redactionsCount;
            return { ...item, content: res.text };
        });
        return { history: cleaned, redactionsCount: total };
    }
}
