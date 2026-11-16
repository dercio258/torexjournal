import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { createHash } from 'crypto';
import { firstValueFrom } from 'rxjs';
import {
    AI_EMBEDDING_DIMENSIONS,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
    FALLBACK_GEMINI_EMBEDDING_MODEL,
    FORBIDDEN_EMBEDDING_MODELS,
} from './ai-vector-schema';

export type GeminiEmbeddingTaskType =
    | 'RETRIEVAL_QUERY'
    | 'RETRIEVAL_DOCUMENT'
    | 'SEMANTIC_SIMILARITY'
    | 'CLASSIFICATION'
    | 'CLUSTERING';

export interface EmbeddingResult {
    values: number[];
    model: string;
    dimensions: number;
    contentHash: string;
    cached: boolean;
}

export interface EmbedTextOptions {
    taskType?: GeminiEmbeddingTaskType;
    title?: string;
    skipCache?: boolean;
}

export interface EmbedBatchItem {
    text: string;
    taskType?: GeminiEmbeddingTaskType;
    title?: string;
    skipCache?: boolean;
}

export interface EmbeddingServiceStatus {
    enabled: boolean;
    provider: 'gemini' | 'none';
    model: string;
    fallbackModel: string;
    dimensions: number;
    disabledReason?: 'DISABLED_BY_ENV' | 'NOT_CONFIGURED' | 'API_KEY_INVALID';
}

const EMBEDDING_CACHE_TTL_MS = 86_400_000; // 24h
const MAX_EMBEDDING_INPUT_CHARS = 6000;
const BATCH_CHUNK_SIZE = 50;

@Injectable()
export class AiEmbeddingService {
    private readonly logger = new Logger(AiEmbeddingService.name);
    private invalidKeyHash: string | null = null;

    constructor(
        private readonly configService: ConfigService,
        private readonly httpService: HttpService,
        @Optional()
        @Inject(CACHE_MANAGER)
        private readonly cacheManager?: Cache
    ) {}

    private hashSecret(secret: string): string {
        return createHash('sha256').update(secret).digest('hex');
    }

    private isInvalidApiKeyError(err: any): boolean {
        const status = Number(err?.response?.status);
        if (status !== 400 && status !== 401 && status !== 403) {
            return false;
        }
        const errorBody = err?.response?.data?.error;
        const details = Array.isArray(errorBody?.details) ? errorBody.details : [];
        if (details.some((d: any) => d?.reason === 'API_KEY_INVALID')) {
            return true;
        }
        const msg = String(errorBody?.message || err?.message || '');
        return /API key not valid|API_KEY_INVALID/i.test(msg);
    }

    private tripInvalidKeyBreakerIfNeeded(err: any, key?: string): boolean {
        if (!key || !this.isInvalidApiKeyError(err)) {
            return false;
        }
        const h = this.hashSecret(key);
        if (this.invalidKeyHash !== h) {
            this.invalidKeyHash = h;
            this.logger.warn(
                'GEMINI_API_KEY rejeitada pela Google API (API_KEY_INVALID). Embeddings vetoriais em pausa até que uma chave válida do Google AI Studio seja configurada.'
            );
        }
        return true;
    }

