import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

export interface AiMetricCard {
    label: string;
    value: string;
    tone?: 'positive' | 'negative' | 'neutral';
    subtext?: string;
}

export interface AiActionLink {
    label: string;
    route: string;
    description?: string;
}

export interface PersistedGrillMeState {
    active: boolean;
    originalQuestion: string;
    clarificationAsked: string;
    missingAspects: string[];
    turnCount: number;
    createdAtIso: string;
}

export interface AiMessageUserFeedback {
    rating: 1 | -1;
    reasonCode?: string | null;
    correctionNote?: string | null;
    updatedAtIso: string;
}

export interface AiMessageMetadata {
    metrics?: AiMetricCard[];
    actions?: AiActionLink[];
    suggestions?: string[];
    accountLabel?: string;
    creditsUsed?: number;
    tokensUsed?: number;
    /** Why the assistant fell back (NO_CREDITS, EXCEPTION, JOB_CRASH, LLM_FAILED, ...); null on success. */
    failureReason?: string | null;
    failureDetail?: string;
    analystTruncated?: boolean;
    /** Figures in the analyst reply checked against the audited data (see ai-numeric-grounding.ts). */
    numericGrounding?: { checked: number; ungrounded: number[]; grounded: boolean; retried: boolean } | null;
    /** Highlight the 👍/👎 question on this reply (first analyst reply of a conversation, then every 5th). */
    askFeedback?: boolean;
    /** Facts the user shared that wait for "remember me?" consent; cleared once answered. */
    profileConsentRequest?: { facts: Array<{ type: string; value: string }> } | null;
    grillMeState?: PersistedGrillMeState | null;
    routerDecision?: string;
    routerModel?: string;
    analystModel?: string;
    domainCategory?: string;
    semanticConfidence?: string;
    semanticScore?: number;
    matchedAnchorKey?: string;
    semanticMemoryId?: string;
    memoryHitScope?:
        | 'GLOBAL_SAFE'
        | 'GLOBAL_INTENT_PATTERN'
        | 'USER_PRIVATE'
        | 'HINT_ONLY';
    hybridScore?: number;
    lexicalExpansions?: string[];
    userFeedback?: AiMessageUserFeedback | null;
    sqlToolsUsed?: string[];
    ragSourcesUsed?: string[];
    ragChunksCount?: number;
    backtestingIncluded?: boolean;
    routerLatencyMs?: number;
    analystLatencyMs?: number;
}

@Entity('ai_chat_sessions')
@Index(['userId', 'updatedAt'])
export class AiChatSessionEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @Column({ name: 'account_id', type: 'varchar', nullable: true })
    accountId: string | null;

    @Column({ type: 'varchar', length: 180 })
    title: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}

@Entity('ai_chat_messages')
@Index(['sessionId', 'createdAt'])
export class AiChatMessageEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'session_id' })
    sessionId: string;

    @Column({ type: 'varchar', length: 20 })
    role: 'user' | 'assistant';

    @Column({ type: 'text' })
    content: string;

    @Column({ type: 'varchar', length: 60, nullable: true })
    intent: string | null;

    @Column({ type: 'varchar', length: 40, default: 'deterministic_analytics' })
    provider: string;

    @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
    metadata: AiMessageMetadata;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}

@Entity('ai_chat_jobs')
@Index(['userId', 'status'])
@Index(['sessionId', 'createdAt'])
export class AiChatJobEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @Column({ name: 'session_id', type: 'uuid' })
    sessionId: string;

    @Column({ name: 'user_message_id', type: 'uuid' })
    userMessageId: string;

    @Column({ name: 'assistant_message_id', type: 'uuid', nullable: true })
    assistantMessageId: string | null;

    @Column({ type: 'varchar', length: 20, default: 'PROCESSING' })
    status: 'PROCESSING' | 'COMPLETED';

    @Column({ name: 'credits_used', type: 'int', default: 0 })
    creditsUsed: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
