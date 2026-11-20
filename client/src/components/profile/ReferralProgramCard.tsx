import React, { useEffect, useState } from 'react';
import { Award, Check, Copy, Gift, Lock, Share2, Sparkles, TrendingUp, Users } from 'lucide-react';
import api from '../../api';
import { useLocale } from '../../context/LocaleContext';

interface ReferralItem {
    id: string;
    referredUsername: string;
    status: 'REGISTERED' | 'VERIFIED' | 'PAID';
    rewardCreditsUsd: number;
    tierBoostAwarded: boolean;
    verifiedAt: string | null;
    paidAt: string | null;
    createdAt: string | null;
}

interface ReferralSummaryResponse {
    referralCode: string;
    shareUrl: string;
    creditsUsd: number;
    pendingCreditsUsd?: number;
    hasPaidSubscription?: boolean;
    aiDailyBonusCredits?: number;
    aiBonusExpiresAt?: string | null;
    tierBoostUnlocked: boolean;
    rules: {
        invite1AiDailyBonus?: number;
        invite1DurationDays?: number;
        invite3PlanCreditUsd?: number;
        requiresPaidPlanForFull10Usd?: boolean;
        perVerifiedUsd: number;
        perPaidUsd: number;
        tierBoostVerifiedTarget: number;
        tierBoostPaidTarget: number;
    };
    counts: {
        total: number;
        verified: number;
        paid: number;
    };
    referrals: ReferralItem[];
}

