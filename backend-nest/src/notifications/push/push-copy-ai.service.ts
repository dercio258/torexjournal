import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PushCopyResult {
    title: string;
    body: string;
    usedAi: boolean;
}

@Injectable()
export class PushCopyAiService {
    private readonly logger = new Logger(PushCopyAiService.name);

    constructor(private readonly configService: ConfigService) {}

    private hasValidGeminiKey(): string | null {
        const key = (this.configService?.get<string>('GEMINI_API_KEY') || process.env.GEMINI_API_KEY || '').trim();
        if (!key || key.startsWith('CHANGE_ME') || key.length < 15) return null;
        return key;
    }

    private async callGeminiShortCopy(prompt: string): Promise<{ title: string; body: string } | null> {
        const apiKey = this.hasValidGeminiKey();
        if (!apiKey) return null;

        const rawModel =
            (this.configService?.get<string>('GEMINI_MODEL') || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
        const model =
            rawModel.toLowerCase() === 'gemini-3.8-flash' || rawModel.toLowerCase() === 'gemini-3.1-flash-lite'
                ? 'gemini-2.5-flash'
                : rawModel;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.5,
                        maxOutputTokens: 160,
                        responseMimeType: 'application/json',
                    },
                }),
                signal: AbortSignal.timeout(5500),
            });

            if (!response.ok) return null;
            const data: any = await response.json();
            const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawText) return null;

            const cleanedJson = String(rawText)
                .replace(/^```json\s*/i, '')
                .replace(/```\s*$/i, '')
                .trim();
            const parsed = JSON.parse(cleanedJson);
            const title = String(parsed?.title || '').trim().slice(0, 62);
            const body = String(parsed?.body || '').trim().slice(0, 145);
            if (title.length >= 6 && body.length >= 16) {
                return { title, body };
            }
            return null;
        } catch (err: any) {
            this.logger.debug(`Gemini push copy fallback triggered: ${err?.message || err}`);
            return null;
        }
    }

    async generatePostImportJournalCopy(params: {
        locale?: string;
        tradesCount: number;
        topSymbol?: string | null;
        netPnl?: number | null;
        username?: string | null;
    }): Promise<PushCopyResult> {
        const isEn = params.locale === 'en';
        const count = Math.max(1, Number(params.tradesCount) || 1);
        const symbolNote = params.topSymbol ? ` em ${params.topSymbol}` : '';
        const symbolNoteEn = params.topSymbol ? ` on ${params.topSymbol}` : '';

        const fallback: PushCopyResult = isEn
            ? {
                  title: `${count} new ${count === 1 ? 'trade' : 'trades'} synced${symbolNoteEn}`,
                  body: `How did you feel executing ${count === 1 ? 'this setup' : 'these setups'}? Log your journal now — it takes only 2 min.`,
                  usedAi: false,
              }
            : {
                  title: `Foram adicionadas ${count} ${count === 1 ? 'operação' : 'operações'}${symbolNote}`,
                  body: 'Diga como se sentiu ao operar e registe o contexto emocional. Preencha o diário — leva apenas 2 min.',
                  usedAi: false,
              };

        const prompt = isEn
            ? `Write a concise, motivating Web Push notification in JSON {"title":"...","body":"..."} for a trader who just imported ${count} trades (${params.topSymbol || 'mixed assets'}). Invite them to fill out their trading journal ("how did you feel?", "takes 2 min"). Never mention account balances, money amounts, or private credentials. Title <= 55 chars, body <= 135 chars, no emojis spam.`
            : `Escreva uma notificação Web Push objetiva, clara e motivadora em JSON {"title":"...","body":"..."} em Português para um trader que acabou de importar ${count} operações (${params.topSymbol || 'vários ativos'}). Pergunte como se sentiu e incentive a preencher o diário em apenas 2 min. Nunca inclua saldos, valores monetários ou dados sensíveis. Título <= 55 chars, corpo <= 135 chars, sem spam.`;

        const ai = await this.callGeminiShortCopy(prompt);
        if (ai) {
            return { ...ai, usedAi: true };
        }
        return fallback;
    }

    async generateCuriosityInsightCopy(params: {
        locale?: string;
        topSymbol: string;
        topSymbolWinRate: number;
        totalRecentTrades: number;
    }): Promise<PushCopyResult> {
        const isEn = params.locale === 'en';
        const fallback: PushCopyResult = isEn
            ? {
                  title: `Edge insight: ${params.topSymbol} at ${params.topSymbolWinRate}% win rate`,
                  body: `Across your last ${params.totalRecentTrades} trades, ${params.topSymbol} stands out. Open Reports to inspect MFE/MAE & expectancy.`,
                  usedAi: false,
              }
            : {
                  title: `Curiosidade do seu operacional: ${params.topSymbol}`,
                  body: `Nos últimos ${params.totalRecentTrades} trades, ${params.topSymbol} teve ${params.topSymbolWinRate}% de acerto. Veja os detalhes nos Relatórios.`,
                  usedAi: false,
              };

        const prompt = isEn
            ? `Write a sharp Web Push curiosity insight in JSON {"title":"...","body":"..."} using ONLY these real stats: ${params.totalRecentTrades} recent trades, best symbol ${params.topSymbol} with ${params.topSymbolWinRate}% win rate. Invite clicking to open Reports. Title <= 55 chars, body <= 135 chars.`
            : `Escreva uma notificação Web Push de curiosidade precisa em JSON {"title":"...","body":"..."} em Português usando APENAS estes dados reais: ${params.totalRecentTrades} trades recentes, destaque para ${params.topSymbol} com ${params.topSymbolWinRate}% de acerto. Convide para abrir Relatórios. Título <= 55 chars, corpo <= 135 chars.`;

        const ai = await this.callGeminiShortCopy(prompt);
        if (ai) {
            return { ...ai, usedAi: true };
        }
        return fallback;
    }

    buildBrokerConnectTransparencyCopy(locale?: string): PushCopyResult {
        if (locale === 'en') {
            return {
                title: 'Connect Torex to 20+ brokers with full clarity',
                body: 'Sync MT5, Deriv, and top prop brokers automatically and audit every trade with institutional transparency.',
                usedAi: false,
            };
        }
        return {
            title: 'Conecte a Torex com +20 corretoras em segundos',
            body: 'Veja todas as suas operações com total transparência, sincronize MT5/Deriv e acompanhe risco e execução num só lugar.',
            usedAi: false,
        };
    }

    buildStaleImportCopy(locale: string | undefined, daysSinceLastTrade: number): PushCopyResult {
        const days = Math.max(1, Math.round(daysSinceLastTrade));
        if (locale === 'en') {
            return {
                title: `It has been ${days} days since your last trade sync`,
                body: 'Keep your Torex edge sharp: import your latest trades in 1 click to update expectancy & journal analytics.',
                usedAi: false,
            };
        }
        return {
            title: `Faz ${days} dias desde a sua última importação`,
            body: 'Sincronize as suas operações recentes com +20 corretoras para manter as suas métricas e diário atualizados.',
            usedAi: false,
        };
    }
}
