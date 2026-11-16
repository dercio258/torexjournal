import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    Optional,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { AiEmbeddingService } from './ai-embedding.service';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { AiPromptSystemService } from './ai-prompt-system.service';
import {
    ALLOWED_RAG_SOURCE_TYPES,
    AllowedRagSourceType,
} from './ai-vector-schema';
import {
    AiVectorStoreService,
    RagChunkMatch,
    UpsertRagChunkInput,
} from './ai-vector-store.service';

export interface RagSyncSourceReport {
    syncedChunks: number;
    skippedUnchanged: number;
    pruned: number;
}

export interface RagRetrievedContext {
    chunks: RagChunkMatch[];
    sourcesUsed: AllowedRagSourceType[];
    syncedChunks: number;
}

interface RawRagItemInput {
    sourceId: string;
    accountId?: string | null;
    title?: string | null;
    text: string;
    metadata?: Record<string, any>;
}

const USER_SYNC_THROTTLE_MS = 60_000;

@Injectable()
export class AiRagService implements OnApplicationBootstrap {
    private readonly logger = new Logger(AiRagService.name);
    private platformDocsSynced = false;
    private readonly userSyncTimestamps = new Map<string, number>();

    constructor(
        private readonly embeddingService: AiEmbeddingService,
        private readonly vectorStore: AiVectorStoreService,
        private readonly knowledgeBase: AiKnowledgeBaseService,
        private readonly promptSystem: AiPromptSystemService,
        @Optional()
        private readonly dataSource?: DataSource
    ) {}