export const ReferralProgramCard: React.FC = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [data, setData] = useState<ReferralSummaryResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [copiedType, setCopiedType] = useState<'link' | 'code' | null>(null);

    useEffect(() => {
        let mounted = true;
        api.get<ReferralSummaryResponse>('/referrals/me')
            .then((res) => {
                if (mounted) setData(res.data);
            })
            .catch(() => {
                if (mounted) setData(null);
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, []);

    const handleCopy = async (text: string, type: 'link' | 'code') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedType(type);
            window.setTimeout(() => setCopiedType(null), 2000);
        } catch {
            // clipboard unavailable
        }
    };

    const handleNativeShare = async () => {
        if (!data) return;
        const shareData = {
            title: 'Torex Journal',
            text: isEn
                ? 'Join me on Torex Journal — institutional trading analytics, offline journal & AI Coach:'
                : 'Opera comigo no Torex Journal — diário de trading offline, métricas avançadas e AI Coach:',
            url: data.shareUrl,
        };
        if (typeof navigator.share === 'function') {
            try {
                await navigator.share(shareData);
                return;
            } catch {
                // fallback to clipboard
            }
        }
        await handleCopy(data.shareUrl, 'link');
    };

    const target3 = data?.rules.tierBoostVerifiedTarget ?? 3;
    const aiBonusDaily = data?.rules.invite1AiDailyBonus ?? 50;
    const aiBonusDays = data?.rules.invite1DurationDays ?? 30;
    const milestoneUsd = data?.rules.invite3PlanCreditUsd ?? 10;
    const verifiedCount = data?.counts.verified ?? 0;
    const remainderTowardNext10 = verifiedCount > 0 && verifiedCount % target3 === 0 ? target3 : verifiedCount % target3;
    const milestoneProgressPct = Math.min(100, Math.round((remainderTowardNext10 / target3) * 100));
    const pendingCreditsUsd = Number(data?.pendingCreditsUsd || 0);
    const aiBonusActive = Number(data?.aiDailyBonusCredits || 0) > 0;

    return (
        <div
            id="affiliates"
            className="rounded-xl bg-surface border border-line p-4 sm:p-5 space-y-4"
        >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent-fg shrink-0">
                        <Gift size={18} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-fg flex items-center gap-2 flex-wrap">
                            <span>{isEn ? 'Torex Affiliate & AI Credits' : 'Programa de Afiliados & Créditos IA'}</span>
                            {aiBonusActive && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 border border-accent/30 px-2 py-0.5 text-[10px] font-bold text-accent-fg">
                                    <Sparkles size={11} />
                                    +{data?.aiDailyBonusCredits} AI/{isEn ? 'day' : 'dia'}
                                </span>
                            )}
                            {data?.tierBoostUnlocked && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                                    <Award size={11} />
                                    {isEn ? 'Plan Activation Bonus Ready' : 'Meta de Plano Atingida'}
                                </span>
                            )}
                        </h3>
                        <p className="text-xs text-fg-muted mt-0.5 leading-relaxed">
                            {isEn
                                ? `Invite 1 friend: unlock +${aiBonusDaily} extra daily AI credits for ${aiBonusDays} days. Invite ${target3} friends: earn $${milestoneUsd} USD to activate next plans (paid plan required to unlock full $${milestoneUsd} anti-fraud credit).`
                                : `Convide 1 trader: receba +${aiBonusDaily} créditos IA diários extras durante 1 mês (${aiBonusDays} dias). Convide ${target3} pessoas: receba $${milestoneUsd} USD para ativar os próximos planos (requer assinatura paga ativa para liberar os $${milestoneUsd} completos contra fraudes).`}
                        </p>
                    </div>
                </div>

                {data && (
                    <button
                        type="button"
                        onClick={handleNativeShare}
                        className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-accent hover:bg-accent-hover text-accent-on text-xs font-semibold transition-colors shrink-0 cursor-pointer"
                    >
                        <Share2 size={13} />
                        <span>{isEn ? 'Invite Traders' : 'Convidar Traders'}</span>
                    </button>
                )}
            </div>

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="h-16 rounded-lg skeleton-shimmer" />
                    <div className="h-16 rounded-lg skeleton-shimmer" />
                    <div className="h-16 rounded-lg skeleton-shimmer" />
                </div>
            ) : !data ? (
                <p className="text-xs text-fg-subtle">
                    {isEn ? 'Unable to load affiliate status right now.' : 'Não foi possível carregar os dados de afiliados.'}
                </p>
            ) : (
                <>
                    {pendingCreditsUsd > 0 && !data.hasPaidSubscription && (
                        <div className="flex items-start gap-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-300">
                            <Lock size={14} className="shrink-0 mt-0.5" />
                            <div>
                                <strong className="block font-semibold">
                                    {isEn
                                        ? `$${pendingCreditsUsd.toFixed(2)} USD in anti-fraud guarantee hold`
                                        : `$${pendingCreditsUsd.toFixed(2)} USD retidos em garantia anti-fraude`}
                                </strong>
                                <span className="text-[11px] opacity-90">
                                    {isEn
                                        ? 'Activate any paid subscription to immediately unlock this balance and redeem future plans.'
                                        : 'Ative qualquer assinatura paga para liberar imediatamente este saldo para os seus próximos planos.'}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Share Link + Code */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                        <div className="md:col-span-8 flex items-center gap-2 rounded-lg bg-canvas-subtle border border-line-subtle px-3 py-2">
                            <span className="text-[11px] font-mono text-fg-muted truncate flex-1">
                                {data.shareUrl}
                            </span>
                            <button
                                type="button"
                                onClick={() => handleCopy(data.shareUrl, 'link')}
                                className="inline-flex items-center gap-1 rounded-md bg-surface-2 hover:bg-surface-3 border border-line px-2.5 py-1 text-[11px] font-semibold text-fg shrink-0 cursor-pointer"
                            >
                                {copiedType === 'link' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                <span>{copiedType === 'link' ? (isEn ? 'Copied' : 'Copiado') : (isEn ? 'Copy Link' : 'Copiar Link')}</span>
                            </button>
                        </div>

                        <div className="md:col-span-4 flex items-center justify-between gap-2 rounded-lg bg-canvas-subtle border border-line-subtle px-3 py-2">
                            <div>
                                <span className="text-[9px] uppercase tracking-wider text-fg-subtle block">
                                    {isEn ? 'Your Code' : 'Seu Código'}
                                </span>
                                <span className="text-xs font-mono font-bold text-accent-fg">
                                    {data.referralCode}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleCopy(data.referralCode, 'code')}
                                className="p-1.5 rounded-md bg-surface-2 hover:bg-surface-3 border border-line text-fg-muted hover:text-fg cursor-pointer"
                                title={isEn ? 'Copy code' : 'Copiar código'}
                            >
                                {copiedType === 'code' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                            </button>
                        </div>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="rounded-lg bg-canvas-subtle border border-line-subtle p-3">
                            <div className="text-[10px] uppercase tracking-wider text-fg-subtle flex items-center gap-1">
                                <TrendingUp size={11} className="text-emerald-400" />
                                <span>{isEn ? 'Plan Credit' : 'Saldo Planos'}</span>
                            </div>
                            <div className="text-base font-bold font-mono tabular-nums text-emerald-400 mt-1">
                                ${data.creditsUsd.toFixed(2)}
                            </div>
                            {pendingCreditsUsd > 0 && (
                                <span className="text-[10px] text-amber-400 font-mono block">
                                    +${pendingCreditsUsd.toFixed(2)} {isEn ? 'locked' : 'retido'}
                                </span>
                            )}
                        </div>

                        <div className="rounded-lg bg-canvas-subtle border border-line-subtle p-3">
                            <div className="text-[10px] uppercase tracking-wider text-fg-subtle flex items-center gap-1">
                                <Sparkles size={11} className="text-accent-fg" />
                                <span>{isEn ? 'Daily AI Bonus' : 'Bónus IA / Dia'}</span>
                            </div>
                            <div className="text-base font-bold font-mono tabular-nums text-fg mt-1">
                                +{data.aiDailyBonusCredits || 0}{' '}
                                <span className="text-[11px] font-normal text-fg-subtle">cr/d</span>
                            </div>
                            {data.aiBonusExpiresAt && aiBonusActive && (
                                <span className="text-[10px] text-fg-subtle font-mono block">
                                    {isEn ? 'Until' : 'Até'} {new Date(data.aiBonusExpiresAt).toLocaleDateString(isEn ? 'en-US' : 'pt-PT')}
                                </span>
                            )}
                        </div>

                        <div className="rounded-lg bg-canvas-subtle border border-line-subtle p-3">
                            <div className="text-[10px] uppercase tracking-wider text-fg-subtle flex items-center gap-1">
                                <Users size={11} className="text-accent-fg" />
                                <span>{isEn ? 'Verified Invites' : 'Convidados'}</span>
                            </div>
                            <div className="text-base font-bold font-mono tabular-nums text-fg mt-1">
                                {verifiedCount} <span className="text-[11px] font-normal text-fg-subtle">/ {target3}</span>
                            </div>
                        </div>

                        <div className="rounded-lg bg-canvas-subtle border border-line-subtle p-3">
                            <div className="text-[10px] uppercase tracking-wider text-fg-subtle block">
                                {isEn ? `Next $${milestoneUsd} Goal` : `Meta $${milestoneUsd} USD`}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                                <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-accent transition-all duration-500"
                                        style={{ width: `${milestoneProgressPct}%` }}
                                    />
                                </div>
                                <span className="text-[11px] font-mono font-semibold text-fg">{milestoneProgressPct}%</span>
                            </div>
                        </div>
                    </div>

                    {/* Recent referrals table */}
                    {data.referrals.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border border-line-subtle">
                            <table className="w-full text-left text-xs text-fg-muted">
                                <thead className="bg-canvas-subtle text-[10px] uppercase text-fg-subtle border-b border-line-subtle">
                                    <tr>
                                        <th className="py-2 px-3">{isEn ? 'Trader' : 'Convidado'}</th>
                                        <th className="py-2 px-3">Status</th>
                                        <th className="py-2 px-3">{isEn ? 'Reward' : 'Benefício'}</th>
                                        <th className="py-2 px-3">{isEn ? 'Date' : 'Data'}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line-subtle">
                                    {data.referrals.slice(0, 8).map((item) => (
                                        <tr key={item.id}>
                                            <td className="py-2 px-3 font-medium text-fg">@{item.referredUsername}</td>
                                            <td className="py-2 px-3">
                                                <span
                                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                                        item.status === 'PAID'
                                                            ? 'bg-emerald-500/15 text-emerald-400'
                                                            : 'bg-accent/15 text-accent-fg'
                                                    }`}
                                                >
                                                    {item.status === 'PAID'
                                                        ? isEn
                                                            ? 'Paid Plan'
                                                            : 'Assinante Pago'
                                                        : isEn
                                                          ? 'Verified'
                                                          : 'Conta Verificada'}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 font-mono text-emerald-400">
                                                {item.rewardCreditsUsd > 0
                                                    ? `+$${item.rewardCreditsUsd.toFixed(2)}`
                                                    : `+${aiBonusDaily} IA/dia`}
                                            </td>
                                            <td className="py-2 px-3 text-[11px] text-fg-subtle">
                                                {item.createdAt
                                                    ? new Date(item.createdAt).toLocaleDateString(isEn ? 'en-US' : 'pt-PT')
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
