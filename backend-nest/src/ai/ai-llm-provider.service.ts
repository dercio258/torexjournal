import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createHash } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { cavemanCompressHistory } from './ai-caveman-compressor';

export type LlmProviderKind = 'none' | 'gemini' | 'openai_compatible' | 'qwen';

export interface LlmProviderStatus {
    enabled: boolean;
    provider: LlmProviderKind;
    model: string;
    label: string;
}

export interface DualEngineStatus {
    qwenEnabled: boolean;
    qwenModel: string;
    qwenEndpoint: string;
    qwenWorkspaceConfigured?: boolean;
    qwenRegion?: string;
    geminiEnabled: boolean;
    geminiModel: string;
    geminiDisabledReason?: 'DISABLED_BY_ENV' | 'NOT_CONFIGURED' | 'API_KEY_INVALID';
    anyEnabled: boolean;
}

export interface LlmChatMessageInput {
    role: 'user' | 'assistant';
    content: string;
}

export interface LlmCoachReplyResult {
    text: string;
    providerUsed?: string;
    modelUsed?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
    failed?: boolean;
    /** True when the provider stopped because it hit the output token limit. */
    truncated?: boolean;
}

/** Analyst output budget: long enough for a full structured analysis. */
const ANALYST_MAX_OUTPUT_TOKENS = 1400;

/** Joins every non-thought text part of a Gemini candidate (responses can be split across parts). */
function extractGeminiText(data: any): string {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts
        .filter((p: any) => typeof p?.text === 'string' && !p?.thought)
        .map((p: any) => p.text)
        .join('')
        .trim();
}

@Injectable()
export class AiLlmProviderService {
    private static readonly GEMINI_FALLBACK_MODELS = [
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
    ] as const;

    private static readonly LEGACY_INVALID_GEMINI_MODELS = new Set([
        'gemini-3.8-flash',
        'gemini-3.1-flash-lite',
    ]);

    private readonly logger = new Logger(AiLlmProviderService.name);
    private invalidGeminiKeyHash: string | null = null;
    private bypassedQwenWorkspaceHash: string | null = null;
    private warnedInvalidQwenWorkspace: string | null = null;
    private readonly retiredGeminiModels = new Set<string>();

    constructor(
        private readonly configService: ConfigService,
        private readonly httpService: HttpService
    ) {}

    private hashSecret(secret: string): string {
        return createHash('sha256').update(secret).digest('hex');
    }

    private formatProviderError(err: any): string {
        const status = err?.response?.status;
        const providerMsg =
            err?.response?.data?.error?.message ||
            err?.response?.data?.message ||
            err?.message ||
            'Unknown error';
        return status ? `HTTP ${status}: ${providerMsg}` : String(providerMsg);
    }

