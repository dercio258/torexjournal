import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { AiActionLink } from './ai-chat.entity';
import { AiEmbeddingService } from './ai-embedding.service';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import {
    applyAiLearningSchema,
    GLOBAL_MEMORY_OWNER_SCOPE,
    SemanticMemoryScope,
    SemanticMemoryStatus,
} from './ai-learning-schema';
import { AiPrivacySanitizerService } from './ai-privacy-sanitizer.service';
import { checkReuse } from './ai-reuse-guard';
import {
    DEFAULT_MEMORY_SCORING,
    MemoryScoringParams,
    SCORING_REFRESH_MS,
    sanitizeMemoryScoring,
} from './ai-memory-scoring';
import { AiDomainCategory } from './ai-prompt-system.service';
import {
    AI_EMBEDDING_DIMENSIONS,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
} from './ai-vector-schema';

export interface LexicalSynonymSeed {
    surfaceTerm: string;
    canonicalTerm: string;
    intentKey: string;
    domainCategory: AiDomainCategory;
    locale: 'pt' | 'en';
}

export interface HandoffTemplateRecord {
    analyticalObjective: string;
    subIntent: string;
    timeframeHint: string;
    includeJournalNotes: boolean;
    includePlaybookRules: boolean;
    includeBacktesting: boolean;
    focusMetrics: string[];
}

export interface SemanticMemoryRecord {
    id: string;
    scopeLevel: SemanticMemoryScope;
    ownerScope: string;
    userId: string | null;
    accountId: string | null;
    locale: 'pt' | 'en';
    domainCategory: AiDomainCategory;
    subIntent: string | null;
    intentKey: string | null;
    canonicalQuestion: string;
    normalizedQuestion: string;
    contentHash: string;
    variantPhrases: string[];
    embeddingModel: string;
    dimensions: number;
    embeddingF64: number[];
    cachedReply: string | null;
    handoffTemplate: HandoffTemplateRecord | null;
    actions: AiActionLink[];
    suggestions: string[];
    status: SemanticMemoryStatus;
    positiveCount: number;
    negativeCount: number;
    distinctPositiveUsers: number;
    positiveUserHashes: string[];
    hitCount: number;
    llmTokensSaved: number;
    trustScore: number;
    platformDocVersion: string | null;
    lastHitAt: string | null;
    updatedAt: string;
}

export interface MemoryLookupResult {
    hitType:
        | 'GLOBAL_SAFE_REPLY'
        | 'GLOBAL_INTENT_PATTERN'
        | 'USER_PRIVATE_REPLY'
        | 'HINT_ONLY'
        | 'NONE';
    match: SemanticMemoryRecord | null;
    hybridScore: number;
    vectorScore: number | null;
    lexicalScore: number;
    trustScore: number;
    expandedQuery: string;
    matchedSynonyms: string[];
}

interface CachedSynonymEntry {
    surfaceTerm: string;
    normalizedSurface: string;
    canonicalTerm: string;
    intentKey: string | null;
    domainCategory: string | null;
    locale: 'pt' | 'en';
    positiveWeight: number;
}

const STOPWORDS_PT_EN = new Set([
    'a',
    'o',
    'as',
    'os',
    'de',
    'do',
    'da',
    'dos',
    'das',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'para',
    'por',
    'com',
    'como',
    'que',
    'qual',
    'quais',
    'onde',
    'meu',
    'minha',
    'meus',
    'minhas',
    'seu',
    'sua',
    'the',
    'and',
    'for',
    'how',
    'what',
    'where',
    'when',
    'why',
    'with',
    'from',
    'my',
    'your',
    'is',
    'are',
    'do',
    'does',
    'can',
    'to',
    'in',
    'on',
    'of',
    'via',
    'ou',
    'or',
]);

export const SEED_LEXICAL_SYNONYMS: LexicalSynonymSeed[] = [
    {
        surfaceTerm: 'operacoes',
        canonicalTerm: 'trades',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'sincronizar trades',
        canonicalTerm: 'importar trades sincronizar',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'metrader',
        canonicalTerm: 'mt5 sincronizar',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'meta trader',
        canonicalTerm: 'mt5 sincronizar',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'metatrader5',
        canonicalTerm: 'mt5 sincronizar',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'puxar operacoes',
        canonicalTerm: 'importar trades sincronizar mt5',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'puxar trades',
        canonicalTerm: 'importar trades sincronizar mt5',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'subir planilha',
        canonicalTerm: 'importar trades csv excel',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'carregar historico',
        canonicalTerm: 'importar trades csv mt5',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'ilportar',
        canonicalTerm: 'importar',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'backetest',
        canonicalTerm: 'backtesting replay estrategia',
        intentKey: 'guide:backtesting_replay',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'simular estrategia',
        canonicalTerm: 'backtesting replay',
        intentKey: 'guide:backtesting_replay',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'ouro',
        canonicalTerm: 'xauusd',
        intentKey: 'symbol_focus',
        domainCategory: 'PERSONAL_ANALYTICS',
        locale: 'pt',
    },
    {
        surfaceTerm: 'gold',
        canonicalTerm: 'xauusd',
        intentKey: 'symbol_focus',
        domainCategory: 'PERSONAL_ANALYTICS',
        locale: 'en',
    },
    {
        surfaceTerm: 'revenge',
        canonicalTerm: 'overtrading emocional',
        intentKey: 'diagnostic_losses',
        domainCategory: 'PERSONAL_ANALYTICS',
        locale: 'pt',
    },
    {
        surfaceTerm: 'vinganca',
        canonicalTerm: 'overtrading emocional',
        intentKey: 'diagnostic_losses',
        domainCategory: 'PERSONAL_ANALYTICS',
        locale: 'pt',
    },
    {
        surfaceTerm: 'revenge trading',
        canonicalTerm: 'emotional overtrading discipline',
        intentKey: 'diagnostic_losses',
        domainCategory: 'PERSONAL_ANALYTICS',
        locale: 'en',
    },
    {
        surfaceTerm: 'quebrar conta',
        canonicalTerm: 'drawdown risco ruina',
        intentKey: 'concept:drawdown',
        domainCategory: 'TRADING_CONCEPTS',
        locale: 'pt',
    },
    {
        surfaceTerm: 'taxa acerto',
        canonicalTerm: 'winrate',
        intentKey: 'concept:expectancy',
        domainCategory: 'TRADING_CONCEPTS',
        locale: 'pt',
    },
    {
        surfaceTerm: 'risco retorno',
        canonicalTerm: 'payoff rr',
        intentKey: 'concept:expectancy',
        domainCategory: 'TRADING_CONCEPTS',
        locale: 'pt',
    },
    {
        surfaceTerm: 'anotacoes',
        canonicalTerm: 'diario journal notas',
        intentKey: 'guide:journal_notes',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'regras setup',
        canonicalTerm: 'playbook diario',
        intentKey: 'guide:journal_notes',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'pt',
    },
    {
        surfaceTerm: 'pull executions',
        canonicalTerm: 'import sync trades mt5',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'en',
    },
    {
        surfaceTerm: 'upload spreadsheet',
        canonicalTerm: 'import trades csv excel',
        intentKey: 'guide:import_trades',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        locale: 'en',
    },
    {
        surfaceTerm: 'blow account',
        canonicalTerm: 'drawdown risk of ruin',
        intentKey: 'concept:drawdown',
        domainCategory: 'TRADING_CONCEPTS',
        locale: 'en',
    },
];

@Injectable()
export class AiSemanticMemoryService implements OnApplicationBootstrap {
    private readonly logger = new Logger(AiSemanticMemoryService.name);
    private initialized = false;
    private pgvectorEnabled = false;
    private pgTrgmEnabled = false;
    private platformDocVersion = 'v1';
    private synonymsCache: CachedSynonymEntry[] = [];
    /** Reuse weights/thresholds; defaults are overridden by the AI lab via ai_tuning_params. */
    private scoring: MemoryScoringParams = { ...DEFAULT_MEMORY_SCORING };
    private scoringLoadedAt = 0;

