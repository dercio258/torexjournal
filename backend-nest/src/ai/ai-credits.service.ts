import {
    ForbiddenException,
    Injectable,
    Logger,
    OnModuleInit,
    Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
    AiCreditStatusDto,
    AiUserCreditEntity,
} from './ai-credits.entity';
import { PlanPermissionService } from '../payment/plan-permission.service';
import { RedisSecurityService } from '../common/security/redis-security.service';

@Injectable()
export class AiCreditsService implements OnModuleInit {
    private readonly logger = new Logger(AiCreditsService.name);

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(AiUserCreditEntity)
        private readonly creditsRepo: Repository<AiUserCreditEntity>,
        private readonly planPermissionService: PlanPermissionService,
        @Optional() private readonly redisSecurity?: RedisSecurityService,
    ) {}

    async onModuleInit() {
        try {
            await this.dataSource.query(`
                CREATE TABLE IF NOT EXISTS ai_user_credits (
                    user_id VARCHAR PRIMARY KEY,
                    plan_tier VARCHAR(30) NOT NULL DEFAULT 'FREE',
                    daily_limit INT NOT NULL DEFAULT 0,
                    credits_remaining INT NOT NULL DEFAULT 0,
                    credits_used_today INT NOT NULL DEFAULT 0,
                    total_credits_used INT NOT NULL DEFAULT 0,
                    last_reset_date VARCHAR(10) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_ai_user_credits_reset_date
                    ON ai_user_credits (last_reset_date);
            `);
        } catch (err) {
            this.logger.warn(
                `AiCreditsService DDL init warning: ${(err as Error).message}`
            );
        }
    }

    /**
     * Limite máximo de caracteres por mensagem enviada de acordo com o plano ativo:
     * - BASIC (ou FREE): 50 caracteres
     * - PRO: 250 caracteres
     * - PREMIUM: 1000 caracteres
     */
    resolveMaxMessageChars(planTier?: string): number {
        const normalized = String(planTier || '')
            .trim()
            .toUpperCase();
        if (
            normalized === 'PREMIUM' ||
            normalized === 'ENTERPRISE' ||
            normalized === 'ULTIMATE'
        ) {
            return 1000;
        }
        if (normalized === 'PRO') {
            return 250;
        }
        return 50;
    }

    /**
     * Retorna a chave de data local do servidor (YYYY-MM-DD) alinhada ao cron de meia-noite.
     */
    getCurrentDateKey(now = new Date()): string {
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private isMonthlyCycleExpired(lastResetDate?: string | null, now = new Date()): boolean {
        if (!lastResetDate || !/^\d{4}-\d{2}-\d{2}$/.test(lastResetDate)) {
            return true;
        }
        const [y, m, d] = lastResetDate.split('-').map(Number);
        const startMs = Date.UTC(y, m - 1, d);
        const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const diffDays = Math.floor((todayMs - startMs) / 86_400_000);
        return diffDays >= 30;
    }

    getNextResetIso(now = new Date(), lastResetDate?: string | null): string {
        if (lastResetDate && /^\d{4}-\d{2}-\d{2}$/.test(lastResetDate)) {
            const [y, m, d] = lastResetDate.split('-').map(Number);
            const nextMonthly = new Date(Date.UTC(y, m - 1, d + 30));
            return nextMonthly.toISOString();
        }
        const nextMonthly = new Date(
            Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 30)
        );
        return nextMonthly.toISOString();
    }

    /**
     * Regra de negócio mensal: ao completar 1 mês (30 dias) do ciclo,
     * todos os créditos restantes do mês anterior são removidos e o saldo é reiniciado
     * para a cota mensal do plano ativo (sem acumular créditos não usados).
     */
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleDailyCreditsReset() {
        const exec = async () => {
            const todayKey = this.getCurrentDateKey();
            try {
                await this.dataSource.query(
                    `
                    UPDATE ai_user_credits
                    SET
                        credits_used_today = 0,
                        credits_remaining = daily_limit,
                        last_reset_date = $1,
                        updated_at = now()
                    WHERE (CURRENT_DATE - TO_DATE(last_reset_date, 'YYYY-MM-DD')) >= 30
                    `,
                    [todayKey]
                );
                this.logger.log(
                    `[AiCreditsService] Ciclo mensal (30 dias) processado em ${todayKey}: créditos expirados removidos e cotas mensais renovadas.`
                );
            } catch (err) {
                this.logger.error(
                    `[AiCreditsService] Falha no reset mensal de créditos: ${(err as Error).message}`
                );
            }
        };

        if (this.redisSecurity) {
            await this.redisSecurity.withLock('cron:ai_monthly_credits_reset', 10 * 60_000, exec);
            return;
        }
        await exec();
    }

    private toDto(entity: AiUserCreditEntity, now = new Date()): AiCreditStatusDto {
        return {
            planTier: entity.planTier,
            dailyLimit: Number(entity.dailyLimit || 0),
            creditsRemaining: Math.max(0, Number(entity.creditsRemaining || 0)),
            creditsUsedToday: Math.max(0, Number(entity.creditsUsedToday || 0)),
            totalCreditsUsed: Math.max(0, Number(entity.totalCreditsUsed || 0)),
            lastResetDate: entity.lastResetDate,
            nextResetAt: this.getNextResetIso(now, entity.lastResetDate),
            canInteract: Number(entity.creditsRemaining || 0) > 0,
            maxMessageChars: this.resolveMaxMessageChars(entity.planTier),
        };
    }

    /**
     * Sincroniza o saldo mensal de créditos do usuário com seu plano ativo e aplica
     * expiração/renovação automática ao completar 30 dias (regra interna do backend).
     * - Plano BASIC: 0 créditos/mês (50 chars/msg)
     * - Plano PRO: 1.500 créditos/mês (250 chars/msg)
     * - Plano PREMIUM: 4.000 créditos/mês (1000 chars/msg)
     */
    async getCreditStatus(userId: string): Promise<AiCreditStatusDto> {
        const now = new Date();
        const todayKey = this.getCurrentDateKey(now);
        const allowance = await this.planPermissionService.getUserAiDailyAllowance(userId);
        const targetTier = allowance.rawTier || allowance.tier;
        const targetLimit = allowance.dailyLimit;

        let record = await this.creditsRepo.findOne({ where: { userId } });

        if (!record) {
            record = this.creditsRepo.create({
                userId,
                planTier: targetTier,
                dailyLimit: targetLimit,
                creditsRemaining: targetLimit,
                creditsUsedToday: 0,
                totalCreditsUsed: 0,
                lastResetDate: todayKey,
            });
            record = await this.creditsRepo.save(record);
            return this.toDto(record, now);
        }

        let needsSave = false;

        // 1. Fim do ciclo mensal (30 dias): remove créditos restantes do mês anterior e aplica a nova cota mensal
        if (this.isMonthlyCycleExpired(record.lastResetDate, now)) {
            record.planTier = targetTier;
            record.dailyLimit = targetLimit;
            record.creditsUsedToday = 0;
            record.creditsRemaining = targetLimit;
            record.lastResetDate = todayKey;
            needsSave = true;
        } else if (
            record.planTier !== targetTier ||
            Number(record.dailyLimit) !== targetLimit
        ) {
            // 2. Mudança/ativação/upgrade de plano no mesmo mês: ajusta o limite mantendo o consumo do ciclo atual
            record.planTier = targetTier;
            record.dailyLimit = targetLimit;
            record.creditsRemaining = Math.max(
                0,
                targetLimit - Number(record.creditsUsedToday || 0)
            );
            needsSave = true;
        }

        if (needsSave) {
            record = await this.creditsRepo.save(record);
        }

        return this.toDto(record, now);
    }

    /**
     * Garante que o usuário possui plano ativo e créditos disponíveis antes de processar a interação com a IA.
     */
    async assertCanInteract(userId: string): Promise<AiCreditStatusDto> {
        const status = await this.getCreditStatus(userId);

        if (status.dailyLimit <= 0 || status.creditsRemaining <= 0) {
            throw new ForbiddenException({
                statusCode: 403,
                code:
                    status.dailyLimit <= 0
                        ? 'NO_ACTIVE_PLAN_FOR_AI'
                        : 'INSUFFICIENT_AI_CREDITS',
                message:
                    'Você não possui créditos AI disponíveis. Convide amigos ou faça upgrade do seu plano para continuar.',
                credits: status,
            });
        }

        return status;
    }

    /**
     * Calcula o custo proporcional de créditos com base nos tokens da pergunta e da resposta da IA (~10 a 50 créditos).
     */
    calculateInteractionCost(params: {
        question: string;
        reply: string;
        completionTokens?: number;
        isQuickGuide?: boolean;
    }): { cost: number; estimatedTokens: number } {
        const questionChars = String(params.question || '').trim().length;
        const replyChars = String(params.reply || '').trim().length;

        const userTokens = Math.max(1, Math.ceil(questionChars / 4));
        const replyTokens =
            params.completionTokens && params.completionTokens > 0
                ? params.completionTokens
                : Math.max(1, Math.ceil(replyChars / 4));

        const estimatedTokens = userTokens + replyTokens;

        if (params.isQuickGuide) {
            const guideCost = Math.min(15, Math.max(6, 4 + Math.ceil(estimatedTokens / 25)));
            return { cost: guideCost, estimatedTokens };
        }

        const rawCost = 5 + Math.ceil(estimatedTokens / 15);
        const cost = Math.min(80, Math.max(8, rawCost));
        return { cost, estimatedTokens };
    }

    /**
     * Consome os créditos atomicamente no banco de dados e retorna o novo estado atualizado.
     */
    async consumeCredits(
        userId: string,
        requestedAmount: number
    ): Promise<{ creditsUsed: number; credits: AiCreditStatusDto }> {
        const current = await this.getCreditStatus(userId);
        const cleanRequest = Math.max(1, Math.round(requestedAmount || 1));

        if (current.creditsRemaining <= 0) {
            return { creditsUsed: 0, credits: current };
        }

        const rows = await this.dataSource.query(
            `
            UPDATE ai_user_credits
            SET
                credits_used_today = credits_used_today + LEAST(credits_remaining, $2),
                total_credits_used = total_credits_used + LEAST(credits_remaining, $2),
                credits_remaining = GREATEST(0, credits_remaining - $2),
                updated_at = now()
            WHERE user_id = $1
            RETURNING
                user_id AS "userId",
                plan_tier AS "planTier",
                daily_limit AS "dailyLimit",
                credits_remaining AS "creditsRemaining",
                credits_used_today AS "creditsUsedToday",
                total_credits_used AS "totalCreditsUsed",
                last_reset_date AS "lastResetDate"
            `,
            [userId, cleanRequest]
        );

        const updatedRow = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
        if (!updatedRow) {
            const refreshed = await this.getCreditStatus(userId);
            return { creditsUsed: 0, credits: refreshed };
        }

        const updatedStatus = this.toDto(updatedRow as AiUserCreditEntity);
        const actualDeducted = Math.max(
            0,
            current.creditsRemaining - updatedStatus.creditsRemaining
        );

        return {
            creditsUsed: actualDeducted,
            credits: updatedStatus,
        };
    }

    /**
     * Reserva créditos atomicamente no início da geração (evita corrida paralela quando há saldo baixo).
     */
    async reserveCredits(
        userId: string,
        holdAmount = 1
    ): Promise<{ reserved: boolean; reservedAmount: number; credits: AiCreditStatusDto }> {
        const current = await this.getCreditStatus(userId);
        if (!current.canInteract || current.creditsRemaining <= 0) {
            return { reserved: false, reservedAmount: 0, credits: current };
        }

        const safeHold = Math.max(1, Math.round(holdAmount || 1));
        const rows = await this.dataSource.query(
            `
            UPDATE ai_user_credits
            SET
                credits_used_today = credits_used_today + LEAST(credits_remaining, $2),
                total_credits_used = total_credits_used + LEAST(credits_remaining, $2),
                credits_remaining = credits_remaining - LEAST(credits_remaining, $2),
                updated_at = now()
            WHERE user_id = $1
              AND credits_remaining > 0
            RETURNING
                user_id AS "userId",
                plan_tier AS "planTier",
                daily_limit AS "dailyLimit",
                credits_remaining AS "creditsRemaining",
                credits_used_today AS "creditsUsedToday",
                total_credits_used AS "totalCreditsUsed",
                last_reset_date AS "lastResetDate"
            `,
            [userId, safeHold]
        );

        const updatedRow = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
        if (!updatedRow) {
            const refreshed = await this.getCreditStatus(userId);
            return { reserved: false, reservedAmount: 0, credits: refreshed };
        }

        const updatedStatus = this.toDto(updatedRow as AiUserCreditEntity);
        const reservedAmount = Math.max(
            0,
            current.creditsRemaining - updatedStatus.creditsRemaining
        );

        return {
            reserved: reservedAmount > 0,
            reservedAmount,
            credits: updatedStatus,
        };
    }

    /**
     * Liquida uma reserva atómica anterior: reembolsa em falha/custo menor ou debita a diferença real.
     */
    async settleReservedCredits(
        userId: string,
        reservedAmount: number,
        finalCost: number
    ): Promise<{ creditsUsed: number; credits: AiCreditStatusDto }> {
        const safeReserved = Math.max(0, Math.round(reservedAmount || 0));
        const safeFinal = Math.max(0, Math.round(finalCost || 0));

        if (safeFinal === safeReserved) {
            return {
                creditsUsed: safeFinal,
                credits: await this.getCreditStatus(userId),
            };
        }

        if (safeFinal < safeReserved) {
            const refund = safeReserved - safeFinal;
            const rows = await this.dataSource.query(
                `
                UPDATE ai_user_credits
                SET
                    credits_remaining = LEAST(daily_limit, credits_remaining + $2),
                    credits_used_today = GREATEST(0, credits_used_today - $2),
                    total_credits_used = GREATEST(0, total_credits_used - $2),
                    updated_at = now()
                WHERE user_id = $1
                RETURNING
                    user_id AS "userId",
                    plan_tier AS "planTier",
                    daily_limit AS "dailyLimit",
                    credits_remaining AS "creditsRemaining",
                    credits_used_today AS "creditsUsedToday",
                    total_credits_used AS "totalCreditsUsed",
                    last_reset_date AS "lastResetDate"
                `,
                [userId, refund]
            );
            const updatedRow = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
            const credits = updatedRow
                ? this.toDto(updatedRow as AiUserCreditEntity)
                : await this.getCreditStatus(userId);
            return { creditsUsed: safeFinal, credits };
        }

        const extraNeeded = safeFinal - safeReserved;
        const deltaResult = await this.consumeCredits(userId, extraNeeded);
        return {
            creditsUsed: safeReserved + deltaResult.creditsUsed,
            credits: deltaResult.credits,
        };
    }
}
