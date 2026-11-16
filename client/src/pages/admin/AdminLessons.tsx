import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    CheckCircle2,
    Code2,
    Edit3,
    Eye,
    EyeOff,
    Heart,
    Loader2,
    MessageCircle,
    Play,
    Plus,
    Trash2,
    Video,
    X,
    Layers,
} from 'lucide-react';
import api from '../../api';
import { Button } from '../../components/ui/Button';
import {
    AdminBadge,
    AdminBanner,
    AdminPageHeader,
    AdminStatCard,
} from './components/AdminPrimitives';
import {
    VideoLessonItem,
    parseClientEmbedPreview,
} from '../../components/network/networkTypes';

interface LessonFormState {
    title: string;
    embedInput: string;
    description: string;
    category: string;
    durationLabel: string;
    thumbnailUrl: string;
    orderIndex: number;
    isPublished: boolean;
}

const EMPTY_FORM: LessonFormState = {
    title: '',
    embedInput: '',
    description: '',
    category: 'Formação Principal',
    durationLabel: '',
    thumbnailUrl: '',
    orderIndex: 1,
    isPublished: true,
};

export const AdminLessons: React.FC = () => {
    const [lessons, setLessons] = useState<VideoLessonItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{
        type: 'success' | 'error';
        text: string;
    } | null>(null);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [form, setForm] = useState<LessonFormState>(EMPTY_FORM);

    const fetchLessons = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/admin/lessons');
            const list: VideoLessonItem[] = Array.isArray(res.data)
                ? res.data
                : [];
            setLessons(list);
            if (!editingId) {
                setForm((prev) => ({
                    ...prev,
                    orderIndex: list.length + 1,
                }));
            }
        } catch {
            setFeedback({
                type: 'error',
                text: 'Falha ao carregar videoaulas do servidor.',
            });
        } finally {
            setLoading(false);
        }
    }, [editingId]);

    useEffect(() => {
        void fetchLessons();
    }, [fetchLessons]);

    const liveEmbedPreview = useMemo(
        () => parseClientEmbedPreview(form.embedInput),
        [form.embedInput]
    );

    const resetForm = (nextOrder = lessons.length + 1) => {
        setEditingId(null);
        setForm({
            ...EMPTY_FORM,
            orderIndex: nextOrder,
        });
    };

    const handleStartEdit = (item: VideoLessonItem) => {
        setEditingId(item.id);
        setFeedback(null);
        setForm({
            title: item.title || '',
            embedInput: item.embedInput || item.embedUrl || '',
            description: item.description || '',
            category: item.category || 'Formação Principal',
            durationLabel: item.durationLabel || '',
            thumbnailUrl: item.thumbnailUrl || '',
            orderIndex: Number(item.orderIndex) || 1,
            isPublished: Boolean(item.isPublished),
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFeedback(null);

        if (!form.title.trim()) {
            setFeedback({
                type: 'error',
                text: 'Informe o nome da videoaula.',
            });
            return;
        }
        if (!form.embedInput.trim()) {
            setFeedback({
                type: 'error',
                text: 'Cole o código de embed (<iframe>) ou URL do vídeo.',
            });
            return;
        }

        setSaving(true);
        try {
            const payload = {
                title: form.title.trim(),
                embedInput: form.embedInput.trim(),
                description: form.description.trim(),
                category: form.category.trim() || 'Formação Principal',
                durationLabel: form.durationLabel.trim() || null,
                thumbnailUrl: form.thumbnailUrl.trim() || null,
                orderIndex: Number(form.orderIndex) || 1,
                isPublished: form.isPublished,
            };

            if (editingId) {
                await api.patch(`/admin/lessons/${editingId}`, payload);
                setFeedback({
                    type: 'success',
                    text: 'Videoaula atualizada com sucesso!',
                });
            } else {
                await api.post('/admin/lessons', payload);
                setFeedback({
                    type: 'success',
                    text: 'Nova videoaula publicada em /network!',
                });
            }

            const refreshed = await api.get('/admin/lessons');
            const updatedList: VideoLessonItem[] = Array.isArray(refreshed.data)
                ? refreshed.data
                : [];
            setLessons(updatedList);
            resetForm(updatedList.length + 1);
        } catch (err: any) {
            setFeedback({
                type: 'error',
                text:
                    err?.response?.data?.message ||
                    'Erro ao salvar a videoaula. Verifique o código de embed informado.',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleTogglePublish = async (item: VideoLessonItem) => {
        try {
            await api.patch(`/admin/lessons/${item.id}`, {
                isPublished: !item.isPublished,
            });
            setLessons((prev) =>
                prev.map((l) =>
                    l.id === item.id ? { ...l, isPublished: !l.isPublished } : l
                )
            );
        } catch {
            // ignore
        }
    };

    const handleDelete = async (item: VideoLessonItem) => {
        try {
            await api.delete(`/admin/lessons/${item.id}`);
            setConfirmDeleteId(null);
            setLessons((prev) => prev.filter((l) => l.id !== item.id));
            setFeedback({
                type: 'success',
                text: `Videoaula "${item.title}" removida com sucesso.`,
            });
            if (editingId === item.id) {
                resetForm(Math.max(1, lessons.length));
            }
        } catch {
            setFeedback({
                type: 'error',
                text: 'Não foi possível excluir a videoaula.',
            });
        }
    };

    const publishedCount = lessons.filter((l) => l.isPublished).length;
    const hiddenCount = lessons.length - publishedCount;
    const categoriesCount = new Set(lessons.map((l) => l.category).filter(Boolean)).size;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <AdminPageHeader
                badge="Comunicação & Conteúdo"
                title="Academia & Videoaulas (/network)"
                subtitle="Gerencie embeds de vídeo, ordem, visibilidade e módulos de treinamento da comunidade."
                icon={<Video className="h-5 w-5" />}
                actions={
                    editingId ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resetForm()}
                            icon={<X size={14} />}
                        >
                            Cancelar Edição
                        </Button>
                    ) : undefined
                }
            />

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <AdminStatCard
                    label="Total de Aulas"
                    value={lessons.length}
                    hint="Cadastradas no catálogo"
                    icon={<Video className="h-4 w-4" />}
                    tone="info"
                />
                <AdminStatCard
                    label="Publicadas"
                    value={publishedCount}
                    hint="Visíveis em /network"
                    icon={<Eye className="h-4 w-4" />}
                    tone="accent"
                />
                <AdminStatCard
                    label="Ocultas / Rascunho"
                    value={hiddenCount}
                    hint="Aguardando publicação"
                    icon={<EyeOff className="h-4 w-4" />}
                    tone="warning"
                />
                <AdminStatCard
                    label="Categorias / Módulos"
                    value={categoriesCount}
                    hint="Trilhas distintas"
                    icon={<Layers className="h-4 w-4" />}
                />
            </div>

            {feedback && (
                <AdminBanner
                    tone={feedback.type === 'success' ? 'success' : 'danger'}
                    message={feedback.text}
                    onDismiss={() => setFeedback(null)}
                />
            )}

            {/* Formulário Principal + Preview em Tempo Real */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                    onSubmit={handleSubmit}
                    className="lg:col-span-7 rounded-2xl bg-surface border border-line p-5 sm:p-6 space-y-4"
                >
                    <div className="flex items-center justify-between border-b border-line-subtle pb-3">
                        <h2 className="text-sm font-bold text-fg flex items-center gap-2">
                            {editingId ? (
                                <>
                                    <Edit3 size={16} className="text-red-500" />
                                    <span>Editar Videoaula</span>
                                </>
                            ) : (
                                <>
                                    <Plus size={16} className="text-red-500" />
                                    <span>Adicionar Nova Videoaula</span>
                                </>
                            )}
                        </h2>
                        <label className="inline-flex items-center gap-2 text-xs font-medium text-fg cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.isPublished}
                                onChange={(e) =>
                                    setForm((prev) => ({
                                        ...prev,
                                        isPublished: e.target.checked,
                                    }))
                                }
                                className="rounded accent-emerald-500"
                            />
                            <span>Publicada para usuários</span>
                        </label>
                    </div>

                    {/* Nome do Vídeo */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-fg">
                            Nome do Vídeo *
                        </label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    title: e.target.value,
                                }))
                            }
                            placeholder="Ex.: Aula 01 — Gestão de Risco Institucional no XAUUSD"
                            className="w-full h-10 rounded-xl bg-canvas-subtle border border-line px-3.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
                        />
                    </div>

                    {/* Código Embed ou Link do Vídeo */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-fg flex items-center gap-1.5">
                            <Code2 size={14} className="text-accent-fg" />
                            <span>Embed do Vídeo (Código &lt;iframe&gt; ou Link) *</span>
                        </label>
                        <textarea
                            value={form.embedInput}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    embedInput: e.target.value,
                                }))
                            }
                            placeholder='Cole aqui o <iframe src="..."></iframe> completo ou link do YouTube, Vimeo, PandaVideo, Bunny, Loom ou .mp4'
                            rows={3}
                            className="w-full rounded-xl bg-canvas-subtle border border-line p-3 text-xs font-mono text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent resize-y"
                        />
                    </div>

                    {/* Descrição Completa */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-fg">
                            Descrição da Aula
                        </label>
                        <textarea
                            value={form.description}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    description: e.target.value,
                                }))
                            }
                            placeholder="Descreva o conteúdo da aula, pontos-chave, regras operacionais abordadas e instruções para os alunos..."
                            rows={5}
                            className="w-full rounded-xl bg-canvas-subtle border border-line p-3 text-xs sm:text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent resize-y"
                        />
                    </div>

                    {/* Campos Complementares Opcionais */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                            <label className="block text-[11px] font-semibold text-fg-muted">
                                Módulo / Categoria
                            </label>
                            <input
                                type="text"
                                value={form.category}
                                onChange={(e) =>
                                    setForm((prev) => ({
                                        ...prev,
                                        category: e.target.value,
                                    }))
                                }
                                placeholder="Formação Principal"
                                className="w-full h-9 rounded-lg bg-canvas-subtle border border-line px-3 text-xs text-fg focus:outline-none focus:border-accent"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="block text-[11px] font-semibold text-fg-muted">
                                Duração (opcional)
                            </label>
                            <input
                                type="text"
                                value={form.durationLabel}
                                onChange={(e) =>
                                    setForm((prev) => ({
                                        ...prev,
                                        durationLabel: e.target.value,
                                    }))
                                }
                                placeholder="Ex.: 18 min"
                                className="w-full h-9 rounded-lg bg-canvas-subtle border border-line px-3 text-xs text-fg focus:outline-none focus:border-accent"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="block text-[11px] font-semibold text-fg-muted">
                                Ordem na Trilha
                            </label>
                            <input
                                type="number"
                                min={1}
                                value={form.orderIndex}
                                onChange={(e) =>
                                    setForm((prev) => ({
                                        ...prev,
                                        orderIndex: Number(e.target.value) || 1,
                                    }))
                                }
                                className="w-full h-9 rounded-lg bg-canvas-subtle border border-line px-3 text-xs text-fg focus:outline-none focus:border-accent"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-fg-muted">
                            URL da Capa / Thumbnail (opcional — extraída automaticamente no YouTube)
                        </label>
                        <input
                            type="text"
                            value={form.thumbnailUrl}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    thumbnailUrl: e.target.value,
                                }))
                            }
                            placeholder="https://... (deixe em branco para capa automática)"
                            className="w-full h-9 rounded-lg bg-canvas-subtle border border-line px-3 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
                        />
                    </div>

                    <div className="pt-2 flex items-center justify-end gap-2.5">
                        <button
                            type="submit"
                            disabled={saving}
                            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-on text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                        >
                            {saving ? (
                                <>
                                    <Loader2
                                        size={15}
                                        className="animate-spin"
                                    />
                                    <span>Salvando...</span>
                                </>
                            ) : editingId ? (
                                <>
                                    <CheckCircle2 size={15} />
                                    <span>Salvar Alterações</span>
                                </>
                            ) : (
                                <>
                                    <Plus size={15} />
                                    <span>Publicar Videoaula</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>

                {/* Painel Lateral de Preview ao Vivo do Embed */}
                <div className="lg:col-span-5 rounded-2xl bg-surface border border-line p-5 space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                            Preview em Tempo Real do Player
                        </h3>
                        {liveEmbedPreview.embedUrl && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent/15 text-accent-fg">
                                {liveEmbedPreview.embedType.toUpperCase()} OK
                            </span>
                        )}
                    </div>

                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-canvas-subtle border border-line flex items-center justify-center">
                        {liveEmbedPreview.embedUrl ? (
                            liveEmbedPreview.embedType === 'video' ? (
                                <video
                                    src={liveEmbedPreview.embedUrl}
                                    controls
                                    className="w-full h-full object-contain bg-black"
                                />
                            ) : (
                                <iframe
                                    src={liveEmbedPreview.embedUrl}
                                    title="Admin Embed Preview"
                                    className="w-full h-full border-0 bg-black"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                />
                            )
                        ) : (
                            <div className="text-center p-6 space-y-2">
                                <Play
                                    size={28}
                                    className="mx-auto text-fg-subtle"
                                />
                                <p className="text-xs text-fg-subtle">
                                    Cole um código &lt;iframe&gt; ou URL de vídeo ao lado para testar o player antes de salvar.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="space-y-1 pt-1">
                        <p className="text-sm font-bold text-fg line-clamp-2">
                            {form.title || 'Título da sua videoaula aparecerá aqui'}
                        </p>
                        <p className="text-xs text-fg-muted line-clamp-3 whitespace-pre-wrap">
                            {form.description ||
                                'A descrição definida acima será apresentada abaixo do player dedicado em /network/watch/:id.'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Lista de Videoaulas Cadastradas */}
            <div className="rounded-2xl bg-surface border border-line overflow-hidden">
                <div className="px-5 py-4 border-b border-line-subtle flex items-center justify-between">
                    <h2 className="text-sm font-bold text-fg">
                        Videoaulas Cadastradas ({lessons.length})
                    </h2>
                </div>

                {loading ? (
                    <div className="py-12 text-center text-xs text-fg-muted">
                        Carregando lista de aulas...
                    </div>
                ) : lessons.length === 0 ? (
                    <div className="py-12 text-center text-xs text-fg-subtle">
                        Nenhuma videoaula cadastrada ainda. Use o formulário acima para publicar a primeira aula.
                    </div>
                ) : (
                    <div className="divide-y divide-line-subtle">
                        {lessons.map((item) => (
                            <div
                                key={item.id}
                                className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-surface-2/40 transition-colors"
                            >
                                <div className="flex items-start gap-3.5 min-w-0">
                                    <div className="w-28 aspect-video rounded-lg bg-canvas-subtle border border-line overflow-hidden shrink-0 flex items-center justify-center relative">
                                        {item.thumbnailUrl ? (
                                            <img
                                                src={item.thumbnailUrl}
                                                alt={item.title}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <Video
                                                size={18}
                                                className="text-fg-subtle"
                                            />
                                        )}
                                        <span className="absolute bottom-1 left-1 px-1.5 py-0.2 rounded bg-black/80 text-[10px] font-mono text-white">
                                            #{item.orderIndex}
                                        </span>
                                    </div>

                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <AdminBadge tone={item.isPublished ? 'success' : 'warning'} dot>
                                                {item.isPublished ? 'Publicada' : 'Oculta'}
                                            </AdminBadge>
                                            <span className="text-[11px] text-fg-subtle">
                                                {item.category}
                                            </span>
                                            {item.durationLabel && (
                                                <span className="text-[11px] font-mono text-fg-subtle">
                                                    · {item.durationLabel}
                                                </span>
                                            )}
                                        </div>

                                        <h3 className="text-sm font-bold text-fg truncate">
                                            {item.title}
                                        </h3>

                                        <p className="text-xs text-fg-muted line-clamp-1">
                                            {item.description || 'Sem descrição'}
                                        </p>

                                        <div className="flex items-center gap-4 text-[11px] text-fg-subtle tabular-nums pt-0.5">
                                            <span className="inline-flex items-center gap-1">
                                                <Eye size={12} />{' '}
                                                {item.viewsCount || 0}
                                            </span>
                                            <span className="inline-flex items-center gap-1">
                                                <Heart size={12} />{' '}
                                                {item.likesCount || 0}
                                            </span>
                                            <span className="inline-flex items-center gap-1">
                                                <MessageCircle size={12} />{' '}
                                                {item.commentsCount || 0}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    <a
                                        href={`/network/watch/${item.id}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-xs font-semibold text-fg transition-colors"
                                    >
                                        <Play size={12} />
                                        <span>Ver Player</span>
                                    </a>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            void handleTogglePublish(item)
                                        }
                                        className="p-2 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-fg-muted hover:text-fg transition-colors cursor-pointer"
                                        title={
                                            item.isPublished
                                                ? 'Ocultar videoaula'
                                                : 'Publicar videoaula'
                                        }
                                    >
                                        {item.isPublished ? (
                                            <EyeOff size={14} />
                                        ) : (
                                            <Eye size={14} />
                                        )}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleStartEdit(item)}
                                        className="p-2 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-fg-muted hover:text-fg transition-colors cursor-pointer"
                                        title="Editar videoaula"
                                    >
                                        <Edit3 size={14} />
                                    </button>

                                    {confirmDeleteId === item.id ? (
                                        <div className="inline-flex items-center gap-1.5">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setConfirmDeleteId(null)}
                                            >
                                                Não
                                            </Button>
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => void handleDelete(item)}
                                            >
                                                Confirmar
                                            </Button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDeleteId(item.id)}
                                            className="p-2 rounded-lg bg-surface-2 hover:bg-danger/20 border border-line text-fg-muted hover:text-danger-fg transition-colors cursor-pointer"
                                            title="Excluir videoaula"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
