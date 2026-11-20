import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AiMessageMetadata } from './ai-chat.entity';
import { AiPrivacySanitizerService } from './ai-privacy-sanitizer.service';
import {
    AiDomainCategory,
    AiPromptSystemService,
    AnalyticalSubIntent,
} from './ai-prompt-system.service';
import { GeminiHandoffSpec } from './ai-router.service';
import { AiSemanticMemoryService } from './ai-semantic-memory.service';
import { RedisSecurityService } from '../common/security/redis-security.service';

export interface FeedbackRecordedEventPayload {
    feedbackId?: string;
    userId: string;
    userName?: string;
    sessionId: string;
    messageId: string;
    rating: 1 | -1;
    reasonCode?: string | null;
    correctionNote?: string | null;
    locale: 'pt' | 'en';
    question: string;
    normalizedQuestion: string;
    reply: string;
    intent?: string | null;
    provider?: string | null;
    metadata?: AiMessageMetadata;
}

@Injectable()
export class AiAutoLearningService {
    private readonly logger = new Logger(AiAutoLearningService.name);

    constructor(
        private readonly privacySanitizer: AiPrivacySanitizerService,
        private readonly semanticMemory: AiSemanticMemoryService,
        private readonly promptSystem: AiPromptSystemService,
        @Optional() private readonly redisSecurity?: RedisSecurityService,
    ) {}

    @OnEvent('ai.feedback.recorded', { async: true })
    async handleFeedbackRecordedEvent(
        payload: FeedbackRecordedEventPayload
    ): Promise<void> {
        try {
            await this.processFeedback(payload);
        } catch (err) {
            this.logger.warn(
                `handleFeedbackRecordedEvent error (non-blocking): ${(err as Error).message}`
            );
        }
    }

    async processFeedback(payload: FeedbackRecordedEventPayload): Promise<{
        action:
            | 'GLOBAL_SAFE_UPSERTED'
            | 'GLOBAL_INTENT_PATTERN_UPSERTED'
            | 'DLP_BLOCKED'
            | 'NEGATIVE_QUARANTINE_CHECKED'
            | 'NOOP';
        dlpReasons?: string[];
        memoryId?: string | null;
        status?: string;
    }> {
        const locale: 'pt' | 'en' = payload.locale === 'en' ? 'en' : 'pt';
        const userHash = this.privacySanitizer.hashUserForQuorum(payload.userId);

        if (payload.rating === -1) {
            const reason = String(payload.reasonCode || '').toUpperCase();
            const res = await this.semanticMemory.applyNegativeFeedbackToMemory(
                payload.metadata?.semanticMemoryId || null,
                payload.normalizedQuestion,
                locale,
                { forceQuarantine: reason === 'INACCURATE' || reason === 'UNSAFE' }
            );
            return {
                action: 'NEGATIVE_QUARANTINE_CHECKED',
                memoryId: res.quarantinedIds[0] || payload.metadata?.semanticMemoryId || null,
            };
        }

        if (payload.rating !== 1) {
            return { action: 'NOOP' };
        }

        if (payload.metadata?.semanticMemoryId) {
            await this.semanticMemory.recordPositiveHitVote(
                payload.metadata.semanticMemoryId,
                userHash
            );
        }

        const inspection = this.promptSystem.inspectAndClassifyInput(
            payload.question || '',
            500,
            locale
        );
        const resolvedDomain = (payload.metadata?.domainCategory ||
            inspection.domainCategory) as AiDomainCategory;

        if (
            resolvedDomain === 'PLATFORM_KNOWLEDGE' ||
            resolvedDomain === 'TRADING_CONCEPTS'
        ) {
            const dlp = this.privacySanitizer.inspectCandidateForGlobalSafe({
                question: payload.question,
                reply: payload.reply,
                domainCategory: resolvedDomain,
                intent: payload.intent,
                sqlToolsUsed: payload.metadata?.sqlToolsUsed,
                ragSourcesUsed: payload.metadata?.ragSourcesUsed,
                userNames: payload.userName ? [payload.userName] : [],
            });

            if (!dlp.eligible) {
                return {
                    action: 'DLP_BLOCKED',
                    dlpReasons: dlp.reasons,
                };
            }

            const upserted = await this.semanticMemory.upsertGlobalSafeCandidate({
                locale,
                domainCategory: resolvedDomain,
                intentKey: payload.intent || 'platform_qa',
                question: dlp.sanitizedQuestion,
                normalizedQuestion:
                    payload.normalizedQuestion || inspection.normalizedLookup,
                reply: dlp.sanitizedReply,
                actions: payload.metadata?.actions || [],
                suggestions: payload.metadata?.suggestions || [],
                userHash,
            });

            return {
                action: 'GLOBAL_SAFE_UPSERTED',
                memoryId: upserted?.id || null,
                status: upserted?.status,
            };
        }

        if (
            resolvedDomain === 'PERSONAL_ANALYTICS' &&
            payload.intent !== 'zero_data_guard' &&
            payload.intent !== 'support_fallback'
        ) {
            const inferredSubIntent = (String(
                payload.intent || inspection.subIntent || 'STATUS_OVERVIEW'
            )
                .toUpperCase()
                .replace(/[^A-Z_]/g, '') || 'STATUS_OVERVIEW') as AnalyticalSubIntent;

            const handoff: GeminiHandoffSpec = {
                formalizedQuestion: payload.question,
                analyticalObjective: inspection.expandedInstruction,
                subIntent: inferredSubIntent,
                targetSymbols: [],
                timeframeHint: 'all_history',
                includeJournalNotes: true,
                includePlaybookRules: true,
                includeBacktesting: Boolean(payload.metadata?.backtestingIncluded),
                focusMetrics: ['net_pnl', 'winrate', 'payoff', 'sessions'],
            };

            const pattern = this.privacySanitizer.buildAnonymizedIntentPattern({
                question: payload.question,
                normalizedQuestion:
                    payload.normalizedQuestion || inspection.normalizedLookup,
                handoff,
                userNames: payload.userName ? [payload.userName] : [],
            });

            const upserted =
                await this.semanticMemory.upsertGlobalIntentPatternCandidate({
                    locale,
                    intentKey: payload.intent || inferredSubIntent.toLowerCase(),
                    canonicalPattern: pattern.canonicalPattern,
                    normalizedPattern: pattern.normalizedPattern,
                    handoffTemplate: pattern.handoffTemplate,
                    userHash,
                });

            return {
                action: 'GLOBAL_INTENT_PATTERN_UPSERTED',
                memoryId: upserted?.id || null,
                status: upserted?.status,
            };
        }

        return { action: 'NOOP' };
    }

    @Cron(CronExpression.EVERY_6_HOURS)
    async runScheduledConsolidation(): Promise<void> {
        const exec = async () => {
            const res = await this.semanticMemory.runMaintenanceSweep();
            if (res.retiredCount > 0) {
                this.logger.log(
                    `Auto-learning maintenance sweep retired ${res.retiredCount} stale/quarantined memory entries.`
                );
            }
        };
        if (this.redisSecurity) {
            await this.redisSecurity.withLock('cron:ai_auto_learning', 20 * 60_000, exec);
            return;
        }
        await exec();
    }
}
