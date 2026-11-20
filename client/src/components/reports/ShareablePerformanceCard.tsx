import React, { useEffect, useState } from 'react';
import { Award, Check, Copy, Share2, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';

export interface ShareablePerformanceStats {
    periodLabel: string;
    totalTrades: number;
    winRate: number | string;
    profitFactor: number | string;
    netProfit: number;
    currency?: string;
    symbolFocus?: string;
}

interface ShareablePerformanceCardProps {
    isOpen: boolean;
    onClose: () => void;
    stats: ShareablePerformanceStats;
}

export const ShareablePerformanceCard: React.FC<ShareablePerformanceCardProps> = ({
    isOpen,
    onClose,
    stats,
}) => {
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [referralCode, setReferralCode] = useState<string>('');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        let mounted = true;
        api.get('/referrals/me')
            .then((res) => {
                if (mounted && res.data?.referralCode) {
                    setReferralCode(String(res.data.referralCode));
                }
            })
            .catch(() => {});
        return () => {
            mounted = false;
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleUsername =
        user?.username?.replace(/^@/, '') ||
        user?.name?.split(' ')[0]?.toLowerCase() ||
        'trader';
    const shareUrl = referralCode
        ? `${window.location.origin}/register?ref=${encodeURIComponent(referralCode)}`
        : `${window.location.origin}/register`;

    const currency = stats.currency || 'USD';
    const netPositive = Number(stats.netProfit || 0) >= 0;
    const formattedNet = `${netPositive ? '+' : '-'}${currency === 'USD' ? '$' : `${currency} `}${Math.abs(
        Number(stats.netProfit || 0)
    ).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const shareText = isEn
        ? `Analyzed on Torex · @${handleUsername} | Win Rate ${stats.winRate}% · PF ${stats.profitFactor} · ${stats.totalTrades} verified trades (${stats.periodLabel})`
        : `Analisado na Torex · @${handleUsername} | Win Rate ${stats.winRate}% · PF ${stats.profitFactor} · ${stats.totalTrades} trades auditados (${stats.periodLabel})`;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2500);
        } catch {
            // ignore clipboard errors
        }
    };

    const handleNativeShare = async () => {
        if (typeof navigator.share === 'function') {
            try {
                await navigator.share({
                    title: 'Torex Journal · Track Record Auditado',
                    text: shareText,
                    url: shareUrl,
                });
                return;
            } catch {
                // fallback to clipboard
            }
        }
        await handleCopy();
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md rounded-2xl bg-surface border border-line shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-line-subtle">
                    <div className="flex items-center gap-2">
                        <Award size={16} className="text-accent-fg" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-fg">
                            {isEn ? 'Shareable Track Record' : 'Cartão Partilhável de Performance'}
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Branded Share Card */}
                    <div className="relative rounded-2xl bg-canvas border border-line-strong p-5 space-y-4 overflow-hidden">
                        <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-accent/10 blur-2xl pointer-events-none" />

                        <div className="flex items-center justify-between gap-2 relative z-10">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-accent-fg bg-accent/10 border border-accent/25 px-2.5 py-1 rounded-full">
                                <Sparkles size={11} />
                                {isEn ? 'Analyzed on Torex' : 'Analisado na Torex'} · @{handleUsername}
                            </span>
                            <span className="text-[10px] font-mono text-fg-subtle">
                                {stats.periodLabel}
                            </span>
                        </div>

                        <div className="relative z-10">
                            <span className="text-[10px] uppercase tracking-wider text-fg-subtle block">
                                {isEn ? 'Verified Net Result' : 'Resultado Líquido Auditado'}
                            </span>
                            <div
                                className={`text-2xl sm:text-3xl font-black font-mono tabular-nums mt-0.5 flex items-center gap-2 ${
                                    netPositive ? 'text-accent-fg' : 'text-danger-fg'
                                }`}
                            >
                                <span>{formattedNet}</span>
                                {netPositive ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-line-subtle relative z-10">
                            <div>
                                <span className="text-[10px] text-fg-subtle uppercase block">Win Rate</span>
                                <span className="text-sm font-bold font-mono tabular-nums text-fg">
                                    {stats.winRate}%
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] text-fg-subtle uppercase block">Profit Factor</span>
                                <span className="text-sm font-bold font-mono tabular-nums text-fg">
                                    {stats.profitFactor}
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] text-fg-subtle uppercase block">
                                    {isEn ? 'Trades' : 'Operações'}
                                </span>
                                <span className="text-sm font-bold font-mono tabular-nums text-fg">
                                    {stats.totalTrades}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] font-mono text-fg-subtle pt-1 border-t border-line-subtle/60 relative z-10">
                            <span>torexjournal.com</span>
                            {referralCode && <span>?ref={referralCode}</span>}
                        </div>
                    </div>

                    <div className="rounded-xl bg-accent/10 border border-accent/25 px-3.5 py-2.5 text-[11px] text-fg-muted leading-relaxed">
                        {isEn
                            ? 'Invite 1 verified trader to unlock +50 daily AI credits for 30 days. Invite 3 to earn $10 USD toward future plan activations.'
                            : 'Cada convite verificado libera +50 créditos IA/dia durante 30 dias. Ao completar 3 convidados você ganha $10.00 USD para ativar seus próximos planos.'}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="flex-1 h-9 rounded-xl bg-surface-2 hover:bg-surface-3 border border-line text-xs font-semibold text-fg flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                            <span>
                                {copied
                                    ? isEn
                                        ? 'Copied!'
                                        : 'Copiado!'
                                    : isEn
                                      ? 'Copy Card & Link'
                                      : 'Copiar Resumo & Link'}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={handleNativeShare}
                            className="h-9 px-4 rounded-xl bg-accent hover:bg-accent-hover text-accent-on text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                            <Share2 size={14} />
                            <span>{isEn ? 'Share' : 'Partilhar'}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
