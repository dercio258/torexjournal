import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
    Check,
    Copy,
    Gift,
    Loader2,
    MessageCircle,
    Send,
    Share2,
    Sparkles,
    X,
} from 'lucide-react';
import api from '../../api';
import { useLocale } from '../../context/LocaleContext';

interface InviteFriendBannerProps {
    locale?: 'pt' | 'en';
    className?: string;
}

interface ReferralSummaryData {
    referralCode?: string;
    shareUrl?: string;
    counts?: {
        total?: number;
        paid?: number;
    };
    creditsUsd?: number;
}

async function copyTextSafe(text: string): Promise<boolean> {
    if (!text) return false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fallback below
    }
    try {
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        return ok;
    } catch {
        return false;
    }
}

export const InviteFriendBanner: React.FC<InviteFriendBannerProps> = ({
    locale: explicitLocale,
    className = '',
}) => {
    const { locale: ctxLocale } = useLocale();
    const isEn = (explicitLocale || ctxLocale) === 'en';

    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [referral, setReferral] = useState<ReferralSummaryData | null>(null);
    const [copied, setCopied] = useState<'link' | 'code' | null>(null);

    useEffect(() => {
        if (!isOpen || referral?.shareUrl) return;
        let active = true;
        setLoading(true);
        api.get<ReferralSummaryData>('/referrals/me')
            .then((res) => {
                if (active && res.data) {
                    setReferral(res.data);
                }
            })
            .catch(() => {
                // keep fallback URL below
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [isOpen, referral?.shareUrl]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen]);

    const fallbackUrl =
        typeof window !== 'undefined'
            ? `${window.location.origin}/register`
            : 'https://torexjournal.com/register';
    const shareUrl = referral?.shareUrl || fallbackUrl;
    const referralCode = referral?.referralCode || '';

    const shareMessage = isEn
        ? `Join me on Torex Journal — institutional trading analytics, journal & AI Coach: ${shareUrl}`
        : `Opera comigo no Torex Journal — diário de trading, métricas avançadas e AI Coach: ${shareUrl}`;

    const handleCopy = async (value: string, type: 'link' | 'code') => {
        const ok = await copyTextSafe(value);
        if (ok) {
            setCopied(type);
            window.setTimeout(() => setCopied(null), 2200);
        }
    };

    const handleNativeShare = async () => {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({
                    title: 'Torex Journal',
                    text: isEn
                        ? 'Join me on Torex Journal — institutional trading analytics, journal & AI Coach:'
                        : 'Opera comigo no Torex Journal — diário de trading, métricas avançadas e AI Coach:',
                    url: shareUrl,
                });
                return;
            } catch {
                // fallback to copy
            }
        }
        await handleCopy(shareUrl, 'link');
    };

    const whatsappHref = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
    const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(
        isEn
            ? 'Join me on Torex Journal — trading journal, analytics & AI Coach'
            : 'Opera comigo no Torex Journal — diário de trading, métricas e AI Coach',
    )}`;

    return (
        <>
            <div
                className={`rounded-xl border border-line bg-surface hover:border-accent/40 px-3 py-2 sm:px-4 flex items-center justify-between gap-3 transition-colors ${className}`}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-accent/12 border border-accent/25 flex items-center justify-center text-accent-fg shrink-0">
                        <Gift size={14} />
                    </div>
                    <p className="text-xs text-fg-muted truncate">
                        <span className="font-semibold text-fg">
                            {isEn ? 'Invite a friend' : 'Convide um amigo'}
                        </span>
                        <span className="hidden sm:inline text-fg-subtle">
                            {' · '}
                            {isEn
                                ? 'Earn +50 AI credits/day and $10 plan credits'
                                : 'Ganhe +50 créditos IA/dia e $10 para planos'}
                        </span>
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-accent hover:bg-accent-hover text-accent-on text-[11px] font-bold transition-colors shrink-0 cursor-pointer active:scale-95"
                >
                    <Share2 size={12} />
                    <span>{isEn ? 'Invite' : 'Convidar'}</span>
                </button>
            </div>

            {isOpen &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[9999] bg-canvas/80 backdrop-blur-md flex items-center justify-center p-4"
                        onClick={() => setIsOpen(false)}
                    >
                        <div
                            className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-2xl p-5 sm:p-6 space-y-4 relative"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="absolute top-4 right-4 p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                                title={isEn ? 'Close' : 'Fechar'}
                            >
                                <X size={16} />
                            </button>

                            <div className="flex items-start gap-3 pr-7">
                                <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent-fg shrink-0">
                                    <Gift size={18} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-fg leading-snug">
                                        {isEn ? 'Invite a Friend' : 'Convidar Amigo'}
                                    </h3>
                                    <p className="text-xs text-fg-muted mt-0.5 leading-relaxed">
                                        {isEn
                                            ? 'Share your link with fellow traders: earn +50 daily AI credits per paid friend and $10 in plan credits every 3.'
                                            : 'Partilhe o seu link com outros traders: ganhe +50 créditos IA/dia por amigo pagante e $10 em créditos a cada 3.'}
                                    </p>
                                </div>
                            </div>

                            {loading ? (
                                <div className="flex items-center justify-center gap-2 py-6 text-xs text-fg-muted">
                                    <Loader2 size={15} className="animate-spin text-accent-fg" />
                                    <span>{isEn ? 'Loading your invite link...' : 'A preparar o seu link...'}</span>
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle block">
                                            {isEn ? 'Your invite link' : 'O seu link de convite'}
                                        </label>
                                        <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas-subtle px-3 py-2">
                                            <span className="text-xs font-mono text-fg-muted truncate flex-1 select-all">
                                                {shareUrl}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => void handleCopy(shareUrl, 'link')}
                                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-on text-[11px] font-bold shrink-0 transition-colors cursor-pointer"
                                            >
                                                {copied === 'link' ? (
                                                    <>
                                                        <Check size={12} />
                                                        <span>{isEn ? 'Copied' : 'Copiado'}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy size={12} />
                                                        <span>{isEn ? 'Copy' : 'Copiar'}</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>

                                    {referralCode && (
                                        <div className="flex items-center justify-between rounded-xl border border-line-subtle bg-canvas-subtle/60 px-3 py-2">
                                            <div className="flex items-center gap-2 text-xs">
                                                <Sparkles size={13} className="text-accent-fg shrink-0" />
                                                <span className="text-fg-muted">
                                                    {isEn ? 'Code:' : 'Código:'}
                                                </span>
                                                <span className="font-mono font-bold text-fg">
                                                    {referralCode}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => void handleCopy(referralCode, 'code')}
                                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-fg hover:text-accent-hover cursor-pointer"
                                            >
                                                {copied === 'code' ? <Check size={12} /> : <Copy size={12} />}
                                                <span>
                                                    {copied === 'code'
                                                        ? isEn
                                                            ? 'Copied'
                                                            : 'Copiado'
                                                        : isEn
                                                          ? 'Copy code'
                                                          : 'Copiar código'}
                                                </span>
                                            </button>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-3 gap-2 pt-1">
                                        <a
                                            href={whatsappHref}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-line bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg transition-colors"
                                        >
                                            <MessageCircle size={14} className="text-emerald-400" />
                                            <span>WhatsApp</span>
                                        </a>
                                        <a
                                            href={telegramHref}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-line bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg transition-colors"
                                        >
                                            <Send size={13} className="text-sky-400" />
                                            <span>Telegram</span>
                                        </a>
                                        <button
                                            type="button"
                                            onClick={() => void handleNativeShare()}
                                            className="inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-line bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg transition-colors cursor-pointer"
                                        >
                                            <Share2 size={13} className="text-accent-fg" />
                                            <span>{isEn ? 'Share' : 'Partilhar'}</span>
                                        </button>
                                    </div>

                                    <div className="pt-2 border-t border-line-subtle flex items-center justify-between text-[11px] text-fg-subtle">
                                        <span>
                                            {isEn ? 'Free for all traders' : 'Gratuito para todos os traders'}
                                        </span>
                                        <Link
                                            to="/profile#affiliates"
                                            onClick={() => setIsOpen(false)}
                                            className="font-semibold text-accent-fg hover:underline"
                                        >
                                            {isEn ? 'View my invites' : 'Ver meus convites'}
                                        </Link>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
};
