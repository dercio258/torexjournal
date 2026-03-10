import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { TradeEntity } from './trade.entity';
import { AlertsService } from '../alerts/alerts.service';
import { AlertType, AlertSeverity } from '../alerts/alert.entity';

@Processor('behavioral-analysis')
export class BehavioralProcessor {
    private readonly logger = new Logger(BehavioralProcessor.name);

    constructor(
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        private alertsService: AlertsService
    ) { }

    @Process('analyze-user-behavior')
    async handleBehaviorAnalysis(job: Job<{ userId: string; accountId: string }>) {
        const { userId, accountId } = job.data;
        this.logger.log(`Starting deep behavioral analysis for user ${userId}`);

        try {
            // 1. Tilt Detection (Volume Spike after losses)
            await this.checkTilt(userId, accountId);

            // 2. Overconfidence Detection (Risk increase after win streak)
            await this.checkOverconfidence(userId, accountId);

            // 3. Consistency Score (Optional - can be used for trader scoring)

        } catch (error) {
            this.logger.error(`Behavioral analysis failed for user ${userId}: ${error.message}`);
        }
    }

    private async checkTilt(userId: string, accountId: string) {
        // Get last 20 trades
        const trades = await this.tradeRepo.find({
            where: { accountId },
            order: { closeTime: 'DESC' },
            take: 20
        });

        if (trades.length < 5) return;

        // Check if last trade volume is > 2x the average volume of previous trades
        const lastTrade = trades[0];
        const previousTrades = trades.slice(1, 11); // look at previous 10
        const avgVolume = previousTrades.reduce((sum, t) => sum + Number(t.volume), 0) / previousTrades.length;

        // Condition: Recent losses + sudden volume spike
        const recentLosses = previousTrades.filter(t => Number(t.profit) < 0).length;

        if (recentLosses >= 3 && Number(lastTrade.volume) > avgVolume * 1.8) {
            await this.alertsService.create(userId, {
                type: AlertType.PSYCHOLOGY,
                severity: AlertSeverity.CRITICAL,
                title: 'Alerta de Tilt Detectado! 🔥',
                description: `Detectamos um aumento súbito no tamanho da posição (${lastTrade.volume} lotes) após uma sequência de perdas. Isso é um sinal clássico de "Tilt". Recomendamos parar imediatamente.`,
                metadata: { lastVolume: lastTrade.volume, avgVolume: avgVolume.toFixed(2), window: 10 }
            });
        }
    }

    private async checkOverconfidence(userId: string, accountId: string) {
        // Look for risk increase after a win streak
        const trades = await this.tradeRepo.find({
            where: { accountId },
            order: { closeTime: 'DESC' },
            take: 15
        });

        if (trades.length < 10) return;

        const streak = [];
        for (const t of trades.slice(1)) {
            if (Number(t.profit) > 0) streak.push(t);
            else break;
        }

        if (streak.length >= 4) { // 4+ wins in a row
            const lastTrade = trades[0];
            const avgStreakVolume = streak.reduce((sum, t) => sum + Number(t.volume), 0) / streak.length;

            if (Number(lastTrade.volume) > avgStreakVolume * 1.5) {
                await this.alertsService.create(userId, {
                    type: AlertType.PSYCHOLOGY,
                    severity: AlertSeverity.WARNING,
                    title: 'Alerta de Excesso de Confiança 🚀',
                    description: `Após sua sequência de ${streak.length} vitórias, você aumentou significativamente o risco. Cuidado para não abandonar seu plano trading devido à euforia.`,
                    metadata: { streakCount: streak.length, lastVolume: lastTrade.volume, avgStreakVolume: avgStreakVolume.toFixed(2) }
                });
            }
        }
    }
}
