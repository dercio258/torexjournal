import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiChatMessageEntity } from './ai-chat.entity';
import {
    IMPLICIT_SIGNAL_WEIGHTS,
    ImplicitSignal,
} from './ai-implicit-feedback';
import { AiPrivacySanitizerService } from './ai-privacy-sanitizer.service';
import { AiSemanticMemoryService } from './ai-semantic-memory.service';

export interface RejectedReplyItem {
    feedbackId: string;
    messageId: string;
    createdAtIso: string;
    locale: string;
    reasonCode: string | null;
    correctionNote: string | null;
    question: string | null;
    reply: string;
    intent: string | null;
    provider: string | null;
    domainCategory: string | null;
    semanticMemoryId: string | null;
    implicitScore: number;
}

export type RejectedReplyReviewAction = 'QUARANTINE_MEMORY' | 'DISMISS';

/**
 * Stores implicit feedback events (no message text, hashed user) and serves the
 * admin review queue of replies users rejected.
 */
@Injectable()
export class AiFeedbackSignalsService implements OnApplicationBootstrap {
    private readonly logger = new Logger(AiFeedbackSignalsService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly privacySanitizer: AiPrivacySanitizerService,
        @Optional() private readonly semanticMemory?: AiSemanticMemoryService
    ) {}

    /**
     * Runs after the learning schema exists: `ai_message_feedback` is created by
     * AiSemanticMemoryService at bootstrap, so the review columns are added only then.
     * Two separate statements, so a failure in one never rolls back the other.
     */
    async onApplicationBootstrap(): Promise<void> {
        if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
        await this.semanticMemory?.ensureInitialized().catch(() => undefined);
        try {
            await this.dataSource.query(`
                CREATE TABLE IF NOT EXISTS ai_feedback_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    message_id UUID NOT NULL,
                    session_id UUID NOT NULL,
                    user_hash VARCHAR(32) NOT NULL,
                    signal VARCHAR(24) NOT NULL,
                    weight NUMERIC(4,2) NOT NULL,
                    intent VARCHAR(80),
                    provider VARCHAR(40),
                    domain_category VARCHAR(40),
                    semantic_memory_id UUID,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_message ON ai_feedback_events (message_id);
                CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_signal_created ON ai_feedback_events (signal, created_at DESC);
                CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_feedback_events_once
                    ON ai_feedback_events (message_id, user_hash, signal);
            `);
        } catch (err) {
            this.logger.warn(`ai_feedback_events schema check failed: ${(err as Error).message}`);
        }
        try {
            await this.dataSource.query(`
                ALTER TABLE ai_message_feedback ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
                ALTER TABLE ai_message_feedback ADD COLUMN IF NOT EXISTS review_action VARCHAR(24);
            `);
        } catch (err) {
            this.logger.warn(`ai_message_feedback review columns not added: ${(err as Error).message}`);
        }
    }

    private async hasTable(name: string): Promise<boolean> {
        try {
            const rows = await this.dataSource.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
            return Boolean(Array.isArray(rows) && rows[0]?.ok);
        } catch {
            return false;
        }
    }

    /**
     * Records one implicit signal for an assistant reply (once per user, reply and signal)
     * and nudges the trust of the shared memory entry that produced it, if any.
     */
    async recordSignal(params: {
        userId: string;
        message: AiChatMessageEntity;
        signal: ImplicitSignal;
    }): Promise<{ recorded: boolean }> {
        const { message, signal } = params;
        if (message.role !== 'assistant') return { recorded: false };
        const weight = IMPLICIT_SIGNAL_WEIGHTS[signal];
        const memoryId = message.metadata?.semanticMemoryId || null;
        try {
            const res = await this.dataSource.query(
                `INSERT INTO ai_feedback_events
                    (message_id, session_id, user_hash, signal, weight, intent, provider, domain_category, semantic_memory_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (message_id, user_hash, signal) DO NOTHING
                 RETURNING id`,
                [
                    message.id,
                    message.sessionId,
                    this.privacySanitizer.hashUserForQuorum(params.userId),
                    signal,
                    weight,
                    message.intent || null,
                    message.provider || null,
                    message.metadata?.domainCategory || null,
                    memoryId,
                ]
            );
            const inserted = Array.isArray(res) ? res.length > 0 : Boolean(res);
            if (inserted && memoryId && this.semanticMemory) {
                await this.semanticMemory.applyImplicitSignal(memoryId, weight);
            }
            return { recorded: inserted };
        } catch (err) {
            this.logger.warn(`recordSignal skipped: ${(err as Error).message}`);
            return { recorded: false };
        }
    }

