import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { GeminiHandoffSpec } from './ai-router.service';

export interface TextSanitizationResult {
    cleanText: string;
    redactionsCount: number;
    flags: string[];
}

export interface GlobalSafeDlpInspection {
    eligible: boolean;
    reasons: string[];
    sanitizedQuestion: string;
    sanitizedReply: string;
}

export interface AnonymizedIntentPatternResult {
    canonicalPattern: string;
    normalizedPattern: string;
    handoffTemplate: {
        analyticalObjective: string;
        subIntent: GeminiHandoffSpec['subIntent'];
        timeframeHint: GeminiHandoffSpec['timeframeHint'];
        includeJournalNotes: boolean;
        includePlaybookRules: boolean;
        includeBacktesting: boolean;
        focusMetrics: string[];
    };
}

const COMMON_TRADING_WORDS_EXCLUSION = new Set([
    'trade',
    'trades',
    'trader',
    'trading',
    'torex',
    'journal',
    'meta',
    'stop',
    'gain',
    'loss',
    'win',
    'risk',
    'risco',
    'conta',
    'lucro',
    'perda',
    'ativo',
    'ativos',
    'diario',
    'plano',
    'data',
    'analise',
    'sessao',
    'melhor',
    'pior',
    'como',
    'onde',
    'qual',
    'para',
    'sobre',
    'what',
    'where',
    'how',
    'with',
    'from',
    'your',
    'gold',
    'ouro',
]);

const KNOWN_SYMBOL_RX =
    /\b(XAUUSD|XAGUSD|EURUSD|GBPUSD|USDJPY|USDCHF|USDCAD|AUDUSD|NZDUSD|EURJPY|GBPJPY|BTCUSD|ETHUSD|SOLUSD|US30|US100|NAS100|NDX|SPX500|US500|GER40|DAX|UK100|WIN[A-Z0-9]{0,3}|WDO[A-Z0-9]{0,3}|V75|BOOM\d+|CRASH\d+|STEP\s*INDEX)\b/gi;

@Injectable()
export class AiPrivacySanitizerService {
    private getQuorumSalt(): string {
        return (
            process.env.AI_QUORUM_HMAC_SALT ||
            process.env.JWT_SECRET ||
            'torex-ai-quorum-salt-v1'
        );
    }

    hashUserForQuorum(userId: string): string {
        return createHmac('sha256', this.getQuorumSalt())
            .update(String(userId || 'anonymous'))
            .digest('hex')
            .slice(0, 24);
    }

    anonymizeRecordId(rawId: string): string {
        return `rec_${this.hashUserForQuorum(rawId).slice(0, 12)}`;
    }