    private isInvalidGeminiKeyError(err: any): boolean {
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

    private tripInvalidGeminiKeyBreaker(err: any, key?: string): boolean {
        if (!key || !this.isInvalidGeminiKeyError(err)) {
            return false;
        }
        const h = this.hashSecret(key);
        if (this.invalidGeminiKeyHash !== h) {
            this.invalidGeminiKeyHash = h;
            this.logger.warn(
                'GEMINI_API_KEY rejeitada pela Google API (API_KEY_INVALID). Motor Gemini em pausa até que uma chave válida do Google AI Studio seja configurada.'
            );
        }
        return true;
    }

    private resolveGeminiConfig(): {
        enabled: boolean;
        key?: string;
        model: string;
        disabledReason?: 'DISABLED_BY_ENV' | 'NOT_CONFIGURED' | 'API_KEY_INVALID';
    } {
        const defaultModel = AiLlmProviderService.GEMINI_FALLBACK_MODELS[0];
        const rawProvider = String(
            this.configService.get<string>('TOREX_AI_CHAT_PROVIDER') || 'auto'
        )
            .toLowerCase()
            .trim();

        if (rawProvider === 'none' || rawProvider === 'disabled' || rawProvider === 'off') {
            return {
                enabled: false,
                model: defaultModel,
                disabledReason: 'DISABLED_BY_ENV',
            };
        }

        const key = (
            this.configService.get<string>('GEMINI_API_KEY') ||
            this.configService.get<string>('TOREX_AI_GEMINI_API_KEY') ||
            this.configService.get<string>('api_token_gemin') ||
            this.configService.get<string>('TOREX_AI_CHAT_API_KEY') ||
            ''
        ).trim();

        // Evita confundir uma chave OpenRouter/OpenAI colocada em TOREX_AI_CHAT_API_KEY com chave Gemini
        const isValidGeminiKey =
            Boolean(key) && !key.startsWith('sk-or-') && !key.startsWith('sk-proj-');

        const configuredModel = (
            this.configService.get<string>('GEMINI_MODEL') ||
            this.configService.get<string>('TOREX_AI_ANALYST_MODEL') ||
            this.configService.get<string>('TOREX_AI_CHAT_MODEL') ||
            ''
        ).trim();

        const isDeprecatedOrUnknown =
            AiLlmProviderService.LEGACY_INVALID_GEMINI_MODELS.has(configuredModel.toLowerCase());

        let model =
            configuredModel.toLowerCase().startsWith('gemini') && !isDeprecatedOrUnknown
                ? configuredModel
                : defaultModel;

        if (this.retiredGeminiModels.has(model)) {
            model =
                AiLlmProviderService.GEMINI_FALLBACK_MODELS.find(
                    (candidate) => !this.retiredGeminiModels.has(candidate)
                ) || AiLlmProviderService.GEMINI_FALLBACK_MODELS[1];
        }

        if (!isValidGeminiKey) {
            return {
                enabled: false,
                model,
                disabledReason: 'NOT_CONFIGURED',
            };
        }

        if (this.invalidGeminiKeyHash === this.hashSecret(key)) {
            return {
                enabled: false,
                model,
                disabledReason: 'API_KEY_INVALID',
            };
        }

        return {
            enabled: true,
            key,
            model,
        };
    }

    private normalizeOpenAiCompatibleEndpoint(
        rawEndpoint: string,
        workspaceId?: string,
        region = 'ap-southeast-1'
    ): string {
        let clean = String(rawEndpoint || '').trim();
        if (!clean) return '';

        if (workspaceId) {
            clean = clean.replace(
                /(?:\$\{workspace_?id\}|\{workspace_?id\}|<workspace_?id>)/gi,
                workspaceId
            );
        }
        clean = clean.replace(/(?:\{region\}|<region>)/gi, region);
        clean = clean.replace(/\/+$/, '');

        if (/\/(?:compatible-mode\/v1|v1)$/i.test(clean)) {
            clean = `${clean}/chat/completions`;
        }

        return clean;
    }

    private buildQwenHeaders(qwen: {
        key?: string;
        workspaceId?: string;
        endpoint: string;
    }): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (qwen.key) {
            headers.Authorization = `Bearer ${qwen.key}`;
        }
        if (
            qwen.workspaceId &&
            qwen.endpoint.includes('aliyuncs.com') &&
            !qwen.endpoint.includes('.maas.aliyuncs.com')
        ) {
            headers['X-DashScope-WorkSpace'] = qwen.workspaceId;
        }
        return headers;
    }

