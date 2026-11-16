import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Lock,
    MessageSquare,
    TrendingUp,
    UserCheck,
    Users,
    Video,
    WifiOff,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { useOfflineSyncStore } from '../store/useOfflineSyncStore';
import { ChatPartnerTarget, ChatTab } from '../components/network/ChatTab';
import { CommunityTab } from '../components/network/CommunityTab';
import { ProfileTab } from '../components/network/ProfileTab';
import { FeedTab } from '../components/network/FeedTab';
import { LessonsCatalogTab } from '../components/network/LessonsCatalogTab';
import { RightSidebar } from '../components/network/RightSidebar';
import {
    DirectConversationSummary,
    VideoLessonItem,
    VideoLessonsSummary,
} from '../components/network/networkTypes';

interface PostComment {
    id: number | string;
    content: string;
    createdAt?: string;
    user: {
        id?: string;
        username: string;
        name?: string;
        avatarUrl?: string | null;
    };
}

interface Post {
    id: number;
    content: string;
    likesCount: number;
    commentsCount: number;
    isLiked: boolean;
    createdAt: string;
    user: {
        id: string;
        username: string;
        name?: string;
        avatarUrl?: string | null;
    };
    type?: string;
    imageUrl?: string;
    tradeData?: any;
    comments?: PostComment[];
}

interface SuggestedUser {
    id: string;
    username: string;
    avatarUrl?: string;
    name?: string;
}

type NetworkTabId = 'lessons' | 'feed' | 'messages' | 'community' | 'profile';

const VALID_TABS: NetworkTabId[] = [
    'lessons',
    'feed',
    'messages',
    'community',
    'profile',
];

