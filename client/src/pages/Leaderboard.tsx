import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Trophy, Search, Share2, Flame, Target, Info,
    X, Star, Crown, Gem, Zap, Sparkles, Award, HelpCircle, Check
} from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

/* 
 * NOTA DO BACKEND: 
 * O processamento e atribuição das categorias (Tiers) é executado no servidor (backend)
 * com base no universo total de usuários cadastrados e ranqueados na plataforma:
 * - #1: LEGEND
 * - #2: MASTERS
 * - #3: DIAMOND
 * - Top 10 (#4 a #10): PLATINUM
 * - Top 50 (#11 a #50): GOLD
 * - Top 100 (#51 a #100): SILVER
 * - Restante (> 100): BRONZE
 */

// Função utilitária para calcular o Tier com base na posição e volume de operações
export const getTierByRank = (rank: number, tradesCount: number = 0) => {
    if (tradesCount === 0) return { key: 'BRONZE', label: 'CALIBRANDO' };
    if (rank > 100) return { key: 'BRONZE', label: 'BRONZE' };
    if (rank === 1 && tradesCount >= 25000) return { key: 'LEGEND', label: 'LEGEND 1' };
    if (rank <= 3 && tradesCount >= 10000) return { key: 'MASTERS', label: `MASTERS ${rank}` };
    if (rank <= 10 && tradesCount >= 10000) return { key: 'DIAMOND', label: `DIAMOND ${Math.ceil((rank - 3) / 2)}` };
    if (rank <= 50 && tradesCount >= 5000) return { key: 'PLATINUM', label: 'PLATINUM' };
    if (rank <= 50 && tradesCount >= 2500) return { key: 'GOLD', label: 'GOLD' };
    if (rank <= 100 && tradesCount >= 1000) return { key: 'SILVER', label: 'SILVER' };
    return { key: 'BRONZE', label: 'BRONZE' };
};

// Configuração visual das Categorias (Tiers)
const TIER_CONFIG: Record<string, { label: string; icon: any; bg: string; text: string; border: string }> = {
    LEGEND: {
        label: 'LEGEND',
        icon: Crown,
        bg: 'bg-emerald-500/15',
        text: 'text-accent-fg',
        border: 'border-emerald-500/40',
    },
    MASTERS: {
        label: 'MASTERS',
        icon: Zap,
        bg: 'bg-orange-500/15',
        text: 'text-orange-400',
        border: 'border-orange-500/40',
    },
    DIAMOND: {
        label: 'DIAMOND',
        icon: Gem,
        bg: 'bg-sky-500/15',
        text: 'text-sky-300',
        border: 'border-sky-500/40',
    },
    PLATINUM: {
        label: 'PLATINUM',
        icon: Sparkles,
        bg: 'bg-indigo-500/15',
        text: 'text-indigo-300',
        border: 'border-indigo-500/40',
    },
    GOLD: {
        label: 'GOLD',
        icon: Trophy,
        bg: 'bg-amber-500/15',
        text: 'text-amber-400',
        border: 'border-amber-500/40',
    },
    SILVER: {
        label: 'SILVER',
        icon: Star,
        bg: 'bg-slate-400/15',
        text: 'text-fg/80',
        border: 'border-slate-400/40',
    },
    BRONZE: {
        label: 'BRONZE',
        icon: Award,
        bg: 'bg-amber-800/15',
        text: 'text-amber-500',
        border: 'border-amber-700/40',
    },
};

// Componente de Avatar estilizado com fallback em iniciais
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
        md: 'w-9 h-9 text-xs',
        lg: 'w-11 h-11 text-sm',
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
            className={`${sizeClasses} rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-800/40 border border-emerald-500/40 text-accent-fg font-bold flex items-center justify-center shrink-0 shadow-inner select-none font-mono`}
        >
            {initial}
        </div>
    );
}

