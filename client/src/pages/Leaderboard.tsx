import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Trophy, Search, Share2, Flame, Target, Info,
    X, Star, Crown, Gem, Zap, Sparkles, Award, HelpCircle, Check
} from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { TableRowsSkeleton } from '../components/ui/Skeleton';

export const getTierByRank = (rank: number, tradesCount: number = 0, isEn: boolean = false) => {
    if (tradesCount === 0) return { key: 'BRONZE', label: isEn ? 'CALIBRATING' : 'CALIBRANDO' };
    if (rank > 100) return { key: 'BRONZE', label: 'BRONZE' };
    if (rank === 1 && tradesCount >= 25000) return { key: 'LEGEND', label: 'LEGEND 1' };
    if (rank <= 3 && tradesCount >= 10000) return { key: 'MASTERS', label: `MASTERS ${rank}` };
    if (rank <= 10 && tradesCount >= 10000) return { key: 'DIAMOND', label: `DIAMOND ${Math.ceil((rank - 3) / 2)}` };
    if (rank <= 50 && tradesCount >= 5000) return { key: 'PLATINUM', label: 'PLATINUM' };
    if (rank <= 50 && tradesCount >= 2500) return { key: 'GOLD', label: 'GOLD' };
    if (rank <= 100 && tradesCount >= 1000) return { key: 'SILVER', label: 'SILVER' };
    return { key: 'BRONZE', label: 'BRONZE' };
};

const TIER_CONFIG: Record<string, { label: string; icon: any; bg: string; text: string; border: string }> = {
    LEGEND: {
        label: 'LEGEND',
        icon: Crown,
        bg: 'bg-accent/15',
        text: 'text-accent-fg',
        border: 'border-accent/35',
    },
    MASTERS: {
        label: 'MASTERS',
        icon: Zap,
        bg: 'bg-warning/15',
        text: 'text-warning',
        border: 'border-warning/35',
    },
    DIAMOND: {
        label: 'DIAMOND',
        icon: Gem,
        bg: 'bg-sky-500/15',
        text: 'text-sky-300',
        border: 'border-sky-500/35',
    },
    PLATINUM: {
        label: 'PLATINUM',
        icon: Sparkles,
        bg: 'bg-data-radar/15',
        text: 'text-data-radar',
        border: 'border-data-radar/35',
    },
    GOLD: {
        label: 'GOLD',
        icon: Trophy,
        bg: 'bg-amber-500/15',
        text: 'text-amber-400',
        border: 'border-amber-500/35',
    },
    SILVER: {
        label: 'SILVER',
        icon: Star,
        bg: 'bg-surface-2',
        text: 'text-fg',
        border: 'border-line-strong',
    },
    BRONZE: {
        label: 'BRONZE',
        icon: Award,
        bg: 'bg-amber-800/15',
        text: 'text-amber-500',
        border: 'border-amber-700/35',
    },
};

function TraderAvatar({
    name,
    username,
    avatarUrl,
    size = 'md',
}: {
    name?: string;
    username?: string;
    avatarUrl?: string | null;
    size?: 'sm' | 'md' | 'lg';
}) {
    const [imgError, setImgError] = useState(false);
    const displayName = name || username || 'Trader';
    const initial = displayName.charAt(0).toUpperCase();

    const sizeClasses = {
        sm: 'w-7 h-7 text-[11px]',
        md: 'w-8 h-8 text-xs',
        lg: 'w-10 h-10 text-sm',
    }[size];

    if (avatarUrl && !imgError) {
        return (
            <img
                src={avatarUrl}
                alt=""
                aria-hidden="true"
                onError={() => setImgError(true)}
                className={`${sizeClasses} rounded-full object-cover border border-line-strong shrink-0 bg-surface-2`}
            />
        );
    }

    return (
        <div
            className={`${sizeClasses} rounded-full bg-accent/15 border border-accent/30 text-accent-fg font-bold flex items-center justify-center shrink-0 select-none font-mono`}
        >
            {initial}
        </div>
    );
}

