import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
    AiChatJobEntity,
    AiChatMessageEntity,
    AiChatSessionEntity,
} from './ai-chat.entity';
import { AiCreditsService } from './ai-credits.service';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { AiLlmProviderService } from './ai-llm-provider.service';
import { AiPromptSystemService } from './ai-prompt-system.service';
import { AiRouterService } from './ai-router.service';
import { AiTradeAnalyzerService } from './ai-trade-analyzer.service';
import { TorexAiChatService } from './torex-ai-chat.service';

describe('Phase 8: Persistent Session UUID Routing & DB Recovery', () => {
    function buildChatHarness() {
        const sessions = new Map<string, AiChatSessionEntity>();
        const messages: AiChatMessageEntity[] = [];
        const jobs = new Map<string, AiChatJobEntity>();
        let seq = 1;

        const sessionRepo = {
            create: jest.fn((data: Partial<AiChatSessionEntity>) => ({
                id: data.id || randomUUID(),
                userId: data.userId || 'user-1',
                accountId: data.accountId ?? null,
                title: data.title || 'Nova Conversa',
                createdAt: new Date(),
                updatedAt: new Date(),
            })),
            save: jest.fn(async (s: AiChatSessionEntity) => {
                sessions.set(s.id, s);
                return s;
            }),
            findOne: jest.fn(async ({ where }: any) => {
                const match = sessions.get(where.id);
                if (!match) return null;
                if (where.userId && match.userId !== where.userId) return null;
                return match;
            }),
            find: jest.fn(async ({ where }: any) =>
                Array.from(sessions.values()).filter(
                    (s) => s.userId === where.userId
                )
            ),
            update: jest.fn(async (criteria: any, partial: any) => {
                const target = sessions.get(criteria.id);
                if (target) {
                    Object.assign(target, partial);
                }
            }),
            delete: jest.fn(async ({ id, userId }: any) => {
                const target = sessions.get(id);
                if (target && (!userId || target.userId === userId)) {
                    sessions.delete(id);
                }
            }),
        } as any;

        const messageRepo = {
            create: jest.fn((data: Partial<AiChatMessageEntity>) => ({
                id: randomUUID(),
                sessionId: data.sessionId || '',
                role: data.role || 'assistant',
                content: data.content || '',
                intent: data.intent ?? null,
                provider: data.provider || 'client',
                metadata: data.metadata || {},
                createdAt: new Date(Date.now() + seq++),
            })),
            save: jest.fn(async (m: AiChatMessageEntity) => {
                messages.push(m);
                return m;
            }),
            find: jest.fn(async ({ where }: any) =>
                messages.filter((m) => m.sessionId === where.sessionId)
            ),
            delete: jest.fn(async ({ sessionId }: any) => {
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i].sessionId === sessionId) {
                        messages.splice(i, 1);
                    }
                }
            }),
        } as any;

        const jobRepo = {
            create: jest.fn((data: Partial<AiChatJobEntity>) => ({
                id: randomUUID(),
                userId: data.userId || 'user-1',
                sessionId: data.sessionId || '',
                userMessageId: data.userMessageId || randomUUID(),
                assistantMessageId: data.assistantMessageId ?? null,
                status: data.status || 'PROCESSING',
                creditsUsed: data.creditsUsed ?? 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            })),
            save: jest.fn(async (j: AiChatJobEntity) => {
                jobs.set(j.id, j);
                return j;
            }),
            find: jest.fn(async ({ where }: any) =>
                Array.from(jobs.values()).filter((j) => {
                    if (where.userId && j.userId !== where.userId) return false;
                    if (where.status && j.status !== where.status) return false;
                    if (where.sessionId && j.sessionId !== where.sessionId) {
                        return false;
                    }
                    if (
                        where.createdAt?.value instanceof Date &&
                        j.createdAt >= where.createdAt.value
                    ) {
                        return false;
                    }
                    return true;
                })
            ),
            findOne: jest.fn(async ({ where }: any) => {
                if (where.id) {
                    const hit = jobs.get(where.id);
                    if (!hit) return null;
                    if (where.userId && hit.userId !== where.userId) return null;
                    return hit;
                }
                return (
                    Array.from(jobs.values()).find((j) => {
                        if (where.userId && j.userId !== where.userId) {
                            return false;
                        }
                        if (where.sessionId && j.sessionId !== where.sessionId) {
                            return false;
                        }
                        if (where.status && j.status !== where.status) {
                            return false;
                        }
                        return true;
                    }) || null
                );
            }),
            delete: jest.fn(async ({ sessionId, userId }: any) => {
                for (const [id, job] of Array.from(jobs.entries())) {
                    if (
                        job.sessionId === sessionId &&
                        (!userId || job.userId === userId)
                    ) {
                        jobs.delete(id);
                    }
                }
            }),
        } as any;

        const promptSystem = new AiPromptSystemService();
        const knowledgeBase = new AiKnowledgeBaseService();
        const llmProvider = {
            getDualEngineStatus: jest.fn(() => ({
                qwenEnabled: false,
                geminiEnabled: false,
                anyEnabled: false,
            })),
        } as unknown as AiLlmProviderService;
        const aiCreditsService = {
            getCreditStatus: jest.fn(async () => ({
                canInteract: true,
                planTier: 'ELITE',
                maxMessageChars: 1000,
                creditsRemaining: 500,
                dailyLimit: 500,
            })),
            calculateInteractionCost: jest.fn(() => ({ cost: 0 })),
            consumeCredits: jest.fn(async () => ({
                creditsUsed: 0,
                credits: {
                    canInteract: true,
                    planTier: 'ELITE',
                    maxMessageChars: 1000,
                    creditsRemaining: 500,
                    dailyLimit: 500,
                },
            })),
        } as unknown as AiCreditsService;
        const tradeAnalyzer = {
            buildSnapshot: jest.fn(async () => null),
        } as unknown as AiTradeAnalyzerService;
        const aiRouter = new AiRouterService(
            llmProvider,
            knowledgeBase,
            promptSystem
        );

        const chatService = new TorexAiChatService(
            { query: jest.fn(async () => []) } as any,
            sessionRepo,
            messageRepo,
            jobRepo,
            knowledgeBase,
            tradeAnalyzer,
            llmProvider,
            aiCreditsService,
            promptSystem,
            aiRouter
        );

        return {
            chatService,
            sessions,
            messages,
            jobs,
            sessionRepo,
            messageRepo,
            jobRepo,
        };
    }

    it('1. createSession persiste o UUID gerado pelo cliente e responde idempotentemente ao mesmo dono', async () => {
        const { chatService, sessions } = buildChatHarness();
        const clientUuid = randomUUID();

        const first = await chatService.createSession({
            userId: 'user-a',
            sessionId: clientUuid,
            accountId: 'acc-1',
            locale: 'pt',
        });

        expect(first.created).toBe(true);
        expect(first.session.id).toBe(clientUuid.toLowerCase());
        expect(first.session.title).toBe('Nova Conversa');
        expect(sessions.has(clientUuid.toLowerCase())).toBe(true);

        const second = await chatService.createSession({
            userId: 'user-a',
            sessionId: clientUuid,
            accountId: 'acc-1',
            locale: 'pt',
        });

        expect(second.created).toBe(false);
        expect(second.session.id).toBe(clientUuid.toLowerCase());
    });

    it('2. Protege contra colisão / IDOR cross-user: UUID de outro utilizador nunca é reutilizado nem sobrescrito', async () => {
        const { chatService, sessions } = buildChatHarness();
        const victimUuid = randomUUID();

        await chatService.createSession({
            userId: 'user-victim',
            sessionId: victimUuid,
            locale: 'pt',
        });

        const intruderCreate = await chatService.createSession({
            userId: 'user-attacker',
            sessionId: victimUuid,
            locale: 'pt',
        });

        expect(intruderCreate.created).toBe(true);
        expect(intruderCreate.session.id).not.toBe(victimUuid.toLowerCase());
        expect(intruderCreate.session.userId).toBe('user-attacker');
        expect(sessions.get(victimUuid.toLowerCase())?.userId).toBe(
            'user-victim'
        );

        const intruderSend = await chatService.sendMessage({
            userId: 'user-attacker',
            userName: 'Attacker',
            question: 'oi',
            sessionId: victimUuid,
            locale: 'pt',
        });

        expect(intruderSend.session.id).not.toBe(victimUuid.toLowerCase());
        expect(sessions.get(victimUuid.toLowerCase())?.title).toBe(
            'Nova Conversa'
        );
    });

    it('3. sendMessage e enqueueMessage gravam o UUID pré-gerado e atualizam o título padrão "Nova Conversa" no 1.º prompt', async () => {
        const { chatService, sessions } = buildChatHarness();
        const uuidSync = randomUUID();

        await chatService.createSession({
            userId: 'user-1',
            sessionId: uuidSync,
            locale: 'pt',
        });

        expect(sessions.get(uuidSync.toLowerCase())?.title).toBe(
            'Nova Conversa'
        );

        const resSync = await chatService.sendMessage({
            userId: 'user-1',
            userName: 'Dercio',
            question: 'Onde fica o Diário na plataforma?',
            sessionId: uuidSync,
            locale: 'pt',
        });

        expect(resSync.session.id).toBe(uuidSync.toLowerCase());
        expect(resSync.session.title).toContain('Onde fica o Diário');
        expect(sessions.get(uuidSync.toLowerCase())?.title).toContain(
            'Onde fica o Diário'
        );

        const uuidAsync = randomUUID();
        const resAsync = await chatService.enqueueMessage({
            userId: 'user-1',
            userName: 'Dercio',
            question: 'oi, tudo bem',
            sessionId: uuidAsync,
            locale: 'pt',
        });

        expect(resAsync.session.id).toBe(uuidAsync.toLowerCase());
        expect(sessions.has(uuidAsync.toLowerCase())).toBe(true);
        await new Promise((r) => setTimeout(r, 30));
    });

    it('4. getSessionMessages recupera mensagens + activeJob após F5 e lança NotFoundException para slug inválido sem ir ao PostgreSQL', async () => {
        const { chatService, sessionRepo, jobs } = buildChatHarness();
        const validUuid = randomUUID();

        await chatService.sendMessage({
            userId: 'user-reload',
            userName: 'Dercio',
            question: 'oi, bom dia',
            sessionId: validUuid,
            locale: 'pt',
        });

        const pendingJob = {
            id: randomUUID(),
            userId: 'user-reload',
            sessionId: validUuid.toLowerCase(),
            userMessageId: randomUUID(),
            assistantMessageId: null,
            status: 'PROCESSING' as const,
            creditsUsed: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        jobs.set(pendingJob.id, pendingJob);

        const reloaded = await chatService.getSessionMessages(
            'user-reload',
            validUuid
        );
        expect(reloaded.session.id).toBe(validUuid.toLowerCase());
        expect(reloaded.messages.length).toBeGreaterThanOrEqual(2);
        expect(reloaded.activeJob?.jobId).toBe(pendingJob.id);

        sessionRepo.findOne.mockClear();
        await expect(
            chatService.getSessionMessages('user-reload', 'invalid-slug-123')
        ).rejects.toThrow(NotFoundException);
        expect(sessionRepo.findOne).not.toHaveBeenCalled();
    });

    it('5. deleteSession rejeita slugs inválidos antes do PostgreSQL e apaga sessão + mensagens + jobs do dono', async () => {
        const { chatService, sessionRepo, sessions, messages, jobs } =
            buildChatHarness();

        await expect(
            chatService.deleteSession('user-1', 'nao-e-uuid')
        ).rejects.toThrow(NotFoundException);
        expect(sessionRepo.findOne).not.toHaveBeenCalled();

        const ownedUuid = randomUUID();
        await chatService.sendMessage({
            userId: 'user-1',
            userName: 'Dercio',
            question: 'oi, tudo bem',
            sessionId: ownedUuid,
            locale: 'pt',
        });
        expect(sessions.has(ownedUuid.toLowerCase())).toBe(true);
        expect(
            messages.filter((m) => m.sessionId === ownedUuid.toLowerCase())
                .length
        ).toBeGreaterThan(0);

        const deleted = await chatService.deleteSession('user-1', ownedUuid);
        expect(deleted).toEqual({ ok: true });
        expect(sessions.has(ownedUuid.toLowerCase())).toBe(false);
        expect(
            messages.filter((m) => m.sessionId === ownedUuid.toLowerCase())
                .length
        ).toBe(0);
        expect(jobs.size).toBe(0);
    });
});