    private resolveQwenConfig(): {
        enabled: boolean;
        key?: string;
        endpoint: string;
        model: string;
        workspaceId?: string;
        region: string;
        timeoutMs: number;
    } {
        const rawRegion = (
            this.configService.get<string>('QWEN_REGION') ||
            this.configService.get<string>('DASHSCOPE_REGION') ||
            'ap-southeast-1'
        )
            .trim()
            .toLowerCase();
        const region = rawRegion.replace(/[^a-z0-9-]/g, '') || 'ap-southeast-1';

        const rawWorkspaceId = (
            this.configService.get<string>('QWEN_WORKSPACE_ID') ||
            this.configService.get<string>('DASHSCOPE_WORKSPACE_ID') ||
            this.configService.get<string>('TOREX_AI_ROUTER_WORKSPACE_ID') ||
            ''
        ).trim();
        const sanitizedWorkspaceId = rawWorkspaceId.replace(/[^a-zA-Z0-9._-]/g, '');
        const isAlibabaWorkspaceFormat = /^(?:ws-|llm-)[a-zA-Z0-9._-]+$/i.test(sanitizedWorkspaceId);
        if (sanitizedWorkspaceId && !isAlibabaWorkspaceFormat && this.warnedInvalidQwenWorkspace !== sanitizedWorkspaceId) {
            this.warnedInvalidQwenWorkspace = sanitizedWorkspaceId;
            this.logger.warn(
                `QWEN_WORKSPACE_ID="${sanitizedWorkspaceId}" não tem formato de ID do Alibaba Model Studio (esperado ws-.../llm-...; nomes de exibição não são aceites no subdomínio). Usando endpoint regional Qwen sem subdomínio de workspace.`
            );
        }
        let workspaceId: string | undefined = isAlibabaWorkspaceFormat ? sanitizedWorkspaceId : undefined;

        const rawProvider = String(
            this.configService.get<string>('TOREX_AI_CHAT_PROVIDER') || 'auto'
        )
            .toLowerCase()
            .trim();

        if (rawProvider === 'none' || rawProvider === 'disabled' || rawProvider === 'off') {
            return {
                enabled: false,
                endpoint: 'https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions',
                model: 'qwen-plus',
                workspaceId,
                region,
                timeoutMs: 9000,
            };
        }

        const dedicatedQwenKey = (
            this.configService.get<string>('QWEN_API_KEY') ||
            this.configService.get<string>('DASHSCOPE_API_KEY') ||
            this.configService.get<string>('TOREX_AI_ROUTER_API_KEY') ||
            ''
        ).trim();

        const openRouterKey = (
            this.configService.get<string>('OPENROUTER_API_KEY') || ''
        ).trim();

        const chatFallbackKey = (
            this.configService.get<string>('TOREX_AI_CHAT_API_KEY') || ''
        ).trim();

        // Usa TOREX_AI_CHAT_API_KEY para Qwen apenas se não for chave típica AIza... do Google Gemini
        const legacyFallbackKey = (
            this.configService.get<string>('IA_API_KEY') ||
            this.configService.get<string>('OPENAI_API_KEY') ||
            (chatFallbackKey && !chatFallbackKey.startsWith('AIza')
                ? chatFallbackKey
                : '')
        ).trim();

        const key = dedicatedQwenKey || openRouterKey || legacyFallbackKey;

        let workspaceBypassed = false;
        if (workspaceId) {
            const wsHash = this.hashSecret(`${key || ''}:${workspaceId}`);
            if (this.bypassedQwenWorkspaceHash === wsHash) {
                workspaceId = undefined;
                workspaceBypassed = true;
            }
        }

        const openRouterDetected =
            Boolean(openRouterKey && !dedicatedQwenKey) ||
            key.startsWith('sk-or-');

        const explicitQwenEndpoint = (
            this.configService.get<string>('QWEN_API_ENDPOINT') ||
            this.configService.get<string>('DASHSCOPE_BASE_URL') ||
            this.configService.get<string>('QWEN_BASE_URL') ||
            this.configService.get<string>('TOREX_AI_ROUTER_ENDPOINT') ||
            ''
        ).trim();

        // Nunca envia QWEN_API_KEY/DASHSCOPE_API_KEY para IA_ENDPOINT legado
        const legacyEndpoint =
            !dedicatedQwenKey && !openRouterKey
                ? (
                      this.configService.get<string>('IA_ENDPOINT') ||
                      this.configService.get<string>('TOREX_AI_CHAT_ENDPOINT') ||
                      ''
                  ).trim()
                : '';

        const configuredEndpoint = explicitQwenEndpoint || legacyEndpoint;
        let normalizedConfiguredEndpoint =
            this.normalizeOpenAiCompatibleEndpoint(
                configuredEndpoint,
                workspaceId,
                region
            );

        if (
            (!workspaceId && /\{workspace_?id\}|<workspace_?id>/i.test(normalizedConfiguredEndpoint)) ||
            (workspaceBypassed && normalizedConfiguredEndpoint.includes('.maas.aliyuncs.com'))
        ) {
            normalizedConfiguredEndpoint = '';
        }

        let endpoint = normalizedConfiguredEndpoint;
        if (!endpoint) {
            if (openRouterDetected) {
                endpoint = 'https://openrouter.ai/api/v1/chat/completions';
            } else if (workspaceId) {
                endpoint = `https://${workspaceId}.${region}.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
            } else {
                endpoint = `https://${region}.maas.qwencloudapi.com/compatible-mode/v1/chat/completions`;
            }
        }

        const configuredModel = (
            this.configService.get<string>('QWEN_MODEL') ||
            this.configService.get<string>('TOREX_AI_ROUTER_MODEL') ||
            ''
        ).trim();

        const model =
            configuredModel ||
            (openRouterDetected
                ? 'qwen/qwen-2.5-14b-instruct'
                : 'qwen-plus');

        const isLocalEndpoint =
            Boolean(normalizedConfiguredEndpoint) &&
            (normalizedConfiguredEndpoint.includes('127.0.0.1') ||
                normalizedConfiguredEndpoint.includes('localhost'));

        const timeoutMs = Math.max(
            3000,
            Number(this.configService.get<string>('QWEN_TIMEOUT_MS') || 9000) || 9000
        );

        return {
            enabled: Boolean(key) || isLocalEndpoint,
            key: key || undefined,
            endpoint,
            model,
            workspaceId,
            region,
            timeoutMs,
        };
    }

