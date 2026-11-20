import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Flame,
    Heart,
    Lock,
    MessageSquare,
    TrendingUp,
    Users,
} from 'lucide-react';
import { VideoLessonItem } from './networkTypes';
import { ChatPartnerTarget } from './ChatTab';
import { useLocale } from '../../context/LocaleContext';

interface SuggestedUser {
    id: string;
    username: string;
    avatarUrl?: string;
    name?: string;
}

interface Post {
    id: number;
    content: string;
    likesCount: number;
    user: {
        username: string;
    };
}

interface RightSidebarProps {
    trending: Post[];
    suggestions: SuggestedUser[];
    unwatchedLessons?: VideoLessonItem[];
    onOpenChat?: () => void;
    onOpenLessons?: () => void;
    onMessageUser?: (partner: ChatPartnerTarget) => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
    trending,
    suggestions,
    unwatchedLessons = [],
    onOpenChat,
    onOpenLessons,
    onMessageUser,
}) => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';

    return (
        <div className="w-72 flex flex-col gap-3 flex-shrink-0 overflow-y-auto custom-scrollbar pr-0.5">
            {/* Widget de Urgência: Aulas Bloqueadas (Não Assistidas) */}
            {unwatchedLessons.length > 0 && (
                <div className="bg-surface border border-warning/35 rounded-xl p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-warning flex items-center gap-1.5">
                            <Flame size={13} />
                            <span>{isEn ? 'Locked Lessons' : 'Aulas Bloqueadas'}</span>
                        </h3>
                        <span className="px-1.5 py-0.2 rounded-full bg-warning/20 text-warning text-[10px] font-extrabold tabular-nums">
                            {unwatchedLessons.length}
                        </span>
                    </div>

                    <p className="text-[11px] text-fg-muted leading-snug">
                        {isEn
                            ? 'Watch now to unlock the badge and advance in your track:'
                            : 'Assista agora para remover o bloqueio e avançar na trilha:'}
                    </p>

                    <div className="space-y-1.5">
                        {unwatchedLessons.slice(0, 3).map((l) => (
                            <button
                                key={l.id}
                                type="button"
                                onClick={() => navigate(`/network/watch/${l.id}`)}
                                className="w-full p-2.5 rounded-lg bg-canvas-subtle hover:bg-surface-2 border border-warning/20 text-left flex items-start gap-2 transition-colors cursor-pointer"
                            >
                                <Lock
                                    size={12}
                                    className="text-warning mt-0.5 shrink-0"
                                />
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-fg line-clamp-1">
                                        {l.title}
                                    </p>
                                    <span className="text-[10px] text-warning font-bold">
                                        {isEn ? 'Unlock in player →' : 'Desbloquear no player →'}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>

                    {onOpenLessons && (
                        <button
                            type="button"
                            onClick={onOpenLessons}
                            className="w-full h-8 rounded-lg bg-warning/15 hover:bg-warning/25 border border-warning/30 text-warning text-xs font-bold transition-colors cursor-pointer"
                        >
                            {isEn ? 'View All Video Lessons' : 'Ver Todas as Videoaulas'}
                        </button>
                    )}
                </div>
            )}

            {/* Destaques da Comunidade */}
            <div className="bg-surface border border-line rounded-xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-fg mb-3 flex items-center gap-1.5">
                    <TrendingUp size={13} className="text-accent-fg" /> {isEn ? 'Trending' : 'Destaques'}
                </h3>
                <div className="space-y-2">
                    {trending.length === 0 ? (
                        <p className="text-fg-subtle text-xs">
                            {isEn ? 'No highlights today.' : 'Nenhum destaque hoje.'}
                        </p>
                    ) : (
                        trending.slice(0, 4).map((t) => (
                            <div
                                key={t.id}
                                className="p-2.5 bg-canvas-subtle hover:bg-surface-2 transition-colors border border-line-subtle rounded-lg"
                            >
                                <p className="text-[11px] text-accent-fg font-mono font-semibold mb-0.5">
                                    @{t.user?.username || 'trader'}
                                </p>
                                <p className="text-xs text-fg line-clamp-2 leading-relaxed">
                                    {t.content}
                                </p>
                                <div className="flex gap-2 mt-1.5 text-[10px] text-fg-subtle font-semibold tabular-nums">
                                    <span className="flex items-center gap-1">
                                        <Heart
                                            size={10}
                                            className="text-danger-fg"
                                        />{' '}
                                        {t.likesCount}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Traders Ativos para Conversar */}
            {suggestions.length > 0 && (
                <div className="bg-surface border border-line rounded-xl p-4 space-y-2.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-fg flex items-center gap-1.5">
                        <Users size={13} className="text-accent-fg" />
                        <span>{isEn ? 'Message Traders' : 'Conversar com Traders'}</span>
                    </h4>

                    <div className="space-y-2">
                        {suggestions.slice(0, 4).map((s) => (
                            <div
                                key={s.id}
                                className="flex items-center justify-between gap-2"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-7 h-7 rounded-full bg-surface-2 border border-line flex items-center justify-center text-[10px] font-bold text-fg overflow-hidden shrink-0">
                                        {s.avatarUrl ? (
                                            <img
                                                src={s.avatarUrl}
                                                alt={s.username}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            s.username?.[0]?.toUpperCase()
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold text-fg truncate font-mono">
                                            @{s.username}
                                        </p>
                                        <p className="text-[10px] text-fg-subtle truncate">
                                            {isEn ? 'Community Trader' : 'Trader'}
                                        </p>
                                    </div>
                                </div>

                                {onMessageUser && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onMessageUser({
                                                id: s.id,
                                                username: s.username,
                                                avatarUrl: s.avatarUrl,
                                            })
                                        }
                                        className="p-1.5 rounded-lg bg-surface-2 hover:bg-accent hover:text-accent-on border border-line text-accent-fg transition-colors cursor-pointer shrink-0"
                                        title={isEn ? `Message @${s.username}` : `Conversar com @${s.username}`}
                                    >
                                        <MessageSquare size={13} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={onOpenChat}
                        className="w-full h-8 bg-surface-2 hover:bg-surface-3 border border-line text-fg rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                        {isEn ? 'Open Rooms & Direct Chats' : 'Abrir Salas & Conversas'}
                    </button>
                </div>
            )}
        </div>
    );
};