export const Network = () => {
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const isOnline = useOfflineSyncStore((s) => s.isOnline);
    const [searchParams, setSearchParams] = useSearchParams();

    const initialTabParam = searchParams.get('tab') as NetworkTabId | null;
    const [activeTab, setActiveTabState] = useState<NetworkTabId>(
        initialTabParam && VALID_TABS.includes(initialTabParam)
            ? initialTabParam
            : 'lessons'
    );

    const setActiveTab = useCallback(
        (nextTab: NetworkTabId) => {
            setActiveTabState(nextTab);
            setSearchParams({ tab: nextTab }, { replace: true });
        },
        [setSearchParams]
    );

    const [socket, setSocket] = useState<Socket | null>(null);

    // Videoaulas state
    const [lessons, setLessons] = useState<VideoLessonItem[]>([]);
    const [lessonsSummary, setLessonsSummary] = useState<VideoLessonsSummary>({
        totalLessons: 0,
        watchedCount: 0,
        lockedUnwatchedCount: 0,
        completionPercent: 0,
        nextUnwatchedLessonId: null,
    });
    const [lessonsLoading, setLessonsLoading] = useState(true);

    // Comunidade Feed state
    const [posts, setPosts] = useState<Post[]>([]);
    const [trending, setTrending] = useState<Post[]>([]);
    const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
    const [loadingFeed, setLoadingFeed] = useState(true);
    const [feedError, setFeedError] = useState<string | null>(null);

    // Conversas diretas & badge de não lidas
    const [directChatPartner, setDirectChatPartner] =
        useState<ChatPartnerTarget | null>(null);
    const [unreadDirectCount, setUnreadDirectCount] = useState<number>(0);

    const fetchLessons = useCallback(async () => {
        setLessonsLoading(true);
        try {
            const res = await api.get('/network/lessons');
            if (res.data && Array.isArray(res.data.lessons)) {
                setLessons(res.data.lessons);
                if (res.data.summary) {
                    setLessonsSummary(res.data.summary);
                }
            }
        } catch (e) {
            console.error('Erro ao carregar videoaulas:', e);
        } finally {
            setLessonsLoading(false);
        }
    }, []);

    const fetchFeed = useCallback(async () => {
        setLoadingFeed(true);
        setFeedError(null);
        try {
            const res = await api.get('/network/feed');
            if (res.data && Array.isArray(res.data.data)) {
                setPosts(res.data.data);
            } else if (Array.isArray(res.data)) {
                setPosts(res.data);
            } else {
                setPosts([]);
            }
        } catch (e) {
            console.error('Failed to fetch feed', e);
            setFeedError(
                isEn
                    ? 'Unable to load the community feed. Please try again.'
                    : 'Não foi possível carregar o feed da comunidade. Tente novamente.'
            );
        } finally {
            setLoadingFeed(false);
        }
    }, []);

    const fetchTrending = useCallback(async () => {
        try {
            const res = await api.get('/network/trending');
            if (Array.isArray(res.data)) {
                setTrending(res.data);
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    const fetchSuggestions = useCallback(async () => {
        try {
            const res = await api.get('/network/suggestions');
            if (Array.isArray(res.data)) {
                setSuggestions(res.data);
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    const fetchUnreadDirectCount = useCallback(async () => {
        try {
            const res = await api.get('/network/conversations');
            if (Array.isArray(res.data)) {
                const total = (res.data as DirectConversationSummary[]).reduce(
                    (acc, conv) => acc + Number(conv.unreadCount || 0),
                    0
                );
                setUnreadDirectCount(total);
            }
        } catch {
            // ignore silently
        }
    }, []);

    const [loadedGroups, setLoadedGroups] = useState<{
        lessons: boolean;
        community: boolean;
    }>({ lessons: false, community: false });

    useEffect(() => {
        void fetchUnreadDirectCount();
    }, [fetchUnreadDirectCount]);

    useEffect(() => {
        if (activeTab === 'lessons' && !loadedGroups.lessons) {
            setLoadedGroups((prev) => ({ ...prev, lessons: true }));
            void fetchLessons();
        } else if (
            (activeTab === 'feed' || activeTab === 'community') &&
            !loadedGroups.community
        ) {
            setLoadedGroups((prev) => ({ ...prev, community: true }));
            void fetchFeed();
            void fetchTrending();
            void fetchSuggestions();
        }
    }, [
        activeTab,
        loadedGroups.lessons,
        loadedGroups.community,
        fetchLessons,
        fetchFeed,
        fetchTrending,
        fetchSuggestions,
    ]);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;

        const socketUrl = `${window.location.origin}/network`;
        const newSocket = io(socketUrl, {
            auth: { token },
            transports: ['websocket'],
        });

        setSocket(newSocket);

        newSocket.on('newPost', (post: Post) => {
            setPosts((prev) => {
                if (prev.some((p) => p.id === post.id)) return prev;
                return [post, ...prev];
            });
        });

        newSocket.on('interaction', (data: any) => {
            setPosts((prev) =>
                prev.map((p) => {
                    if (p.id !== data.postId) return p;
                    if (data.type === 'like') {
                        return { ...p, likesCount: data.likesCount };
                    }
                    if (data.type === 'comment') {
                        const existingComments = p.comments || [];
                        const alreadyExists =
                            data.comment &&
                            existingComments.some(
                                (c) => String(c.id) === String(data.comment.id)
                            );
                        return {
                            ...p,
                            commentsCount: data.commentsCount,
                            comments:
                                data.comment && !alreadyExists
                                    ? [...existingComments, data.comment]
                                    : existingComments,
                        };
                    }
                    return p;
                })
            );
        });

        newSocket.on('lessonCatalogUpdated', () => {
            void fetchLessons();
        });

        newSocket.on('lessonInteraction', (payload: any) => {
            if (!payload?.lessonId) return;
            setLessons((prev) =>
                prev.map((item) => {
                    if (item.id !== payload.lessonId) return item;
                    if (
                        payload.type === 'like' &&
                        typeof payload.likesCount === 'number'
                    ) {
                        return { ...item, likesCount: payload.likesCount };
                    }
                    if (
                        (payload.type === 'comment' ||
                            payload.type === 'commentDeleted') &&
                        typeof payload.commentsCount === 'number'
                    ) {
                        return { ...item, commentsCount: payload.commentsCount };
                    }
                    return item;
                })
            );
        });

        newSocket.on('dmToClient', (msg: any) => {
            if (msg && msg.senderId && msg.senderId !== user?.id) {
                setUnreadDirectCount((prev) => prev + 1);
            }
        });

        const handleOnline = () => {
            if (!newSocket.connected) {
                newSocket.connect();
            }
            void fetchLessons();
            void fetchUnreadDirectCount();
        };
        window.addEventListener('online', handleOnline);

        return () => {
            window.removeEventListener('online', handleOnline);
            newSocket.disconnect();
        };
    }, [fetchLessons, fetchUnreadDirectCount, user?.id]);

    const handleCreatePost = async (
        content: string,
        options?: { imageUrl?: string; type?: string }
    ) => {
        if (!content.trim() && !options?.imageUrl) return;
        try {
            await api.post('/network/post', {
                content,
                imageUrl: options?.imageUrl,
                type: options?.type || 'text',
            });
        } catch (e) {
            console.error(e);
        }
    };

    const handleLike = async (postId: number) => {
        setPosts((prev) =>
            prev.map((p) => {
                if (p.id === postId) {
                    return {
                        ...p,
                        isLiked: !p.isLiked,
                        likesCount: p.isLiked
                            ? Math.max(0, p.likesCount - 1)
                            : p.likesCount + 1,
                    };
                }
                return p;
            })
        );

        try {
            await api.post(`/network/post/${postId}/like`);
        } catch {
            void fetchFeed();
        }
    };

    const handleCommentAdded = (postId: number, comment: PostComment) => {
        setPosts((prev) =>
            prev.map((p) => {
                if (p.id !== postId) return p;
                const current = p.comments || [];
                if (current.some((c) => String(c.id) === String(comment.id))) {
                    return p;
                }
                return {
                    ...p,
                    commentsCount: (p.commentsCount || 0) + 1,
                    comments: [...current, comment],
                };
            })
        );
    };

    const handleDeletePost = (postId: number) => {
        setPosts((prev) => prev.filter((p) => p.id !== postId));
    };

    const handleOpenDirectChat = (partner: ChatPartnerTarget) => {
        setDirectChatPartner(partner);
        setActiveTab('messages');
    };

    const unwatchedLessons = useMemo(
        () => lessons.filter((l) => !l.isWatched),
        [lessons]
    );

    const showRightSidebar =
        activeTab === 'feed' ||
        activeTab === 'community' ||
        activeTab === 'profile';

    return (
        <div className="h-[calc(100vh-5.5rem)] flex flex-col gap-3">
            {!isOnline && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-300">
                    <WifiOff className="h-4 w-4 shrink-0" />
                    <span>
                        {isEn
                            ? 'You are offline. Cached lessons, threads, and chat messages remain readable, while new posts, likes, and live chat require an internet connection.'
                            : 'Você está offline. Aulas, tópicos e mensagens em cache continuam legíveis, mas novas publicações, curtidas e chat ao vivo exigem conexão com a internet.'}
                    </span>
                </div>
            )}
            {/* Header & Navegação Integrada: Videoaulas + Comunidade + Conversas */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1 p-1 bg-surface rounded-xl w-full md:w-fit border border-line overflow-x-auto no-scrollbar">
                    {[
                        {
                            id: 'lessons' as NetworkTabId,
                            label: isEn ? 'Video Lessons' : 'Videoaulas',
                            icon: Video,
                            badge:
                                lessonsSummary.lockedUnwatchedCount > 0
                                    ? lessonsSummary.lockedUnwatchedCount
                                    : null,
                            badgeTone: 'warning' as const,
                        },
                        {
                            id: 'feed' as NetworkTabId,
                            label: isEn ? 'Community' : 'Comunidade',
                            icon: TrendingUp,
                            badge: null,
                            badgeTone: 'accent' as const,
                        },
                        {
                            id: 'messages' as NetworkTabId,
                            label: isEn ? 'Messages' : 'Conversas',
                            icon: MessageSquare,
                            badge:
                                unreadDirectCount > 0 ? unreadDirectCount : null,
                            badgeTone: 'accent' as const,
                        },
                        {
                            id: 'community' as NetworkTabId,
                            label: 'Traders',
                            icon: Users,
                            badge: null,
                            badgeTone: 'accent' as const,
                        },
                        {
                            id: 'profile' as NetworkTabId,
                            label: isEn ? 'My Profile' : 'Meu Perfil',
                            icon: UserCheck,
                            badge: null,
                            badgeTone: 'accent' as const,
                        },
                    ].map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`whitespace-nowrap h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                                    isActive
                                        ? 'bg-surface-2 text-fg border border-line-subtle shadow-sm'
                                        : 'text-fg-muted hover:text-fg'
                                }`}
                            >
                                <Icon
                                    size={13}
                                    className={isActive ? 'text-accent-fg' : ''}
                                />
                                <span>{tab.label}</span>

                                {tab.badge !== null && (
                                    <span
                                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                                            tab.badgeTone === 'warning'
                                                ? 'bg-warning/15 border border-warning/35 text-warning'
                                                : 'bg-accent text-accent-on'
                                        }`}
                                    >
                                        {tab.badgeTone === 'warning' && (
                                            <Lock size={9} />
                                        )}
                                        {tab.badge}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Indicador rápido de urgência quando há aulas bloqueadas e usuário está em outra aba */}
                {activeTab !== 'lessons' &&
                    lessonsSummary.lockedUnwatchedCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setActiveTab('lessons')}
                            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning/10 hover:bg-warning/20 border border-warning/35 text-warning text-[11px] font-bold transition-colors cursor-pointer"
                        >
                            <Lock size={12} />
                            <span>
                                {lessonsSummary.lockedUnwatchedCount}{' '}
                                {isEn
                                    ? lessonsSummary.lockedUnwatchedCount === 1
                                        ? 'locked lesson awaiting view'
                                        : 'locked lessons awaiting view'
                                    : lessonsSummary.lockedUnwatchedCount === 1
                                    ? 'videoaula bloqueada aguardando visualização'
                                    : 'videoaulas bloqueadas aguardando visualização'}
                            </span>
                        </button>
                    )}
            </div>

            {/* Área Principal & Sidebar Direita */}
            <div className="flex gap-3 flex-1 min-h-0">
                <div className="flex-1 overflow-hidden h-full flex flex-col min-w-0">
                    {activeTab === 'lessons' && (
                        <LessonsCatalogTab
                            lessons={lessons}
                            summary={lessonsSummary}
                            loading={lessonsLoading}
                        />
                    )}

                    {activeTab === 'feed' && (
                        <FeedTab
                            posts={posts}
                            loading={loadingFeed}
                            error={feedError}
                            suggestions={suggestions}
                            featuredUnwatchedLessons={unwatchedLessons}
                            onOpenAllLessons={() => setActiveTab('lessons')}
                            handleCreatePost={handleCreatePost}
                            handleLike={handleLike}
                            onCommentAdded={handleCommentAdded}
                            onDeletePost={handleDeletePost}
                            onMessageUser={handleOpenDirectChat}
                        />
                    )}

                    {activeTab === 'messages' && (
                        <ChatTab
                            socket={socket}
                            initialPartner={directChatPartner}
                            onClearInitialPartner={() =>
                                setDirectChatPartner(null)
                            }
                            onUnreadChange={setUnreadDirectCount}
                        />
                    )}

                    {activeTab === 'community' && (
                        <CommunityTab onMessageUser={handleOpenDirectChat} />
                    )}

                    {activeTab === 'profile' && <ProfileTab />}
                </div>

                {showRightSidebar && (
                    <div className="hidden xl:block shrink-0">
                        <RightSidebar
                            trending={trending}
                            suggestions={suggestions}
                            unwatchedLessons={unwatchedLessons}
                            onOpenChat={() => setActiveTab('messages')}
                            onOpenLessons={() => setActiveTab('lessons')}
                            onMessageUser={handleOpenDirectChat}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
