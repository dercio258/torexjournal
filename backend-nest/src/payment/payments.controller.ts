import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';

@Controller('payments')
export class PaymentsController {
    constructor(private readonly subscriptionService: SubscriptionService) { }

    @UseGuards(JwtAuthGuard)
    @Get()
    async getUserPayments(@Request() req) {
        const userId = req.user.id || req.user.userId;
        const history = await this.subscriptionService.getUserSubscriptionHistory(userId);
        
        return history.map(sub => {
            const amount =
                sub.paymentMethod === 'TRIAL' || !sub.planConfig
                    ? 0
                    : this.subscriptionService.getAmountUsd(sub.planConfig, sub.cycle);
            const cycleLabel =
                sub.cycle === 'BIENNIAL'
                    ? 'Bianual'
                    : sub.cycle === 'YEARLY'
                      ? 'Anual'
                      : sub.cycle === 'QUARTERLY'
                        ? 'Trimestral'
                        : 'Mensal';

            // Map database subscription status to user-friendly Portuguese statuses
            let status = 'pendente';
            if (sub.status === 'ACTIVE') {
                status = 'aprovada';
            } else if (sub.status === 'CANCELLED' || sub.status === 'EXPIRED') {
                status = 'falha';
            }

            // Map method
            let method = 'Cartão';
            if (sub.paymentMethod === 'mpesa') {
                method = 'M-Pesa';
            } else if (sub.paymentMethod === 'emola') {
                method = 'e-Mola';
            } else if (sub.paymentMethod === 'crypto') {
                method = 'Criptomoeda';
            } else if (sub.paymentMethod === 'pix') {
                method = 'PIX';
            } else if (sub.paymentMethod === 'payfast') {
                method = 'PayFast';
            } else if (sub.paymentMethod === 'referral_credits') {
                method = 'Créditos de Afiliado';
            } else if (sub.paymentMethod === 'TRIAL') {
                method = 'Avaliação Gratuita';
            }

            return {
                id: sub.paymentReference || sub.id,
                dataHora: sub.createdAt,
                status: status,
                produto: `Assinatura Plano ${sub.planConfig?.tier || 'FREE'} (${cycleLabel})`,
                amount: Number(amount.toFixed(2)),
                method: method,
                expiresAt: sub.currentPeriodEnd,
                cycle: sub.cycle,
                planTier: sub.planConfig?.tier
            };
        });
    }
}
