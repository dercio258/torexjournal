import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    CheckCircle2,
    Clock,
    Eye,
    Flame,
    Heart,
    Lock,
    MessageCircle,
    Play,
    Search,
    Sparkles,
    Video,
} from 'lucide-react';
import {
    VideoLessonItem,
    VideoLessonsSummary,
    buildSilentHoverEmbedUrl,
} from './networkTypes';
import { useLocale } from '../../context/LocaleContext';

interface LessonCardProps {
    lesson: VideoLessonItem;
    compact?: boolean;
}

export const VideoLessonCard: React.FC<LessonCardProps> = ({
    lesson,
    compact = false,
}) => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [isHoverPreviewing, setIsHoverPreviewing] = useState(false);
    const [thumbError, setThumbError] = useState(false);
    const hoverTimerRef = useRef<number | null>(null);

    const isLockedUnwatched = !lesson.isWatched;

    const handleMouseEnter = () => {
        if (hoverTimerRef.current) {
            window.clearTimeout(hoverTimerRef.current);
        }
        hoverTimerRef.current = window.setTimeout(() => {
            setIsHoverPreviewing(true);
        }, 320);
    };

    const handleMouseLeave = () => {
        if (hoverTimerRef.current) {
            window.clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        setIsHoverPreviewing(false);
    };

    const openDedicatedPlayer = () => {
        navigate(`/network/watch/${lesson.id}`);
    };

    const canLiveIframePreview =
        lesson.embedType === 'iframe' &&
        (lesson.embedUrl.includes('youtube.com') ||
            lesson.embedUrl.includes('vimeo.com'));

    return (
        <div
            onClick={openDedicatedPlayer}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={`group relative rounded-xl bg-surface border transition-all duration-200 overflow-hidden flex flex-col cursor-pointer ${
                isLockedUnwatched
                    ? 'border-warning/40 hover:border-warning shadow-sm'
                    : 'border-line hover:border-accent/55'
            }`}
        >
            {/* Preview 16:9 Interativo */}
            <div className="relative aspect-video w-full bg-canvas-subtle overflow-hidden border-b border-line-subtle">
                {/* Imagem de Capa ou Studio Preview Gráfico */}
                {lesson.thumbnailUrl && !thumbError ? (
                    <img
                        src={lesson.thumbnailUrl}
                        alt={lesson.title}
                        onError={() => setThumbError(true)}
                        className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${
                            isLockedUnwatched
                                ? 'brightness-[0.78] group-hover:brightness-95'
                                : 'brightness-95 group-hover:brightness-100'
                        }`}
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-surface-2 via-canvas to-surface-3 flex flex-col items-center justify-center p-4 relative">
                        <div
                            className="absolute inset-0 opacity-20"
                            style={{
                                backgroundImage:
                                    'radial-gradient(circle at 2px 2px, rgba(16,185,129,0.45) 1px, transparent 0)',
                                backgroundSize: '18px 18px',
                            }}
                        />
                        <div className="w-11 h-11 rounded-2xl bg-surface/90 border border-line flex items-center justify-center text-accent-fg mb-2 relative z-10">
                            <Video size={20} />
                        </div>
                        <span className="text-[10px] uppercase tracking-widest font-bold text-fg-muted relative z-10 text-center line-clamp-1">
                            {lesson.category || 'Torex Academy'}
                        </span>
                    </div>
                )}

                {/* Hover Live Video Preview (MP4 ou YouTube/Vimeo silencioso) */}
                {isHoverPreviewing && lesson.embedType === 'video' && (
                    <video
                        src={lesson.embedUrl}
                        muted
                        autoPlay
                        loop
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover z-10"
                    />
                )}
                {isHoverPreviewing && canLiveIframePreview && (
                    <iframe
                        src={buildSilentHoverEmbedUrl(lesson.embedUrl)}
                        title={`Preview ${lesson.title}`}
                        className="absolute inset-0 w-full h-full pointer-events-none z-10 scale-[1.04]"
                        allow="autoplay; encrypted-media"
                    />
                )}

                {/* Gradiente escuro de leitura */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/30 pointer-events-none z-20" />

                {/* SELO DE BLOQUEADO (NÃO ASSISTIDO) COM URGÊNCIA vs ASSISTIDO */}
                <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 z-30">
                    {isLockedUnwatched ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/95 text-slate-950 text-[10px] font-extrabold uppercase tracking-wider shadow-md">
                            <Lock size={11} className="shrink-0" />
                            <span>{isEn ? 'Locked · Unwatched' : 'Bloqueado · Não Assistido'}</span>
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-600/95 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
                            <CheckCircle2 size={11} className="shrink-0" />
                            <span>{isEn ? 'Watched' : 'Assistido'}</span>
                        </span>
                    )}

                    {isHoverPreviewing ? (
                        <span className="px-2 py-0.5 rounded-md bg-black/75 text-accent-fg border border-accent/40 text-[10px] font-semibold animate-pulse">
                            Preview
                        </span>
                    ) : lesson.durationLabel ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/75 text-white text-[10px] font-mono">
                            <Clock size={10} />
                            {lesson.durationLabel}
                        </span>
                    ) : null}
                </div>

                {/* Botão Central de Play / Desbloqueio */}
                <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                    <div
                        className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg group-hover:scale-110 ${
                            isLockedUnwatched
                                ? 'bg-amber-500 text-slate-950 ring-4 ring-amber-500/25'
                                : 'bg-accent text-accent-on ring-4 ring-accent/25'
                        }`}
                    >
                        {isLockedUnwatched && !isHoverPreviewing ? (
                            <Lock size={17} />
                        ) : (
                            <Play size={18} fill="currentColor" className="ml-0.5" />
                        )}
                    </div>
                </div>

                {/* Rodapé interno do Preview */}
                <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between gap-2 z-30 text-[10px] text-white/90">
                    <span className="font-semibold truncate">
                        {isEn ? 'Lesson' : 'Aula'} #{String(lesson.sequenceNumber || lesson.orderIndex || 1).padStart(2, '0')} ·{' '}
                        {lesson.category}
                    </span>
                    {isLockedUnwatched && (
                        <span className="inline-flex items-center gap-1 text-amber-300 font-bold shrink-0">
                            <Flame size={11} />
                            {isEn ? 'Priority' : 'Urgente'}
                        </span>
                    )}
                </div>
            </div>

            {/* Corpo do Card */}
            <div className={`flex-1 flex flex-col justify-between ${compact ? 'p-3' : 'p-3.5'}`}>
                <div>
                    <h3 className="text-xs sm:text-[13px] font-bold text-fg group-hover:text-accent-fg transition-colors line-clamp-2 leading-snug">
                        {lesson.title}
                    </h3>

                    {!compact && (
                        <p className="mt-1.5 text-[11px] text-fg-muted line-clamp-2 leading-relaxed">
                            {lesson.description ||
                                (isEn
                                    ? 'Watch in the dedicated player for full walkthroughs, resources, and community discussion.'
                                    : 'Assista no player dedicado para acompanhar a explicação completa, materiais e discussão da comunidade.')}
                        </p>
                    )}
                </div>

                <div className="mt-3 pt-2.5 border-t border-line-subtle flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-[11px] text-fg-subtle tabular-nums">
                        <span
                            className={`inline-flex items-center gap-1 ${
                                lesson.isLiked ? 'text-danger-fg font-semibold' : ''
                            }`}
                        >
                            <Heart
                                size={12}
                                fill={lesson.isLiked ? 'currentColor' : 'none'}
                            />
                            {lesson.likesCount || 0}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <MessageCircle size={12} />
                            {lesson.commentsCount || 0}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <Eye size={12} />
                            {lesson.viewsCount || 0}
                        </span>
                    </div>

                    <span
                        className={`text-[11px] font-bold transition-colors ${
                            isLockedUnwatched
                                ? 'text-warning group-hover:underline'
                                : 'text-accent-fg group-hover:underline'
                        }`}
                    >
                        {isLockedUnwatched
                            ? isEn
                                ? 'Unlock →'
                                : 'Desbloquear →'
                            : isEn
                            ? 'Open Player →'
                            : 'Abrir Player →'}
                    </span>
                </div>
            </div>
        </div>
    );
};

interface LessonsCatalogTabProps {
    lessons: VideoLessonItem[];
    summary: VideoLessonsSummary;
    loading: boolean;
}

export const LessonsCatalogTab: React.FC<LessonsCatalogTabProps> = ({
    lessons,
    summary,
    loading,
}) => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<
        'all' | 'unwatched' | 'watched'
    >('all');
    const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

    const categories = useMemo(() => {
        const set = new Set<string>();
        lessons.forEach((l) => {
            if (l.category) set.add(l.category);
        });
        return Array.from(set);
    }, [lessons]);

    const filteredLessons = useMemo(() => {
        const q = search.trim().toLowerCase();
        return lessons.filter((l) => {
            if (statusFilter === 'unwatched' && l.isWatched) return false;
            if (statusFilter === 'watched' && !l.isWatched) return false;
            if (selectedCategory !== 'ALL' && l.category !== selectedCategory) {
                return false;
            }
            if (!q) return true;
            return (
                l.title.toLowerCase().includes(q) ||
                (l.description || '').toLowerCase().includes(q) ||
                (l.category || '').toLowerCase().includes(q)
            );
        });
    }, [lessons, search, statusFilter, selectedCategory]);

    return (
        <div className="h-full overflow-y-auto custom-scrollbar pr-1 space-y-3.5 pb-6">
            {/* Banner de Progresso & Urgência de Desbloqueio */}
            <div className="rounded-xl bg-surface border border-line p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-accent-fg text-[11px] font-bold">
                            <Sparkles size={12} />
                            {isEn ? 'Torex Academy & Video Lessons' : 'Formação & Videoaulas Torex'}
                        </span>

                        {summary.lockedUnwatchedCount > 0 && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-warning/15 border border-warning/35 text-warning text-[11px] font-bold">
                                <Lock size={11} />
                                {isEn
                                    ? `${summary.lockedUnwatchedCount} locked ${summary.lockedUnwatchedCount === 1 ? 'lesson' : 'lessons'} remaining`
                                    : `${summary.lockedUnwatchedCount} ${summary.lockedUnwatchedCount === 1 ? 'aula bloqueada por assistir' : 'aulas bloqueadas por assistir'}`}
                            </span>
                        )}
                    </div>

                    <h2 className="text-sm sm:text-base font-bold text-fg">
                        {summary.totalLessons === 0
                            ? isEn
                                ? 'Official Community Video Curriculum'
                                : 'Área Oficial de Videoaulas da Comunidade'
                            : summary.lockedUnwatchedCount > 0
                            ? isEn
                                ? `Keep going: ${summary.lockedUnwatchedCount} lesson${summary.lockedUnwatchedCount === 1 ? '' : 's'} left to unlock 100% of your track!`
                                : `Não pare agora: faltam ${summary.lockedUnwatchedCount} aula(s) para desbloquear 100% da sua trilha!`
                            : isEn
                            ? 'All current video lessons unlocked and completed!'
                            : 'Parabéns! Todas as videoaulas atuais foram desbloqueadas e assistidas.'}
                    </h2>

                    {summary.totalLessons > 0 && (
                        <div className="pt-1 max-w-xl space-y-1">
                            <div className="flex items-center justify-between text-[11px] text-fg-muted font-medium tabular-nums">
                                <span>
                                    {isEn
                                        ? `Progress: ${summary.watchedCount} of ${summary.totalLessons} lessons watched`
                                        : `Progresso: ${summary.watchedCount} de ${summary.totalLessons} aulas assistidas`}
                                </span>
                                <span className="text-accent-fg font-bold">
                                    {summary.completionPercent}%
                                </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-canvas-subtle overflow-hidden border border-line-subtle">
                                <div
                                    className="h-full rounded-full bg-accent transition-all duration-500"
                                    style={{
                                        width: `${summary.completionPercent}%`,
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {summary.nextUnwatchedLessonId && (
                    <button
                        type="button"
                        onClick={() =>
                            navigate(
                                `/network/watch/${summary.nextUnwatchedLessonId}`
                            )
                        }
                        className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition-colors shadow-sm shrink-0 cursor-pointer"
                    >
                        <Flame size={15} />
                        <span>{isEn ? 'Watch Next Locked Lesson' : 'Assistir Próxima Aula Bloqueada'}</span>
                    </button>
                )}
            </div>

            {/* Barra de Filtros e Pesquisa */}
            <div className="rounded-xl bg-surface border border-line p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                    {[
                        { id: 'all', label: `${isEn ? 'All' : 'Todas'} (${lessons.length})` },
                        {
                            id: 'unwatched',
                            label: `${isEn ? 'Locked / Pending' : 'Bloqueadas / Pendentes'} (${summary.lockedUnwatchedCount})`,
                        },
                        {
                            id: 'watched',
                            label: `${isEn ? 'Watched' : 'Assistidas'} (${summary.watchedCount})`,
                        },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setStatusFilter(tab.id as any)}
                            className={`h-7 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                                statusFilter === tab.id
                                    ? 'bg-surface-2 text-fg border border-line-strong'
                                    : 'text-fg-muted hover:text-fg hover:bg-surface-2/60'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}

                    {categories.length > 1 && (
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="h-7 px-2.5 rounded-lg bg-canvas-subtle border border-line text-xs text-fg focus:outline-none"
                        >
                            <option value="ALL">{isEn ? 'All Modules' : 'Todos os Módulos'}</option>
                            {categories.map((cat) => (
                                <option key={cat} value={cat}>
                                    {cat}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                <div className="relative sm:w-64">
                    <Search
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
                    />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={isEn ? 'Search lessons by topic...' : 'Buscar aula por tema...'}
                        className="w-full h-8 rounded-lg bg-canvas-subtle border border-line pl-8 pr-3 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/50"
                    />
                </div>
            </div>

            {/* Grelha de Videoaulas */}
            {loading ? (
                <div className="py-16 text-center text-xs text-fg-muted">
                    {isEn ? 'Loading video lessons...' : 'Carregando videoaulas...'}
                </div>
            ) : filteredLessons.length === 0 ? (
                <div className="rounded-xl bg-surface border border-line border-dashed py-14 px-4 text-center space-y-1.5">
                    <Video size={26} className="mx-auto text-fg-subtle" />
                    <p className="text-xs font-semibold text-fg">
                        {lessons.length === 0
                            ? isEn
                                ? 'No video lessons published yet.'
                                : 'Nenhuma videoaula publicada ainda.'
                            : isEn
                            ? 'No video lessons match the selected filter.'
                            : 'Nenhuma videoaula corresponde ao filtro selecionado.'}
                    </p>
                    <p className="text-xs text-fg-subtle">
                        {lessons.length === 0
                            ? isEn
                                ? 'Once new lessons are published, they will appear here with interactive previews and player access.'
                                : 'Assim que o administrador publicar novas aulas, elas aparecerão aqui com preview e acesso ao player dedicado.'
                            : isEn
                            ? 'Clear the search or adjust the filter above to view all lessons.'
                            : 'Limpe a pesquisa ou altere o filtro acima para ver todas as aulas.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3.5">
                    {filteredLessons.map((lesson) => (
                        <VideoLessonCard key={lesson.id} lesson={lesson} />
                    ))}
                </div>
            )}
        </div>
    );
};