    /** Replies voted 👎, newest first, with their implicit score; reviewed ones hidden by default. */
    async listRejectedReplies(options?: { limit?: number; includeReviewed?: boolean }): Promise<RejectedReplyItem[]> {
        const limit = Math.max(1, Math.min(200, Number(options?.limit) || 50));
        if (!(await this.hasTable('ai_message_feedback'))) return [];
        const implicitSql = (await this.hasTable('ai_feedback_events'))
            ? `COALESCE((SELECT SUM(e.weight) FROM ai_feedback_events e WHERE e.message_id = f.message_id), 0)`
            : '0';
        const rows = await this.dataSource.query(
            `SELECT f.id AS feedback_id, f.message_id, f.created_at, f.locale, f.reason_code, f.correction_note,
                    f.normalized_question, f.domain_category, f.intent, f.semantic_memory_id,
                    m.content AS reply, m.provider,
                    ${implicitSql} AS implicit_score
               FROM ai_message_feedback f
               LEFT JOIN ai_chat_messages m ON m.id = f.message_id
              WHERE f.rating = -1
                AND ($1::boolean OR f.reviewed_at IS NULL)
              ORDER BY f.created_at DESC
              LIMIT $2`,
            [Boolean(options?.includeReviewed), limit]
        );
        return (Array.isArray(rows) ? rows : []).map((r: any) => ({
            feedbackId: String(r.feedback_id),
            messageId: String(r.message_id),
            createdAtIso: new Date(r.created_at).toISOString(),
            locale: String(r.locale || 'pt'),
            reasonCode: r.reason_code || null,
            correctionNote: r.correction_note || null,
            question: r.normalized_question || null,
            reply: String(r.reply || ''),
            intent: r.intent || null,
            provider: r.provider || null,
            domainCategory: r.domain_category || null,
            semanticMemoryId: r.semantic_memory_id || null,
            implicitScore: Number(r.implicit_score || 0),
        }));
    }

    async reviewRejectedReply(feedbackId: string, action: RejectedReplyReviewAction): Promise<boolean> {
        const rows = await this.dataSource.query(
            `SELECT semantic_memory_id FROM ai_message_feedback WHERE id = $1 AND rating = -1`,
            [feedbackId]
        );
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row) return false;
        if (action === 'QUARANTINE_MEMORY' && row.semantic_memory_id && this.semanticMemory) {
            await this.semanticMemory.reviewMemoryByAdmin(String(row.semantic_memory_id), 'QUARANTINE');
        }
        await this.dataSource.query(
            `UPDATE ai_message_feedback SET reviewed_at = now(), review_action = $2 WHERE id = $1`,
            [feedbackId, action]
        );
        return true;
    }

    /** Count and summed weight per signal over the last N days, for the admin report. */
    async summarizeSignals(days = 30): Promise<Array<{ signal: string; count: number; weight: number }>> {
        try {
            const rows = await this.dataSource.query(
                `SELECT signal, COUNT(*)::int AS count, COALESCE(SUM(weight), 0)::float AS weight
                   FROM ai_feedback_events
                  WHERE created_at >= now() - ($1::int * interval '1 day')
                  GROUP BY signal
                  ORDER BY count DESC`,
                [Math.max(1, Math.min(365, days))]
            );
            return (Array.isArray(rows) ? rows : []).map((r: any) => ({
                signal: String(r.signal),
                count: Number(r.count),
                weight: Number(r.weight),
            }));
        } catch {
            return [];
        }
    }
}
