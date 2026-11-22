import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiInsightEntity } from './ai-insight.entity';
import {
    PREMIUM_SYSTEM_PROMPT,
    BASIC_SYSTEM_PROMPT,
    buildUserPrompt,
    normalizeInsightsPayload,
} from './prompts';
import { PlanTier, PlanPermissionService } from '../payment/plan-permission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AiService {
    private readonly logger = new Logger(AiService.name);

    constructor(
        private configService: ConfigService,
        private httpService: HttpService,
        @InjectRepository(AiInsightEntity)
        private aiInsightRepo: Repository<AiInsightEntity>,
        private notificationsService: NotificationsService,
        private planPermissionService: PlanPermissionService
    ) { }

    async generateInsights(accountId: string, userId: string, metrics: any, logId?: number) {
        const geminiToken =
            this.configService.get<string>('GEMINI_API_KEY') ||
            this.configService.get<string>('api_token_gemin');
        const userPlan = await this.planPermissionService.getUserPlan(userId);
        const isAdvancedPlan = userPlan === PlanTier.PREMIUM || userPlan === PlanTier.PRO;
        const systemPrompt = isAdvancedPlan ? PREMIUM_SYSTEM_PROMPT : BASIC_SYSTEM_PROMPT;
        const userPrompt = buildUserPrompt(JSON.stringify({ metrics, tier: userPlan }, null, 2));

        if (geminiToken) {
            try {
                const body = {
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    },
                    contents: [{
                        parts: [{ text: userPrompt }]
                    }],
                    generationConfig: {
                        temperature: 0.15,
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "object",
                            properties: {
                                headline: { type: "string" },
                                insights: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            text: { type: "string" },
                                            severity: {
                                                type: "string",
                                                enum: ["green", "yellow", "red"]
                                            }
                                        },
                                        required: ["text", "severity"]
                                    }
                                },
                                actions: {
                                    type: "array",
                                    items: { type: "string" }
                                },
                                notify: { type: "boolean" }
                            },
                            required: ["headline", "insights", "actions", "notify"]
                        }
                    }
                };

                const configuredModel = (
                    this.configService.get<string>('GEMINI_MODEL') || ''
                ).trim();
                const remappedConfigured =
                    configuredModel.toLowerCase() === 'gemini-2.5-flash-lite'
                        ? 'gemini-3.5-flash-lite'
                        : configuredModel;
                const safeConfiguredModel =
                    remappedConfigured.toLowerCase().startsWith('gemini') &&
                    remappedConfigured.toLowerCase() !== 'gemini-3.8-flash' &&
                    remappedConfigured.toLowerCase() !== 'gemini-3.1-flash-lite'
                        ? remappedConfigured
                        : 'gemini-2.5-flash';
                const candidates = [
                    safeConfiguredModel,
                    'gemini-2.5-flash',
                    'gemini-3.5-flash-lite',
                ].filter((m, idx, arr) => arr.indexOf(m) === idx);

                let response: any = null;
                let lastErr: any = null;
                for (let i = 0; i < candidates.length; i++) {
                    const candidateModel = candidates[i];
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`;
                    try {
                        this.logger.log(`Requesting insights from Gemini API (${candidateModel}) for account ${accountId}...`);
                        response = await firstValueFrom(this.httpService.post(url, body, {
                            headers: {
                                'Content-Type': 'application/json',
                                'x-goog-api-key': geminiToken,
                            },
                            timeout: 45000 // 45s timeout
                        }));
                        break;
                    } catch (err: any) {
                        lastErr = err;
                        const status = Number(err?.response?.status);
                        if (status === 400 || status === 401 || status === 403) {
                            throw err;
                        }
                        const retryable =
                            status === 404 ||
                            status === 503 ||
                            status === 429 ||
                            err?.code === 'ECONNABORTED';
                        if (!retryable || i === candidates.length - 1) {
                            throw err;
                        }
                        this.logger.warn(
                            `Gemini API (${candidateModel}) unavailable (${status || err?.code || err?.message}). Retrying with ${candidates[i + 1]}...`
                        );
                    }
                }
                if (!response) {
                    throw lastErr || new Error("No response returned from Gemini API");
                }

                const candidate = response.data?.candidates?.[0];
                const contentText = candidate?.content?.parts?.[0]?.text;
                if (!contentText) {
                    throw new Error("No text content returned from Gemini API");
                }

                const cleanJson = contentText.replace(/```json/gi, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleanJson);
                const result = normalizeInsightsPayload(parsed);
                if (!result) {
                    throw new Error("Invalid insights schema returned from Gemini API");
                }

                // Save to DB
                const insightEntity = this.aiInsightRepo.create({
                    accountId,
                    importLogId: logId,
                    headline: result.headline,
                    insights: result.insights,
                    actions: result.actions,
                });

                await this.aiInsightRepo.save(insightEntity);
                this.logger.log(`AI Insights (Gemini) saved successfully for account ${accountId}`);

                // Send Notification if requested by the AI
                if (result.notify) {
                    const title = isAdvancedPlan ? '⚠️ Alerta de IA Torex' : 'ℹ️ Alerta do Sistema Torex';
                    const message = isAdvancedPlan
                        ? `O assistente identificou avisos de alto risco: ${result.headline}`
                        : `Novo resumo de performance disponível: ${result.headline}`;

                    this.notificationsService.create(userId, {
                        title,
                        message,
                        type: (result.notify === true ? 'WARNING' : 'INFO') as any
                    }).catch(e => this.logger.warn(`Failed to notify AI alert: ${e.message}`));
                }

                return insightEntity;

            } catch (geminiErr: any) {
                this.logger.warn(`Gemini API failed: ${geminiErr.message}. Falling back to old AI endpoint...`);
            }
        }

        // --- FALLBACK TO PREVIOUS AI API FLOW ---
        const iaEndpoint = this.configService.get<string>('IA_ENDPOINT');
        const iaApiKey = this.configService.get<string>('IA_API_KEY');

        let url = iaEndpoint;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        if (!url) {
            const host = this.configService.get<string>('LLAMA_SERVER_HOST') || '127.0.0.1';
            const port = this.configService.get<string>('LLAMA_SERVER_PORT') || '8080';
            url = `http://${host}:${port}/v1/chat/completions`;
        } else {
            const isProd = this.configService.get<string>('NODE_ENV') === 'production';
            const isLocal = url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');
            if (isProd && url.startsWith('http://') && !isLocal) {
                throw new HttpException(
                    'IA_ENDPOINT deve utilizar HTTPS em produção para proteger dados financeiros em trânsito.',
                    HttpStatus.BAD_GATEWAY,
                );
            }
            if (iaApiKey) {
                headers['Authorization'] = `Bearer ${iaApiKey}`;
            }
        }

        const body = {
            model: "mistral",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.3,
            n_predict: 600,
            max_tokens: 600,
            response_format: { type: "json_object" }
        };

        try {
            if (iaEndpoint) {
                this.logger.log(`Requesting insights from Remote IA Endpoint at ${url} for account ${accountId}...`);
            } else {
                this.logger.log(`Requesting insights from local LLaMA Server at ${url} for account ${accountId}...`);
            }

            const response = await firstValueFrom(this.httpService.post(url, body, {
                headers,
                timeout: 880000 // 8 minutes timeout
            }));

            const data = response.data;
            const contentString = data.choices[0]?.message?.content || '{}';

            const cleanString = contentString.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanString);
            const result = normalizeInsightsPayload(parsed);

            if (!result) {
                throw new Error("Invalid schema returned from AI model");
            }

            const insightEntity = this.aiInsightRepo.create({
                accountId,
                importLogId: logId,
                headline: result.headline,
                insights: result.insights,
                actions: result.actions,
            });

            await this.aiInsightRepo.save(insightEntity);
            this.logger.log(`AI Insights saved successfully for account ${accountId}`);

            if (result.notify) {
                const title = isAdvancedPlan ? '⚠️ Alerta de IA Torex' : 'ℹ️ Alerta do Sistema Torex';
                const message = isAdvancedPlan
                    ? `O assistente identificou avisos de alto risco: ${result.headline}`
                    : `Novo resumo de performance disponível: ${result.headline}`;

                this.notificationsService.create(userId, {
                    title,
                    message,
                    type: (result.notify === true ? 'WARNING' : 'INFO') as any
                }).catch(e => this.logger.warn(`Failed to notify AI alert: ${e.message}`));
            }

            return insightEntity;

        } catch (e: any) {
            this.logger.error(`AI Insight Generation Failed: ${e.message}`);
            return null;
        }
    }

    async getInsightsByAccount(accountId: string) {
        return this.aiInsightRepo.find({
            where: { accountId },
            order: { createdAt: 'DESC' },
            take: 10
        });
    }
}
