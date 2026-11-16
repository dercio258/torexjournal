import { of } from 'rxjs';
import { AiLlmProviderService } from './ai-llm-provider.service';

/**
 * Analyst output quality: full token budget, multi-part responses and truncation detection.
 */
describe('Phase 9 — Analyst output quality', () => {
    const makeProvider = (response: any) => {
        const env: Record<string, string> = {
            GEMINI_API_KEY: 'AIzaValidKeyForAnalystQualitySpec0000001',
        };
        const configService = { get: jest.fn((key: string) => env[key]) } as any;
        const httpPost = jest.fn<any, any[]>(() => of({ data: response } as any));
        const provider = new AiLlmProviderService(configService, { post: httpPost } as any);
        return { provider, httpPost };
    };

    it('requests a full analyst budget instead of 450 tokens', async () => {
        const { provider, httpPost } = makeProvider({
            candidates: [{ content: { parts: [{ text: 'Análise completa.' }] }, finishReason: 'STOP' }],
        });

        const res = await provider.generateGeminiAnalysis({ systemPrompt: 's', userTaskPrompt: 't', history: [] });

        expect(res?.text).toBe('Análise completa.');
        const body = httpPost.mock.calls[0][1];
        expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(1200);
        expect(res?.truncated).toBe(false);
    });

    it('joins every text part and skips thought parts', async () => {
        const { provider } = makeProvider({
            candidates: [
                {
                    content: {
                        parts: [
                            { text: 'internal reasoning', thought: true },
                            { text: 'Win rate de 54%. ' },
                            { text: 'Payoff de 1.8.' },
                        ],
                    },
                    finishReason: 'STOP',
                },
            ],
        });

        const res = await provider.generateGeminiAnalysis({ systemPrompt: 's', userTaskPrompt: 't', history: [] });

        expect(res?.text).toBe('Win rate de 54%. Payoff de 1.8.');
    });

    it('flags replies cut by the output token limit', async () => {
        const { provider } = makeProvider({
            candidates: [
                { content: { parts: [{ text: 'Nos últimos 30 dias, não há operações registadas' }] }, finishReason: 'MAX_TOKENS' },
            ],
        });

        const res = await provider.generateGeminiAnalysis({ systemPrompt: 's', userTaskPrompt: 't', history: [] });

        expect(res?.truncated).toBe(true);
        expect(res?.failed).toBeFalsy();
    });
});