    private isQwenWorkspaceEndpointError(
        err: any,
        qwen: { workspaceId?: string; endpoint: string }
    ): boolean {
        const status = Number(err?.response?.status);
        if (status !== 400 && status !== 403) {
            return false;
        }
        if (!qwen.workspaceId && !qwen.endpoint.includes('.maas.aliyuncs.com')) {
            return false;
        }
        const errCode = String(err?.response?.data?.error?.code || '');
        const errMsg = String(err?.response?.data?.error?.message || err?.message || '');
        return /Workspace endpoint is invalid|Workspace\.AccessDenied|Workspace access denied|invalid_parameter_error/i.test(
            `${errCode} ${errMsg}`
        );
    }

    private async postQwenChatCompletion(
        qwen: ReturnType<AiLlmProviderService['resolveQwenConfig']>,
        payload: Record<string, any>,
        timeoutMs: number
    ) {
        try {
            return await firstValueFrom(
                this.httpService.post(qwen.endpoint, payload, {
                    headers: this.buildQwenHeaders(qwen),
                    timeout: timeoutMs,
                })
            );
        } catch (err) {
            const fallbackEndpoint = `https://${qwen.region}.maas.qwencloudapi.com/compatible-mode/v1/chat/completions`;
            if (qwen.endpoint !== fallbackEndpoint && this.isQwenWorkspaceEndpointError(err, qwen)) {
                if (qwen.workspaceId) {
                    this.bypassedQwenWorkspaceHash = this.hashSecret(
                        `${qwen.key || ''}:${qwen.workspaceId}`
                    );
                }
                this.logger.warn(
                    `Qwen Workspace endpoint rejeitado (${this.formatProviderError(err)}). Alternando imediatamente para endpoint regional ${fallbackEndpoint}.`
                );
                const cleanHeaders: Record<string, string> = {
                    'Content-Type': 'application/json',
                    ...(qwen.key ? { Authorization: `Bearer ${qwen.key}` } : {}),
                };
                return firstValueFrom(
                    this.httpService.post(fallbackEndpoint, payload, {
                        headers: cleanHeaders,
                        timeout: timeoutMs,
                    })
                );
            }
            throw err;
        }
    }

