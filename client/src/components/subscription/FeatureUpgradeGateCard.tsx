import React from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Crown } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { openWorkspacePlansModal } from '../../lib/planGate';
import { UpgradeBadge } from './UpgradeBadge';

interface FeatureUpgradeGateCardProps {
    featureKey: string;
    title: string;
    titleEn?: string;
    description: string;
    descriptionEn?: string;
    requiredPlan?: 'PRO' | 'PREMIUM';
    bullets?: string[];
    bulletsEn?: string[];
    compact?: boolean;
    onBack?: () => void;
    backLabel?: string;
    backLabelEn?: string;
}

export const FeatureUpgradeGateCard: React.FC<FeatureUpgradeGateCardProps> = ({
    featureKey,
    title,
    titleEn,
    description,
    descriptionEn,
    requiredPlan = 'PRO',
    bullets,
    bulletsEn,
    compact = false,
    onBack,
    backLabel,
    backLabelEn,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';

    const resolvedTitle = isEn && titleEn ? titleEn : title;
    const resolvedDescription = isEn && descriptionEn ? descriptionEn : description;
    const resolvedBullets = isEn && bulletsEn ? bulletsEn : bullets;
    const planLabel = requiredPlan === 'PREMIUM' ? 'Premium' : 'Pro';

    return (
        <div
            className={
                compact
                    ? 'rounded-2xl border border-amber-500/30 bg-surface/95 p-5 shadow-lg'
                    : 'mx-auto my-8 max-w-2xl rounded-2xl border border-amber-500/30 bg-surface/95 p-6 sm:p-8 shadow-2xl'
            }
        >
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                    <Crown size={22} />
                </div>

                <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <UpgradeBadge
                            variant="inline"
                            asButton
                            tierLabel={planLabel.toUpperCase()}
                            label={
                                isEn
                                    ? `Upgrade · ${planLabel} Required`
                                    : `Upgrade · Plano ${planLabel}`
                            }
                            sourceFeature={featureKey}
                            extraDetail={{ requiredPlan }}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <h2 className="text-lg sm:text-xl font-bold text-fg leading-snug">
                            {resolvedTitle}
                        </h2>
                        <p className="text-xs sm:text-sm text-fg-muted leading-relaxed">
                            {resolvedDescription}
                        </p>
                    </div>

                    {resolvedBullets && resolvedBullets.length > 0 && (
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            {resolvedBullets.map((item, idx) => (
                                <li
                                    key={idx}
                                    className="flex items-start gap-2 rounded-xl border border-line-subtle bg-canvas-subtle px-3 py-2 text-xs text-fg"
                                >
                                    <CheckCircle2 size={14} className="text-accent-fg shrink-0 mt-0.5" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="flex flex-wrap items-center gap-2.5 pt-2">
                        <button
                            type="button"
                            onClick={() => openWorkspacePlansModal(featureKey, { requiredPlan })}
                            className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl bg-accent hover:bg-accent-hover text-accent-on text-xs sm:text-sm font-bold shadow-sm transition-all cursor-pointer active:scale-[0.98]"
                        >
                            <Crown size={15} />
                            <span>
                                {isEn ? `Upgrade to ${planLabel}` : `Atualizar para Plano ${planLabel}`}
                            </span>
                            <ArrowRight size={15} />
                        </button>

                        {onBack && (
                            <button
                                type="button"
                                onClick={onBack}
                                className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-surface-2 hover:bg-surface-3 border border-line text-fg-muted hover:text-fg text-xs font-semibold transition-colors cursor-pointer"
                            >
                                <ArrowLeft size={14} />
                                <span>{isEn ? (backLabelEn || 'Go back') : (backLabel || 'Voltar')}</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
