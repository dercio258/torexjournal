import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiInsightEntity } from './ai-insight.entity';
import { PREMIUM_SYSTEM_PROMPT, BASIC_SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { PlanTier } from '../payment/plan-permission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlanPermissionService } from '../payment/plan-permission.service';
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
        const geminiToken = this.configService.get<string>('api_token_gemin');
        const userPlan = await this.planPermissionService.getUserPlan(userId);
        const systemPrompt = userPlan === PlanTier.PREMIUM ? PREMIUM_SYSTEM_PROMPT : BASIC_SYSTEM_PROMPT;
        const userPrompt = buildUserPrompt(JSON.stringify({ metrics, tier: userPlan }, null, 2));

        if (geminiToken) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiToken}`;
                const body = {
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    },
                    contents: [{
                        parts: [{ text: userPrompt }]
                    }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "object",
                            properties: {
                                headline: { type: "string" },
                                insights: {
                                    type: "array",
                                    items: { type: "string" }
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

                this.logger.log(`Requesting insights from Gemini API (gemini-2.5-flash) for account ${accountId}...`);
                const response = await firstValueFrom(this.httpService.post(url, body, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 45000 // 45s timeout
                }));

                const candidate = response.data?.candidates?.[0];
                const contentText = candidate?.content?.parts?.[0]?.text;
                if (!contentText) {
                    throw new Error("No text content returned from Gemini API");
                }

                const result = JSON.parse(contentText.trim());

                // Save to DB
                const insightEntity = this.aiInsightRepo.create({
                    accountId,
                    importLogId: logId,
                    headline: result.headline,
                    insights: result.insights,
                    actions: result.actions || [],
                });

                await this.aiInsightRepo.save(insightEntity);
                this.logger.log(`AI Insights (Gemini) saved successfully for account ${accountId}`);

                // Send Notification if requested by the AI
                if (result.notify) {
                    const title = userPlan === PlanTier.PREMIUM ? '⚠️ Alerta de IA Torex' : 'ℹ️ Alerta do Sistema Torex';
                    const message = userPlan === PlanTier.PREMIUM
                        ? `O assistente identificou avisos de alto risco: ${result.headline}`
                        : `Novo resumo de performance disponível: ${result.headline}`;

                    this.notificationsService.create(userId, {
                        title,
                        message,
                        type: (result.notify === true ? 'WARNING' : 'INFO') as any
                    }).catch(e => this.logger.warn(`Failed to notify AI alert: ${e.message}`));
                }

                return insightEntity;

            } catch (geminiErr) {
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
        } else if (iaApiKey) {
            headers['Authorization'] = `Bearer ${iaApiKey}`;
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

            const cleanString = contentString.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(cleanString);

            if (!result.headline || !Array.isArray(result.insights)) {
                throw new Error("Invalid schema returned from AI model");
            }

            const insightEntity = this.aiInsightRepo.create({
                accountId,
                importLogId: logId,
                headline: result.headline,
                insights: result.insights,
                actions: result.actions || [],
            });

            await this.aiInsightRepo.save(insightEntity);
            this.logger.log(`AI Insights saved successfully for account ${accountId}`);

            if (result.notify) {
                const title = userPlan === PlanTier.PREMIUM ? '⚠️ Alerta de IA Torex' : 'ℹ️ Alerta do Sistema Torex';
                const message = userPlan === PlanTier.PREMIUM
                    ? `O assistente identificou avisos de alto risco: ${result.headline}`
                    : `Novo resumo de performance disponível: ${result.headline}`;

                this.notificationsService.create(userId, {
                    title,
                    message,
                    type: (result.notify === true ? 'WARNING' : 'INFO') as any
                }).catch(e => this.logger.warn(`Failed to notify AI alert: ${e.message}`));
            }

            return insightEntity;

        } catch (e) {
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