    private async postGeminiGenerateContent(
        gemini: { key: string; model: string },
        payload: Record<string, any>,
        timeoutMs: number
    ): Promise<{ data: any; modelUsed: string }> {
        const candidates = [
            gemini.model,
            ...AiLlmProviderService.GEMINI_FALLBACK_MODELS,
        ].filter(
            (m, idx, arr) =>
                Boolean(m) &&
                arr.indexOf(m) === idx &&
                !this.retiredGeminiModels.has(m)
        );
        const queue = candidates.length > 0 ? candidates : ['gemini-2.5-flash-lite'];

        for (let i = 0; i < queue.length; i++) {
            const candidateModel = queue[i];
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`;
            try {
                const res = await firstValueFrom(
                    this.httpService.post(url, payload, {
                        headers: {
                            'Content-Type': 'application/json',
                            'x-goog-api-key': gemini.key,
                        },
                        timeout: timeoutMs,
                    })
                );
                return { data: res.data, modelUsed: candidateModel };
            } catch (err: any) {
                const status = Number(err?.response?.status);
                const code = err?.code;
                if (status === 400 || status === 401 || status === 403) {
                    throw err;
                }
                const hasNext = i < queue.length - 1;
                if (status === 404) {
                    this.retiredGeminiModels.add(candidateModel);
                    if (hasNext) {
                        this.logger.warn(
                            `Modelo Gemini ${candidateModel} retornou 404 (${this.formatProviderError(err)}). Substituindo por ${queue[i + 1]}.`
                        );
                        continue;
                    }
                    throw err;
                }
                if ((status === 503 || status === 429 || code === 'ECONNABORTED') && hasNext) {
                    this.logger.warn(
                        `Modelo Gemini ${candidateModel} temporariamente indisponível (${this.formatProviderError(err)}). Tentando ${queue[i + 1]}.`
                    );
                    continue;
                }
                throw err;
            }
        }

        throw new Error('No Gemini candidate model succeeded');
    }

    /**
     * Retorna o estado detalhado da arquitetura Dual-Engine (Qwen Router + Gemini Analyst).
     */
    getDualEngineStatus(): DualEngineStatus {
        const qwen = this.resolveQwenConfig();
        const gemini = this.resolveGeminiConfig();
        return {
            qwenEnabled: qwen.enabled,
            qwenModel: qwen.model,
            qwenEndpoint: qwen.endpoint,
            qwenWorkspaceConfigured: Boolean(qwen.workspaceId),
            qwenRegion: qwen.region,
            geminiEnabled: gemini.enabled,
            geminiModel: gemini.model,
            ...(gemini.disabledReason
                ? { geminiDisabledReason: gemini.disabledReason }
                : {}),
            anyEnabled: qwen.enabled || gemini.enabled,
        };
    }

    /**
     * Mantido por compatibilidade com chamadas legadas do módulo.
     */
    getProviderStatus(): LlmProviderStatus {
        const dual = this.getDualEngineStatus();
        if (dual.geminiEnabled) {
            return {
                enabled: true,
                provider: 'gemini',
                model: dual.geminiModel,
                label: 'Torex AI',
            };
        }
        if (dual.qwenEnabled) {
            return {
                enabled: true,
                provider: 'qwen',
                model: dual.qwenModel,
                label: 'Torex AI',
            };
        }
        return {
            enabled: false,
            provider: 'none',
            model: 'torex-ai',
            label: 'Torex AI',
        };
    }

    private sanitizeHistoryContent(raw: string): string {
        return String(raw || '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
            .slice(0, 1400)
            .trim();
    }

    private prepareSafeHistory(
        history: LlmChatMessageInput[],
        maxItems = 6
    ): LlmChatMessageInput[] {
        const sanitized = (history || [])
            .slice(-maxItems)
            .map((m) => ({
                role: m.role,
                content: this.sanitizeHistoryContent(m.content),
            }))
            .filter((m) => m.content.length > 0);

        return cavemanCompressHistory(sanitized, maxItems, 420);
    }

    private buildOpenAiMessages(
        systemPrompt: string,
        history: LlmChatMessageInput[],
        userContent: string
    ) {
        return [
            { role: 'system', content: systemPrompt },
            ...history.map((m) => ({
                role: m.role,
                content: m.content,
            })),
            { role: 'user', content: userContent },
        ];
    }

    private buildGeminiContents(
        history: LlmChatMessageInput[],
        userContent: string
    ) {
        return [
            ...history.map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            })),
            {
                role: 'user',
                parts: [{ text: userContent }],
            },
        ];
    }

    /**
     * Camada 1 (Roteador & Gatekeeper): Executa o Qwen em modo JSON estruturado de passagem única.
     * Caso o Qwen oscile ou não esteja configurado, faz fallback transparente para o Gemini Flash em modo JSON.
     */
    async generateRouterJson(params: {
        systemPrompt: string;
        userPrompt: string;
        history: LlmChatMessageInput[];
    }): Promise<LlmCoachReplyResult | null> {
        const qwen = this.resolveQwenConfig();
        const gemini = this.resolveGeminiConfig();

        if (!qwen.enabled && !gemini.enabled) {
            return null;
        }

        const safeHistory = this.prepareSafeHistory(params.history, 4);

        // 1. Tenta primariamente o Qwen (modelo barato e rápido de linha de frente)
        if (qwen.enabled) {
            const startedAt = Date.now();
            try {
                const messages = this.buildOpenAiMessages(
                    params.systemPrompt,
                    safeHistory,
                    params.userPrompt
                );

                const res = await this.postQwenChatCompletion(
                    qwen,
                    {
                        model: qwen.model,
                        messages,
                        temperature: 0.2,
                        max_tokens: 700,
                        response_format: { type: 'json_object' },
                    },
                    qwen.timeoutMs
                );

                const text = res.data?.choices?.[0]?.message?.content?.trim();
                if (text) {
                    const usage = res.data?.usage;
                    return {
                        text,
                        providerUsed: 'qwen_router',
                        modelUsed: qwen.model,
                        promptTokens: Number(usage?.prompt_tokens || 0) || undefined,
                        completionTokens:
                            Number(usage?.completion_tokens || 0) || undefined,
                        totalTokens: Number(usage?.total_tokens || 0) || undefined,
                        latencyMs: Date.now() - startedAt,
                    };
                }
            } catch (err) {
                this.logger.warn(
                    `Qwen Router indisponível (${this.formatProviderError(err)}). Acionando fallback se disponível.`
                );
            }
        }

        // 2. Fallback automático de alta disponibilidade usando Gemini Flash em modo JSON
        if (gemini.enabled && gemini.key) {
            const startedAt = Date.now();
            try {
                const contents = this.buildGeminiContents(
                    safeHistory,
                    params.userPrompt
                );

                const { data, modelUsed } = await this.postGeminiGenerateContent(
                    { key: gemini.key, model: gemini.model },
                    {
                        systemInstruction: {
                            parts: [{ text: params.systemPrompt }],
                        },
                        contents,
                        generationConfig: {
                            temperature: 0.15,
                            maxOutputTokens: 700,
                            responseMimeType: 'application/json',
                        },
                    },
                    12000
                );

                const text = extractGeminiText(data);
                if (text) {
                    const usage = data?.usageMetadata;
                    return {
                        text,
                        providerUsed: 'gemini_router_fallback',
                        modelUsed,
                        promptTokens:
                            Number(usage?.promptTokenCount || 0) || undefined,
                        completionTokens:
                            Number(usage?.candidatesTokenCount || 0) || undefined,
                        totalTokens:
                            Number(usage?.totalTokenCount || 0) || undefined,
                        latencyMs: Date.now() - startedAt,
                    };
                }
            } catch (err) {
                if (!this.tripInvalidGeminiKeyBreaker(err, gemini.key)) {
                    this.logger.warn(
                        `Gemini Router Fallback falhou: ${this.formatProviderError(err)}`
                    );
                }
                return { text: '', failed: true };
            }
        }

        return { text: '', failed: true };
    }

    /**
     * Camada 2 (Analista Quantitativo): Executa o Gemini com temperatura baixa (0.15)
     * para respostas objetivas, precisas e fundamentadas nos dados auditados da conta.
     */
    async generateGeminiAnalysis(params: {
        systemPrompt: string;
        userTaskPrompt: string;
        history: LlmChatMessageInput[];
    }): Promise<LlmCoachReplyResult | null> {
        const gemini = this.resolveGeminiConfig();
        const qwen = this.resolveQwenConfig();

        if (!gemini.enabled && !qwen.enabled) {
            return null;
        }

        const safeHistory = this.prepareSafeHistory(params.history, 6);

        // 1. Execução primária no Gemini (Analista Oficial)
        if (gemini.enabled && gemini.key) {
            const startedAt = Date.now();
            try {
                const contents = this.buildGeminiContents(
                    safeHistory,
                    params.userTaskPrompt
                );

                const { data, modelUsed } = await this.postGeminiGenerateContent(
                    { key: gemini.key, model: gemini.model },
                    {
                        systemInstruction: {
                            parts: [{ text: params.systemPrompt }],
                        },
                        contents,
                        generationConfig: {
                            temperature: 0.15,
                            maxOutputTokens: ANALYST_MAX_OUTPUT_TOKENS,
                        },
                    },
                    28000
                );

                const text = extractGeminiText(data);
                const finishReason = String(data?.candidates?.[0]?.finishReason || '');
                if (finishReason === 'MAX_TOKENS') {
                    this.logger.warn(
                        `Gemini Analyst hit maxOutputTokens (${ANALYST_MAX_OUTPUT_TOKENS}); reply may be truncated.`
                    );
                }
                if (text) {
                    const usage = data?.usageMetadata;
                    return {
                        text,
                        truncated: finishReason === 'MAX_TOKENS',
                        providerUsed: 'llm:gemini',
                        modelUsed,
                        promptTokens:
                            Number(usage?.promptTokenCount || 0) || undefined,
                        completionTokens:
                            Number(usage?.candidatesTokenCount || 0) || undefined,
                        totalTokens:
                            Number(usage?.totalTokenCount || 0) || undefined,
                        latencyMs: Date.now() - startedAt,
                    };
                }
            } catch (err) {
                if (!this.tripInvalidGeminiKeyBreaker(err, gemini.key)) {
                    this.logger.warn(
                        `Falha no Gemini Analyst (${this.formatProviderError(err)}). Tentando contingência Qwen.`
                    );
                }
            }
        }

        // 2. Contingência segura no Qwen caso a API do Gemini esteja temporariamente indisponível
        if (qwen.enabled) {
            const startedAt = Date.now();
            try {
                const messages = this.buildOpenAiMessages(
                    params.systemPrompt,
                    safeHistory,
                    params.userTaskPrompt
                );

                const res = await this.postQwenChatCompletion(
                    qwen,
                    {
                        model: qwen.model,
                        messages,
                        temperature: 0.15,
                        max_tokens: ANALYST_MAX_OUTPUT_TOKENS,
                    },
                    22000
                );

                const text = res.data?.choices?.[0]?.message?.content?.trim();
                if (text) {
                    const usage = res.data?.usage;
                    return {
                        text,
                        truncated: res.data?.choices?.[0]?.finish_reason === 'length',
                        providerUsed: 'llm:qwen_analyst_fallback',
                        modelUsed: qwen.model,
                        promptTokens: Number(usage?.prompt_tokens || 0) || undefined,
                        completionTokens:
                            Number(usage?.completion_tokens || 0) || undefined,
                        totalTokens: Number(usage?.total_tokens || 0) || undefined,
                        latencyMs: Date.now() - startedAt,
                    };
                }
            } catch (err) {
                this.logger.warn(
                    `Contingência Qwen Analyst também falhou: ${this.formatProviderError(err)}`
                );
                return { text: '', failed: true };
            }
        }

        return { text: '', failed: true };
    }

    /**
     * Alias compatível para fluxos existentes.
     */
    async generateCoachReply(params: {
        systemPrompt: string;
        userTaskPrompt: string;
        history: LlmChatMessageInput[];
    }): Promise<LlmCoachReplyResult | null> {
        return this.generateGeminiAnalysis(params);
    }
}