    sanitizeTextForTraining(
        rawText: string,
        options?: { userNames?: string[]; maxLen?: number }
    ): TextSanitizationResult {
        let working = String(rawText || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');

        const flags = new Set<string>();
        let redactionsCount = 0;

        const applyReplace = (rx: RegExp, token: string, flag: string) => {
            working = working.replace(rx, () => {
                redactionsCount += 1;
                flags.add(flag);
                return token;
            });
        };

        // 1. Prompt-injection markers
        applyReplace(
            /(<\|im_start\|>|<\|im_end\|>|ignore\s+(?:all\s+)?previous\s+instructions|system\s*:\s*you\s+are\s+now)/gi,
            ' [FILTERED] ',
            'PROMPT_INJECTION_MARKER'
        );

        // 2. API keys / JWTs / Bearer tokens
        applyReplace(
            /\b(?:Bearer\s+[A-Za-z0-9._-]{16,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
            '<SECRET>',
            'SECRET'
        );

        // 3. Emails
        applyReplace(
            /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
            '<EMAIL>',
            'EMAIL'
        );

        // 4. UUIDs
        applyReplace(
            /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
            '<UUID>',
            'UUID'
        );

        // 5. Broker / MT5 / Deriv logins & ticket numbers
        applyReplace(
            /(?:\b(?:login|conta|account|mt5|mt4|deriv|ticket|servidor)\s*[:#-]?\s*\d{5,12}\b|#\d{5,12}\b)/gi,
            '<ACCOUNT_ID>',
            'ACCOUNT_ID'
        );

        // 6. Monetary amounts ($1,250.40 | US$ 500 | R$ 300 | 150 USD | 500 MZN)
        applyReplace(
            /(?:US\$|R\$|€|£|\$)\s*-?\d[\d.,]*|-?\d[\d.,]*\s*(?:USD|EUR|BRL|MZN|GBP|USDT)\b/gi,
            '<AMOUNT>',
            'MONETARY_AMOUNT'
        );

        // 7. Phone numbers
        applyReplace(
            /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]+)\d{4,5}[\s.-]?\d{4}\b|\+\d{8,15}\b/g,
            '<PHONE>',
            'PHONE'
        );

        // 8. Explicit calendar dates (YYYY-MM-DD, DD/MM/YYYY)
        applyReplace(
            /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,
            '<DATE>',
            'DATE'
        );

        // 8B. Self-introductions and age ("sou o Dercio", "my name is…", "tenho 22 anos")
        applyReplace(
            /\b(?:me\s+chamo|chamo-me|(?:o\s+)?meu\s+nome\s+(?:é|e)|my\s+name\s+is|call\s+me|sou\s+(?:o|a))\s+\p{Lu}[\p{L}'-]{1,29}|\b(?:me\s+chamo|chamo-me|(?:o\s+)?meu\s+nome\s+(?:é|e)|my\s+name\s+is)\s+[\p{L}'-]{2,30}/giu,
            '<SELF_INTRO>',
            'SELF_INTRO'
        );
        applyReplace(
            /\b(?:tenho|i\s*'?\s*m|i\s+am)\s+\d{1,2}\s*(?:anos(?:\s+de\s+idade)?|years?\s+old)\b/gi,
            '<AGE>',
            'AGE'
        );

        // 9. Explicit user display names
        const candidateNames = (options?.userNames || [])
            .flatMap((n) => String(n || '').trim().split(/\s+/))
            .map((t) => t.trim())
            .filter(
                (t) =>
                    t.length >= 3 &&
                    !COMMON_TRADING_WORDS_EXCLUSION.has(t.toLowerCase()) &&
                    /^[\p{L}0-9._-]+$/u.test(t)
            );

        for (const nameToken of candidateNames) {
            const escaped = nameToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRx = new RegExp(`\\b${escaped}\\b`, 'gi');
            working = working.replace(nameRx, () => {
                redactionsCount += 1;
                flags.add('USER_NAME');
                return '<USER>';
            });
        }

        let cleanText = working.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (options?.maxLen && options.maxLen > 0 && cleanText.length > options.maxLen) {
            cleanText = cleanText.slice(0, options.maxLen).trim();
        }

        return {
            cleanText,
            redactionsCount,
            flags: Array.from(flags),
        };
    }

    inspectCandidateForGlobalSafe(params: {
        question: string;
        reply: string;
        domainCategory?: string | null;
        intent?: string | null;
        sqlToolsUsed?: string[];
        ragSourcesUsed?: string[];
        userNames?: string[];
    }): GlobalSafeDlpInspection {
        const reasons: string[] = [];

        if (
            params.domainCategory !== 'PLATFORM_KNOWLEDGE' &&
            params.domainCategory !== 'TRADING_CONCEPTS'
        ) {
            reasons.push(`INVALID_DOMAIN:${params.domainCategory || 'UNKNOWN'}`);
        }

        const qTrim = String(params.question || '').trim();
        const rTrim = String(params.reply || '').trim();
        if (!qTrim || rTrim.length < 25) {
            reasons.push('CONTENT_TOO_SHORT');
        }

        const intentLower = String(params.intent || '').toLowerCase();
        if (
            intentLower === 'support_fallback' ||
            intentLower === 'greeting' ||
            intentLower === 'zero_data_guard' ||
            intentLower.startsWith('guardrail_') ||
            intentLower.startsWith('clarify')
        ) {
            reasons.push(`NON_CACHEABLE_INTENT:${intentLower}`);
        }

        if ((params.sqlToolsUsed?.length ?? 0) > 0) {
            reasons.push('PRIVATE_SQL_TOOLS_USED');
        }

        const privateRagSources = (params.ragSourcesUsed || []).filter(
            (src) => String(src).toUpperCase() !== 'PLATFORM_DOC'
        );
        if (privateRagSources.length > 0) {
            reasons.push(`PRIVATE_RAG_SOURCES:${privateRagSources.join(',')}`);
        }

        const qCheck = this.sanitizeTextForTraining(qTrim, {
            userNames: params.userNames,
            maxLen: 500,
        });
        const rCheck = this.sanitizeTextForTraining(rTrim, {
            userNames: params.userNames,
            maxLen: 4000,
        });

        for (const f of [...qCheck.flags, ...rCheck.flags]) {
            reasons.push(`DLP_FLAG:${f}`);
        }

        const normalizedReply = rTrim
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();

        if (
            /\b(no seu historico|na sua conta|seu win\s*rate atual|seu saldo|seu lucro liquido|suas operacoes fechadas|your current win\s*rate|in your account|your net p&l|your closed trades)\b/i.test(
                normalizedReply
            )
        ) {
            reasons.push('PERSONAL_TELEMETRY_PHRASE');
        }

        const uniqueReasons = Array.from(new Set(reasons));
        return {
            eligible: uniqueReasons.length === 0,
            reasons: uniqueReasons,
            sanitizedQuestion: qCheck.cleanText,
            sanitizedReply: rCheck.cleanText,
        };
    }

    buildAnonymizedIntentPattern(params: {
        question: string;
        normalizedQuestion: string;
        handoff: GeminiHandoffSpec;
        userNames?: string[];
    }): AnonymizedIntentPatternResult {
        const sanitized = this.sanitizeTextForTraining(params.question, {
            userNames: params.userNames,
            maxLen: 300,
        }).cleanText;

        const canonicalPattern = sanitized
            .replace(KNOWN_SYMBOL_RX, '<symbol>')
            .replace(/\b\d+(?:[.,]\d+)?\b/g, '<num>')
            .replace(/\s+/g, ' ')
            .trim();

        const normalizedPattern = String(params.normalizedQuestion || canonicalPattern)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(KNOWN_SYMBOL_RX, '<symbol>')
            .replace(/\b\d+(?:[.,]\d+)?\b/g, '<num>')
            .replace(/\s+/g, ' ')
            .trim();

        const sanitizedObjective = this.sanitizeTextForTraining(
            params.handoff.analyticalObjective || '',
            { userNames: params.userNames, maxLen: 260 }
        ).cleanText;

        return {
            canonicalPattern,
            normalizedPattern,
            handoffTemplate: {
                analyticalObjective: sanitizedObjective,
                subIntent: params.handoff.subIntent,
                timeframeHint: params.handoff.timeframeHint || 'all_history',
                includeJournalNotes: Boolean(params.handoff.includeJournalNotes),
                includePlaybookRules: Boolean(params.handoff.includePlaybookRules),
                includeBacktesting: Boolean(params.handoff.includeBacktesting),
                focusMetrics: Array.isArray(params.handoff.focusMetrics)
                    ? params.handoff.focusMetrics.slice(0, 6)
                    : ['net_pnl', 'winrate', 'payoff', 'sessions'],
            },
        };
    }
}
