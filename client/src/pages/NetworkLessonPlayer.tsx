import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
    ArrowLeft,
    Check,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Clock,
    Copy,
    Eye,
    FastForward,
    Flame,
    Heart,
    Loader2,
    Lock,
    Maximize2,
    MessageCircle,
    Minimize2,
    Pause,
    Play,
    Rewind,
    Send,
    Trash2,
    Video,
    Volume2,
    VolumeX,
} from 'lucide-react';
import api from '../api';
import { LessonPlayerSkeleton } from '../components/ui/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import {
    LessonCommentItem,
    VideoLessonItem,
    VideoLessonsSummary,
} from '../components/network/networkTypes';

function formatDurationSeconds(sec: number): string {
    if (!Number.isFinite(sec) || sec < 0) return '00:00';
    const total = Math.floor(sec);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const NetworkLessonPlayer: React.FC = () => {
    const { lessonId } = useParams<{ lessonId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';

    const [lesson, setLesson] = useState<VideoLessonItem | null>(null);
    const [comments, setComments] = useState<LessonCommentItem[]>([]);
    const [playlist, setPlaylist] = useState<VideoLessonItem[]>([]);
    const [summary, setSummary] = useState<VideoLessonsSummary>({
        totalLessons: 0,
        watchedCount: 0,
        lockedUnwatchedCount: 0,
        completionPercent: 0,
        nextUnwatchedLessonId: null,
    });
    const [navigationIds, setNavigationIds] = useState<{
        prevLessonId: string | null;
        nextLessonId: string | null;
    }>({ prevLessonId: null, nextLessonId: null });

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [theaterMode, setTheaterMode] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [expandDescription, setExpandDescription] = useState(false);

    // Comentários
    const [commentInput, setCommentInput] = useState('');
    const [submittingComment, setSubmittingComment] = useState(false);

    // Controles nativos para streams diretos (.mp4 / .webm)
    const playerContainerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState<number>(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    const markWatchedServer = useCallback(
        async (targetId: string, watchedState: boolean) => {
            try {
                await api.post(`/network/lessons/${targetId}/watch`, {
                    isWatched: watchedState,
                });
                setLesson((prev) =>
                    prev && prev.id === targetId
                        ? { ...prev, isWatched: watchedState }
                        : prev
                );
                setPlaylist((prev) => {
                    const updated = prev.map((item) =>
                        item.id === targetId
                            ? { ...item, isWatched: watchedState }
                            : item
                    );
                    const total = updated.length;
                    const watched = updated.filter((i) => i.isWatched).length;
                    const nextUnwatched =
                        updated.find((i) => !i.isWatched)?.id || null;
                    setSummary({
                        totalLessons: total,
                        watchedCount: watched,
                        lockedUnwatchedCount: Math.max(0, total - watched),
                        completionPercent:
                            total > 0 ? Math.round((watched / total) * 100) : 0,
                        nextUnwatchedLessonId: nextUnwatched,
                    });
                    return updated;
                });
            } catch {
                // Silencioso
            }
        },
        []
    );

    const loadLesson = useCallback(async () => {
        if (!lessonId) return;
        setLoading(true);
        setError(null);
        setIframeLoaded(false);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);

        try {
            const res = await api.get(`/network/lessons/${lessonId}`);
            const loadedLesson: VideoLessonItem = res.data.lesson;
            setLesson(loadedLesson);
            setComments(
                Array.isArray(res.data.comments) ? res.data.comments : []
            );
            setPlaylist(
                Array.isArray(res.data.playlist) ? res.data.playlist : []
            );
            if (res.data.summary) {
                setSummary(res.data.summary);
            }
            if (res.data.navigation) {
                setNavigationIds(res.data.navigation);
            }
        } catch {
            setError(isEn ? 'Unable to load this video lesson.' : 'Não foi possível carregar esta videoaula.');
        } finally {
            setLoading(false);
        }
    }, [lessonId]);

    useEffect(() => {
        void loadLesson();
    }, [loadLesson]);

    // Ao permanecer no player dedicado por 3.5s, desbloqueia automaticamente o selo "Não Assistido"
    useEffect(() => {
        if (!lesson || lesson.isWatched) return;
        const timer = window.setTimeout(() => {
            void markWatchedServer(lesson.id, true);
        }, 3500);
        return () => window.clearTimeout(timer);
    }, [lesson, markWatchedServer]);

    // Atualizações em tempo real de Likes e Comentários via Socket.IO
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token || !lessonId) return;

        const socket = io(`${window.location.origin}/network`, {
            auth: { token },
            transports: ['websocket'],
        });

        socket.on('lessonInteraction', (payload: any) => {
            if (!payload || payload.lessonId !== lessonId) return;

            if (payload.type === 'like') {
                setLesson((prev) =>
                    prev ? { ...prev, likesCount: payload.likesCount } : prev
                );
            } else if (payload.type === 'comment' && payload.comment) {
                setLesson((prev) =>
                    prev
                        ? { ...prev, commentsCount: payload.commentsCount }
                        : prev
                );
                setComments((prev) => {
                    if (prev.some((c) => c.id === payload.comment.id)) {
                        return prev;
                    }
                    return [payload.comment, ...prev];
                });
            } else if (payload.type === 'comment_deleted') {
                setLesson((prev) =>
                    prev
                        ? { ...prev, commentsCount: payload.commentsCount }
                        : prev
                );
                setComments((prev) =>
                    prev.filter((c) => c.id !== payload.commentId)
                );
            }
        });

        return () => {
            socket.disconnect();
        };
    }, [lessonId]);

    const handleToggleLike = async () => {
        if (!lesson) return;
        const nextLiked = !lesson.isLiked;
        const nextCount = Math.max(
            0,
            (lesson.likesCount || 0) + (nextLiked ? 1 : -1)
        );

        setLesson({
            ...lesson,
            isLiked: nextLiked,
            likesCount: nextCount,
        });

        try {
            const res = await api.post(`/network/lessons/${lesson.id}/like`);
            setLesson((prev) =>
                prev
                    ? {
                          ...prev,
                          isLiked: Boolean(res.data.liked),
                          likesCount: Number(res.data.likesCount ?? nextCount),
                      }
                    : prev
            );
        } catch {
            // Reverte caso falhe
            void loadLesson();
        }
    };

    const handleSubmitComment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!lesson || !commentInput.trim() || submittingComment) return;

        setSubmittingComment(true);
        try {
            const res = await api.post(
                `/network/lessons/${lesson.id}/comments`,
                {
                    content: commentInput.trim(),
                }
            );
            const created: LessonCommentItem | undefined = res.data?.comment;
            if (created) {
                setComments((prev) =>
                    prev.some((c) => c.id === created.id)
                        ? prev
                        : [created, ...prev]
                );
            }
            if (typeof res.data?.commentsCount === 'number') {
                setLesson((prev) =>
                    prev
                        ? { ...prev, commentsCount: res.data.commentsCount }
                        : prev
                );
            }
            setCommentInput('');
        } catch {
            // ignore
        } finally {
            setSubmittingComment(false);
        }
    };

    const handleDeleteComment = async (commentId: string) => {
        if (!lesson) return;
        try {
            const res = await api.delete(
                `/network/lessons/${lesson.id}/comments/${commentId}`
            );
            setComments((prev) => prev.filter((c) => c.id !== commentId));
            if (typeof res.data?.commentsCount === 'number') {
                setLesson((prev) =>
                    prev
                        ? { ...prev, commentsCount: res.data.commentsCount }
                        : prev
                );
            }
        } catch {
            // ignore
        }
    };

    const handleCopyShareLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopiedLink(true);
            window.setTimeout(() => setCopiedLink(false), 2000);
        } catch {
            // ignore
        }
    };

    // Controles nativos para vídeo direto
    const toggleNativePlay = () => {
        const el = videoRef.current;
        if (!el) return;
        if (el.paused) {
            void el.play();
        } else {
            el.pause();
        }
    };

    const skipSeconds = (delta: number) => {
        const el = videoRef.current;
        if (!el) return;
        el.currentTime = Math.min(
            Math.max(0, el.currentTime + delta),
            el.duration || 0
        );
    };

    const cycleSpeed = () => {
        const speeds = [1, 1.25, 1.5, 2];
        const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
        setPlaybackRate(next);
        if (videoRef.current) {
            videoRef.current.playbackRate = next;
        }
    };

    const toggleFullscreen = () => {
        const container = playerContainerRef.current;
        if (!container) return;
        if (document.fullscreenElement) {
            void document.exitFullscreen();
        } else {
            void container.requestFullscreen?.();
        }
    };

    const descriptionLines = useMemo(() => {
        const raw = String(lesson?.description || '').trim();
        if (!raw) return [];
        return raw.split('\n');
    }, [lesson?.description]);

    const isLongDescription = (lesson?.description?.length || 0) > 420;

    if (loading) {
        return <LessonPlayerSkeleton />;
    }

    if (error || !lesson) {
        return (
            <div className="max-w-xl mx-auto mt-12 rounded-xl bg-surface border border-line p-6 text-center space-y-3">
                <Video className="w-8 h-8 text-fg-subtle mx-auto" />
                <p className="text-sm font-bold text-fg">
                    {error || (isEn ? 'Video lesson not found.' : 'Videoaula não encontrada.')}
                </p>
                <button
                    type="button"
                    onClick={() => navigate('/network')}
                    className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-accent text-accent-on text-xs font-bold cursor-pointer"
                >
                    <ArrowLeft size={14} />
                    Voltar para Comunidade & Aulas
                </button>
            </div>
        );
    }

    return (
        <div className="pb-10 space-y-4">
            {/* Barra Superior de Navegação do Player Dedicado */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-surface border border-line rounded-xl px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                    <button
                        type="button"
                        onClick={() => navigate('/network')}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-xs font-semibold text-fg transition-colors cursor-pointer shrink-0"
                    >
                        <ArrowLeft size={14} />
                        <span>{isEn ? 'Community & Lessons' : 'Comunidade & Aulas'}</span>
                    </button>

                    <div className="hidden sm:flex items-center gap-2 min-w-0 text-xs">
                        <span className="px-2 py-0.5 rounded bg-accent/15 text-accent-fg border border-accent/25 font-bold shrink-0">
                            {isEn ? 'Lesson' : 'Aula'} #{String(lesson.sequenceNumber || 1).padStart(2, '0')}
                        </span>
                        <span className="text-fg-muted truncate">
                            {lesson.category}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setTheaterMode((prev) => !prev)}
                        className="hidden lg:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-xs font-medium text-fg-muted hover:text-fg transition-colors cursor-pointer"
                        title={isEn ? 'Toggle Theater Mode' : 'Alternar Modo Cinema'}
                    >
                        {theaterMode ? (
                            <>
                                <Minimize2 size={13} />
                                <span>{isEn ? 'Default View' : 'Modo Padrão'}</span>
                            </>
                        ) : (
                            <>
                                <Maximize2 size={13} />
                                <span>{isEn ? 'Theater Mode' : 'Modo Cinema'}</span>
                            </>
                        )}
                    </button>

                    <button
                        type="button"
                        disabled={!navigationIds.prevLessonId}
                        onClick={() =>
                            navigationIds.prevLessonId &&
                            navigate(`/network/watch/${navigationIds.prevLessonId}`)
                        }
                        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 disabled:opacity-40 border border-line text-xs font-semibold text-fg transition-colors cursor-pointer disabled:cursor-not-allowed"
                    >
                        <ChevronLeft size={14} />
                        <span className="hidden sm:inline">{isEn ? 'Previous' : 'Anterior'}</span>
                    </button>

                    <button
                        type="button"
                        disabled={!navigationIds.nextLessonId}
                        onClick={() =>
                            navigationIds.nextLessonId &&
                            navigate(`/network/watch/${navigationIds.nextLessonId}`)
                        }
                        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-on text-xs font-bold transition-colors cursor-pointer disabled:cursor-not-allowed"
                    >
                        <span className="hidden sm:inline">{isEn ? 'Next Lesson' : 'Próxima Aula'}</span>
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            {/* Layout Principal: Palco do Vídeo + Descrição + Comentários | Trilha Lateral */}
            <div
                className={`grid gap-4 ${
                    theaterMode
                        ? 'grid-cols-1'
                        : 'grid-cols-1 xl:grid-cols-12 items-start'
                }`}
            >
                {/* Coluna Principal do Player */}
                <div
                    className={`${
                        theaterMode ? 'w-full' : 'xl:col-span-8'
                    } space-y-4 min-w-0`}
                >
                    {/* PLAYER DEDICADO ROBUSTO */}
                    <div
                        ref={playerContainerRef}
                        className="rounded-2xl overflow-hidden bg-black border border-line shadow-xl relative"
                    >
                        <div className="relative aspect-video w-full bg-black">
                            {lesson.embedType === 'iframe' ? (
                                <>
                                    {!iframeLoaded && (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas text-xs text-fg-muted z-10">
                                            <Loader2 className="w-6 h-6 animate-spin text-accent" />
                                            <span>{isEn ? 'Loading secure stream...' : 'Carregando transmissão segura...'}</span>
                                        </div>
                                    )}
                                    <iframe
                                        key={lesson.embedUrl}
                                        src={lesson.embedUrl}
                                        title={lesson.title}
                                        onLoad={() => setIframeLoaded(true)}
                                        className="w-full h-full border-0"
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                                        allowFullScreen
                                    />
                                </>
                            ) : (
                                <>
                                    <video
                                        ref={videoRef}
                                        key={lesson.embedUrl}
                                        src={lesson.embedUrl}
                                        poster={lesson.thumbnailUrl || undefined}
                                        playsInline
                                        onClick={toggleNativePlay}
                                        onPlay={() => setIsPlaying(true)}
                                        onPause={() => setIsPlaying(false)}
                                        onTimeUpdate={(e) =>
                                            setCurrentTime(
                                                e.currentTarget.currentTime
                                            )
                                        }
                                        onLoadedMetadata={(e) =>
                                            setDuration(e.currentTarget.duration)
                                        }
                                        onEnded={() => {
                                            setIsPlaying(false);
                                            void markWatchedServer(
                                                lesson.id,
                                                true
                                            );
                                        }}
                                        className="w-full h-full object-contain cursor-pointer"
                                    />

                                    {/* Barra de Controlo Customizada para Vídeo Nativo */}
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pt-8 pb-3 space-y-2">
                                        <input
                                            type="range"
                                            min={0}
                                            max={duration || 100}
                                            step={0.1}
                                            value={currentTime}
                                            onChange={(e) => {
                                                const val = Number(e.target.value);
                                                setCurrentTime(val);
                                                if (videoRef.current) {
                                                    videoRef.current.currentTime = val;
                                                }
                                            }}
                                            className="w-full h-1.5 accent-emerald-500 cursor-pointer"
                                        />

                                        <div className="flex items-center justify-between gap-3 text-white text-xs">
                                            <div className="flex items-center gap-2.5">
                                                <button
                                                    type="button"
                                                    onClick={toggleNativePlay}
                                                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
                                                >
                                                    {isPlaying ? (
                                                        <Pause size={15} />
                                                    ) : (
                                                        <Play size={15} />
                                                    )}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => skipSeconds(-10)}
                                                    className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
                                                    title={isEn ? 'Rewind 10s' : 'Voltar 10s'}
                                                >
                                                    <Rewind size={14} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => skipSeconds(10)}
                                                    className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
                                                    title={isEn ? 'Forward 10s' : 'Avançar 10s'}
                                                >
                                                    <FastForward size={14} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const nextMute = !isMuted;
                                                        setIsMuted(nextMute);
                                                        if (videoRef.current) {
                                                            videoRef.current.muted =
                                                                nextMute;
                                                        }
                                                    }}
                                                    className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
                                                >
                                                    {isMuted ? (
                                                        <VolumeX size={15} />
                                                    ) : (
                                                        <Volume2 size={15} />
                                                    )}
                                                </button>
                                                <span className="font-mono text-[11px] tabular-nums text-white/85">
                                                    {formatDurationSeconds(
                                                        currentTime
                                                    )}{' '}
                                                    /{' '}
                                                    {formatDurationSeconds(
                                                        duration
                                                    )}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={cycleSpeed}
                                                    className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 font-mono text-[11px] font-bold cursor-pointer"
                                                    title={isEn ? 'Playback speed' : 'Velocidade de reprodução'}
                                                >
                                                    {playbackRate}x
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={toggleFullscreen}
                                                    className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
                                                    title={isEn ? 'Fullscreen' : 'Ecrã inteiro'}
                                                >
                                                    <Maximize2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* CABEÇALHO DA AULA, LIKES, STATUS DESBLOQUEADO E DESCRIÇÃO */}
                    <div className="rounded-xl bg-surface border border-line p-4 sm:p-5 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div className="space-y-1.5 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                    <span className="px-2 py-0.5 rounded-md bg-surface-2 border border-line text-fg-muted font-semibold">
                                        {lesson.category}
                                    </span>
                                    {lesson.durationLabel && (
                                        <span className="inline-flex items-center gap-1 text-fg-subtle font-mono">
                                            <Clock size={11} />
                                            {lesson.durationLabel}
                                        </span>
                                    )}
                                    <span className="inline-flex items-center gap-1 text-fg-subtle tabular-nums">
                                        <Eye size={12} />
                                        {lesson.viewsCount} {isEn ? 'views' : 'visualizações'}
                                    </span>
                                </div>

                                <h1 className="text-base sm:text-lg font-bold text-fg leading-snug">
                                    {lesson.title}
                                </h1>
                            </div>

                            {/* Botões de Ação (Like, Desbloqueado/Assistido, Partilhar) */}
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => void handleToggleLike()}
                                    className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border text-xs font-bold transition-all cursor-pointer tabular-nums ${
                                        lesson.isLiked
                                            ? 'bg-danger/15 border-danger/40 text-danger-fg'
                                            : 'bg-surface-2 hover:bg-surface-3 border-line text-fg'
                                    }`}
                                >
                                    <Heart
                                        size={14}
                                        fill={
                                            lesson.isLiked
                                                ? 'currentColor'
                                                : 'none'
                                        }
                                    />
                                    <span>{isEn ? 'Like' : 'Gostei'}</span>
                                    <span className="px-1.5 py-0.2 rounded bg-canvas/60 text-[11px]">
                                        {lesson.likesCount || 0}
                                    </span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() =>
                                        void markWatchedServer(
                                            lesson.id,
                                            !lesson.isWatched
                                        )
                                    }
                                    className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                                        lesson.isWatched
                                            ? 'bg-emerald-600/15 border-emerald-500/40 text-accent-fg'
                                            : 'bg-warning/15 border-warning/40 text-warning'
                                    }`}
                                >
                                    {lesson.isWatched ? (
                                        <>
                                            <CheckCircle2 size={14} />
                                            <span>{isEn ? 'Lesson Watched' : 'Aula Assistida'}</span>
                                        </>
                                    ) : (
                                        <>
                                            <Lock size={13} />
                                            <span>{isEn ? 'Mark as Watched' : 'Desbloquear Aula'}</span>
                                        </>
                                    )}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => void handleCopyShareLink()}
                                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-surface-2 hover:bg-surface-3 border border-line text-xs font-semibold text-fg-muted hover:text-fg transition-colors cursor-pointer"
                                    title={isEn ? 'Copy direct link to this lesson' : 'Copiar link direto desta aula'}
                                >
                                    {copiedLink ? (
                                        <>
                                            <Check
                                                size={13}
                                                className="text-accent-fg"
                                            />
                                            <span className="text-accent-fg">
                                                {isEn ? 'Copied' : 'Copiado'}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy size={13} />
                                            <span>Link</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Caixa Robusta de Descrição da Aula */}
                        <div className="rounded-xl bg-canvas-subtle border border-line-subtle p-3.5 sm:p-4 space-y-2">
                            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
                                <span>{isEn ? 'Lesson Overview' : 'Descrição da Aula'}</span>
                                <span>
                                    {isEn ? 'Published' : 'Publicada em'}{' '}
                                    {new Date(lesson.createdAt).toLocaleDateString(
                                        isEn ? 'en-US' : 'pt-BR'
                                    )}
                                </span>
                            </div>

                            {descriptionLines.length === 0 ? (
                                <p className="text-xs text-fg-muted leading-relaxed">
                                    {isEn
                                        ? 'Follow the key execution concepts covered in this lesson and use the discussion below to share questions or insights with fellow traders.'
                                        : 'Acompanhe os pontos práticos desta aula e utilize os comentários abaixo para partilhar dúvidas ou insights com outros traders da comunidade.'}
                                </p>
                            ) : (
                                <div
                                    className={`space-y-1.5 text-xs sm:text-[13px] text-fg leading-relaxed ${
                                        !expandDescription && isLongDescription
                                            ? 'max-h-36 overflow-hidden relative'
                                            : ''
                                    }`}
                                >
                                    {descriptionLines.map((line, i) =>
                                        line.trim() === '' ? (
                                            <div key={i} className="h-1" />
                                        ) : (
                                            <p
                                                key={i}
                                                className="whitespace-pre-wrap break-words text-fg-muted"
                                            >
                                                {line}
                                            </p>
                                        )
                                    )}
                                </div>
                            )}

                            {isLongDescription && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        setExpandDescription((prev) => !prev)
                                    }
                                    className="text-xs font-bold text-accent-fg hover:underline cursor-pointer pt-1"
                                >
                                    {expandDescription
                                        ? isEn
                                            ? 'Show less'
                                            : 'Mostrar menos'
                                        : isEn
                                        ? 'Read full description'
                                        : 'Ler descrição completa'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* SECÇÃO DEDICADA DE COMENTÁRIOS DA VIDEOAULA */}
                    <div className="rounded-xl bg-surface border border-line p-4 sm:p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-bold text-fg flex items-center gap-2">
                                <MessageCircle
                                    size={16}
                                    className="text-accent-fg"
                                />
                                <span>
                                    {isEn ? 'Lesson Discussion' : 'Comentários da Aula'} ({lesson.commentsCount || comments.length})
                                </span>
                            </h2>
                        </div>

                        {/* Formulário de Novo Comentário */}
                        <form
                            onSubmit={handleSubmitComment}
                            className="flex items-start gap-2.5"
                        >
                            <div className="w-8 h-8 rounded-full bg-surface-2 border border-line-strong flex items-center justify-center text-xs font-bold text-fg overflow-hidden shrink-0 mt-0.5">
                                {user?.avatarUrl ? (
                                    <img
                                        src={user.avatarUrl}
                                        alt={user.username || 'Avatar'}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <span>
                                        {(user?.name || user?.username || 'T')[0]?.toUpperCase()}
                                    </span>
                                )}
                            </div>

                            <div className="flex-1 flex gap-2">
                                <input
                                    type="text"
                                    value={commentInput}
                                    onChange={(e) =>
                                        setCommentInput(e.target.value)
                                    }
                                    placeholder={
                                        isEn
                                            ? 'Leave a comment, question, or study note on this lesson...'
                                            : 'Deixe seu comentário, dúvida ou anotação sobre esta aula...'
                                    }
                                    className="flex-1 h-9 rounded-xl bg-canvas-subtle border border-line px-3.5 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/60"
                                />
                                <button
                                    type="submit"
                                    disabled={
                                        !commentInput.trim() ||
                                        submittingComment
                                    }
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-45 text-accent-on text-xs font-bold transition-colors cursor-pointer shrink-0"
                                >
                                    <Send size={13} />
                                    <span>{isEn ? 'Post' : 'Comentar'}</span>
                                </button>
                            </div>
                        </form>

                        {/* Lista de Comentários */}
                        {comments.length === 0 ? (
                            <div className="py-8 text-center rounded-xl bg-canvas-subtle border border-line-subtle border-dashed">
                                <p className="text-xs text-fg-muted">
                                    {isEn
                                        ? 'Be the first to comment on this lesson!'
                                        : 'Seja o primeiro a comentar nesta aula!'}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {comments.map((c) => {
                                    const isOwner = c.user?.id === user?.id;
                                    return (
                                        <div
                                            key={c.id}
                                            className="flex items-start gap-2.5 p-3 rounded-xl bg-canvas-subtle border border-line-subtle"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-surface-2 border border-line flex items-center justify-center text-xs font-bold text-fg overflow-hidden shrink-0">
                                                {c.user?.avatarUrl ? (
                                                    <img
                                                        src={c.user.avatarUrl}
                                                        alt={c.user.username}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <span>
                                                        {c.user?.username?.[0]?.toUpperCase() ||
                                                            'T'}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="text-xs font-bold text-fg truncate">
                                                            {c.user?.name ||
                                                                c.user?.username}
                                                        </span>
                                                        <span className="text-[11px] font-mono text-accent-fg truncate">
                                                            @{c.user?.username}
                                                        </span>
                                                        <span className="text-[10px] text-fg-subtle tabular-nums">
                                                            {new Date(
                                                                c.createdAt
                                                            ).toLocaleDateString(
                                                                'pt-BR'
                                                            )}{' '}
                                                            ·{' '}
                                                            {new Date(
                                                                c.createdAt
                                                            ).toLocaleTimeString(
                                                                [],
                                                                {
                                                                    hour: '2-digit',
                                                                    minute: '2-digit',
                                                                }
                                                            )}
                                                        </span>
                                                    </div>

                                                    {isOwner && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                void handleDeleteComment(
                                                                    c.id
                                                                )
                                                            }
                                                            className="p-1 text-fg-subtle hover:text-danger transition-colors cursor-pointer"
                                                            title={isEn ? 'Delete comment' : 'Remover comentário'}
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    )}
                                                </div>

                                                <p className="mt-1 text-xs text-fg-muted whitespace-pre-wrap break-words leading-relaxed">
                                                    {c.content}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Coluna Lateral: Playlist / Trilha com Selos de Bloqueado quando Não Assistido */}
                <div
                    className={`${
                        theaterMode ? 'w-full' : 'xl:col-span-4'
                    } rounded-xl bg-surface border border-line overflow-hidden flex flex-col max-h-[820px]`}
                >
                    <div className="p-4 border-b border-line-subtle bg-canvas-subtle space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-fg">
                                {isEn ? 'Course Curriculum' : 'Trilha de Videoaulas'}
                            </h3>
                            <span className="text-xs font-mono font-bold text-accent-fg tabular-nums">
                                {summary.watchedCount}/{summary.totalLessons}
                            </span>
                        </div>

                        <div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-accent transition-all duration-300"
                                style={{
                                    width: `${summary.completionPercent}%`,
                                }}
                            />
                        </div>

                        {summary.lockedUnwatchedCount > 0 && (
                            <p className="text-[11px] text-warning font-semibold flex items-center gap-1.5">
                                <Flame size={12} className="shrink-0" />
                                <span>
                                    {isEn
                                        ? `${summary.lockedUnwatchedCount} locked lesson${summary.lockedUnwatchedCount === 1 ? '' : 's'} remaining!`
                                        : `Faltam ${summary.lockedUnwatchedCount} aula(s) bloqueada(s) por assistir!`}
                                </span>
                            </p>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 custom-scrollbar">
                        {playlist.map((item, idx) => {
                            const isCurrent = item.id === lesson.id;
                            const isLocked = !item.isWatched;

                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() =>
                                        navigate(`/network/watch/${item.id}`)
                                    }
                                    className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center gap-2.5 cursor-pointer ${
                                        isCurrent
                                            ? 'bg-accent/10 border-accent/45'
                                            : isLocked
                                            ? 'bg-canvas-subtle hover:bg-surface-2 border-warning/25'
                                            : 'bg-canvas-subtle hover:bg-surface-2 border-line-subtle'
                                    }`}
                                >
                                    {/* Mini Preview */}
                                    <div className="relative w-20 aspect-video rounded-lg bg-surface-2 border border-line overflow-hidden shrink-0 flex items-center justify-center">
                                        {item.thumbnailUrl ? (
                                            <img
                                                src={item.thumbnailUrl}
                                                alt={item.title}
                                                className={`w-full h-full object-cover ${
                                                    isLocked && !isCurrent
                                                        ? 'brightness-75'
                                                        : ''
                                                }`}
                                            />
                                        ) : (
                                            <Video
                                                size={14}
                                                className="text-fg-subtle"
                                            />
                                        )}

                                        <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                                            {isCurrent ? (
                                                <Play
                                                    size={13}
                                                    fill="currentColor"
                                                    className="text-accent-fg"
                                                />
                                            ) : isLocked ? (
                                                <Lock
                                                    size={12}
                                                    className="text-amber-400"
                                                />
                                            ) : (
                                                <CheckCircle2
                                                    size={13}
                                                    className="text-emerald-400"
                                                />
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 mb-0.5">
                                            <span className="text-[10px] font-mono text-fg-subtle">
                                                #{String(idx + 1).padStart(2, '0')}
                                            </span>
                                            {isCurrent ? (
                                                <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-accent text-accent-on">
                                                    {isEn ? 'Playing' : 'Reproduzindo'}
                                                </span>
                                            ) : isLocked ? (
                                                <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-warning/20 text-warning">
                                                    {isEn ? 'Locked' : 'Bloqueado'}
                                                </span>
                                            ) : (
                                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-emerald-600/20 text-accent-fg">
                                                    {isEn ? 'Watched' : 'Assistido'}
                                                </span>
                                            )}
                                        </div>

                                        <p className="text-xs font-semibold text-fg line-clamp-2 leading-snug">
                                            {item.title}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};
