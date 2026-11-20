import { BadRequestException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { decodeProtobufStringField } from '../mt5-tcp.server';
import { ReportParserService } from '../import/report-parser.service';
import { DerivService } from '../deriv/deriv.service';
import { AiLlmProviderService } from './ai-llm-provider.service';
import { AiCreditsService } from './ai-credits.service';
import { AiSemanticMemoryService } from './ai-semantic-memory.service';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { AiPrivacySanitizerService } from './ai-privacy-sanitizer.service';
import {
    cavemanCompactPayload,
    cavemanCompressText,
    measureCavemanSavings,
} from './ai-caveman-compressor';
import { checkNumericGrounding } from './ai-numeric-grounding';
import { TorexAiChatService } from './torex-ai-chat.service';
import { PushProducerService } from '../notifications/push/push-producer.service';

function encodeVarint(value: number): Buffer {
    const bytes: number[] = [];
    let v = value >>> 0;
    while (v >= 0x80) {
        bytes.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    bytes.push(v);
    return Buffer.from(bytes);
}

function encodeProtobufString(fieldNum: number, text: string): Buffer {
    const strBuf = Buffer.from(text, 'utf-8');
    const tag = encodeVarint((fieldNum << 3) | 2);
    const len = encodeVarint(strBuf.length);
    return Buffer.concat([tag, len, strBuf]);
}

function encodeProtobufVarintField(fieldNum: number, numVal: number): Buffer {
    const tag = encodeVarint((fieldNum << 3) | 0);
    return Buffer.concat([tag, encodeVarint(numVal)]);
}

function makeFakeSingleEntryZip(fileName: string, rawXml: string): Buffer {
    const zlib = require('zlib') as typeof import('zlib');
    const compressed = zlib.deflateRawSync(Buffer.from(rawXml, 'utf-8'));
    const nameBuf = Buffer.from(fileName, 'utf-8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(Buffer.byteLength(rawXml, 'utf-8'), 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    return Buffer.concat([header, nameBuf, compressed]);
}

describe('Phase 3 — Brokers, Core AI, Caveman Compression, Away Web Push & Report Safety', () => {
    describe('1. Mt5TcpServer Protobuf Varint & Multi-Field Decoder', () => {
        it('decodifica payloads JSON > 300 bytes com Varint multi-byte e navega até fieldNum = 2 após fieldNum = 1', () => {
            const bigPayload = JSON.stringify({
                symbol: 'XAUUSD',
                bid: 2652.45,
                ask: 2652.75,
                positions: Array.from({ length: 12 }, (_, idx) => ({
                    ticket: 100000 + idx,
                    symbol: 'XAUUSD',
                    volume: 0.25,
                    profit: 45.5 + idx,
                })),
            });
            expect(Buffer.byteLength(bigPayload, 'utf-8')).toBeGreaterThan(300);

            const packet = Buffer.concat([
                encodeProtobufVarintField(9, 42),
                encodeProtobufString(1, 'XAUUSD'),
                encodeProtobufString(2, bigPayload),
            ]);

            expect(decodeProtobufStringField(packet, 1)).toBe('XAUUSD');
            const decoded2 = decodeProtobufStringField(packet, 2);
            expect(decoded2).toBe(bigPayload);
            expect(JSON.parse(decoded2!).positions).toHaveLength(12);
        });
    });

    describe('2. ReportParserService — Safe Broker Symbol Regex & Zip-Bomb Defense', () => {
        const parser = new ReportParserService();

        it('remove sufixos de corretora sem amputar tickers legítimos terminados em M/PRO', () => {
            expect(parser.normalizeBrokerSymbol('XAUUSDm')).toBe('XAUUSD');
            expect(parser.normalizeBrokerSymbol('EURUSDpro')).toBe('EURUSD');
            expect(parser.normalizeBrokerSymbol('GBPUSD.ecn')).toBe('GBPUSD');
            expect(parser.normalizeBrokerSymbol('NAS100_raw')).toBe('NAS100');

            // Não pode destruir tickers legítimos terminados em M / PRO:
            expect(parser.normalizeBrokerSymbol('IBM')).toBe('IBM');
            expect(parser.normalizeBrokerSymbol('XOM')).toBe('XOM');
            expect(parser.normalizeBrokerSymbol('3M')).toBe('3M');
            expect(parser.normalizeBrokerSymbol('US30M')).toBe('US30M');
            expect(parser.normalizeBrokerSymbol('PLATINUM')).toBe('PLATINUM');
            expect(parser.normalizeBrokerSymbol('ETHEREUM')).toBe('ETHEREUM');
            expect(parser.normalizeBrokerSymbol('GPRO')).toBe('GPRO');
        });

        it('bloqueia XLSX suspeito de Zip-Bomb (header ou entrada gigante)', () => {
            const bigPayload = 'A'.repeat(16 * 1024 * 1024); // 16 MB (> 15 MB limite por entrada)
            const zipBuf = makeFakeSingleEntryZip('xl/worksheets/sheet1.xml', bigPayload);
            expect(() => parser.parseExcel(zipBuf, '')).toThrow(BadRequestException);
        });
    });

    describe('3. DerivService — Multi-Account Isolation', () => {
        it('mantém conexões e contas distintas simultâneas para o mesmo userId sem sobrescrever', async () => {
            const mockDerivAuthRepo = {
                find: jest.fn(async () => [
                    {
                        id: 'auth-1',
                        userId: 'user-1',
                        accountId: 'VRTC1001',
                        currency: 'USD',
                        isActive: true,
                        accountEntityId: 'acc-demo-1',
                        metadata: { balance: 10000 },
                        updatedAt: new Date(),
                    },
                    {
                        id: 'auth-2',
                        userId: 'user-1',
                        accountId: 'CR2002',
                        currency: 'USD',
                        isActive: true,
                        accountEntityId: 'acc-real-2',
                        metadata: { balance: 2500 },
                        updatedAt: new Date(),
                    },
                ]),
                update: jest.fn(async () => undefined),
            } as any;
            const mockAccountRepo = {
                findOne: jest.fn(async ({ where }: any) => {
                    if (where.id === 'acc-demo-1') {
                        return { id: 'acc-demo-1', name: 'Deriv Demo', currency: 'USD', balance: 10000, equity: 10000 };
                    }
                    if (where.id === 'acc-real-2') {
                        return { id: 'acc-real-2', name: 'Deriv Real', currency: 'USD', balance: 2500, equity: 2500 };
                    }
                    return null;
                }),
                update: jest.fn(async () => undefined),
            } as any;

            const service = new DerivService(
                mockDerivAuthRepo,
                {} as any,
                {} as any,
                mockAccountRepo,
                { get: jest.fn(() => 'secret') } as any,
                { safeDate: (v: any) => new Date(v) } as any,
                {} as any,
            );

            // Simula dois sockets conectados simultaneamente usando buildConnKey internamente
            const fakeClientDemo = { getIsAuthorized: () => true, disconnect: jest.fn() };
            const fakeClientReal = { getIsAuthorized: () => false, disconnect: jest.fn() };
            (service as any).clients.set('user-1:VRTC1001', fakeClientDemo);
            (service as any).clients.set('user-1:CR2002', fakeClientReal);
            (service as any).accountIds.set('user-1:VRTC1001', 'acc-demo-1');
            (service as any).accountIds.set('user-1:CR2002', 'acc-real-2');

            const statusReal = await service.getStatus('user-1', 'acc-real-2');
            expect(statusReal.accountId).toBe('CR2002');
            expect(statusReal.accounts).toHaveLength(2);

            await service.disconnect('user-1', 'acc-demo-1');
            expect(fakeClientDemo.disconnect).toHaveBeenCalledTimes(1);
            expect(fakeClientReal.disconnect).not.toHaveBeenCalled();
            expect((service as any).clients.has('user-1:CR2002')).toBe(true);
        });
    });

    describe('4. Core AI — Gemini 2.5 Header Auth & Atomic Credit Reservation', () => {
        it('normaliza modelo legado inválido (gemini-3.8-flash -> gemini-2.5-flash) e envia x-goog-api-key sem ?key=', async () => {
            const env: Record<string, string> = {
                GEMINI_API_KEY: 'AIzaTestHeaderAuth00000000000000001',
                GEMINI_MODEL: 'gemini-3.8-flash',
            };
            const httpPost = jest.fn(() =>
                of({
                    data: {
                        candidates: [{ content: { parts: [{ text: 'Diagnóstico OK.' }] } }],
                    },
                } as any),
            );
            const provider = new AiLlmProviderService(
                { get: jest.fn((k: string) => env[k]) } as any,
                { post: httpPost } as any,
            );

            const res = await provider.generateGeminiAnalysis({
                systemPrompt: 'sys',
                userTaskPrompt: 'question',
                history: [],
            });

            expect(res?.modelUsed).toBe('gemini-2.5-flash');
            expect(httpPost).toHaveBeenCalledTimes(1);
            const [calledUrl, , axiosConfig] = httpPost.mock.calls[0] as any[];
            expect(calledUrl).not.toContain('key=');
            expect(calledUrl).toContain('gemini-2.5-flash:generateContent');
            expect(axiosConfig?.headers?.['x-goog-api-key']).toBe(env.GEMINI_API_KEY);
        });

        it('reserva créditos atomicamente e reembolsa quando custo final é menor ou zero', async () => {
            let creditsRemaining = 10;
            let creditsUsedToday = 90;
            let totalCreditsUsed = 200;

            const record = {
                userId: 'u-credit',
                planTier: 'BASIC',
                dailyLimit: 100,
                creditsRemaining: 10,
                creditsUsedToday: 90,
                totalCreditsUsed: 200,
                lastResetDate: new AiCreditsService(
                    {} as any,
                    {} as any,
                    {} as any,
                ).getCurrentDateKey(),
            };

            const dataSource = {
                query: jest.fn(async (sql: string, params: any[]) => {
                    if (/credits_remaining = credits_remaining - LEAST/i.test(sql)) {
                        const hold = params[1];
                        if (creditsRemaining <= 0) return [[]];
                        const taken = Math.min(creditsRemaining, hold);
                        creditsRemaining -= taken;
                        creditsUsedToday += taken;
                        totalCreditsUsed += taken;
                        record.creditsRemaining = creditsRemaining;
                        record.creditsUsedToday = creditsUsedToday;
                        record.totalCreditsUsed = totalCreditsUsed;
                        return [[{ ...record }]];
                    }
                    if (/credits_remaining = LEAST\(daily_limit, credits_remaining \+ \$2\)/i.test(sql)) {
                        const refund = params[1];
                        creditsRemaining = Math.min(100, creditsRemaining + refund);
                        creditsUsedToday = Math.max(0, creditsUsedToday - refund);
                        totalCreditsUsed = Math.max(0, totalCreditsUsed - refund);
                        record.creditsRemaining = creditsRemaining;
                        record.creditsUsedToday = creditsUsedToday;
                        record.totalCreditsUsed = totalCreditsUsed;
                        return [[{ ...record }]];
                    }
                    return [[]];
                }),
            } as any;

            const creditsRepo = {
                findOne: jest.fn(async () => ({ ...record })),
                save: jest.fn(async (e: any) => e),
                create: jest.fn((e: any) => e),
            } as any;

            const planPerm = {
                getUserAiDailyAllowance: jest.fn(async () => ({
                    tier: 'BASIC',
                    rawTier: 'BASIC',
                    dailyLimit: 100,
                })),
            } as any;

            const creditsService = new AiCreditsService(dataSource, creditsRepo, planPerm);

            const r1 = await creditsService.reserveCredits('u-credit', 5);
            expect(r1.reserved).toBe(true);
            expect(r1.reservedAmount).toBe(5);
            expect(r1.credits.creditsRemaining).toBe(5);

            // Reembolso integral por falha/cancelamento (finalCost = 0)
            const settled = await creditsService.settleReservedCredits('u-credit', 5, 0);
            expect(settled.creditsUsed).toBe(0);
            expect(settled.credits.creditsRemaining).toBe(10);
        });
    });

    describe('5. Semantic Memory — Account Scope Isolation', () => {
        it('impede vazamento de USER_PRIVATE entre Account A e Account B do mesmo utilizador', async () => {
            const memories: any[] = [];
            const mockDs = {
                query: jest.fn(async (sql: string, params: any[]) => {
                    if (/INSERT INTO ai_semantic_memory/i.test(sql)) {
                        const row = {
                            id: `mem-${memories.length + 1}`,
                            scope_level: 'USER_PRIVATE',
                            owner_scope: params[0],
                            user_id: params[0],
                            account_id: params[1],
                            locale: params[2],
                            domain_category: params[3],
                            sub_intent: params[4],
                            intent_key: params[5],
                            canonical_question: params[6],
                            normalized_question: params[7],
                            content_hash: params[8],
                            variant_phrases: [],
                            embedding_model: params[9],
                            dimensions: params[10],
                            embedding_f64: params[11],
                            cached_reply: params[12],
                            handoff_template: null,
                            actions: [],
                            suggestions: [],
                            status: params[15] || 'ACTIVE',
                            positive_count: 1,
                            negative_count: 0,
                            distinct_positive_users: 1,
                            positive_user_hashes: [],
                            hit_count: 0,
                            llm_tokens_saved: 0,
                            trust_score: 0.9,
                            platform_doc_version: null,
                            last_hit_at: null,
                            updated_at: new Date(),
                        };
                        memories.push(row);
                        return [row];
                    }
                    if (/SELECT \*[\s\S]*FROM ai_semantic_memory/i.test(sql) && /status\s*=\s*'ACTIVE'/i.test(sql)) {
                        return memories.filter((m) => {
                            const acc = m.account_id || '__ALL__';
                            const targetAcc = params[params.length - 1];
                            return m.owner_scope === 'user-1' && acc === targetAcc;
                        });
                    }
                    return [];
                }),
            } as any;

            const memSvc = new AiSemanticMemoryService(
                mockDs,
                new AiKnowledgeBaseService(),
                new AiPrivacySanitizerService(),
            );

            await memSvc.upsertUserPrivateMemory({
                userId: 'user-1',
                accountId: 'acc-A',
                locale: 'pt',
                domainCategory: 'PLATFORM_KNOWLEDGE',
                intentKey: 'private_note_acc_a',
                question: 'qual e minha configuracao favorita de sessao',
                reply: 'Sessao preferida configurada apenas na Conta A.',
            });

            const hitA = await memSvc.lookupMemory({
                userId: 'user-1',
                accountId: 'acc-A',
                trimmedQuestion: 'qual e minha configuracao favorita de sessao',
                normalizedLookup: 'qual e minha configuracao favorita de sessao',
                locale: 'pt',
            });
            expect(hitA.hitType).toBe('USER_PRIVATE_REPLY');
            expect(hitA.match?.accountId).toBe('acc-A');

            const hitB = await memSvc.lookupMemory({
                userId: 'user-1',
                accountId: 'acc-B',
                trimmedQuestion: 'qual e minha configuracao favorita de sessao',
                normalizedLookup: 'qual e minha configuracao favorita de sessao',
                locale: 'pt',
            });
            expect(hitB.hitType).toBe('NONE');
        });
    });

    describe('6. Caveman Token Compressor — High Savings & Numeric Grounding Safety', () => {
        it('reduz >35% dos tokens em payloads SQL/JSON preservando 100% dos números auditados', () => {
            const rawObj = {
                escopoConta: 'Conta Real MT5 #4001',
                moedaConta: 'USD',
                resumoQuantitativo: {
                    totalTradesFechados: 84,
                    taxaDeAcertoPct: '58.3%',
                    pnlLiquidoAcumulado: '1425.60 USD',
                    profitFactor: '1.94',
                },
                campoVazio: null,
                regraVazia: '',
                alerta: 'Nenhum dia com alerta físico/emocional registado no Diário',
                regrasSalvasNoPlaybook: ['Nenhuma regra escrita registada na aba General do Diário'],
            };

            const prettyJson = JSON.stringify(rawObj, null, 2);
            const compacted = cavemanCompactPayload(rawObj, 'full');
            const savings = measureCavemanSavings(prettyJson, compacted);

            expect(savings.savedPct).toBeGreaterThan(35);
            expect(compacted).toContain('0_PSYCH_ALERTS');
            expect(compacted).toContain('0_PLAYBOOK_RULES');

            const grounding = checkNumericGrounding(
                'A conta teve **58.3%** de acerto com lucro líquido de **1425.60 USD** e Profit Factor **1.94**.',
                [compacted],
            );
            expect(grounding.grounded).toBe(true);
            expect(grounding.ungrounded).toHaveLength(0);

            const compressedText = cavemanCompressText(
                'Com base na análise dos seus dados, gostaria de saber o impacto em `/journal` do Win Rate 58.3%',
                'full',
            );
            expect(compressedText).toContain('/journal');
            expect(compressedText).toContain('58.3%');
            expect(compressedText.length).toBeLessThan(85);
        });
    });

    describe('7. Torex AI Away Web Push Dispatch', () => {
        it('emite ai.reply.ready_away quando job conclui fora da tela e enfileira Web Push seguro para /torex-ai/:sessionId', async () => {
            const jobRow = {
                id: 'job-away-1',
                userId: 'user-away',
                sessionId: '11111111-1111-4111-8111-111111111111',
                userMessageId: '22222222-2222-4222-8222-222222222222',
                assistantMessageId: null as string | null,
                status: 'PROCESSING' as 'PROCESSING' | 'COMPLETED',
                creditsUsed: 0,
            };

            const jobRepo = {
                findOne: jest.fn(async () => ({ ...jobRow })),
                save: jest.fn(async (j: any) => Object.assign(jobRow, j)),
            } as any;
            const messageRepo = {
                delete: jest.fn(async () => undefined),
            } as any;
            const eventEmitter = { emit: jest.fn() } as any;

            const chatSvc = new TorexAiChatService(
                {} as any,
                {} as any,
                messageRepo,
                jobRepo,
                new AiKnowledgeBaseService(),
                {} as any,
                {} as any,
                {} as any,
                {} as any,
                {} as any,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                eventEmitter,
            );

            jest.spyOn(chatSvc as any, 'generateWithProfile').mockResolvedValue({
                assistantMessage: {
                    id: '33333333-3333-4333-8333-333333333333',
                    sessionId: jobRow.sessionId,
                    role: 'assistant',
                    content: 'Diagnóstico estruturado concluído.',
                    intent: 'edge_strengths',
                    provider: 'llm:gemini',
                    metadata: {},
                },
                creditsUsed: 12,
                credits: { creditsRemaining: 88 } as any,
            });

            await chatSvc.markJobPresence('user-away', 'job-away-1', true);
            await (chatSvc as any).runAsyncJob({
                jobId: 'job-away-1',
                userId: 'user-away',
                userName: 'Trader',
                session: { id: jobRow.sessionId } as any,
                userMsg: { id: jobRow.userMessageId } as any,
                trimmedQuestion: 'Qual meu edge?',
                inspection: {} as any,
                initialCreditStatus: {} as any,
                locale: 'pt',
            });

            expect(eventEmitter.emit).toHaveBeenCalledWith('ai.reply.ready_away', {
                userId: 'user-away',
                sessionId: jobRow.sessionId,
                jobId: 'job-away-1',
                locale: 'pt',
            });

            const pushQueue = { add: jest.fn(async () => undefined) } as any;
            const subRepo = { count: jest.fn(async () => 1) } as any;
            const redisStore = new Map<string, string>();
            const redisSecurity = {
                getValue: jest.fn(async (k: string) => redisStore.get(k) || null),
                setValue: jest.fn(async (k: string, v: string) => {
                    redisStore.set(k, v);
                }),
                incrementWithWindow: jest.fn(async (k: string) => {
                    const next = Number(redisStore.get(k) || '0') + 1;
                    redisStore.set(k, String(next));
                    return { count: next };
                }),
            } as any;

            const pushProducer = new PushProducerService(
                pushQueue,
                subRepo,
                {} as any,
                {} as any,
                redisSecurity,
                {} as any,
                {} as any,
            );

            const sent = await pushProducer.handleAiReplyReadyAway({
                userId: 'user-away',
                sessionId: jobRow.sessionId,
                jobId: 'job-away-1',
                locale: 'pt',
            });

            expect(sent).toBe(true);
            expect(pushQueue.add).toHaveBeenCalledWith(
                'send-web-push',
                expect.objectContaining({
                    userId: 'user-away',
                    tag: 'torex-ai-reply',
                    url: `/torex-ai/${jobRow.sessionId}?from=push_ai_reply`,
                }),
                expect.any(Object),
            );
        });
    });
});