export function Leaderboard() {
    const { user } = useAuth();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTier, setSelectedTier] = useState('ALL');
    const [isScoreInfoOpen, setIsScoreInfoOpen] = useState(false);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    // Helper para notificação
    const showToast = (msg: string) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 3000);
    };

    // Query ao endpoint de Leaderboard (Lista geral de traders reais)
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

    // Query ao endpoint de ranking pessoal do usuário logado
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

    // Processamento da lista de traders reais vindos da API
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

    // Usuário atualmente posicionado ou logado
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

    // Filtragem por busca e Tier
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
        <div className="min-h-screen bg-canvas text-fg font-sans flex flex-col antialiased selection:bg-emerald-500 selection:text-black pb-12">
            {/* Notificação Toast */}
            {toastMessage && (
                <div className="fixed top-5 right-5 z-50 bg-emerald-500 text-slate-950 font-bold px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 animate-in slide-in-from-top-4 duration-300">
                    <Check className="w-5 h-5 stroke-[3]" />
                    <span className="text-xs">{toastMessage}</span>
                </div>
            )}

            {/* Conteúdo Principal */}
            <main className="space-y-6 w-full flex-1">
                
                {/* Título da Página com Informações e Ação de Registrar Operação */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-accent-fg shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                            <Trophy className="w-5 h-5" />
                        </div>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-black text-fg tracking-tight flex items-center gap-2">
                                Tabela de Classificação
                            </h1>
                            <p className="text-xs text-fg-muted font-medium flex items-center gap-2 mt-0.5">
                                <span>{filteredTraders.length} {filteredTraders.length === 1 ? 'trader ranqueado' : 'traders ranqueados'}</span>
                                <span className="w-1 h-1 rounded-full bg-[#6B7280]" />
                                <span className="text-accent-fg font-mono text-[11px]">Contas Reais Apenas</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {/* Saudação com o Trader Autenticado */}
                        <div className="flex items-center gap-2.5 bg-surface border border-line px-3.5 py-1.5 rounded-xl">
                            <TraderAvatar
                                name={currentUser.name}
                                username={currentUser.username}
                                avatarUrl={currentUser.avatarUrl}
                                size="sm"
                            />
                            <span className="text-xs text-fg-muted">
                                Olá, <strong className="text-fg font-bold">{currentUser.name}</strong> 👋
                            </span>
                        </div>
                    </div>
                </div>

                {/* Campo de Busca por @username */}
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar traders por @username ou nome..."
                        className="w-full bg-surface border border-line rounded-xl pl-10 pr-10 py-2.5 text-sm text-fg placeholder-[#6B7280] focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-sans"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg p-1 rounded-md transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* Card em Destaque: SUA POSIÇÃO */}
                <div className="relative bg-surface border border-emerald-500/30 rounded-2xl p-5 md:p-6 shadow-[0_0_30px_rgba(16,185,129,0.06)] overflow-hidden">
                    <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full filter blur-3xl pointer-events-none" />

                    <div className="relative z-10 space-y-5">
                        {/* Cabeçalho do Card */}
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-fg-muted tracking-wider uppercase flex items-center gap-1.5">
                                <Trophy className="w-3.5 h-3.5 text-accent-fg" />
                                <span>Sua Posição</span>
                            </span>
                            <button
                                onClick={() => setIsShareModalOpen(true)}
                                className="px-3 py-1.5 rounded-lg bg-surface-2 border border-line hover:border-emerald-500/50 text-fg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer hover:bg-surface-3"
                            >
                                <Share2 className="w-3.5 h-3.5 text-accent-fg" />
                                <span>Compartilhar Posição</span>
                            </button>
                        </div>

                        {/* Número da Posição & Perfil & Lucro */}
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex flex-wrap items-center gap-6">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-4xl md:text-5xl font-black text-fg tracking-tight font-mono">
                                        {currentUser.rank === 999 ? '-' : `#${currentUser.rank}`}
                                    </span>
                                    <span className="text-xs text-fg-muted font-medium font-mono">
                                        de {tradersList.length} traders
                                    </span>
                                </div>

                                {/* Tag de Perfil do Usuário com Categoria */}
                                <div className="flex items-center gap-3 bg-surface-2 border border-emerald-500/40 rounded-xl px-4 py-2 shadow-inner">
                                    <TraderAvatar
                                        name={currentUser.name}
                                        username={currentUser.username}
                                        avatarUrl={currentUser.avatarUrl}
                                        size="md"
                                    />
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-fg">{currentUser.name}</span>
                                        <span className="text-xs text-accent-fg font-mono font-medium">@{currentUser.username}</span>
                                    </div>
                                    <div className="ml-2 flex items-center gap-1 bg-emerald-500/15 text-accent-fg border border-emerald-500/30 px-2.5 py-1 rounded-lg text-xs font-bold font-mono">
                                        <Crown className="w-3.5 h-3.5" />
                                        <span>{currentUser.tierLevel}</span>
                                    </div>
                                </div>
                            </div>

                            {/* PnL Líquido em Destaque */}
                            <div className="flex items-center gap-2 bg-surface-2 border border-line px-4 py-2.5 rounded-xl font-mono">
                                <span className="text-xs text-fg-muted">Lucro Total:</span>
                                {Number(currentUser.totalPnL) > 0 ? (
                                    <span className="text-accent-fg font-black text-base">
                                        +${Number(currentUser.totalPnL).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                ) : Number(currentUser.totalPnL) < 0 ? (
                                    <span className="text-danger-fg font-black text-base">
                                        -${Math.abs(Number(currentUser.totalPnL)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                ) : (
                                    <span className="text-fg-muted font-black text-base">$0.00</span>
                                )}
                            </div>
                        </div>

                        {/* Barra de Progresso e Métricas */}
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between text-xs font-medium gap-2">
                                <span className="text-accent-fg font-mono font-semibold flex items-center gap-2">
                                    <span>{currentUser.winRate}% Taxa de Vitória</span>
                                    <span className="w-1 h-1 rounded-full bg-[#6B7280]" />
                                    <span>{currentUser.tradesCount} operações</span>
                                    <span className="w-1 h-1 rounded-full bg-[#6B7280]" />
                                    <span className="text-fg-muted">PF: {Number(currentUser.profitFactor || 0).toFixed(2)}</span>
                                </span>
                                <span className="text-fg-muted font-mono">
                                    {currentUser.rank > 100
                                        ? `Abaixo do Top 100 (< 1.000 ops) • Faltam ${Math.max(0, 1000 - (currentUser.tradesCount || 0))} ops para o Top 100`
                                        : `Classificação Atual: Top ${currentUser.rank} (${currentUser.tier})`}
                                </span>
                            </div>

                            {/* Meta e Progresso para LEGEND (25.000 operações) */}
                            <div className="p-3 rounded-xl bg-canvas-subtle border border-line space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-fg-muted font-medium flex items-center gap-1.5">
                                        <Crown className="w-3.5 h-3.5 text-amber-400" />
                                        <span>Meta para LEGEND: <strong className="text-fg">25.000 operações</strong> + PnL Positivo</span>
                                    </span>
                                    <span className="text-accent-fg font-mono font-bold text-[11px]">
                                        {currentUser.tradesCount || 0} / 25.000 ({Math.min(100, (((currentUser.tradesCount || 0) / 25000) * 100)).toFixed(2)}%)
                                    </span>
                                </div>
                                <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 rounded-full"
                                        style={{ width: `${Math.max(1, Math.min(100, (((currentUser.tradesCount || 0) / 25000) * 100)))}%` }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Badges do Usuário */}
                        <div className="flex flex-wrap gap-2 pt-1">
                            {currentUser.badges?.map((badge: string, idx: number) => (
                                <span 
                                    key={idx} 
                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-accent-fg text-xs font-semibold"
                                >
                                    {badge.includes('Streak') ? <Flame className="w-3.5 h-3.5 text-danger-fg" /> : <Target className="w-3.5 h-3.5 text-amber-400" />}
                                    <span>{badge}</span>
                                </span>
                            ))}
                            {(!currentUser.badges || currentUser.badges.length === 0) && (
                                <span className="text-xs text-fg-subtle font-mono italic">
                                    Nenhuma badge conquistada nesta temporada.
                                </span>
                            )}
                        </div>

                        {/* Pontuação Composta */}
                        <div className="pt-3 border-t border-line space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-fg tracking-wider uppercase">
                                        Pontuação Composta
                                    </span>
                                    <button
                                        onClick={() => setIsScoreInfoOpen(!isScoreInfoOpen)}
                                        className="text-fg-muted hover:text-accent-fg transition-colors cursor-pointer"
                                        title="Como é calculada?"
                                    >
                                        <Info className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                <span className="text-2xl font-black text-accent-fg tracking-tight font-mono">
                                    {currentUser.compositeScore}
                                </span>
                            </div>

                            <div className="h-2 w-full bg-surface-2 rounded-full overflow-hidden border border-line">
                                <div
                                    className="h-full bg-emerald-400 rounded-full shadow-[0_0_10px_#10b981]"
                                    style={{ width: `${Math.min(100, currentUser.compositeScore)}%` }}
                                />
                            </div>

                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted font-mono pt-1">
                                <span>
                                    PnL: <strong className="text-accent-fg">{currentUser.scoreBreakdown?.pnl ?? '0.0'}</strong>
                                </span>
                                <span>
                                    Vol: <strong className="text-fg">{currentUser.scoreBreakdown?.vol ?? '0.0'}</strong>
                                </span>
                                <span>
                                    PF: <strong className="text-fg">{currentUser.scoreBreakdown?.pf ?? '0.0'}</strong>
                                </span>
                                <span>
                                    Cons: <strong className="text-fg">{currentUser.scoreBreakdown?.cons ?? '0.0'}</strong>
                                </span>
                                <span>
                                    WR: <strong className="text-fg">{currentUser.scoreBreakdown?.wr ?? '0.0'}</strong>
                                </span>
                                <span>
                                    R:R: <strong className="text-fg">{currentUser.scoreBreakdown?.rr ?? '0.0'}</strong>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filtros por Categorias (Tiers) */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                    <span className="text-xs font-bold text-fg-muted uppercase tracking-wider mr-2 shrink-0">
                        Categorias
                    </span>

                    <button
                        onClick={() => setSelectedTier('ALL')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 border cursor-pointer ${
                            selectedTier === 'ALL'
                                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm'
                                : 'bg-surface text-fg-muted border-line hover:border-line-strong hover:text-white'
                        }`}
                    >
                        TODAS
                    </button>

                    {Object.entries(TIER_CONFIG).map(([key, config]) => {
                        const Icon = config.icon;
                        const isSelected = selectedTier === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setSelectedTier(isSelected ? 'ALL' : key)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 border cursor-pointer ${
                                    config.bg
                                } ${config.text} ${config.border} ${
                                    isSelected ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-[#08090C]' : ''
                                }`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                <span>{config.label}</span>
                            </button>
                        );
                    })}
                </div>



                {/* Tabela Principal da Classificação */}
                <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-xl">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-line bg-canvas-subtle text-fg-muted font-bold uppercase tracking-wider font-mono">
                                    <th className="py-3.5 px-4 w-12 text-center">#</th>
                                    <th className="py-3.5 px-4">Trader</th>
                                    <th className="py-3.5 px-4">Categoria</th>
                                    <th className="py-3.5 px-4">Taxa de Vitória</th>
                                    <th className="py-3.5 px-4">Fator Lucro</th>
                                    <th className="py-3.5 px-4">Risco/Retorno</th>
                                    <th className="py-3.5 px-4 text-right">Pontuação</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-line font-medium">
                                {isLoadingTraders ? (
                                    <tr>
                                        <td colSpan={7} className="py-12 text-center text-fg-muted text-sm font-mono">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                                                <span>Carregando dados dos traders...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredTraders.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-12 text-center text-fg-subtle text-sm font-mono">
                                            Nenhum trader encontrado com os critérios selecionados.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredTraders.map((trader: any) => {
                                        const tierStyle = TIER_CONFIG[trader.tier] || TIER_CONFIG.GOLD;
                                        const TierIcon = tierStyle.icon;

                                        return (
                                            <tr
                                                key={trader.id || trader.username}
                                                className={`transition-colors duration-150 hover:bg-surface-2 ${
                                                    trader.isCurrentUser
                                                        ? 'bg-emerald-500/[0.08] text-fg border-l-4 border-l-emerald-400'
                                                        : 'text-fg/80'
                                                }`}
                                            >
                                                {/* Posição no Rank */}
                                                <td className="py-4 px-4 text-center font-bold text-sm font-mono">
                                                    <span
                                                        className={`${
                                                            trader.rank === 1
                                                                ? 'text-amber-400 text-base font-black drop-shadow-sm'
                                                                : trader.rank === 2
                                                                ? 'text-fg/80 font-bold'
                                                                : trader.rank === 3
                                                                ? 'text-amber-600 font-bold'
                                                                : trader.rank > 100
                                                                ? 'text-fg-subtle text-xs'
                                                                : 'text-fg-muted'
                                                        }`}
                                                    >
                                                        {trader.rank === 999 ? '-' : `#${trader.rank}`}
                                                    </span>
                                                </td>

                                                {/* Dados do Trader e @username */}
                                                <td className="py-4 px-4">
                                                    <div className="flex items-center gap-3">
                                                        <TraderAvatar
                                                            name={trader.name}
                                                            username={trader.username}
                                                            avatarUrl={trader.avatarUrl}
                                                            size="md"
                                                        />
                                                        <div className="flex flex-col">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-bold text-fg text-sm">{trader.name}</span>
                                                                {trader.badges?.includes('Atirador de Elite') && (
                                                                    <span title="Atirador de Elite" className="inline-flex items-center">
                                                                        <Target className="w-3.5 h-3.5 text-amber-400" />
                                                                    </span>
                                                                )}
                                                                {trader.badges?.includes('Sequência de Aço') && (
                                                                    <span title="Sequência de Aço" className="inline-flex items-center">
                                                                        <Flame className="w-3.5 h-3.5 text-danger-fg" />
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span className="text-[11px] text-emerald-400/90 font-mono">@{trader.username}</span>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Categoria (Tier) */}
                                                <td className="py-4 px-4">
                                                    <div
                                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs ${tierStyle.bg} ${tierStyle.text} border ${tierStyle.border} font-bold font-mono`}
                                                    >
                                                        <TierIcon className="w-3.5 h-3.5" />
                                                        <span>{trader.tierLevel}</span>
                                                    </div>
                                                </td>

                                                {/* Taxa de Vitória */}
                                                <td className="py-4 px-4 font-bold text-accent-fg text-sm font-mono">
                                                    {trader.winRate}%
                                                </td>

                                                {/* Fator de Lucro */}
                                                <td className="py-4 px-4 font-semibold text-fg-muted font-mono">
                                                    {Number(trader.profitFactor).toFixed(2)}
                                                </td>

                                                {/* Risco / Retorno */}
                                                <td className="py-4 px-4 font-semibold text-fg-muted font-mono">
                                                    {Number(trader.riskReward).toFixed(2)}
                                                </td>

                                                {/* Pontuação Composta */}
                                                <td className="py-4 px-4 text-right font-mono">
                                                    <span className="font-bold text-accent-fg text-xs">
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
            </main>



            {/* Modal: Compartilhar Posição */}
            {isShareModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface border border-line-strong rounded-2xl w-full max-w-sm p-6 space-y-5 text-center shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center border-b border-line pb-2">
                            <h3 className="text-sm font-bold text-fg">Compartilhar Posição</h3>
                            <button onClick={() => setIsShareModalOpen(false)} className="text-fg-muted hover:text-fg p-1">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-4 rounded-xl bg-surface-2 border border-emerald-500/30 text-left space-y-3">
                            <div className="flex items-center justify-between font-mono">
                                <span className="text-xs text-fg-muted">Classificação Torex</span>
                                <span className="text-xs font-bold text-accent-fg">Posição #{currentUser.rank}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <img
                                    src={currentUser.avatarUrl}
                                    alt={currentUser.name}
                                    className="w-10 h-10 rounded-full border border-emerald-500"
                                />
                                <div>
                                    <div className="text-sm font-bold text-fg">{currentUser.name}</div>
                                    <div className="text-xs text-accent-fg font-mono">@{currentUser.username}</div>
                                </div>
                            </div>
                            <div className="text-[11px] text-accent-fg font-semibold bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/30 font-mono">
                                🏆 Categoria: {currentUser.tierLevel} | Pontuação: {currentUser.compositeScore}
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(`${window.location.origin}/leaderboard?user=${currentUser.username}`);
                                setIsShareModalOpen(false);
                                showToast('Link copiado para a área de transferência!');
                            }}
                            className="w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400 shadow-md transition-all cursor-pointer"
                        >
                            Copiar Link
                        </button>
                    </div>
                </div>
            )}

            {/* Modal: Informações do Cálculo de Pontuação */}
            {isScoreInfoOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface border border-line-strong rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center border-b border-line pb-3">
                            <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                                <HelpCircle className="w-4 h-4 text-accent-fg" /> Fórmula da Pontuação Composta
                            </h3>
                            <button onClick={() => setIsScoreInfoOpen(false)} className="text-fg-muted hover:text-fg p-1">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <p className="text-xs text-fg-muted leading-relaxed">
                            A Pontuação Composta avalia múltiplos indicadores matemáticos de rentabilidade real, maturidade amostral e disciplina de risco:
                        </p>

                        <ul className="text-xs space-y-2 text-fg/80 font-mono bg-surface-2 p-3.5 rounded-xl border border-line">
                            <li>• <strong className="text-accent-fg">Vol (Volume até 25k - 25%):</strong> Progressão e maturidade até 25.000 operações.</li>
                            <li>• <strong className="text-accent-fg">PnL (Lucro Líquido Real - 25%):</strong> Retorno financeiro acumulado em dólares.</li>
                            <li>• <strong className="text-accent-fg">Cons (Dias Ativos - 20%):</strong> Regularidade operacional e tempo na plataforma.</li>
                            <li>• <strong className="text-accent-fg">WR (Taxa de Vitória - 15%):</strong> Percentual de vitórias sustentadas.</li>
                            <li>• <strong className="text-accent-fg">PF (Fator de Lucro - 10%):</strong> Razão entre lucros brutos e perdas brutas.</li>
                            <li>• <strong className="text-accent-fg">R:R (Risco/Retorno - 10%):</strong> Eficiência na gestão de risco e disciplina.</li>
                            <li>• <strong className="text-accent-fg">Streak (Bônus de Sequência - 5%):</strong> Sequência de vitórias consecutivas.</li>
                        </ul>

                        <button
                            onClick={() => setIsScoreInfoOpen(false)}
                            className="w-full py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-bold text-fg transition-colors cursor-pointer"
                        >
                            Entendido
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Leaderboard;