    private resolveConfig(): {
        enabled: boolean;
        key?: string;
        model: string;
        fallbackModel: string;
        dimensions: number;
        disabledReason?: 'DISABLED_BY_ENV' | 'NOT_CONFIGURED' | 'API_KEY_INVALID';
    } {
        const disabledFlag = String(
            this.configService.get<string>('TOREX_AI_EMBEDDING_ENABLED') || 'true'
        )
            .toLowerCase()
            .trim();

        if (disabledFlag === 'false' || disabledFlag === 'off' || disabledFlag === '0') {
            return {
                enabled: false,
                model: DEFAULT_GEMINI_EMBEDDING_MODEL,
                fallbackModel: FALLBACK_GEMINI_EMBEDDING_MODEL,
                dimensions: AI_EMBEDDING_DIMENSIONS,
                disabledReason: 'DISABLED_BY_ENV',
            };
        }

        const key = (
            this.configService.get<string>('TOREX_AI_EMBEDDING_API_KEY') ||
            this.configService.get<string>('GEMINI_API_KEY') ||
            this.configService.get<string>('TOREX_AI_GEMINI_API_KEY') ||
            this.configService.get<string>('api_token_gemin') ||
            this.configService.get<string>('TOREX_AI_CHAT_API_KEY') ||
            ''
        ).trim();

        const isValidGeminiKey =
            Boolean(key) && !key.startsWith('sk-or-') && !key.startsWith('sk-proj-');

        const rawConfiguredModel = (
            this.configService.get<string>('GEMINI_EMBEDDING_MODEL') ||
            this.configService.get<string>('TOREX_AI_EMBEDDING_MODEL') ||
            DEFAULT_GEMINI_EMBEDDING_MODEL
        )
            .trim()
            .replace(/^models\//i, '');

        const normalizedModel = rawConfiguredModel.toLowerCase();
        const isForbidden =
            FORBIDDEN_EMBEDDING_MODELS.some((m) =>
                normalizedModel.includes(m.replace(/^models\//i, '').toLowerCase())
            ) || !normalizedModel.startsWith('gemini-embedding-2');

        let resolvedModel = rawConfiguredModel || DEFAULT_GEMINI_EMBEDDING_MODEL;
        if (isForbidden) {
            this.logger.warn(
                `Configured embedding model "${rawConfiguredModel}" is disallowed or unsupported. Enforcing "${DEFAULT_GEMINI_EMBEDDING_MODEL}".`
            );
            resolvedModel = DEFAULT_GEMINI_EMBEDDING_MODEL;
        }

        if (!isValidGeminiKey) {
            return {
                enabled: false,
                model: resolvedModel,
                fallbackModel: FALLBACK_GEMINI_EMBEDDING_MODEL,
                dimensions: AI_EMBEDDING_DIMENSIONS,
                disabledReason: 'NOT_CONFIGURED',
            };
        }

        if (this.invalidKeyHash === this.hashSecret(key)) {
            return {
                enabled: false,
                model: resolvedModel,
                fallbackModel: FALLBACK_GEMINI_EMBEDDING_MODEL,
                dimensions: AI_EMBEDDING_DIMENSIONS,
                disabledReason: 'API_KEY_INVALID',
            };
        }

        return {
            enabled: true,
            key,
            model: resolvedModel,
            fallbackModel: FALLBACK_GEMINI_EMBEDDING_MODEL,
            dimensions: AI_EMBEDDING_DIMENSIONS,
        };
    }

    getStatus(): EmbeddingServiceStatus {
        const cfg = this.resolveConfig();
        return {
            enabled: cfg.enabled,
            provider: cfg.enabled ? 'gemini' : 'none',
            model: cfg.model,
            fallbackModel: cfg.fallbackModel,
            dimensions: cfg.dimensions,
            ...(cfg.disabledReason ? { disabledReason: cfg.disabledReason } : {}),
        };
    }

    sanitizeEmbeddingText(raw: string): string {
        return String(raw || '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_EMBEDDING_INPUT_CHARS);
    }

    computeContentHash(
        text: string,
        taskType: GeminiEmbeddingTaskType = 'SEMANTIC_SIMILARITY',
        dimensions = AI_EMBEDDING_DIMENSIONS
    ): string {
        const clean = this.sanitizeEmbeddingText(text);
        return createHash('sha256')
            .update(`${DEFAULT_GEMINI_EMBEDDING_MODEL}:${dimensions}:${taskType}:${clean}`)
            .digest('hex');
    }

    l2Normalize(values: number[]): number[] {
        if (!Array.isArray(values) || values.length === 0) return [];
        let sumSq = 0;
        const clean = new Array<number>(values.length);
        for (let i = 0; i < values.length; i += 1) {
            const v = Number(values[i]);
            if (!Number.isFinite(v)) return [];
            clean[i] = v;
            sumSq += v * v;
        }
        const norm = Math.sqrt(sumSq);
        if (!Number.isFinite(norm) || norm <= 0) return [];
        for (let i = 0; i < clean.length; i += 1) {
            clean[i] = clean[i] / norm;
        }
        return clean;
    }

    cosineSimilarity(a: number[], b: number[]): number {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
            return 0;
        }
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i += 1) {
            const x = Number(a[i]);
            const y = Number(b[i]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
            dot += x * y;
            normA += x * x;
            normB += y * y;
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom > 0 ? dot / denom : 0;
    }

    private buildEmbedRequestBody(
        model: string,
        text: string,
        taskType: GeminiEmbeddingTaskType,
        dimensions: number,
        title?: string
    ) {
        const body: Record<string, any> = {
            model: `models/${model}`,
            content: {
                parts: [{ text }],
            },
            taskType,
            outputDimensionality: dimensions,
        };
        if (title && taskType === 'RETRIEVAL_DOCUMENT') {
            body.title = this.sanitizeEmbeddingText(title).slice(0, 200);
        }
        return body;
    }

    private async postWithModelFallback<T>(
        primaryModel: string,
        fallbackModel: string,
        key: string,
        endpointAction: 'embedContent' | 'batchEmbedContents',
        payloadBuilder: (model: string) => any,
        timeoutMs: number
    ): Promise<{ data: T; modelUsed: string }> {
        const executePost = async (model: string) => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpointAction}`;
            const response = await firstValueFrom(
                this.httpService.post<T>(url, payloadBuilder(model), {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': key,
                    },
                    timeout: timeoutMs,
                })
            );
            return { data: response.data, modelUsed: model };
        };

        try {
            return await executePost(primaryModel);
        } catch (err: any) {
            const status = err?.response?.status;
            if (status === 404 && primaryModel !== fallbackModel) {
                this.logger.warn(
                    `Embedding model "${primaryModel}" returned 404; retrying with "${fallbackModel}".`
                );
                return await executePost(fallbackModel);
            }
            throw err;
        }
    }

    private async readCachedEmbedding(cacheKey: string): Promise<EmbeddingResult | null> {
        if (!this.cacheManager) return null;
        try {
            const cached = await this.cacheManager.get<EmbeddingResult>(cacheKey);
            if (
                cached &&
                Array.isArray(cached.values) &&
                cached.values.length === AI_EMBEDDING_DIMENSIONS
            ) {
                return { ...cached, cached: true };
            }
        } catch {
            // Non-blocking cache read error
        }
        return null;
    }

    private async writeCachedEmbedding(
        cacheKey: string,
        result: EmbeddingResult
    ): Promise<void> {
        if (!this.cacheManager) return;
        try {
            await this.cacheManager.set(cacheKey, result, EMBEDDING_CACHE_TTL_MS);
        } catch {
            // Non-blocking cache write error
        }
    }

    async embedText(
        text: string,
        options?: EmbedTextOptions
    ): Promise<EmbeddingResult | null> {
        const cleanText = this.sanitizeEmbeddingText(text);
        if (!cleanText) return null;

        const cfg = this.resolveConfig();
        if (!cfg.enabled || !cfg.key) return null;

        const taskType: GeminiEmbeddingTaskType =
            options?.taskType || 'SEMANTIC_SIMILARITY';
        const contentHash = this.computeContentHash(
            cleanText,
            taskType,
            cfg.dimensions
        );
        const cacheKey = `ai:emb:v2:${contentHash}`;

        if (!options?.skipCache) {
            const cached = await this.readCachedEmbedding(cacheKey);
            if (cached) return cached;
        }

        try {
            const { data, modelUsed } = await this.postWithModelFallback<{
                embedding?: { values?: number[] };
            }>(
                cfg.model,
                cfg.fallbackModel,
                cfg.key,
                'embedContent',
                (model) =>
                    this.buildEmbedRequestBody(
                        model,
                        cleanText,
                        taskType,
                        cfg.dimensions,
                        options?.title
                    ),
                10000
            );

            const rawValues = data?.embedding?.values;
            if (!Array.isArray(rawValues) || rawValues.length !== cfg.dimensions) {
                this.logger.warn(
                    `Unexpected embedding length returned by "${modelUsed}": ${rawValues?.length ?? 0}`
                );
                return null;
            }

            const normalized = this.l2Normalize(rawValues);
            if (normalized.length !== cfg.dimensions) return null;

            const result: EmbeddingResult = {
                values: normalized,
                model: modelUsed,
                dimensions: normalized.length,
                contentHash,
                cached: false,
            };

            if (!options?.skipCache) {
                await this.writeCachedEmbedding(cacheKey, result);
            }
            return result;
        } catch (err: any) {
            if (!this.tripInvalidKeyBreakerIfNeeded(err, cfg.key)) {
                this.logger.warn(
                    `Gemini embedText failed (${err?.response?.status || err?.message || 'unknown'})`
                );
            }
            return null;
        }
    }

    async embedBatch(items: EmbedBatchItem[]): Promise<(EmbeddingResult | null)[]> {
        if (!Array.isArray(items) || items.length === 0) return [];

        const cfg = this.resolveConfig();
        if (!cfg.enabled || !cfg.key) {
            return items.map(() => null);
        }

        const results: (EmbeddingResult | null)[] = new Array(items.length).fill(null);

        interface PendingRequest {
            hash: string;
            cleanText: string;
            taskType: GeminiEmbeddingTaskType;
            title?: string;
            skipCache: boolean;
            targetIndices: number[];
        }

        const pendingByHash = new Map<string, PendingRequest>();

        for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            const cleanText = this.sanitizeEmbeddingText(item?.text || '');
            if (!cleanText) continue;

            const taskType: GeminiEmbeddingTaskType =
                item?.taskType || 'SEMANTIC_SIMILARITY';
            const hash = this.computeContentHash(cleanText, taskType, cfg.dimensions);
            const skipCache = Boolean(item?.skipCache);

            if (!skipCache) {
                const cached = await this.readCachedEmbedding(`ai:emb:v2:${hash}`);
                if (cached) {
                    results[i] = cached;
                    continue;
                }
            }

            const existing = pendingByHash.get(hash);
            if (existing) {
                existing.targetIndices.push(i);
            } else {
                pendingByHash.set(hash, {
                    hash,
                    cleanText,
                    taskType,
                    title: item?.title,
                    skipCache,
                    targetIndices: [i],
                });
            }
        }

        const pendingList = Array.from(pendingByHash.values());
        for (let offset = 0; offset < pendingList.length; offset += BATCH_CHUNK_SIZE) {
            const chunk = pendingList.slice(offset, offset + BATCH_CHUNK_SIZE);
            try {
                const { data, modelUsed } = await this.postWithModelFallback<{
                    embeddings?: Array<{ values?: number[] }>;
                }>(
                    cfg.model,
                    cfg.fallbackModel,
                    cfg.key,
                    'batchEmbedContents',
                    (model) => ({
                        requests: chunk.map((entry) =>
                            this.buildEmbedRequestBody(
                                model,
                                entry.cleanText,
                                entry.taskType,
                                cfg.dimensions,
                                entry.title
                            )
                        ),
                    }),
                    25000
                );

                const returned = Array.isArray(data?.embeddings) ? data.embeddings : [];
                for (let j = 0; j < chunk.length; j += 1) {
                    const entry = chunk[j];
                    const rawValues = returned[j]?.values;
                    if (!Array.isArray(rawValues) || rawValues.length !== cfg.dimensions) {
                        continue;
                    }
                    const normalized = this.l2Normalize(rawValues);
                    if (normalized.length !== cfg.dimensions) continue;

                    const result: EmbeddingResult = {
                        values: normalized,
                        model: modelUsed,
                        dimensions: normalized.length,
                        contentHash: entry.hash,
                        cached: false,
                    };

                    if (!entry.skipCache) {
                        await this.writeCachedEmbedding(
                            `ai:emb:v2:${entry.hash}`,
                            result
                        );
                    }
                    for (const idx of entry.targetIndices) {
                        results[idx] = result;
                    }
                }
            } catch (err: any) {
                if (this.tripInvalidKeyBreakerIfNeeded(err, cfg.key)) {
                    break;
                }
                this.logger.warn(
                    `Gemini embedBatch chunk failed (${err?.response?.status || err?.message || 'unknown'})`
                );
            }
        }

        return results;
    }
}