    onApplicationBootstrap(): void {
        if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
            return;
        }
        if (
            this.dataSource?.isInitialized &&
            this.embeddingService.getStatus().enabled
        ) {
            void this.syncPlatformDocs().catch((err) =>
                this.logger.warn(
                    `Deferred PLATFORM_DOC RAG sync skipped: ${err?.message || err}`
                )
            );
        }
    }

    invalidateUserSyncCache(userId: string): void {
        const cleanUserId = String(userId || '').trim();
        if (!cleanUserId) return;
        const prefix = `${cleanUserId}:`;
        for (const key of Array.from(this.userSyncTimestamps.keys())) {
            if (key === cleanUserId || key.startsWith(prefix)) {
                this.userSyncTimestamps.delete(key);
            }
        }
    }

    @OnEvent('ai.rag.invalidate_user')
    handleUserRagInvalidation(payload: { userId?: string } | string): void {
        const userId =
            typeof payload === 'string'
                ? payload
                : String(payload?.userId || '').trim();
        if (userId) {
            this.invalidateUserSyncCache(userId);
        }
    }

    getStatus(): {
        enabled: boolean;
        platformDocsSynced: boolean;
        cachedUsersCount: number;
        allowedSources: AllowedRagSourceType[];
    } {
        return {
            enabled:
                Boolean(this.dataSource?.isInitialized) &&
                this.embeddingService.getStatus().enabled,
            platformDocsSynced: this.platformDocsSynced,
            cachedUsersCount: this.userSyncTimestamps.size,
            allowedSources: [...ALLOWED_RAG_SOURCE_TYPES],
        };
    }

    private extractRows(res: unknown): Record<string, any>[] {
        if (Array.isArray(res)) return res;
        if (res && typeof res === 'object' && Array.isArray((res as any).rows)) {
            return (res as any).rows;
        }
        return [];
    }

    /**
     * Remove HTML, blobs base64 (imagens/prints em notas rich-text), caracteres de controlo
     * e instruções embutidas maliciosas antes de indexar chunks para RAG.
     */
    sanitizeAndChunkText(
        rawText: string,
        maxChunkChars = 680,
        overlapChars = 80
    ): string[] {
        const withoutMedia = String(rawText || '')
            .replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/gi, ' ')
            .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(
                /(ignore\s+(?:all\s+|previous\s+|prior\s+|todas\s+as\s+|anteriores\s+)*instru(?:ctions?|c[oõ]es|coes)|system\s*prompt|developer\s*mode|jailbreak|<\/?[a-z_][^>]*>)/gi,
                '[redacted]'
            );

        const cleaned = this.promptSystem.sanitizeUntrustedContextText(
            withoutMedia,
            4200
        );
        if (cleaned.length < 4) {
            return [];
        }

        if (cleaned.length <= maxChunkChars) {
            return [cleaned];
        }

        const chunks: string[] = [];
        let cursor = 0;
        const safeOverlap = Math.max(0, Math.min(overlapChars, Math.floor(maxChunkChars / 3)));

        while (cursor < cleaned.length && chunks.length < 6) {
            let end = Math.min(cleaned.length, cursor + maxChunkChars);
            if (end < cleaned.length) {
                const slice = cleaned.slice(cursor, end);
                const breakIdx = Math.max(
                    slice.lastIndexOf('\n'),
                    slice.lastIndexOf('. '),
                    slice.lastIndexOf('! '),
                    slice.lastIndexOf('? '),
                    slice.lastIndexOf(' ')
                );
                if (breakIdx > Math.floor(maxChunkChars * 0.45)) {
                    end = cursor + breakIdx + 1;
                }
            }

            const chunk = cleaned.slice(cursor, end).trim();
            if (chunk.length >= 4) {
                chunks.push(chunk);
            }
            if (end >= cleaned.length) {
                break;
            }
            const nextCursor = end - safeOverlap;
            cursor = nextCursor > cursor ? nextCursor : end;
        }

        return chunks;
    }

    private formatPsychCheck(
        psych: Record<string, any> | null | undefined
    ): string {
        if (!psych || typeof psych !== 'object') return '';
        const pairs = Object.entries(psych)
            .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
            .map(([k, v]) => `${k}=${String(v).trim()}`);
        return pairs.join(', ');
    }

    private async syncSourceItems(params: {
        sourceType: AllowedRagSourceType;
        userId?: string | null;
        items: RawRagItemInput[];
    }): Promise<RagSyncSourceReport> {
        const candidates: Array<{
            sourceId: string;
            chunkIndex: number;
            chunkKey: string;
            accountId: string | null;
            title: string | null;
            content: string;
            contentHash: string;
            metadata: Record<string, any>;
        }> = [];

        for (const item of params.items) {
            const cleanSourceId = String(item.sourceId || '').trim().slice(0, 128);
            if (!cleanSourceId) continue;

            const chunks = this.sanitizeAndChunkText(item.text);
            for (let idx = 0; idx < chunks.length; idx += 1) {
                const content = chunks[idx];
                const contentHash = this.embeddingService.computeContentHash(
                    content,
                    'RETRIEVAL_DOCUMENT'
                );
                candidates.push({
                    sourceId: cleanSourceId,
                    chunkIndex: idx,
                    chunkKey: `${cleanSourceId}:${idx}`,
                    accountId: item.accountId ? String(item.accountId).trim() : null,
                    title: item.title
                        ? this.promptSystem.sanitizeUntrustedContextText(
                              item.title,
                              180
                          ) || null
                        : null,
                    content,
                    contentHash,
                    metadata: item.metadata || {},
                });
            }
        }

        const existingHashes = await this.vectorStore.getExistingRagChunkHashes({
            sourceType: params.sourceType,
            userId: params.userId,
        });

        const keepChunkKeys = candidates.map((c) => c.chunkKey);
        const toEmbed = candidates.filter(
            (c) => existingHashes.get(c.chunkKey) !== c.contentHash
        );

        let syncedChunks = 0;
        if (toEmbed.length > 0) {
            const embeddings = await this.embeddingService.embedBatch(
                toEmbed.map((c) => ({
                    text: c.content,
                    taskType: 'RETRIEVAL_DOCUMENT' as const,
                }))
            );

            const upsertRows: UpsertRagChunkInput[] = [];
            for (let i = 0; i < toEmbed.length; i += 1) {
                const emb = embeddings[i];
                if (!emb) continue;
                const c = toEmbed[i];
                upsertRows.push({
                    sourceType: params.sourceType,
                    userId: params.userId,
                    accountId: c.accountId,
                    sourceId: c.sourceId,
                    chunkIndex: c.chunkIndex,
                    title: c.title,
                    content: c.content,
                    contentHash: c.contentHash,
                    embedding: emb.values,
                    embeddingModel: emb.model,
                    metadata: c.metadata,
                });
            }

            if (upsertRows.length > 0) {
                syncedChunks = await this.vectorStore.upsertRagChunks(upsertRows);
            }
        }

        const pruned = await this.vectorStore.deleteStaleRagChunks({
            sourceType: params.sourceType,
            userId: params.userId,
            keepChunkKeys,
        });

        return {
            syncedChunks,
            skippedUnchanged: candidates.length - toEmbed.length,
            pruned,
        };
    }

    async syncPlatformDocs(force = false): Promise<RagSyncSourceReport> {
        if (this.platformDocsSynced && !force) {
            return { syncedChunks: 0, skippedUnchanged: 0, pruned: 0 };
        }
        if (
            !this.embeddingService.getStatus().enabled ||
            !this.dataSource?.isInitialized
        ) {
            return { syncedChunks: 0, skippedUnchanged: 0, pruned: 0 };
        }

        const docs = this.knowledgeBase.getPlatformDocumentsForRag();
        const report = await this.syncSourceItems({
            sourceType: 'PLATFORM_DOC',
            userId: null,
            items: docs.map((d) => ({
                sourceId: d.sourceId,
                title: d.title,
                text: d.content,
                metadata: {
                    locale: d.locale,
                    routes: d.routes,
                    kind: d.kind,
                },
            })),
        });
        this.platformDocsSynced = true;
        return report;
    }

    /**
     * Sincroniza EXCLUSIVAMENTE as 5 fontes qualitativas pessoais aprovadas pela Decisão #6:
     * DAILY_NOTE, TRADE_NOTE, GENERAL_NOTE, TRADE_LESSON e PLAYBOOK.
     * Nunca indexa histórico bruto de trades sem lição nem sessões de execução/replay de backtesting.
     */
    async syncUserQualitativeSources(
        userId: string,
        options?: {
            includeJournalNotes?: boolean;
            includePlaybookRules?: boolean;
            force?: boolean;
        }
    ): Promise<{ syncedChunks: number; skippedUnchanged: number; pruned: number }> {
        const cleanUserId = String(userId || '').trim();
        if (
            !cleanUserId ||
            !this.dataSource?.isInitialized ||
            !this.embeddingService.getStatus().enabled
        ) {
            return { syncedChunks: 0, skippedUnchanged: 0, pruned: 0 };
        }

        const includeNotes = options?.includeJournalNotes !== false;
        const includePlaybook = options?.includePlaybookRules !== false;
        const throttleKey = `${cleanUserId}:${includeNotes ? 1 : 0}:${includePlaybook ? 1 : 0}`;
        const lastSyncedAt = this.userSyncTimestamps.get(throttleKey) || 0;

        if (
            !options?.force &&
            Date.now() - lastSyncedAt < USER_SYNC_THROTTLE_MS
        ) {
            return { syncedChunks: 0, skippedUnchanged: 0, pruned: 0 };
        }

        const ds = this.dataSource;
        let totalSynced = 0;
        let totalSkipped = 0;
        let totalPruned = 0;

        if (includeNotes) {
            const [dailyRows, tradeNoteRows, generalNoteRows, tradeLessonRows] =
                await Promise.all([
                    ds.query(
                        `SELECT id::text AS id, account_key, date::text AS date, title, content, mood, market_bias, psych_check FROM daily_notes WHERE user_id = $1 ORDER BY date DESC LIMIT 180`,
                        [cleanUserId]
                    ),
                    ds.query(
                        `SELECT tn.id::text AS id, tn.trade_id, tn.content, tn.setup, tn.mistakes, tn.lessons, tn.rating, tn.psych_check, t.account_id::text AS account_id, t.symbol FROM trade_notes tn LEFT JOIN trades t ON t.id::text = tn.trade_id WHERE tn.user_id = $1 ORDER BY tn.updated_at DESC LIMIT 180`,
                        [cleanUserId]
                    ),
                    ds.query(
                        `SELECT id::text AS id, title, category, content, pinned FROM general_notes WHERE user_id = $1 AND is_template = false AND UPPER(COALESCE(category, 'GENERAL')) <> 'PLAYBOOK' ORDER BY pinned DESC, updated_at DESC LIMIT 100`,
                        [cleanUserId]
                    ),
                    ds.query(
                        `SELECT t.id::text AS id, t.account_id::text AS account_id, t.symbol, t.setup, t.lesson, t.mood, t.close_time FROM trades t INNER JOIN accounts a ON a.id::text = t.account_id::text WHERE a.user_id = $1 AND a.is_archived = false AND t.lesson IS NOT NULL AND TRIM(t.lesson) <> '' ORDER BY t.close_time DESC NULLS LAST LIMIT 200`,
                        [cleanUserId]
                    ),
                ]);

            const dailyItems: RawRagItemInput[] = this.extractRows(dailyRows).map(
                (r) => {
                    const dateStr = String(r.date || '').slice(0, 10);
                    const psych = this.formatPsychCheck(r.psych_check);
                    const parts = [
                        dateStr ? `Data: ${dateStr}` : '',
                        r.title ? `Título: ${r.title}` : '',
                        r.mood ? `Humor: ${r.mood}` : '',
                        r.market_bias ? `Viés: ${r.market_bias}` : '',
                        psych ? `Check-in: ${psych}` : '',
                        r.content || '',
                    ].filter(Boolean);
                    return {
                        sourceId: String(r.id),
                        accountId:
                            r.account_key && r.account_key !== 'all'
                                ? String(r.account_key)
                                : null,
                        title: r.title
                            ? `${dateStr} — ${r.title}`
                            : `Daily Note ${dateStr}`,
                        text: parts.join(' | '),
                        metadata: { date: dateStr },
                    };
                }
            );

            const tradeNoteItems: RawRagItemInput[] = this.extractRows(
                tradeNoteRows
            ).map((r) => {
                const psych = this.formatPsychCheck(r.psych_check);
                const sym = r.symbol ? String(r.symbol).toUpperCase() : '';
                const parts = [
                    sym ? `Ativo: ${sym}` : '',
                    r.setup ? `Setup: ${r.setup}` : '',
                    Number(r.rating) > 0 ? `Nota: ${r.rating}/5` : '',
                    r.content ? `Nota: ${r.content}` : '',
                    r.mistakes ? `Erros: ${r.mistakes}` : '',
                    r.lessons ? `Lições: ${r.lessons}` : '',
                    psych ? `Estado: ${psych}` : '',
                ].filter(Boolean);
                return {
                    sourceId: String(r.id),
                    accountId: r.account_id ? String(r.account_id) : null,
                    title: sym
                        ? `Trade Note (${sym}${r.setup ? ` — ${r.setup}` : ''})`
                        : 'Trade Note',
                    text: parts.join(' | '),
                    metadata: {
                        tradeId: r.trade_id ? String(r.trade_id) : null,
                        symbol: sym || null,
                    },
                };
            });

            const generalNoteItems: RawRagItemInput[] = this.extractRows(
                generalNoteRows
            ).map((r) => {
                const cat = String(r.category || 'GENERAL').toUpperCase();
                return {
                    sourceId: String(r.id),
                    accountId: null,
                    title: `${r.title || 'Nota Geral'} [${cat}]`,
                    text: `[${cat}] ${r.title || ''}: ${r.content || ''}`,
                    metadata: { category: cat, pinned: Boolean(r.pinned) },
                };
            });

            const tradeLessonItems: RawRagItemInput[] = this.extractRows(
                tradeLessonRows
            ).map((r) => {
                const sym = String(r.symbol || '').toUpperCase();
                const dateStr = r.close_time
                    ? new Date(r.close_time).toISOString().slice(0, 10)
                    : '';
                const parts = [
                    `Lição de trade (${sym || 'ATIVO'}${r.setup ? `, setup ${r.setup}` : ''}${dateStr ? `, ${dateStr}` : ''}): ${r.lesson || ''}`,
                    r.mood ? `Humor: ${r.mood}` : '',
                ].filter(Boolean);
                return {
                    sourceId: String(r.id),
                    accountId: r.account_id ? String(r.account_id) : null,
                    title: sym ? `Lição ${sym}` : 'Lição de Trade',
                    text: parts.join(' | '),
                    metadata: { symbol: sym || null, date: dateStr || null },
                };
            });

            const reports = await Promise.all([
                this.syncSourceItems({
                    sourceType: 'DAILY_NOTE',
                    userId: cleanUserId,
                    items: dailyItems,
                }),
                this.syncSourceItems({
                    sourceType: 'TRADE_NOTE',
                    userId: cleanUserId,
                    items: tradeNoteItems,
                }),
                this.syncSourceItems({
                    sourceType: 'GENERAL_NOTE',
                    userId: cleanUserId,
                    items: generalNoteItems,
                }),
                this.syncSourceItems({
                    sourceType: 'TRADE_LESSON',
                    userId: cleanUserId,
                    items: tradeLessonItems,
                }),
            ]);

            for (const rep of reports) {
                totalSynced += rep.syncedChunks;
                totalSkipped += rep.skippedUnchanged;
                totalPruned += rep.pruned;
            }
        }

        if (includePlaybook) {
            const [playbookNoteRows, strategyRows] = await Promise.all([
                ds.query(
                    `SELECT id::text AS id, title, content, pinned FROM general_notes WHERE user_id = $1 AND is_template = false AND UPPER(COALESCE(category, '')) = 'PLAYBOOK' ORDER BY pinned DESC, updated_at DESC LIMIT 60`,
                    [cleanUserId]
                ),
                ds.query(
                    `SELECT id::text AS id, account_id::text AS account_id, name, symbol, config, notes FROM backtest_sessions WHERE user_id = $1 AND mode = 'STRATEGY_DEFINITION' ORDER BY updated_at DESC LIMIT 40`,
                    [cleanUserId]
                ),
            ]);

            const playbookItems: RawRagItemInput[] = [];

            for (const r of this.extractRows(playbookNoteRows)) {
                playbookItems.push({
                    sourceId: `gn:${String(r.id)}`,
                    accountId: null,
                    title: `Playbook — ${r.title || 'Regras'}`,
                    text: `Playbook ${r.title || ''}: ${r.content || ''}`,
                    metadata: { origin: 'general_notes', pinned: Boolean(r.pinned) },
                });
            }

            for (const s of this.extractRows(strategyRows)) {
                const cfg =
                    s.config && typeof s.config === 'object' ? s.config : {};
                const rules = Array.isArray(cfg.rules)
                    ? cfg.rules.map((rule: any) => String(rule || '').trim()).filter(Boolean)
                    : [];
                const parts = [
                    `Estratégia Playbook: ${s.name || 'Estratégia'}`,
                    s.symbol ? `Ativo principal: ${s.symbol}` : '',
                    cfg.tradingMethod ? `Método: ${cfg.tradingMethod}` : '',
                    cfg.description ? `Descrição: ${cfg.description}` : '',
                    rules.length > 0 ? `Regras: ${rules.join('; ')}` : '',
                    cfg.journalNotes ? `Notas: ${cfg.journalNotes}` : '',
                    s.notes ? `Observações: ${s.notes}` : '',
                ].filter(Boolean);
                playbookItems.push({
                    sourceId: `strategy:${String(s.id)}`,
                    accountId: s.account_id ? String(s.account_id) : null,
                    title: `Estratégia Playbook — ${s.name || 'Setup'}`,
                    text: parts.join(' | '),
                    metadata: { origin: 'strategy_definition' },
                });
            }

            const rep = await this.syncSourceItems({
                sourceType: 'PLAYBOOK',
                userId: cleanUserId,
                items: playbookItems,
            });
            totalSynced += rep.syncedChunks;
            totalSkipped += rep.skippedUnchanged;
            totalPruned += rep.pruned;
        }

        this.userSyncTimestamps.set(throttleKey, Date.now());
        return {
            syncedChunks: totalSynced,
            skippedUnchanged: totalSkipped,
            pruned: totalPruned,
        };
    }

    async retrieveForAnalyticsHandoff(params: {
        userId: string;
        accountId?: string | null;
        query: string;
        includeJournalNotes?: boolean;
        includePlaybookRules?: boolean;
        topK?: number;
        minSimilarity?: number;
    }): Promise<RagRetrievedContext> {
        const cleanUserId = String(params.userId || '').trim();
        const includeNotes = params.includeJournalNotes !== false;
        const includePlaybook = params.includePlaybookRules !== false;

        const sourceTypes: AllowedRagSourceType[] = [];
        if (includeNotes) {
            sourceTypes.push(
                'DAILY_NOTE',
                'TRADE_NOTE',
                'GENERAL_NOTE',
                'TRADE_LESSON'
            );
        }
        if (includePlaybook) {
            sourceTypes.push('PLAYBOOK');
        }

        if (
            !cleanUserId ||
            sourceTypes.length === 0 ||
            !this.dataSource?.isInitialized ||
            !this.embeddingService.getStatus().enabled
        ) {
            return { chunks: [], sourcesUsed: [], syncedChunks: 0 };
        }

        try {
            const syncReport = await this.syncUserQualitativeSources(
                cleanUserId,
                {
                    includeJournalNotes: includeNotes,
                    includePlaybookRules: includePlaybook,
                }
            );

            const queryEmb = await this.embeddingService.embedText(
                params.query,
                { taskType: 'RETRIEVAL_QUERY' }
            );
            if (!queryEmb) {
                return {
                    chunks: [],
                    sourcesUsed: [],
                    syncedChunks: syncReport.syncedChunks,
                };
            }

            const chunks = await this.vectorStore.searchRagChunks({
                queryVector: queryEmb.values,
                userId: cleanUserId,
                accountId: params.accountId,
                sourceTypes,
                topK: params.topK ?? 6,
                minSimilarity: params.minSimilarity ?? 0.4,
            });

            const sourcesUsed = Array.from(
                new Set(chunks.map((c) => c.sourceType))
            );
            return {
                chunks,
                sourcesUsed,
                syncedChunks: syncReport.syncedChunks,
            };
        } catch (err: any) {
            this.logger.warn(
                `Scoped analytics RAG retrieval fallback (${err?.message || err})`
            );
            return { chunks: [], sourcesUsed: [], syncedChunks: 0 };
        }
    }

    async retrievePlatformDocs(params: {
        query: string;
        topK?: number;
        minSimilarity?: number;
    }): Promise<RagRetrievedContext> {
        if (
            !this.dataSource?.isInitialized ||
            !this.embeddingService.getStatus().enabled
        ) {
            return { chunks: [], sourcesUsed: [], syncedChunks: 0 };
        }

        try {
            const syncReport = await this.syncPlatformDocs();
            const queryEmb = await this.embeddingService.embedText(
                params.query,
                { taskType: 'RETRIEVAL_QUERY' }
            );
            if (!queryEmb) {
                return {
                    chunks: [],
                    sourcesUsed: [],
                    syncedChunks: syncReport.syncedChunks,
                };
            }

            const chunks = await this.vectorStore.searchRagChunks({
                queryVector: queryEmb.values,
                userId: null,
                sourceTypes: ['PLATFORM_DOC'],
                topK: params.topK ?? 4,
                minSimilarity: params.minSimilarity ?? 0.4,
            });

            return {
                chunks,
                sourcesUsed: chunks.length > 0 ? ['PLATFORM_DOC'] : [],
                syncedChunks: syncReport.syncedChunks,
            };
        } catch (err: any) {
            this.logger.warn(
                `Platform doc RAG retrieval fallback (${err?.message || err})`
            );
            return { chunks: [], sourcesUsed: [], syncedChunks: 0 };
        }
    }
}
