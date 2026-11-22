import React from 'react';
import { ArrowRight, Crown, Sparkles, WifiOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { isBasicPlanTier, openWorkspacePlansModal } from '../../lib/planGate';

interface BasicPlanSimpleUpgradeCardProps {
    compact?: boolean;
    locale?: 'pt' | 'en';
    className?: string;
}

export const BasicPlanSimpleUpgradeCard: React.FC<BasicPlanSimpleUpgradeCardProps> = ({
    compact = false,
    locale: explicitLocale,
    className = '',
}) => {
    const { user } = useAuth();
    const { locale: ctxLocale } = useLocale();
    const isEn = (explicitLocale || ctxLocale) === 'en';

    if (!isBasicPlanTier(user?.tier)) {
        return null;
    }

    if (compact) {
        return (
            <div
                className={`rounded-xl border border-amber-500/35 bg-amber-500/10 p-2.5 space-y-2 ${className}`}
            >
                <div className="flex items-center justify-between gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                        <Crown size={11} />
                        {isEn ? 'Upgrade to Pro' : 'Plano Básico'}
                    </span>
                </div>
                <p className="text-[11px] font-medium text-fg leading-snug">
                    {isEn
                        ? 'Unlock AI Analysis & Offline Mode.'
                        : 'Use Análise com IA e Modo Offline.'}
                </p>
                <button
                    type="button"
                    onClick={() => openWorkspacePlansModal('basic_ai_offline_compact')}
                    className="w-full inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-on text-[11px] font-bold transition-colors cursor-pointer"
                >
                    <Sparkles size={11} />
                    <span>{isEn ? 'Upgrade Plan' : 'Atualizar Plano'}</span>
                </button>
            </div>
        );
    }

    return (
        <div
            className={`rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-surface to-surface px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${className}`}
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                    <Sparkles size={15} />
                </div>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-fg">
                            {isEn ? 'Use AI Analysis & Offline Mode' : 'Use Análise com IA e Modo Offline'}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                            PRO / PREMIUM
                        </span>
                    </div>
                    <p className="text-[11px] text-fg-muted flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="inline-flex items-center gap-1">
                            <Sparkles size={10} className="text-accent-fg" />
                            {isEn ? '1,500+ monthly AI credits' : '1.500+ créditos de IA/mês'}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1">
                            <WifiOff size={10} className="text-amber-400" />
                            {isEn ? 'Work & sync offline anywhere' : 'Opere e registe trades em Modo Offline'}
                        </span>
                    </p>
                </div>
            </div>

            <button
                type="button"
                onClick={() => openWorkspacePlansModal('basic_ai_offline_card')}
                className="inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-on text-xs font-bold shrink-0 cursor-pointer transition-all"
            >
                <Crown size={13} />
                <span>{isEn ? 'Upgrade Now' : 'Fazer Upgrade'}</span>
                <ArrowRight size={13} />
            </button>
        </div>
    );
};