export function Leaderboard() {
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTier, setSelectedTier] = useState('ALL');
    const [isScoreInfoOpen, setIsScoreInfoOpen] = useState(false);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    const formatTier = (tierLevel?: string) =>
        isEn && tierLevel === 'CALIBRANDO' ? 'CALIBRATING' : tierLevel || (isEn ? 'CALIBRATING' : 'CALIBRANDO');
    const formatBadge = (badge: string) =>
        isEn
            ? badge === 'Atirador de Elite'
                ? 'Sharpshooter'
                : badge === 'Sequência de Aço'
                ? 'Iron Streak'
                : badge
            : badge;

    const showToast = (msg: string) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 3000);
    };

    const {
        data: serverTraders,
        isLoading: isLoadingTraders,
    } = useQuery({
        queryKey: ['leaderboard', selectedTier],
        queryFn: async () => {
            const params: any = {};
            if (selectedTier !== 'ALL') params.tier = selectedTier;
            const res = await api.get('/leaderboard', { params });
            return res.data;
        },
        refetchInterval: 30000,
    });

    const {
        data: myRankData,
    } = useQuery({
        queryKey: ['leaderboard', 'me'],
        queryFn: async () => {
            try {
                const res = await api.get('/leaderboard/me');
                return res.data;
            } catch (e) {
                return null;
            }
        },
        retry: 1,
    });

    const { data: myReferralData } = useQuery({
        queryKey: ['referrals', 'me'],
        queryFn: async () => {
            try {
                const res = await api.get('/referrals/me');
                return res.data;
            } catch {
                return null;
            }
        },
        enabled: Boolean(user?.id),
        staleTime: 60_000,
    });
    const myReferralCode = myReferralData?.referralCode ? String(myReferralData.referralCode) : '';
    const challengeStatus = myRankData?.challengeStatus;

    const tradersList = useMemo(() => {
        const raw = Array.isArray(serverTraders) ? serverTraders : [];
        return raw.map((t: any) => {
            const isUser = Boolean(
                (user?.id && t.userId === user.id) ||
                (user?.username && t.username?.toLowerCase() === user.username.toLowerCase()) ||
                t.isCurrentUser
            );

            return {
                ...t,
                isCurrentUser: isUser,
                name: t.name || (isUser && user?.name) || t.username || 'Trader',
                username: t.username || (isUser && user?.username) || 'trader',
                avatarUrl: t.avatarUrl || (isUser && user?.avatarUrl) || null,
            };
        });
    }, [serverTraders, user]);

    const currentUser = useMemo(() => {
        if (myRankData) {
            return {
                ...myRankData,
                name: myRankData.name || user?.name || user?.username || 'Trader',
                username: myRankData.username || user?.username || 'trader',
                avatarUrl: myRankData.avatarUrl || user?.avatarUrl || null,
            };
        }
        const found = tradersList.find((t: any) => t.isCurrentUser);
        if (found) return found;

        return {
            rank: '-',
            tier: 'BRONZE',
            tierLevel: 'CALIBRANDO',
            name: user?.name || user?.username || 'Trader',
            username: user?.username || 'trader',
            avatarUrl: user?.avatarUrl || null,
            winRate: 0,
            tradesCount: 0,
            streak: 0,
            profitFactor: 0,
            riskReward: 0,
            compositeScore: 0,
            scoreBreakdown: { wr: 0, pf: 0, rr: 0, vol: 0, cons: 0 },
            badges: [],
        };
    }, [myRankData, tradersList, user]);

    const filteredTraders = useMemo(() => {
        return tradersList.filter((trader: any) => {
            const matchesSearch =
                trader.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                trader.username.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesTier = selectedTier === 'ALL' || trader.tier === selectedTier;
            return matchesSearch && matchesTier;
        });
    }, [tradersList, searchQuery, selectedTier]);

    return (
        <div className="w-full space-y-3 pb-10 text-fg antialiased animate-in fade-in duration-300">
            {toastMessage && (
                <div className="fixed top-5 right-5 z-50 bg-accent text-accent-on font-bold px-3.5 py-2 rounded-lg shadow-xl flex items-center gap-2 animate-in slide-in-from-top-4 duration-300">
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span className="text-xs">{toastMessage}</span>
                </div>
            )}

            {/* Compact Top Bar: Count + Search + Tier Filter */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 text-xs text-fg-muted">
                    <Trophy className="w-3.5 h-3.5 text-accent-fg" />
                    <span>
                        <strong className="text-fg font-semibold tabular-nums">{filteredTraders.length}</strong>{' '}
                        {isEn
                            ? filteredTraders.length === 1
                                ? 'ranked trader'
                                : 'ranked traders'
                            : filteredTraders.length === 1
                            ? 'trader ranqueado'
                            : 'traders ranqueados'}
                    </span>
                    <span className="text-fg-subtle">·</span>
                    <span className="text-accent-fg font-mono text-[11px] font-semibold">
                        {isEn ? 'Live Accounts Only' : 'Contas Reais Apenas'}
                    </span>
                </div>

                <div className="relative w-full md:w-72">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={isEn ? 'Search by @username or name...' : 'Buscar por @username ou nome...'}
                        className="w-full h-8 bg-surface border border-line rounded-lg pl-8 pr-8 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/50 transition-colors"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg cursor-pointer"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Desafio Mensal de Consistência Torex */}
            <div className="bg-surface border border-accent/25 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-accent-fg">
                            <Award className="w-3.5 h-3.5" />
                            {isEn ? 'Torex Monthly Consistency Challenge' : 'Desafio Mensal de Consistência Torex'}
                        </span>
                        {challengeStatus?.monthKey && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-canvas-subtle border border-line text-fg-muted">
                                {challengeStatus.monthKey}
                            </span>
                        )}
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent-fg border border-accent/20">
                            {challengeStatus?.eligible
                                ? (isEn ? 'Eligible for Monthly Prizes' : 'Elegível para Prémios Mensais')
                                : (isEn ? 'Tournaments & Rewards Roadmap' : 'Torneios com Créditos e Contas')}
                        </span>
                    </div>
                    <p className="text-xs text-fg-muted">
                        {isEn
                            ? 'Qualify for upcoming monthly tournaments & plan rewards by fulfilling both consistency criteria:'
                            : 'Habilite-se aos próximos torneios mensais de consistência e recompensas cumprindo os 2 pré-requisitos:'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border ${
                        challengeStatus?.hasConnectedBroker
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : 'bg-canvas-subtle border-line text-fg-muted'
                    }`}>
                        <Check className="w-3 h-3" />
                        {isEn
                            ? `Broker connected (${challengeStatus?.connectedAccountsCount ?? 0}/${challengeStatus?.requiredAccounts ?? 1})`
                            : `Corretora conectada (${challengeStatus?.connectedAccountsCount ?? 0}/${challengeStatus?.requiredAccounts ?? 1})`}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border ${
                        (challengeStatus?.verifiedReferrals ?? 0) >= (challengeStatus?.requiredReferrals ?? 1)
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : 'bg-canvas-subtle border-line text-fg-muted'
                    }`}>
                        <Sparkles className="w-3 h-3" />
                        {isEn
                            ? `Verified invite (${challengeStatus?.verifiedReferrals ?? 0}/${challengeStatus?.requiredReferrals ?? 1})`
                            : `Amigo convidado (${challengeStatus?.verifiedReferrals ?? 0}/${challengeStatus?.requiredReferrals ?? 1})`}
                    </span>
                </div>
            </div>

            {/* Card: SUA POSIÇÃO */}
            <div className="bg-surface border border-line rounded-xl p-4 sm:p-5 space-y-3.5">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-fg-subtle tracking-wider uppercase flex items-center gap-1.5">
                        <Trophy className="w-3.5 h-3.5 text-accent-fg" />
                        <span>{isEn ? 'Your Standing' : 'Sua Posição'}</span>
                    </span>
                    <button
                        onClick={() => setIsShareModalOpen(true)}
                        className="h-7 px-2.5 rounded-lg bg-surface-2 border border-line hover:bg-surface-3 text-fg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                        <Share2 className="w-3 h-3 text-accent-fg" />
                        <span>{isEn ? 'Share' : 'Compartilhar'}</span>
                    </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-3xl font-black text-fg tracking-tight font-mono tabular-nums">
                                {currentUser.rank === 999 ? '—' : `#${currentUser.rank}`}
                            </span>
                            <span className="text-xs text-fg-subtle font-mono tabular-nums">
                                {isEn ? 'of' : 'de'} {tradersList.length}
                            </span>
                        </div>

                        <div className="flex items-center gap-2.5 bg-canvas-subtle border border-line-subtle rounded-xl px-3 py-1.5">
                            <TraderAvatar
                                name={currentUser.name}
                                username={currentUser.username}
                                avatarUrl={currentUser.avatarUrl}
                                size="md"
                            />
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-fg">{currentUser.name}</span>
                                <span className="text-[11px] text-accent-fg font-mono">@{currentUser.username}</span>
                            </div>
                            <div className="ml-1.5 flex items-center gap-1 bg-accent/10 text-accent-fg border border-accent/25 px-2 py-0.5 rounded-md text-[10px] font-bold font-mono">
                                <Crown className="w-3 h-3" />
                                <span>{formatTier(currentUser.tierLevel)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 bg-canvas-subtle border border-line-subtle px-3.5 py-2 rounded-xl font-mono tabular-nums">
                        <span className="text-xs text-fg-muted">{isEn ? 'Total Net P&L:' : 'Lucro Total:'}</span>
                        {Number(currentUser.totalPnL) > 0 ? (
                            <span className="text-accent-fg font-bold text-sm">
                                +${Number(currentUser.totalPnL).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        ) : Number(currentUser.totalPnL) < 0 ? (
                            <span className="text-danger-fg font-bold text-sm">
                                -${Math.abs(Number(currentUser.totalPnL)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        ) : (
                            <span className="text-fg-muted font-bold text-sm">$0.00</span>
                        )}
                    </div>
                </div>

                {/* Progress & Metrics */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
                    <div className="p-3 rounded-xl bg-canvas-subtle border border-line-subtle space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-fg-muted font-medium flex items-center gap-1.5">
                                <Crown className="w-3.5 h-3.5 text-warning" />
                                {isEn ? (
                                    <span>LEGEND Target: <strong className="text-fg">25,000 trades</strong> + Positive Net P&L</span>
                                ) : (
                                    <span>Meta LEGEND: <strong className="text-fg">25.000 ops</strong> + PnL Positivo</span>
                                )}
                            </span>
                            <span className="text-accent-fg font-mono font-bold text-[11px] tabular-nums">
                                {currentUser.tradesCount || 0} / {isEn ? '25,000' : '25.000'}
                            </span>
                        </div>
                        <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-accent rounded-full"
                                style={{ width: `${Math.max(1, Math.min(100, (((currentUser.tradesCount || 0) / 25000) * 100)))}%` }}
                            />
                        </div>
                        <div className="flex flex-wrap items-center justify-between text-[11px] text-fg-subtle font-mono tabular-nums pt-0.5">
                            <span>
                                {currentUser.winRate}% Win Rate · {currentUser.tradesCount} {isEn ? 'trades' : 'ops'} · PF {Number(currentUser.profitFactor || 0).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <div className="p-3 rounded-xl bg-canvas-subtle border border-line-subtle space-y-1.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-bold text-fg uppercase tracking-wider">
                                    {isEn ? 'Composite Score' : 'Pontuação Composta'}
                                </span>
                                <button
                                    onClick={() => setIsScoreInfoOpen(!isScoreInfoOpen)}
                                    className="text-fg-subtle hover:text-accent-fg transition-colors cursor-pointer"
                                    title={isEn ? 'How is it calculated?' : 'Como é calculada?'}
                                >
                                    <Info className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <span className="text-base font-bold text-accent-fg font-mono tabular-nums">
                                {currentUser.compositeScore}
                            </span>
                        </div>

                        <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-accent rounded-full"
                                style={{ width: `${Math.min(100, currentUser.compositeScore)}%` }}
                            />
                        </div>

                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-subtle font-mono tabular-nums pt-0.5">
                            <span>PnL <strong className="text-accent-fg">{currentUser.scoreBreakdown?.pnl ?? '0.0'}</strong></span>
                            <span>Vol <strong className="text-fg">{currentUser.scoreBreakdown?.vol ?? '0.0'}</strong></span>
                            <span>PF <strong className="text-fg">{currentUser.scoreBreakdown?.pf ?? '0.0'}</strong></span>
                            <span>Cons <strong className="text-fg">{currentUser.scoreBreakdown?.cons ?? '0.0'}</strong></span>
                            <span>WR <strong className="text-fg">{currentUser.scoreBreakdown?.wr ?? '0.0'}</strong></span>
                            <span>R:R <strong className="text-fg">{currentUser.scoreBreakdown?.rr ?? '0.0'}</strong></span>
                        </div>
                    </div>
                </div>

                {currentUser.badges && currentUser.badges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {currentUser.badges.map((badge: string, idx: number) => (
                            <span
                                key={idx}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-accent/10 border border-accent/25 text-accent-fg text-[11px] font-semibold"
                            >
                                {badge.includes('Streak') || badge.includes('Sequência') ? (
                                    <Flame className="w-3 h-3 text-danger-fg" />
                                ) : (
                                    <Target className="w-3 h-3 text-warning" />
                                )}
                                <span>{formatBadge(badge)}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Filtros por Categorias (Tiers) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                <span className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mr-1.5 shrink-0">
                    {isEn ? 'Tiers:' : 'Categorias:'}
                </span>

                <button
                    onClick={() => setSelectedTier('ALL')}
                    className={`h-7 px-2.5 rounded-lg text-[11px] font-bold transition-colors shrink-0 border cursor-pointer ${
                        selectedTier === 'ALL'
                            ? 'bg-accent text-accent-on border-accent'
                            : 'bg-surface text-fg-muted border-line hover:text-fg'
                    }`}
                >
                    {isEn ? 'ALL' : 'TODAS'}
                </button>

                {Object.entries(TIER_CONFIG).map(([key, config]) => {
                    const Icon = config.icon;
                    const isSelected = selectedTier === key;
                    return (
                        <button
                            key={key}
                            onClick={() => setSelectedTier(isSelected ? 'ALL' : key)}
                            className={`h-7 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors shrink-0 border cursor-pointer ${
                                config.bg
                            } ${config.text} ${config.border} ${
                                isSelected ? 'ring-1 ring-accent' : ''
                            }`}
                        >
                            <Icon className="w-3 h-3" />
                            <span>{config.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Tabela Principal da Classificação */}
            <div className="bg-surface border border-line rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr className="border-b border-line-subtle bg-canvas-subtle text-[10px] text-fg-subtle font-semibold uppercase tracking-wider">
                                <th className="py-2.5 px-4 w-12 text-center">#</th>
                                <th className="py-2.5 px-4">Trader</th>
                                <th className="py-2.5 px-4">{isEn ? 'Tier' : 'Categoria'}</th>
                                <th className="py-2.5 px-4">{isEn ? 'Win Rate' : 'Taxa de Vitória'}</th>
                                <th className="py-2.5 px-4">{isEn ? 'Profit Factor' : 'Fator Lucro'}</th>
                                <th className="py-2.5 px-4">{isEn ? 'Risk/Reward' : 'Risco/Retorno'}</th>
                                <th className="py-2.5 px-4 text-right">{isEn ? 'Score' : 'Pontuação'}</th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-line-subtle">
                            {isLoadingTraders ? (
                                <TableRowsSkeleton columns={7} rows={8} />
                            ) : filteredTraders.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-10 text-center text-fg-subtle text-xs">
                                        {isEn ? 'No traders found matching the selected criteria.' : 'Nenhum trader encontrado com os critérios selecionados.'}
                                    </td>
                                </tr>
                            ) : (
                                filteredTraders.map((trader: any) => {
                                    const tierStyle = TIER_CONFIG[trader.tier] || TIER_CONFIG.GOLD;
                                    const TierIcon = tierStyle.icon;

                                    return (
                                        <tr
                                            key={trader.id || trader.username}
                                            className={`transition-colors hover:bg-surface-2/50 ${
                                                trader.isCurrentUser
                                                    ? 'bg-accent/[0.06] text-fg border-l-2 border-l-accent'
                                                    : 'text-fg'
                                            }`}
                                        >
                                            <td className="py-2.5 px-4 text-center font-bold font-mono tabular-nums">
                                                <span
                                                    className={
                                                        trader.rank === 1
                                                            ? 'text-warning font-black'
                                                            : trader.rank === 2
                                                            ? 'text-fg font-bold'
                                                            : trader.rank === 3
                                                            ? 'text-amber-600 font-bold'
                                                            : 'text-fg-subtle'
                                                    }
                                                >
                                                    {trader.rank === 999 ? '—' : `#${trader.rank}`}
                                                </span>
                                            </td>

                                            <td className="py-2.5 px-4">
                                                <div className="flex items-center gap-2.5">
                                                    <TraderAvatar
                                                        name={trader.name}
                                                        username={trader.username}
                                                        avatarUrl={trader.avatarUrl}
                                                        size="sm"
                                                    />
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="font-semibold text-fg text-xs">{trader.name}</span>
                                                            {trader.badges?.includes('Atirador de Elite') && (
                                                                <span title={isEn ? 'Sharpshooter' : 'Atirador de Elite'} className="inline-flex items-center">
                                                                    <Target className="w-3 h-3 text-warning" />
                                                                </span>
                                                            )}
                                                            {trader.badges?.includes('Sequência de Aço') && (
                                                                <span title={isEn ? 'Iron Streak' : 'Sequência de Aço'} className="inline-flex items-center">
                                                                    <Flame className="w-3 h-3 text-danger-fg" />
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[10px] text-fg-subtle font-mono">@{trader.username}</span>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="py-2.5 px-4">
                                                <div
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] ${tierStyle.bg} ${tierStyle.text} border ${tierStyle.border} font-bold font-mono`}
                                                >
                                                    <TierIcon className="w-3 h-3" />
                                                    <span>{formatTier(trader.tierLevel)}</span>
                                                </div>
                                            </td>

                                            <td className="py-2.5 px-4 font-semibold text-accent-fg font-mono tabular-nums">
                                                {trader.winRate}%
                                            </td>

                                            <td className="py-2.5 px-4 font-medium text-fg-muted font-mono tabular-nums">
                                                {Number(trader.profitFactor).toFixed(2)}
                                            </td>

                                            <td className="py-2.5 px-4 font-medium text-fg-muted font-mono tabular-nums">
                                                {Number(trader.riskReward).toFixed(2)}
                                            </td>

                                            <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                                                <span className="font-bold text-accent-fg">
                                                    {trader.compositeScore}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal: Compartilhar Posição */}
            {isShareModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface border border-line rounded-xl w-full max-w-sm p-5 space-y-4 text-center shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center border-b border-line-subtle pb-2.5">
                            <h3 className="text-sm font-bold text-fg">{isEn ? 'Share Standing' : 'Compartilhar Posição'}</h3>
                            <button onClick={() => setIsShareModalOpen(false)} className="text-fg-muted hover:text-fg p-1 cursor-pointer">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-3.5 rounded-xl bg-canvas-subtle border border-line text-left space-y-2.5">
                            <div className="flex items-center justify-between font-mono">
                                <span className="text-[11px] text-fg-muted">{isEn ? 'Torex Leaderboard' : 'Classificação Torex'}</span>
                                <span className="text-xs font-bold text-accent-fg">{isEn ? 'Rank' : 'Posição'} #{currentUser.rank}</span>
                            </div>
                            <div className="flex items-center gap-2.5">
                                <TraderAvatar
                                    name={currentUser.name}
                                    username={currentUser.username}
                                    avatarUrl={currentUser.avatarUrl}
                                    size="md"
                                />
                                <div>
                                    <div className="text-xs font-bold text-fg">{currentUser.name}</div>
                                    <div className="text-[11px] text-accent-fg font-mono">@{currentUser.username}</div>
                                </div>
                            </div>
                            <div className="text-[11px] text-accent-fg font-semibold bg-accent/10 p-2 rounded-lg border border-accent/20 font-mono">
                                {isEn
                                    ? `Tier: ${formatTier(currentUser.tierLevel)} · Score: ${currentUser.compositeScore}`
                                    : `Categoria: ${formatTier(currentUser.tierLevel)} · Pontuação: ${currentUser.compositeScore}`}
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                const baseUrl = `${window.location.origin}${isEn ? '/en' : ''}/leaderboard?user=${encodeURIComponent(currentUser.username)}`;
                                const finalUrl = myReferralCode
                                    ? `${baseUrl}&ref=${encodeURIComponent(myReferralCode)}`
                                    : baseUrl;
                                navigator.clipboard.writeText(finalUrl);
                                setIsShareModalOpen(false);
                                showToast(isEn ? 'Share link copied to clipboard!' : 'Link copiado para a área de transferência!');
                            }}
                            className="w-full h-9 rounded-lg bg-accent text-accent-on font-bold text-xs hover:bg-accent-hover transition-colors cursor-pointer"
                        >
                            {isEn ? 'Copy Link' : 'Copiar Link'}
                        </button>
                    </div>
                </div>
            )}

            {/* Modal: Informações do Cálculo de Pontuação */}
            {isScoreInfoOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface border border-line rounded-xl w-full max-w-md p-5 space-y-3.5 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center border-b border-line-subtle pb-2.5">
                            <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                                <HelpCircle className="w-4 h-4 text-accent-fg" /> {isEn ? 'Composite Score Formula' : 'Fórmula da Pontuação Composta'}
                            </h3>
                            <button onClick={() => setIsScoreInfoOpen(false)} className="text-fg-muted hover:text-fg p-1 cursor-pointer">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <p className="text-xs text-fg-muted leading-relaxed">
                            {isEn
                                ? 'The Composite Score evaluates multiple mathematical metrics of live profitability, sample maturity, and risk discipline:'
                                : 'A Pontuação Composta avalia múltiplos indicadores matemáticos de rentabilidade real, maturidade amostral e disciplina de risco:'}
                        </p>

                        <ul className="text-xs space-y-1.5 text-fg font-mono bg-canvas-subtle p-3 rounded-xl border border-line-subtle">
                            {isEn ? (
                                <>
                                    <li>• <strong className="text-accent-fg">Vol (25%):</strong> Progression and sample maturity up to 25,000 trades.</li>
                                    <li>• <strong className="text-accent-fg">PnL (25%):</strong> Cumulative net return in USD.</li>
                                    <li>• <strong className="text-accent-fg">Cons (20%):</strong> Operational consistency and active trading days.</li>
                                    <li>• <strong className="text-accent-fg">WR (15%):</strong> Sustained win rate percentage.</li>
                                    <li>• <strong className="text-accent-fg">PF (10%):</strong> Ratio of gross profits to gross losses.</li>
                                    <li>• <strong className="text-accent-fg">R:R (10%):</strong> Risk management efficiency and discipline.</li>
                                    <li>• <strong className="text-accent-fg">Streak (5%):</strong> Consecutive winning trades.</li>
                                </>
                            ) : (
                                <>
                                    <li>• <strong className="text-accent-fg">Vol (25%):</strong> Progressão e maturidade até 25.000 operações.</li>
                                    <li>• <strong className="text-accent-fg">PnL (25%):</strong> Retorno financeiro acumulado em dólares.</li>
                                    <li>• <strong className="text-accent-fg">Cons (20%):</strong> Regularidade operacional e dias ativos.</li>
                                    <li>• <strong className="text-accent-fg">WR (15%):</strong> Percentual de vitórias sustentadas.</li>
                                    <li>• <strong className="text-accent-fg">PF (10%):</strong> Razão entre lucros brutos e perdas brutas.</li>
                                    <li>• <strong className="text-accent-fg">R:R (10%):</strong> Eficiência na gestão de risco e disciplina.</li>
                                    <li>• <strong className="text-accent-fg">Streak (5%):</strong> Sequência de vitórias consecutivas.</li>
                                </>
                            )}
                        </ul>

                        <button
                            onClick={() => setIsScoreInfoOpen(false)}
                            className="w-full h-9 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg transition-colors cursor-pointer"
                        >
                            {isEn ? 'Got it' : 'Entendido'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Leaderboard;