    constructor(
        private readonly dataSource: DataSource,
        private readonly knowledgeBase: AiKnowledgeBaseService,
        private readonly privacySanitizer: AiPrivacySanitizerService,
        @Optional() private readonly embeddingService?: AiEmbeddingService
    ) {
        this.platformDocVersion = this.computePlatformDocVersion();
        this.synonymsCache = SEED_LEXICAL_SYNONYMS.map((s) => ({
            surfaceTerm: s.surfaceTerm,
            normalizedSurface: this.normalizeText(s.surfaceTerm),
            canonicalTerm: this.normalizeText(s.canonicalTerm),
            intentKey: s.intentKey,
            domainCategory: s.domainCategory,
            locale: s.locale,
            positiveWeight: 1.0,
        }));
    }

    async onApplicationBootstrap(): Promise<void> {
        await this.ensureInitialized();
    }

    async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        try {
            const schemaRes = await applyAiLearningSchema(
                this.dataSource,
                AI_EMBEDDING_DIMENSIONS
            );
            this.pgvectorEnabled = schemaRes.pgvectorEnabled;
            this.pgTrgmEnabled = schemaRes.pgTrgmEnabled;

            await this.retireStalePlatformMemories();
            await this.seedLexicalSynonyms();
            await this.refreshSynonymsCache();
            await this.refreshScoringParams();
            this.initialized = true;
        } catch (err) {
            this.logger.warn(
                `AiSemanticMemoryService init fallback (in-memory synonyms active): ${(err as Error).message}`
            );
        }
    }

    /** Similar is not the same: blocks reuse across personal/generic, symbols and periods. */
    private passesReuseGuard(
        question: string,
        record: SemanticMemoryRecord,
        scope: 'GLOBAL' | 'PRIVATE'
    ): boolean {
        const stored = record.canonicalQuestion || record.normalizedQuestion;
        const verdict = checkReuse(question, stored, scope, {
            domainCategory: record.domainCategory,
        });
        if (!verdict.ok) {
            this.logger.debug?.(`Memory reuse blocked (${verdict.reason}) for ${record.id}`);
        }
        return verdict.ok;
    }

    getScoringParams(): MemoryScoringParams {
        return { ...this.scoring };
    }

    /**
     * Loads the tuned weights and thresholds published by the AI lab (quant-engine
     * scripts/run_ai_lab.py --apply). Missing table, missing row or out-of-range values
     * keep the defaults. Refreshed at most every 30 minutes.
     */
    async refreshScoringParams(force = false): Promise<MemoryScoringParams> {
        if (!force && Date.now() - this.scoringLoadedAt < SCORING_REFRESH_MS) return this.scoring;
        this.scoringLoadedAt = Date.now();
        try {
            const res = await this.dataSource.query(
                `SELECT value FROM ai_tuning_params WHERE key = 'semantic_memory_scoring' LIMIT 1`
            );
            const raw = this.extractRows(res)[0]?.value;
            const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
            this.scoring = sanitizeMemoryScoring(value);
        } catch {
            this.scoring = { ...DEFAULT_MEMORY_SCORING };
        }
        return this.scoring;
    }

    getPlatformDocVersion(): string {
        return this.platformDocVersion;
    }

    normalizeAccountScope(accountId?: string | null): string | null {
        const raw = String(accountId ?? '').trim();
        if (!raw || raw === 'all' || raw === 'undefined' || raw === 'null') {
            return null;
        }
        return raw;
    }

    getStatus() {
        return {
            enabled: true,
            initialized: this.initialized,
            pgvectorEnabled: this.pgvectorEnabled,
            pgTrgmEnabled: this.pgTrgmEnabled,
            platformDocVersion: this.platformDocVersion,
            synonymsLoaded: this.synonymsCache.length,
        };
    }

    normalizeText(raw: string): string {
        return String(raw || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}<>\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    computePlatformDocVersion(): string {
        const docs = this.knowledgeBase.getPlatformDocumentsForRag();
        const serialized = JSON.stringify(
            docs.map((d) => ({
                id: d.sourceId,
                c: d.content,
                r: d.routes,
            }))
        );
        return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
    }

    computeContentHash(text: string, suffix = ''): string {
        return createHash('sha256')
            .update(`${this.normalizeText(text)}::${suffix}`)
            .digest('hex')
            .slice(0, 48);
    }

    /**
     * Exact Dice/Sorensen 3-gram similarity (matching pg_trgm semantics on padded strings).
     */
    computeTrigramSimilarity(aRaw: string, bRaw: string): number {
        const a = this.normalizeText(aRaw);
        const b = this.normalizeText(bRaw);
        if (!a || !b) return 0;
        if (a === b) return 1;

        const trigrams = (str: string): Set<string> => {
            const padded = `  ${str} `;
            const out = new Set<string>();
            for (let i = 0; i <= padded.length - 3; i += 1) {
                out.add(padded.slice(i, i + 3));
            }
            return out;
        };

        const setA = trigrams(a);
        const setB = trigrams(b);
        if (setA.size === 0 || setB.size === 0) return 0;

        let intersection = 0;
        for (const gram of setA) {
            if (setB.has(gram)) intersection += 1;
        }
        const denom = setA.size + setB.size;
        return denom > 0 ? (2 * intersection) / denom : 0;
    }

    computeLexicalSimilarity(aRaw: string, bRaw: string): number {
        const a = this.normalizeText(aRaw);
        const b = this.normalizeText(bRaw);
        if (!a || !b) return 0;
        if (a === b) return 1;

        const trigram = this.computeTrigramSimilarity(a, b);
        const tokensA = Array.from(
            new Set(
                a
                    .split(' ')
                    .filter((t) => t.length >= 2 && !STOPWORDS_PT_EN.has(t))
            )
        );
        const tokensB = Array.from(
            new Set(
                b
                    .split(' ')
                    .filter((t) => t.length >= 2 && !STOPWORDS_PT_EN.has(t))
            )
        );

        if (tokensA.length === 0 || tokensB.length === 0) {
            return trigram;
        }

        const setB = new Set(tokensB);
        let fuzzyOverlapSum = 0;
        for (const ta of tokensA) {
            if (setB.has(ta)) {
                fuzzyOverlapSum += 1;
                continue;
            }
            let bestTokenSim = 0;
            for (const tb of tokensB) {
                const sim = this.computeTrigramSimilarity(ta, tb);
                if (sim > bestTokenSim) bestTokenSim = sim;
            }
            if (bestTokenSim >= 0.68) {
                fuzzyOverlapSum += bestTokenSim;
            }
        }

        const tokenJaccardLike =
            fuzzyOverlapSum / Math.max(tokensA.length, tokensB.length);
        const baseSim = 0.55 * trigram + 0.45 * tokenJaccardLike;
        if (tokenJaccardLike >= 0.95) {
            return Math.min(1, Math.max(baseSim, 0.92 * tokenJaccardLike));
        }
        return Math.min(1, baseSim);
    }

    computeCosineSimilarity(a?: number[] | null, b?: number[] | null): number {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0) {
            return 0;
        }
        if (a.length !== b.length) return 0;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i += 1) {
            const x = Number(a[i]) || 0;
            const y = Number(b[i]) || 0;
            dot += x * y;
            normA += x * x;
            normB += y * y;
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        if (!denom || !Number.isFinite(denom)) return 0;
        return Math.max(0, Math.min(1, dot / denom));
    }

    computeTrustScore(
        positiveCount: number,
        negativeCount: number,
        distinctPositiveUsers: number,
        adminApproved = false
    ): number {
        if (adminApproved && negativeCount === 0) {
            return 0.95;
        }
        const pos = Math.max(0, Number(positiveCount) || 0);
        const neg = Math.max(0, Number(negativeCount) || 0);
        const smoothed = (pos + 2) / (pos + neg + 4);
        const quorumBonus =
            neg === 0 ? Math.min(0.18, Math.max(0, distinctPositiveUsers) * 0.06) : 0;
        return Number(
            Math.max(0.05, Math.min(0.99, smoothed + quorumBonus)).toFixed(4)
        );
    }

    /**
     * Expands typos, slang and broker synonyms via seeded + DB-learned closest-word map.
     */
    expandWithClosestWords(
        rawOrNormalizedQuery: string,
        locale: 'pt' | 'en'
    ): {
        expandedQuery: string;
        canonicalizedQuery: string;
        matchedSynonyms: string[];
        canonicalAdditions: string[];
    } {
        const cleanQuery = this.normalizeText(rawOrNormalizedQuery);
        if (!cleanQuery) {
            return {
                expandedQuery: '',
                canonicalizedQuery: '',
                matchedSynonyms: [],
                canonicalAdditions: [],
            };
        }

        const matchedSynonyms: string[] = [];
        const canonicalAdditions: string[] = [];
        const additionsSeen = new Set<string>(cleanQuery.split(' '));

        const localeSynonyms = [...this.synonymsCache]
            .filter(
                (s) => s.locale === locale || s.normalizedSurface.length >= 4
            )
            .sort(
                (a, b) => b.normalizedSurface.length - a.normalizedSurface.length
            );

        const recordSynMatch = (surface: string, canonicalTerm: string) => {
            const pairLabel = `${surface}->${canonicalTerm}`;
            if (!matchedSynonyms.includes(pairLabel)) {
                matchedSynonyms.push(pairLabel);
            }
            for (const ct of canonicalTerm.split(' ')) {
                if (ct && !additionsSeen.has(ct)) {
                    additionsSeen.add(ct);
                    canonicalAdditions.push(ct);
                }
            }
        };

        let workingQuery = cleanQuery;
        const multiWordSyns = localeSynonyms.filter((s) =>
            s.normalizedSurface.includes(' ')
        );
        for (const syn of multiWordSyns) {
            const surface = syn.normalizedSurface;
            if (!surface) continue;
            const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const phraseRx = new RegExp(`(^|\\s)${escaped}(?=$|\\s)`, 'g');
            if (phraseRx.test(workingQuery)) {
                recordSynMatch(surface, syn.canonicalTerm);
                workingQuery = workingQuery
                    .replace(phraseRx, `$1${syn.canonicalTerm}`)
                    .replace(/\s+/g, ' ')
                    .trim();
            }
        }

        const singleWordSyns = localeSynonyms.filter(
            (s) => s.normalizedSurface && !s.normalizedSurface.includes(' ')
        );
        const workingTokens = workingQuery.split(' ').filter(Boolean);
        const replacedTokens: string[] = [];

        for (const qt of workingTokens) {
            let matchedSyn: CachedSynonymEntry | null =
                singleWordSyns.find((syn) => qt === syn.normalizedSurface) ||
                null;

            if (!matchedSyn && qt.length >= 4 && !STOPWORDS_PT_EN.has(qt)) {
                let bestSim = 0;
                for (const syn of singleWordSyns) {
                    const surface = syn.normalizedSurface;
                    if (surface.length < 4) continue;
                    const canonicalParts = syn.canonicalTerm
                        .split(' ')
                        .filter(Boolean);
                    if (canonicalParts.includes(qt)) continue;
                    const sim = this.computeTrigramSimilarity(qt, surface);
                    if (sim >= 0.62 && sim > bestSim) {
                        bestSim = sim;
                        matchedSyn = syn;
                    }
                }
            }
            if (matchedSyn) {
                recordSynMatch(matchedSyn.normalizedSurface, matchedSyn.canonicalTerm);
                for (const ct of matchedSyn.canonicalTerm.split(' ')) {
                    if (ct) replacedTokens.push(ct);
                }
            } else {
                replacedTokens.push(qt);
            }
        }

        const dedupedCanonical: string[] = [];
        const seenCanonical = new Set<string>();
        for (const tok of replacedTokens) {
            if (!seenCanonical.has(tok)) {
                seenCanonical.add(tok);
                dedupedCanonical.push(tok);
            }
        }

        const canonicalizedQuery = dedupedCanonical.join(' ').trim() || cleanQuery;
        const expandedQuery =
            canonicalAdditions.length > 0
                ? `${cleanQuery} ${canonicalAdditions.join(' ')}`.trim()
                : cleanQuery;

        return {
            expandedQuery,
            canonicalizedQuery,
            matchedSynonyms,
            canonicalAdditions,
        };
    }

    async lookupMemory(params: {
        userId?: string | null;
        accountId?: string | null;
        trimmedQuestion: string;
        normalizedLookup: string;
        locale: 'pt' | 'en';
        domainHint?: AiDomainCategory;
    }): Promise<MemoryLookupResult> {
        // Picks up newly published lab parameters (throttled to every 30 min, never blocks).
        void this.refreshScoringParams().catch(() => undefined);
        const expansion = this.expandWithClosestWords(
            params.normalizedLookup || params.trimmedQuestion,
            params.locale
        );
        const anonymizedQueryPattern =
            this.privacySanitizer.buildAnonymizedIntentPattern({
                question: params.trimmedQuestion || params.normalizedLookup,
                normalizedQuestion:
                    expansion.canonicalizedQuery || params.normalizedLookup,
                handoff: {
                    formalizedQuestion: '',
                    analyticalObjective: '',
                    subIntent: 'STATUS_OVERVIEW',
                    targetSymbols: [],
                    timeframeHint: 'all_history',
                    includeJournalNotes: false,
                    includePlaybookRules: false,
                    includeBacktesting: false,
                    focusMetrics: [],
                },
            }).normalizedPattern;

        let queryEmbedding: number[] | null = null;
        if (this.embeddingService?.getStatus()?.enabled && expansion.expandedQuery) {
            try {
                const emb = await this.embeddingService.embedText(
                    expansion.expandedQuery,
                    { taskType: 'RETRIEVAL_QUERY' }
                );
                queryEmbedding = emb?.values || null;
            } catch {
                queryEmbedding = null;
            }
        }

        const queryAccountScope = this.normalizeAccountScope(params.accountId);
        const rows = await this.fetchActiveMemoryCandidates({
            locale: params.locale,
            userId: params.userId || null,
            accountId: queryAccountScope,
            expandedQuery: expansion.expandedQuery,
            queryEmbedding,
        });

        if (rows.length === 0) {
            return {
                hitType: 'NONE',
                match: null,
                hybridScore: 0,
                vectorScore: null,
                lexicalScore: 0,
                trustScore: 0,
                expandedQuery: expansion.expandedQuery,
                matchedSynonyms: expansion.matchedSynonyms,
            };
        }

        let bestRecord: SemanticMemoryRecord | null = null;
        let bestHybrid = 0;
        let bestVec: number | null = null;
        let bestLex = 0;
        let bestTrust = 0;

        for (const row of rows) {
            if (
                row.scopeLevel === 'GLOBAL_SAFE' &&
                row.domainCategory === 'PLATFORM_KNOWLEDGE' &&
                row.platformDocVersion &&
                row.platformDocVersion !== this.platformDocVersion
            ) {
                continue;
            }

            if (row.scopeLevel === 'GLOBAL_INTENT_PATTERN' && row.cachedReply !== null) {
                continue;
            }

            if (
                row.scopeLevel === 'GLOBAL_SAFE' &&
                params.domainHint === 'PERSONAL_ANALYTICS'
            ) {
                continue;
            }

            if (
                row.scopeLevel === 'USER_PRIVATE' &&
                (!params.userId ||
                    row.ownerScope !== params.userId ||
                    this.normalizeAccountScope(row.accountId) !== queryAccountScope)
            ) {
                continue;
            }

            const candidatesText = Array.from(
                new Set(
                    [
                        row.normalizedQuestion,
                        this.expandWithClosestWords(
                            row.normalizedQuestion,
                            params.locale
                        ).canonicalizedQuery,
                        ...(row.variantPhrases || []).flatMap((v) => {
                            const exp = this.expandWithClosestWords(
                                v,
                                params.locale
                            );
                            return [exp.expandedQuery, exp.canonicalizedQuery];
                        }),
                    ].filter(Boolean)
                )
            );

            let sLex = 0;
            for (const cand of candidatesText) {
                const simExpanded = this.computeLexicalSimilarity(
                    expansion.expandedQuery,
                    cand
                );
                const simCanonical = this.computeLexicalSimilarity(
                    expansion.canonicalizedQuery,
                    cand
                );
                const simRaw = this.computeLexicalSimilarity(
                    params.normalizedLookup,
                    cand
                );
                const simMasked =
                    row.scopeLevel === 'GLOBAL_INTENT_PATTERN'
                        ? this.computeLexicalSimilarity(
                              anonymizedQueryPattern,
                              cand
                          )
                        : 0;
                sLex = Math.max(sLex, simExpanded, simCanonical, simRaw, simMasked);
            }

            let sVec: number | null = null;
            if (
                queryEmbedding &&
                Array.isArray(row.embeddingF64) &&
                row.embeddingF64.length === queryEmbedding.length &&
                row.embeddingF64.length > 0
            ) {
                sVec = this.computeCosineSimilarity(queryEmbedding, row.embeddingF64);
            }

            const sTrust = Number(row.trustScore ?? 0.5);
            const sc = this.scoring;
            const lexicalOnly =
                sc.lexical_only_weight * sLex + (1 - sc.lexical_only_weight) * sTrust;
            const hybridScore =
                sVec !== null
                    ? Math.max(
                          sc.w_vec * sVec + sc.w_lex * sLex + (1 - sc.w_vec - sc.w_lex) * sTrust,
                          sLex >= sc.lexical_gate ? lexicalOnly : 0
                      )
                    : lexicalOnly;

            if (hybridScore > bestHybrid) {
                bestHybrid = Number(hybridScore.toFixed(4));
                bestVec = sVec !== null ? Number(sVec.toFixed(4)) : null;
                bestLex = Number(sLex.toFixed(4));
                bestTrust = sTrust;
                bestRecord = row;
            }
        }

        if (!bestRecord) {
            return {
                hitType: 'NONE',
                match: null,
                hybridScore: 0,
                vectorScore: null,
                lexicalScore: 0,
                trustScore: 0,
                expandedQuery: expansion.expandedQuery,
                matchedSynonyms: expansion.matchedSynonyms,
            };
        }

        if (
            bestRecord.scopeLevel === 'GLOBAL_SAFE' &&
            bestHybrid >= this.scoring.threshold_global &&
            bestRecord.cachedReply &&
            this.passesReuseGuard(params.trimmedQuestion, bestRecord, 'GLOBAL')
        ) {
            void this.recordMemoryHit(bestRecord.id, 450);
            return {
                hitType: 'GLOBAL_SAFE_REPLY',
                match: bestRecord,
                hybridScore: bestHybrid,
                vectorScore: bestVec,
                lexicalScore: bestLex,
                trustScore: bestTrust,
                expandedQuery: expansion.expandedQuery,
                matchedSynonyms: expansion.matchedSynonyms,
            };
        }

        if (
            bestRecord.scopeLevel === 'USER_PRIVATE' &&
            bestHybrid >= this.scoring.threshold_private &&
            bestRecord.cachedReply &&
            params.userId &&
            bestRecord.ownerScope === params.userId &&
            this.normalizeAccountScope(bestRecord.accountId) === queryAccountScope &&
            this.passesReuseGuard(params.trimmedQuestion, bestRecord, 'PRIVATE')
        ) {
            void this.recordMemoryHit(bestRecord.id, 450);
            return {
                hitType: 'USER_PRIVATE_REPLY',
                match: bestRecord,
                hybridScore: bestHybrid,
                vectorScore: bestVec,
                lexicalScore: bestLex,
                trustScore: bestTrust,
                expandedQuery: expansion.expandedQuery,
                matchedSynonyms: expansion.matchedSynonyms,
            };
        }

        if (
            bestRecord.scopeLevel === 'GLOBAL_INTENT_PATTERN' &&
            bestHybrid >= this.scoring.threshold_intent_pattern &&
            bestRecord.cachedReply === null &&
            bestRecord.handoffTemplate
        ) {
            void this.recordMemoryHit(bestRecord.id, 320);
            return {
                hitType: 'GLOBAL_INTENT_PATTERN',
                match: bestRecord,
                hybridScore: bestHybrid,
                vectorScore: bestVec,
                lexicalScore: bestLex,
                trustScore: bestTrust,
                expandedQuery: expansion.expandedQuery,
                matchedSynonyms: expansion.matchedSynonyms,
            };
        }

        if (bestHybrid >= 0.72) {
            return {
                hitType: 'HINT_ONLY',
                match: bestRecord,
                hybridScore: bestHybrid,
                vectorScore: bestVec,
                lexicalScore: bestLex,
                trustScore: bestTrust,
                expandedQuery: expansion.expandedQuery,
                matchedSynonyms: expansion.matchedSynonyms,
            };
        }

        return {
            hitType: 'NONE',
            match: null,
            hybridScore: bestHybrid,
            vectorScore: bestVec,
            lexicalScore: bestLex,
            trustScore: bestTrust,
            expandedQuery: expansion.expandedQuery,
            matchedSynonyms: expansion.matchedSynonyms,
        };
    }

    async upsertGlobalSafeCandidate(params: {
        locale: 'pt' | 'en';
        domainCategory: 'PLATFORM_KNOWLEDGE' | 'TRADING_CONCEPTS';
        intentKey: string;
        question: string;
        normalizedQuestion: string;
        reply: string;
        actions?: AiActionLink[];
        suggestions?: string[];
        userHash: string;
    }): Promise<SemanticMemoryRecord | null> {
        const cleanNorm = this.normalizeText(
            params.normalizedQuestion || params.question
        );
        if (!cleanNorm || !params.reply) return null;

        let embedding: number[] = [];
        let embeddingModel = DEFAULT_GEMINI_EMBEDDING_MODEL;
        if (this.embeddingService?.getStatus()?.enabled) {
            try {
                const emb = await this.embeddingService.embedText(params.question, {
                    taskType: 'RETRIEVAL_DOCUMENT',
                });
                if (emb?.values?.length) {
                    embedding = emb.values;
                    embeddingModel = emb.model;
                }
            } catch {
                embedding = [];
            }
        }

        const existingRows = await this.fetchGlobalClusterCandidates(
            params.locale,
            'GLOBAL_SAFE',
            params.domainCategory
        );

        const cleanCanonical = this.expandWithClosestWords(
            cleanNorm,
            params.locale
        ).canonicalizedQuery;
        const sameSpecificIntentCandidate = Boolean(
            params.intentKey &&
                params.intentKey !== 'platform_qa' &&
                params.intentKey !== 'general'
        );

        let clusterMatch: SemanticMemoryRecord | null = null;
        for (const row of existingRows) {
            if (row.status === 'QUARANTINED' || row.status === 'RETIRED') {
                continue;
            }
            const vecSim =
                embedding.length > 0 && row.embeddingF64.length === embedding.length
                    ? this.computeCosineSimilarity(embedding, row.embeddingF64)
                    : 0;
            const rowCanonical = this.expandWithClosestWords(
                row.normalizedQuestion,
                params.locale
            ).canonicalizedQuery;
            const variantSims = (row.variantPhrases || []).flatMap((v) => {
                const vCanon = this.expandWithClosestWords(
                    v,
                    params.locale
                ).canonicalizedQuery;
                return [
                    this.computeLexicalSimilarity(cleanNorm, v),
                    this.computeLexicalSimilarity(cleanCanonical, vCanon),
                ];
            });
            const lexSim = Math.max(
                this.computeLexicalSimilarity(cleanNorm, row.normalizedQuestion),
                this.computeLexicalSimilarity(cleanCanonical, row.normalizedQuestion),
                this.computeLexicalSimilarity(cleanCanonical, rowCanonical),
                ...variantSims
            );
            const sameSpecificIntent =
                sameSpecificIntentCandidate && row.intentKey === params.intentKey;
            if (
                vecSim >= 0.9 ||
                lexSim >= 0.8 ||
                (sameSpecificIntent && lexSim >= 0.58)
            ) {
                clusterMatch = row;
                break;
            }
        }

        const docVer =
            params.domainCategory === 'PLATFORM_KNOWLEDGE'
                ? this.platformDocVersion
                : null;

        if (clusterMatch) {
            const hashes = Array.from(
                new Set([...(clusterMatch.positiveUserHashes || []), params.userHash])
            );
            const variants = Array.from(
                new Set([
                    ...(clusterMatch.variantPhrases || []),
                    ...(cleanNorm !== clusterMatch.normalizedQuestion ? [cleanNorm] : []),
                ])
            ).slice(0, 25);

            const newPos = clusterMatch.positiveCount + 1;
            const newDistinct = hashes.length;
            const newTrust = this.computeTrustScore(
                newPos,
                clusterMatch.negativeCount,
                newDistinct
            );
            const approvalRatio = newPos / Math.max(1, newPos + clusterMatch.negativeCount);
            const nextStatus: SemanticMemoryStatus =
                clusterMatch.status === 'ACTIVE'
                    ? 'ACTIVE'
                    : newDistinct >= 3 && newTrust >= 0.8 && approvalRatio >= 0.85
                    ? 'ACTIVE'
                    : 'CANDIDATE';

            await this.dataSource.query(
                `
                UPDATE ai_semantic_memory
                SET variant_phrases = $1::jsonb,
                    positive_count = $2,
                    distinct_positive_users = $3,
                    positive_user_hashes = $4::jsonb,
                    trust_score = $5,
                    status = $6,
                    platform_doc_version = COALESCE($7, platform_doc_version),
                    updated_at = now()
                WHERE id = $8
                `,
                [
                    JSON.stringify(variants),
                    newPos,
                    newDistinct,
                    JSON.stringify(hashes),
                    newTrust,
                    nextStatus,
                    docVer,
                    clusterMatch.id,
                ]
            );

            await this.maybeMineSynonymFromVariants(
                clusterMatch.normalizedQuestion,
                cleanNorm,
                params.intentKey,
                params.domainCategory,
                params.locale
            );

            return {
                ...clusterMatch,
                variantPhrases: variants,
                positiveCount: newPos,
                distinctPositiveUsers: newDistinct,
                positiveUserHashes: hashes,
                trustScore: newTrust,
                status: nextStatus,
            };
        }

        const contentHash = this.computeContentHash(cleanNorm, params.domainCategory);
        const initialTrust = this.computeTrustScore(1, 0, 1);
        const inserted = await this.dataSource.query(
            `
            INSERT INTO ai_semantic_memory (
                scope_level, owner_scope, user_id, account_id, locale, domain_category,
                sub_intent, intent_key, canonical_question, normalized_question, content_hash,
                variant_phrases, embedding_model, dimensions, embedding_f64,
                cached_reply, handoff_template, actions, suggestions,
                status, positive_count, negative_count, distinct_positive_users, positive_user_hashes,
                trust_score, platform_doc_version
            )
            VALUES (
                'GLOBAL_SAFE', $1, NULL, NULL, $2, $3,
                NULL, $4, $5, $6, $7,
                $8::jsonb, $9, $10, $11::double precision[],
                $12, NULL, $13::jsonb, $14::jsonb,
                'CANDIDATE', 1, 0, 1, $15::jsonb,
                $16, $17
            )
            ON CONFLICT (owner_scope, scope_level, locale, content_hash) DO UPDATE
            SET updated_at = now()
            RETURNING *
            `,
            [
                GLOBAL_MEMORY_OWNER_SCOPE,
                params.locale,
                params.domainCategory,
                params.intentKey || 'platform_qa',
                params.question.slice(0, 400),
                cleanNorm,
                contentHash,
                JSON.stringify([]),
                embeddingModel,
                embedding.length || AI_EMBEDDING_DIMENSIONS,
                embedding.length ? embedding : [],
                params.reply,
                JSON.stringify(params.actions || []),
                JSON.stringify(params.suggestions || []),
                JSON.stringify([params.userHash]),
                initialTrust,
                docVer,
            ]
        );

        const row = this.extractRows(inserted)[0];
        if (row && this.pgvectorEnabled && embedding.length === AI_EMBEDDING_DIMENSIONS) {
            await this.dataSource
                .query(
                    `UPDATE ai_semantic_memory SET embedding_vector = $1::vector WHERE id = $2`,
                    [`[${embedding.join(',')}]`, row.id]
                )
                .catch(() => undefined);
        }

        return row ? this.mapDbRow(row) : null;
    }

    async upsertGlobalIntentPatternCandidate(params: {
        locale: 'pt' | 'en';
        intentKey: string;
        canonicalPattern: string;
        normalizedPattern: string;
        handoffTemplate: HandoffTemplateRecord;
        userHash: string;
    }): Promise<SemanticMemoryRecord | null> {
        const cleanNorm = this.normalizeText(params.normalizedPattern);
        if (!cleanNorm) return null;

        let embedding: number[] = [];
        let embeddingModel = DEFAULT_GEMINI_EMBEDDING_MODEL;
        if (this.embeddingService?.getStatus()?.enabled) {
            try {
                const emb = await this.embeddingService.embedText(
                    params.canonicalPattern,
                    { taskType: 'CLASSIFICATION' }
                );
                if (emb?.values?.length) {
                    embedding = emb.values;
                    embeddingModel = emb.model;
                }
            } catch {
                embedding = [];
            }
        }

        const existingRows = await this.fetchGlobalClusterCandidates(
            params.locale,
            'GLOBAL_INTENT_PATTERN',
            'PERSONAL_ANALYTICS'
        );

        let clusterMatch: SemanticMemoryRecord | null = null;
        for (const row of existingRows) {
            if (row.status === 'QUARANTINED' || row.status === 'RETIRED') {
                continue;
            }
            const vecSim =
                embedding.length > 0 && row.embeddingF64.length === embedding.length
                    ? this.computeCosineSimilarity(embedding, row.embeddingF64)
                    : 0;
            const lexSim = this.computeLexicalSimilarity(
                cleanNorm,
                row.normalizedQuestion
            );
            if (
                (vecSim >= 0.88 || lexSim >= 0.82) &&
                row.subIntent === params.handoffTemplate.subIntent
            ) {
                clusterMatch = row;
                break;
            }
        }

        if (clusterMatch) {
            const hashes = Array.from(
                new Set([...(clusterMatch.positiveUserHashes || []), params.userHash])
            );
            const variants = Array.from(
                new Set([
                    ...(clusterMatch.variantPhrases || []),
                    ...(cleanNorm !== clusterMatch.normalizedQuestion ? [cleanNorm] : []),
                ])
            ).slice(0, 25);

            const newPos = clusterMatch.positiveCount + 1;
            const newDistinct = hashes.length;
            const newTrust = this.computeTrustScore(
                newPos,
                clusterMatch.negativeCount,
                newDistinct
            );
            const approvalRatio = newPos / Math.max(1, newPos + clusterMatch.negativeCount);
            const nextStatus: SemanticMemoryStatus =
                clusterMatch.status === 'ACTIVE'
                    ? 'ACTIVE'
                    : newDistinct >= 3 && newTrust >= 0.8 && approvalRatio >= 0.85
                    ? 'ACTIVE'
                    : 'CANDIDATE';

            await this.dataSource.query(
                `
                UPDATE ai_semantic_memory
                SET variant_phrases = $1::jsonb,
                    positive_count = $2,
                    distinct_positive_users = $3,
                    positive_user_hashes = $4::jsonb,
                    trust_score = $5,
                    status = $6,
                    updated_at = now()
                WHERE id = $7
                `,
                [
                    JSON.stringify(variants),
                    newPos,
                    newDistinct,
                    JSON.stringify(hashes),
                    newTrust,
                    nextStatus,
                    clusterMatch.id,
                ]
            );

            return {
                ...clusterMatch,
                variantPhrases: variants,
                positiveCount: newPos,
                distinctPositiveUsers: newDistinct,
                positiveUserHashes: hashes,
                trustScore: newTrust,
                status: nextStatus,
            };
        }

        const contentHash = this.computeContentHash(
            cleanNorm,
            `PATTERN:${params.handoffTemplate.subIntent}`
        );
        const initialTrust = this.computeTrustScore(1, 0, 1);

        // STRICT INVARIANT: cached_reply is ALWAYS NULL on GLOBAL_INTENT_PATTERN!
        const inserted = await this.dataSource.query(
            `
            INSERT INTO ai_semantic_memory (
                scope_level, owner_scope, user_id, account_id, locale, domain_category,
                sub_intent, intent_key, canonical_question, normalized_question, content_hash,
                variant_phrases, embedding_model, dimensions, embedding_f64,
                cached_reply, handoff_template, actions, suggestions,
                status, positive_count, negative_count, distinct_positive_users, positive_user_hashes,
                trust_score, platform_doc_version
            )
            VALUES (
                'GLOBAL_INTENT_PATTERN', $1, NULL, NULL, $2, 'PERSONAL_ANALYTICS',
                $3, $4, $5, $6, $7,
                $8::jsonb, $9, $10, $11::double precision[],
                NULL, $12::jsonb, '[]'::jsonb, '[]'::jsonb,
                'CANDIDATE', 1, 0, 1, $13::jsonb,
                $14, NULL
            )
            ON CONFLICT (owner_scope, scope_level, locale, content_hash) DO UPDATE
            SET updated_at = now()
            RETURNING *
            `,
            [
                GLOBAL_MEMORY_OWNER_SCOPE,
                params.locale,
                params.handoffTemplate.subIntent,
                params.intentKey || params.handoffTemplate.subIntent.toLowerCase(),
                params.canonicalPattern.slice(0, 300),
                cleanNorm,
                contentHash,
                JSON.stringify([]),
                embeddingModel,
                embedding.length || AI_EMBEDDING_DIMENSIONS,
                embedding.length ? embedding : [],
                JSON.stringify(params.handoffTemplate),
                JSON.stringify([params.userHash]),
                initialTrust,
            ]
        );

        const row = this.extractRows(inserted)[0];
        return row ? this.mapDbRow(row) : null;
    }

    /**
     * Persiste uma memória privada escopada estritamente ao par (userId, accountId),
     * impedindo vazamento semântico entre contas diferentes do mesmo utilizador.
     */
    async upsertUserPrivateMemory(params: {
        userId: string;
        accountId?: string | null;
        locale: 'pt' | 'en';
        domainCategory: AiDomainCategory;
        subIntent?: string | null;
        intentKey: string;
        question: string;
        normalizedQuestion?: string;
        reply: string;
        actions?: AiActionLink[];
        suggestions?: string[];
        status?: SemanticMemoryStatus;
    }): Promise<SemanticMemoryRecord | null> {
        const cleanNorm = this.normalizeText(
            params.normalizedQuestion || params.question
        );
        if (!params.userId || !cleanNorm || !params.reply) return null;

        const scopedAcc = this.normalizeAccountScope(params.accountId);
        let embedding: number[] = [];
        let embeddingModel = DEFAULT_GEMINI_EMBEDDING_MODEL;
        if (this.embeddingService?.getStatus()?.enabled) {
            try {
                const emb = await this.embeddingService.embedText(params.question, {
                    taskType: 'RETRIEVAL_DOCUMENT',
                });
                if (emb?.values?.length) {
                    embedding = emb.values;
                    embeddingModel = emb.model;
                }
            } catch {
                embedding = [];
            }
        }

        const contentHash = this.computeContentHash(
            cleanNorm,
            `USER_PRIVATE:${scopedAcc || '__ALL__'}:${params.domainCategory}`
        );
        const status: SemanticMemoryStatus = params.status || 'ACTIVE';
        const inserted = await this.dataSource.query(
            `
            INSERT INTO ai_semantic_memory (
                scope_level, owner_scope, user_id, account_id, locale, domain_category,
                sub_intent, intent_key, canonical_question, normalized_question, content_hash,
                variant_phrases, embedding_model, dimensions, embedding_f64,
                cached_reply, handoff_template, actions, suggestions,
                status, positive_count, negative_count, distinct_positive_users, positive_user_hashes,
                trust_score, platform_doc_version
            )
            VALUES (
                'USER_PRIVATE', $1, $1, $2, $3, $4,
                $5, $6, $7, $8, $9,
                '[]'::jsonb, $10, $11, $12::double precision[],
                $13, NULL, $14::jsonb, $15::jsonb,
                $16, 1, 0, 1, '[]'::jsonb,
                0.85, NULL
            )
            ON CONFLICT (owner_scope, scope_level, locale, content_hash) DO UPDATE
            SET cached_reply = EXCLUDED.cached_reply,
                actions = EXCLUDED.actions,
                suggestions = EXCLUDED.suggestions,
                account_id = EXCLUDED.account_id,
                status = EXCLUDED.status,
                updated_at = now()
            RETURNING *
            `,
            [
                params.userId,
                scopedAcc,
                params.locale,
                params.domainCategory,
                params.subIntent || null,
                params.intentKey || 'user_private_memory',
                params.question.slice(0, 400),
                cleanNorm,
                contentHash,
                embeddingModel,
                embedding.length || AI_EMBEDDING_DIMENSIONS,
                embedding.length ? embedding : [],
                params.reply,
                JSON.stringify(params.actions || []),
                JSON.stringify(params.suggestions || []),
                status,
            ]
        );

        const row = this.extractRows(inserted)[0];
        return row ? this.mapDbRow(row) : null;
    }

    async recordPositiveHitVote(
        memoryId: string,
        userHash: string
    ): Promise<void> {
        if (!memoryId) return;
        try {
            const res = await this.dataSource.query(
                `SELECT * FROM ai_semantic_memory WHERE id = $1 LIMIT 1`,
                [memoryId]
            );
            const raw = this.extractRows(res)[0];
            if (!raw) return;
            const rec = this.mapDbRow(raw);
            const hashes = Array.from(
                new Set([...(rec.positiveUserHashes || []), userHash])
            );
            const newPos = rec.positiveCount + 1;
            const newDistinct = hashes.length;
            const newTrust = this.computeTrustScore(
                newPos,
                rec.negativeCount,
                newDistinct
            );

            await this.dataSource.query(
                `
                UPDATE ai_semantic_memory
                SET positive_count = $1,
                    distinct_positive_users = $2,
                    positive_user_hashes = $3::jsonb,
                    trust_score = $4,
                    updated_at = now()
                WHERE id = $5
                `,
                [newPos, newDistinct, JSON.stringify(hashes), newTrust, memoryId]
            );
        } catch (err) {
            this.logger.warn(
                `recordPositiveHitVote warning: ${(err as Error).message}`
            );
        }
    }

    /**
     * Implicit signals (rephrase, suggestion click, copy...) nudge trust in small, bounded steps:
     * a rephrase costs 0.025, a click or copy adds 0.015. Trust below 0.45 quarantines the memory.
     */
    async applyImplicitSignal(memoryId: string | null | undefined, weight: number): Promise<{ trustScore: number; quarantined: boolean } | null> {
        if (!memoryId || !Number.isFinite(weight) || weight === 0) return null;
        try {
            const res = await this.dataSource.query(
                `SELECT * FROM ai_semantic_memory WHERE id = $1 LIMIT 1`,
                [memoryId]
            );
            const raw = this.extractRows(res)[0];
            if (!raw) return null;
            const rec = this.mapDbRow(raw);
            if (rec.status === 'QUARANTINED' || rec.status === 'RETIRED') return null;
            const step = weight * 0.05;
            const trustScore = Number(Math.max(0.05, Math.min(0.99, Number(rec.trustScore ?? 0.5) + step)).toFixed(4));
            const quarantined = trustScore < 0.45;
            await this.dataSource.query(
                `UPDATE ai_semantic_memory SET trust_score = $1, status = $2, updated_at = now() WHERE id = $3`,
                [trustScore, quarantined ? 'QUARANTINED' : rec.status, memoryId]
            );
            return { trustScore, quarantined };
        } catch (err) {
            this.logger.warn(`applyImplicitSignal warning: ${(err as Error).message}`);
            return null;
        }
    }

    async applyNegativeFeedbackToMemory(
        memoryId: string | null | undefined,
        normalizedQuestion?: string,
        locale: 'pt' | 'en' = 'pt',
        options?: { forceQuarantine?: boolean }
    ): Promise<{ quarantinedIds: string[] }> {
        const quarantinedIds: string[] = [];
        try {
            let targetIds: string[] = [];
            if (memoryId) {
                targetIds = [memoryId];
            } else if (normalizedQuestion) {
                const cleanNorm = this.normalizeText(normalizedQuestion);
                const matches = await this.dataSource.query(
                    `
                    SELECT id FROM ai_semantic_memory
                    WHERE owner_scope = $1
                      AND locale = $2
                      AND status IN ('ACTIVE', 'CANDIDATE')
                      AND normalized_question = $3
                    LIMIT 5
                    `,
                    [GLOBAL_MEMORY_OWNER_SCOPE, locale, cleanNorm]
                );
                targetIds = this.extractRows(matches).map((r: any) => String(r.id));
            }

            for (const id of targetIds) {
                const res = await this.dataSource.query(
                    `SELECT * FROM ai_semantic_memory WHERE id = $1 LIMIT 1`,
                    [id]
                );
                const raw = this.extractRows(res)[0];
                if (!raw) continue;
                const rec = this.mapDbRow(raw);
                const newNeg = rec.negativeCount + 1;
                const newTrust = this.computeTrustScore(
                    rec.positiveCount,
                    newNeg,
                    rec.distinctPositiveUsers
                );
                // GLOBAL_SAFE requires quorum (>=2 negative reports or trust drop) before platform-wide quarantine
                const shouldQuarantine =
                    (Boolean(options?.forceQuarantine) &&
                        (rec.scopeLevel !== 'GLOBAL_SAFE' || newNeg >= 2)) ||
                    newTrust < 0.45 ||
                    (newNeg >= 2 && newNeg >= rec.positiveCount);
                const nextStatus: SemanticMemoryStatus = shouldQuarantine
                    ? 'QUARANTINED'
                    : rec.status;

                await this.dataSource.query(
                    `
                    UPDATE ai_semantic_memory
                    SET negative_count = $1,
                        trust_score = $2,
                        status = $3,
                        updated_at = now()
                    WHERE id = $4
                    `,
                    [newNeg, newTrust, nextStatus, id]
                );

                if (shouldQuarantine) {
                    quarantinedIds.push(id);
                }
            }
        } catch (err) {
            this.logger.warn(
                `applyNegativeFeedbackToMemory warning: ${(err as Error).message}`
            );
        }

        return { quarantinedIds };
    }

    async upsertLearnedSynonym(params: {
        surfaceTerm: string;
        canonicalTerm: string;
        intentKey?: string | null;
        domainCategory?: string | null;
        locale: 'pt' | 'en';
    }): Promise<void> {
        const cleanSurface = this.normalizeText(params.surfaceTerm);
        const cleanCanonical = this.normalizeText(params.canonicalTerm);
        if (
            !cleanSurface ||
            !cleanCanonical ||
            cleanSurface === cleanCanonical ||
            cleanSurface.length < 3
        ) {
            return;
        }

        try {
            await this.dataSource.query(
                `
                INSERT INTO ai_lexical_synonyms (
                    surface_term, normalized_surface, canonical_term,
                    intent_key, domain_category, locale, co_occurrence_count, positive_weight, is_active
                )
                VALUES ($1, $2, $3, $4, $5, $6, 1, 1.0, true)
                ON CONFLICT (locale, normalized_surface, canonical_term) DO UPDATE
                SET co_occurrence_count = ai_lexical_synonyms.co_occurrence_count + 1,
                    positive_weight = LEAST(5.0, ai_lexical_synonyms.positive_weight + 0.15),
                    updated_at = now()
                `,
                [
                    params.surfaceTerm.slice(0, 120),
                    cleanSurface.slice(0, 120),
                    cleanCanonical.slice(0, 120),
                    params.intentKey || null,
                    params.domainCategory || null,
                    params.locale,
                ]
            );
            await this.refreshSynonymsCache();
        } catch {
            // Non-blocking synonym persistence
        }
    }

    async refreshSynonymsCache(): Promise<void> {
        try {
            const res = await this.dataSource.query(
                `
                SELECT surface_term, normalized_surface, canonical_term, intent_key, domain_category, locale, positive_weight
                FROM ai_lexical_synonyms
                WHERE is_active = true
                ORDER BY positive_weight DESC, co_occurrence_count DESC
                LIMIT 500
                `
            );
            const rows = this.extractRows(res);
            if (rows.length > 0) {
                this.synonymsCache = rows.map((r: any) => ({
                    surfaceTerm: String(r.surface_term),
                    normalizedSurface: String(r.normalized_surface),
                    canonicalTerm: String(r.canonical_term),
                    intentKey: r.intent_key ? String(r.intent_key) : null,
                    domainCategory: r.domain_category
                        ? String(r.domain_category)
                        : null,
                    locale: r.locale === 'en' ? 'en' : 'pt',
                    positiveWeight: Number(r.positive_weight ?? 1.0),
                }));
            }
        } catch {
            // Retain seeded synonyms if DB unavailable
        }
    }

    async listGlobalMemoriesForAdmin(filters?: {
        status?: string;
        scope?: string;
        limit?: number;
    }): Promise<SemanticMemoryRecord[]> {
        const limit = Math.min(100, Math.max(1, Number(filters?.limit) || 50));
        const conditions = [`owner_scope = $1`];
        const params: any[] = [GLOBAL_MEMORY_OWNER_SCOPE];

        if (filters?.status && filters.status !== 'ALL') {
            params.push(filters.status);
            conditions.push(`status = $${params.length}`);
        }
        if (filters?.scope && filters.scope !== 'ALL') {
            params.push(filters.scope);
            conditions.push(`scope_level = $${params.length}`);
        }
        params.push(limit);

        const res = await this.dataSource.query(
            `
            SELECT * FROM ai_semantic_memory
            WHERE ${conditions.join(' AND ')}
            ORDER BY hit_count DESC, distinct_positive_users DESC, updated_at DESC
            LIMIT $${params.length}
            `,
            params
        );
        return this.extractRows(res).map((r: any) => this.mapDbRow(r));
    }

    async reviewMemoryByAdmin(
        id: string,
        action: 'APPROVE' | 'QUARANTINE' | 'RETIRE'
    ): Promise<SemanticMemoryRecord | null> {
        const targetStatus: SemanticMemoryStatus =
            action === 'APPROVE'
                ? 'ACTIVE'
                : action === 'QUARANTINE'
                ? 'QUARANTINED'
                : 'RETIRED';

        const existingRes = await this.dataSource.query(
            `SELECT * FROM ai_semantic_memory WHERE id = $1 AND owner_scope = $2 LIMIT 1`,
            [id, GLOBAL_MEMORY_OWNER_SCOPE]
        );
        const existingRaw = this.extractRows(existingRes)[0];
        if (!existingRaw) return null;

        const existing = this.mapDbRow(existingRaw);
        const nextTrust =
            action === 'APPROVE'
                ? this.computeTrustScore(
                      Math.max(1, existing.positiveCount),
                      existing.negativeCount,
                      Math.max(1, existing.distinctPositiveUsers),
                      true
                  )
                : action === 'QUARANTINE'
                ? Math.min(existing.trustScore, 0.25)
                : existing.trustScore;

        const updatedRes = await this.dataSource.query(
            `
            UPDATE ai_semantic_memory
            SET status = $1,
                trust_score = $2,
                updated_at = now()
            WHERE id = $3
            RETURNING *
            `,
            [targetStatus, nextTrust, id]
        );
        const updatedRaw = this.extractRows(updatedRes)[0];
        return updatedRaw ? this.mapDbRow(updatedRaw) : null;
    }

    async runMaintenanceSweep(): Promise<{ retiredCount: number }> {
        try {
            const res = await this.dataSource.query(
                `
                UPDATE ai_semantic_memory
                SET status = 'RETIRED', updated_at = now()
                WHERE status IN ('CANDIDATE', 'QUARANTINED')
                  AND hit_count = 0
                  AND updated_at < now() - interval '60 days'
                RETURNING id
                `
            );
            await this.refreshSynonymsCache();
            return { retiredCount: this.extractRows(res).length };
        } catch {
            return { retiredCount: 0 };
        }
    }

    private async retireStalePlatformMemories(): Promise<void> {
        try {
            await this.dataSource.query(
                `
                UPDATE ai_semantic_memory
                SET status = 'RETIRED', updated_at = now()
                WHERE scope_level = 'GLOBAL_SAFE'
                  AND domain_category = 'PLATFORM_KNOWLEDGE'
                  AND status IN ('ACTIVE', 'CANDIDATE')
                  AND platform_doc_version IS NOT NULL
                  AND platform_doc_version <> $1
                `,
                [this.platformDocVersion]
            );
        } catch {
            // Ignore during initial schema bootstrap
        }
    }

    private async seedLexicalSynonyms(): Promise<void> {
        for (const seed of SEED_LEXICAL_SYNONYMS) {
            const normSurface = this.normalizeText(seed.surfaceTerm);
            const normCanon = this.normalizeText(seed.canonicalTerm);
            try {
                await this.dataSource.query(
                    `
                    INSERT INTO ai_lexical_synonyms (
                        surface_term, normalized_surface, canonical_term,
                        intent_key, domain_category, locale, positive_weight, is_active
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, 1.2, true)
                    ON CONFLICT (locale, normalized_surface, canonical_term) DO NOTHING
                    `,
                    [
                        seed.surfaceTerm,
                        normSurface,
                        normCanon,
                        seed.intentKey,
                        seed.domainCategory,
                        seed.locale,
                    ]
                );
            } catch {
                // Non-blocking seed
            }
        }
    }

    private async maybeMineSynonymFromVariants(
        baseNorm: string,
        variantNorm: string,
        intentKey: string,
        domainCategory: AiDomainCategory,
        locale: 'pt' | 'en'
    ): Promise<void> {
        const tokensA = baseNorm
            .split(' ')
            .filter((t) => t.length >= 3 && !STOPWORDS_PT_EN.has(t));
        const tokensB = variantNorm
            .split(' ')
            .filter((t) => t.length >= 3 && !STOPWORDS_PT_EN.has(t));
        if (tokensA.length === 0 || tokensB.length === 0) return;

        const setA = new Set(tokensA);
        const setB = new Set(tokensB);
        const shared = tokensA.filter((t) => setB.has(t));
        const overlapRatio = shared.length / Math.max(tokensA.length, tokensB.length);
        if (overlapRatio < 0.5) return;

        const diffA = tokensA.filter((t) => !setB.has(t));
        const diffB = tokensB.filter((t) => !setA.has(t));
        if (diffA.length === 1 && diffB.length === 1 && diffA[0] !== diffB[0]) {
            await this.upsertLearnedSynonym({
                surfaceTerm: diffB[0],
                canonicalTerm: diffA[0],
                intentKey,
                domainCategory,
                locale,
            });
        }
    }

    private async fetchActiveMemoryCandidates(params: {
        locale: 'pt' | 'en';
        userId: string | null;
        accountId: string | null;
        expandedQuery: string;
        queryEmbedding: number[] | null;
    }): Promise<SemanticMemoryRecord[]> {
        try {
            const ownerScopes = params.userId
                ? [GLOBAL_MEMORY_OWNER_SCOPE, params.userId]
                : [GLOBAL_MEMORY_OWNER_SCOPE];
            const accountFilterValue = params.accountId || '__ALL__';

            if (
                this.pgvectorEnabled &&
                params.queryEmbedding &&
                params.queryEmbedding.length === AI_EMBEDDING_DIMENSIONS
            ) {
                const vecLiteral = `[${params.queryEmbedding.join(',')}]`;
                const res = await this.dataSource.query(
                    `
                    SELECT *
                    FROM ai_semantic_memory
                    WHERE status = 'ACTIVE'
                      AND locale = $1
                      AND owner_scope = ANY($2::varchar[])
                      AND (scope_level <> 'USER_PRIVATE' OR COALESCE(account_id, '__ALL__') = $4)
                    ORDER BY
                        CASE WHEN embedding_vector IS NOT NULL THEN embedding_vector <=> $3::vector ELSE 1 END ASC,
                        hit_count DESC
                    LIMIT 60
                    `,
                    [params.locale, ownerScopes, vecLiteral, accountFilterValue]
                );
                return this.extractRows(res).map((r: any) => this.mapDbRow(r));
            }

            if (
                params.queryEmbedding &&
                params.queryEmbedding.length === AI_EMBEDDING_DIMENSIONS
            ) {
                // Without pgvector, still rank candidates by embedding similarity (SQL full scan)
                // instead of popularity, otherwise a relevant memory outside the top hit_count
                // rows can never be retrieved.
                const res = await this.dataSource.query(
                    `
                    SELECT *
                    FROM ai_semantic_memory
                    WHERE status = 'ACTIVE'
                      AND locale = $1
                      AND owner_scope = ANY($2::varchar[])
                      AND (scope_level <> 'USER_PRIVATE' OR COALESCE(account_id, '__ALL__') = $4)
                    ORDER BY
                        ai_cosine_similarity_f64(embedding_f64, $3::float8[]) DESC,
                        hit_count DESC
                    LIMIT 60
                    `,
                    [params.locale, ownerScopes, params.queryEmbedding, accountFilterValue]
                );
                return this.extractRows(res).map((r: any) => this.mapDbRow(r));
            }

            const res = await this.dataSource.query(
                `
                SELECT *
                FROM ai_semantic_memory
                WHERE status = 'ACTIVE'
                  AND locale = $1
                  AND owner_scope = ANY($2::varchar[])
                  AND (scope_level <> 'USER_PRIVATE' OR COALESCE(account_id, '__ALL__') = $3)
                ORDER BY hit_count DESC, trust_score DESC, updated_at DESC
                LIMIT 80
                `,
                [params.locale, ownerScopes, accountFilterValue]
            );
            return this.extractRows(res).map((r: any) => this.mapDbRow(r));
        } catch {
            return [];
        }
    }

    private async fetchGlobalClusterCandidates(
        locale: 'pt' | 'en',
        scopeLevel: SemanticMemoryScope,
        domainCategory: AiDomainCategory
    ): Promise<SemanticMemoryRecord[]> {
        try {
            const res = await this.dataSource.query(
                `
                SELECT * FROM ai_semantic_memory
                WHERE owner_scope = $1
                  AND scope_level = $2
                  AND locale = $3
                  AND domain_category = $4
                ORDER BY hit_count DESC, updated_at DESC
                LIMIT 100
                `,
                [GLOBAL_MEMORY_OWNER_SCOPE, scopeLevel, locale, domainCategory]
            );
            return this.extractRows(res).map((r: any) => this.mapDbRow(r));
        } catch {
            return [];
        }
    }

    private async recordMemoryHit(id: string, tokensSaved: number): Promise<void> {
        try {
            await this.dataSource.query(
                `
                UPDATE ai_semantic_memory
                SET hit_count = hit_count + 1,
                    llm_tokens_saved = llm_tokens_saved + $1,
                    last_hit_at = now()
                WHERE id = $2
                `,
                [Math.max(0, Math.trunc(tokensSaved)), id]
            );
        } catch {
            // Non-blocking hit counter
        }
    }

    private extractRows(res: any): any[] {
        if (Array.isArray(res)) return res;
        if (res && Array.isArray(res.rows)) return res.rows;
        return [];
    }

    private mapDbRow(row: any): SemanticMemoryRecord {
        return {
            id: String(row.id),
            scopeLevel: row.scope_level as SemanticMemoryScope,
            ownerScope: String(row.owner_scope),
            userId: row.user_id ? String(row.user_id) : null,
            accountId: row.account_id ? String(row.account_id) : null,
            locale: row.locale === 'en' ? 'en' : 'pt',
            domainCategory: row.domain_category as AiDomainCategory,
            subIntent: row.sub_intent ? String(row.sub_intent) : null,
            intentKey: row.intent_key ? String(row.intent_key) : null,
            canonicalQuestion: String(row.canonical_question || ''),
            normalizedQuestion: String(row.normalized_question || ''),
            contentHash: String(row.content_hash || ''),
            variantPhrases: Array.isArray(row.variant_phrases)
                ? row.variant_phrases.map(String)
                : [],
            embeddingModel: String(
                row.embedding_model || DEFAULT_GEMINI_EMBEDDING_MODEL
            ),
            dimensions: Number(row.dimensions ?? AI_EMBEDDING_DIMENSIONS),
            embeddingF64: Array.isArray(row.embedding_f64)
                ? row.embedding_f64.map(Number)
                : [],
            cachedReply:
                row.cached_reply !== null && row.cached_reply !== undefined
                    ? String(row.cached_reply)
                    : null,
            handoffTemplate: row.handoff_template || null,
            actions: Array.isArray(row.actions) ? row.actions : [],
            suggestions: Array.isArray(row.suggestions)
                ? row.suggestions.map(String)
                : [],
            status: (row.status || 'CANDIDATE') as SemanticMemoryStatus,
            positiveCount: Number(row.positive_count ?? 0),
            negativeCount: Number(row.negative_count ?? 0),
            distinctPositiveUsers: Number(row.distinct_positive_users ?? 0),
            positiveUserHashes: Array.isArray(row.positive_user_hashes)
                ? row.positive_user_hashes.map(String)
                : [],
            hitCount: Number(row.hit_count ?? 0),
            llmTokensSaved: Number(row.llm_tokens_saved ?? 0),
            trustScore: Number(row.trust_score ?? 0.5),
            platformDocVersion: row.platform_doc_version
                ? String(row.platform_doc_version)
                : null,
            lastHitAt: row.last_hit_at ? new Date(row.last_hit_at).toISOString() : null,
            updatedAt: row.updated_at
                ? new Date(row.updated_at).toISOString()
                : new Date().toISOString(),
        };
    }
}
