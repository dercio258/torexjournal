import React from 'react';
import { AlertTriangle, ArrowRight, Clock, Crown, Info } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { trackButtonClick } from '../../lib/tracking';
import { openWorkspacePlansModal } from '../../lib/planGate';

interface PlanRenewalBannerCardProps {
    daysLeft?: number | null;
    tier?: string | null;
    isTrial?: boolean;
    expiryDate?: string | Date | null;
    onRenewClick?: () => void;
    locale?: 'pt' | 'en';
}

export const PlanRenewalBannerCard: React.FC<PlanRenewalBannerCardProps> = ({
    daysLeft,
    tier,
    isTrial = false,
    expiryDate,
    onRenewClick,
    locale: explicitLocale,
}) => {
    const { locale: ctxLocale } = useLocale();
    const isEn = (explicitLocale || ctxLocale) === 'en';

    if (typeof daysLeft !== 'number' || daysLeft < 0 || daysLeft > 5) {
        return null;
    }

    const isCritical = daysLeft <= 2;
    const tierClean = String(tier || 'BASIC').toUpperCase();
    const formattedDate = expiryDate
        ? new Date(expiryDate).toLocaleDateString(isEn ? 'en-US' : 'pt-PT', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
          })
        : null;

    const countdownText =
        daysLeft === 0
            ? isEn
                ? 'Expires today'
                : 'Expira hoje'
            : daysLeft === 1
              ? isEn
                  ? '1 day remaining'
                  : 'Falta 1 dia para expirar'
              : isEn
                ? `${daysLeft} days remaining`
                : `Faltam ${daysLeft} dias para expirar`;

    const handleRenew = () => {
        trackButtonClick({
            ctaTag: 'dashboard_renewal_banner_cta',
            intent: 'renewal',
            label: countdownText,
            metadata: { daysLeft, tier: tierClean, isTrial },
        });
        if (onRenewClick) {
            onRenewClick();
        } else {
            openWorkspacePlansModal('renewal_banner', { tier: tierClean, daysLeft });
        }
    };

    return (
        <div
            className={`rounded-2xl border px-4 py-3 sm:px-5 sm:py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
                isCritical
                    ? 'border-danger/45 bg-gradient-to-r from-danger/15 via-surface to-surface shadow-sm'
                    : 'border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-surface to-surface shadow-sm'
            }`}
        >
            <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                        isCritical
                            ? 'bg-danger/15 border-danger/30 text-danger-fg'
                            : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                    }`}
                >
                    {isCritical ? <AlertTriangle size={18} /> : <Clock size={18} />}
                </div>

                <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <span
                            className={`text-xs sm:text-sm font-bold ${
                                isCritical ? 'text-danger-fg' : 'text-amber-300'
                            }`}
                        >
                            {countdownText}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-line px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fg">
                            <Crown size={10} className="text-accent-fg" />
                            {isTrial ? `${tierClean} TRIAL` : tierClean}
                        </span>
                        {formattedDate && (
                            <span className="text-[11px] font-mono text-fg-muted">
                                ({isEn ? 'Until' : 'Até'} {formattedDate})
                            </span>
                        )}
                    </div>

                    <p
                        className="text-xs text-fg-muted flex items-center gap-1.5"
                        title={
                            isEn
                                ? 'Renew before expiration to keep uninterrupted access to your journal, accounts, and AI analytics.'
                                : 'Renove antes do vencimento para evitar o bloqueio do painel e preservar sua sincronização contínua.'
                        }
                    >
                        <Info size={12} className="shrink-0 text-fg-subtle hidden sm:inline" />
                        <span>
                            {isEn
                                ? isTrial
                                    ? 'Your free trial is ending soon. Select a plan now to keep uninterrupted access.'
                                    : 'Your plan renews soon. Renew early to avoid workspace interruption.'
                                : isTrial
                                  ? 'O seu período gratuito está perto do fim. Escolha um plano agora para continuar sem interrupções.'
                                  : 'A sua assinatura está perto do vencimento. Renove antecipadamente para evitar pausas no painel.'}
                        </span>
                    </p>
                </div>
            </div>

            <button
                type="button"
                onClick={handleRenew}
                className={`inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-xl text-xs font-bold shrink-0 cursor-pointer transition-all active:scale-[0.98] ${
                    isCritical
                        ? 'bg-danger hover:opacity-95 text-white shadow-sm'
                        : 'bg-accent hover:bg-accent-hover text-accent-on shadow-sm'
                }`}
            >
                <span>{isEn ? 'Renew Plan' : 'Renovar Plano'}</span>
                <ArrowRight size={14} />
            </button>
        </div>
    );
};
