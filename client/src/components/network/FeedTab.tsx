import React, { useEffect, useRef, useState } from 'react';
import {
    ArrowRight,
    Flame,
    Image as ImageIcon,
    Send,
    Smile,
    User,
    Video,
    X,
} from 'lucide-react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { PostCard } from './PostCard';
import { VideoLessonCard } from './LessonsCatalogTab';
import { VideoLessonItem } from './networkTypes';
import { ChatPartnerTarget } from './ChatTab';
import api from '../../api';

interface SuggestedUser {
    id: string;
    username: string;
    avatarUrl?: string;
    name?: string;
}

interface FeedTabProps {
    posts: any[];
    loading: boolean;
    error: string | null;
    suggestions: SuggestedUser[];
    featuredUnwatchedLessons?: VideoLessonItem[];
    onOpenAllLessons?: () => void;
    handleCreatePost: (
        content: string,
        options?: { imageUrl?: string; type?: string }
    ) => Promise<void>;
    handleLike: (postId: number) => Promise<void>;
    onCommentAdded?: (postId: number, comment: any) => void;
    onDeletePost?: (postId: number) => void;
    onMessageUser?: (partner: ChatPartnerTarget) => void;
}

export const FeedTab: React.FC<FeedTabProps> = ({
    posts,
    loading,
    error,
    suggestions,
    featuredUnwatchedLessons = [],
    onOpenAllLessons,
    handleCreatePost,
    handleLike,
    onCommentAdded,
    onDeletePost,
    onMessageUser,
}) => {
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [newPostContent, setNewPostContent] = useState('');
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);
    const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
    const [isPosting, setIsPosting] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const emojiPickerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                emojiPickerRef.current &&
                !emojiPickerRef.current.contains(event.target as Node)
            ) {
                setShowEmojiPicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () =>
            document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const onEmojiClick = (emojiObject: any) => {
        setNewPostContent((prev) => prev + emojiObject.emoji);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const isVideo = file.type.startsWith('video/');
        setMediaType(isVideo ? 'video' : 'image');
        setMediaFile(file);

        const previewUrl = URL.createObjectURL(file);
        setMediaPreview(previewUrl);
    };

    const removeMedia = () => {
        setMediaFile(null);
        setMediaPreview(null);
        setMediaType(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const onSubmit = async () => {
        if (!newPostContent.trim() && !mediaFile) return;
        setIsPosting(true);

        try {
            let uploadedImageUrl = undefined;
            if (mediaFile) {
                const formData = new FormData();
                formData.append('file', mediaFile);
                const uploadRes = await api.post('/network/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                uploadedImageUrl = uploadRes.data.imageUrl;
            }

            await handleCreatePost(newPostContent, {
                imageUrl: uploadedImageUrl,
                type: mediaType || 'text',
            });

            setNewPostContent('');
            removeMedia();
        } catch (e) {
            console.error('Failed to post:', e);
        } finally {
            setIsPosting(false);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3.5 pb-6">
            {/* Vitrine Rápida de Videoaulas Bloqueadas (Não Assistidas) */}
            {featuredUnwatchedLessons.length > 0 && (
                <div className="rounded-xl bg-surface border border-warning/35 p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-warning">
                            <Flame size={14} className="shrink-0" />
                            <span>
                                {isEn
                                    ? `Locked Lessons Remaining (${featuredUnwatchedLessons.length})`
                                    : `Aulas Bloqueadas por Assistir (${featuredUnwatchedLessons.length})`}
                            </span>
                        </div>
                        {onOpenAllLessons && (
                            <button
                                type="button"
                                onClick={onOpenAllLessons}
                                className="inline-flex items-center gap-1 text-xs font-bold text-accent-fg hover:underline cursor-pointer"
                            >
                                <span>{isEn ? 'View all video lessons' : 'Ver todas as videoaulas'}</span>
                                <ArrowRight size={13} />
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {featuredUnwatchedLessons.slice(0, 2).map((lesson) => (
                            <VideoLessonCard
                                key={lesson.id}
                                lesson={lesson}
                                compact
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Composer de Nova Publicação na Comunidade */}
            <div className="bg-surface border border-line rounded-xl p-4">
                <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center text-accent-fg font-bold text-xs shrink-0 overflow-hidden">
                        {user?.avatarUrl ? (
                            <img
                                src={user.avatarUrl}
                                alt={user.username}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            user?.username?.[0]?.toUpperCase() || (
                                <User size={15} />
                            )
                        )}
                    </div>
                    <div className="flex-1">
                        <textarea
                            value={newPostContent}
                            onChange={(e) => setNewPostContent(e.target.value)}
                            placeholder={
                                isEn
                                    ? 'Share a setup, trade chart, market insight, or question with the community...'
                                    : 'Partilhe um setup, print de operação, insight de mercado ou dúvida com a comunidade...'
                            }
                            className="w-full bg-canvas-subtle border border-line rounded-lg p-2.5 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/50 transition-colors resize-none h-20"
                        />
                        {mediaPreview && (
                            <div className="relative mt-2.5 inline-block">
                                {mediaType === 'video' ? (
                                    <video
                                        src={mediaPreview}
                                        className="max-h-40 rounded-lg border border-line"
                                        controls
                                    />
                                ) : (
                                    <img
                                        src={mediaPreview}
                                        alt="Preview"
                                        className="max-h-40 rounded-lg border border-line object-contain"
                                    />
                                )}
                                <button
                                    type="button"
                                    onClick={removeMedia}
                                    className="absolute -top-2 -right-2 bg-surface-2 hover:bg-danger text-fg hover:text-white p-1 rounded-full transition-colors border border-line cursor-pointer"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                        <div className="flex justify-between items-center mt-2.5">
                            <div className="flex gap-1 text-fg-subtle relative">
                                <button
                                    type="button"
                                    onClick={() =>
                                        fileInputRef.current?.click()
                                    }
                                    className="p-1.5 hover:bg-surface-2 hover:text-fg rounded-md transition-colors flex items-center gap-1.5 text-xs cursor-pointer"
                                    title={isEn ? 'Attach Photo or Video' : 'Adicionar Foto ou Vídeo'}
                                >
                                    <ImageIcon size={15} /> <Video size={15} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowEmojiPicker(!showEmojiPicker)
                                    }
                                    className="p-1.5 hover:bg-surface-2 hover:text-fg rounded-md transition-colors flex items-center gap-1.5 text-xs cursor-pointer"
                                    title={isEn ? 'Insert Emoji' : 'Adicionar Emoji'}
                                >
                                    <Smile size={15} />
                                </button>

                                {showEmojiPicker && (
                                    <div
                                        ref={emojiPickerRef}
                                        className="absolute top-9 left-0 z-50 shadow-2xl"
                                    >
                                        <EmojiPicker
                                            onEmojiClick={onEmojiClick}
                                            theme={Theme.DARK}
                                            lazyLoadEmojis={true}
                                        />
                                    </div>
                                )}
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*,video/*"
                                    onChange={handleFileSelect}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => void onSubmit()}
                                disabled={
                                    (!newPostContent.trim() && !mediaFile) ||
                                    isPosting
                                }
                                className="h-8 px-4 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-on rounded-lg font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                                {isPosting ? (
                                    <span className="animate-pulse">
                                        {isEn ? 'Publishing...' : 'Publicando...'}
                                    </span>
                                ) : (
                                    <>
                                        <Send size={13} /> {isEn ? 'Post' : 'Publicar'}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger-fg text-center text-xs">
                    {error}
                </div>
            )}

            {/* Feed de Publicações */}
            {loading ? (
                <div className="text-center text-fg-subtle py-10 text-xs">
                    {isEn ? 'Loading community feed...' : 'Carregando publicações da comunidade...'}
                </div>
            ) : posts.length === 0 ? (
                <div className="flex flex-col gap-3">
                    <div className="text-center py-10 bg-surface rounded-xl border border-line border-dashed">
                        <p className="text-fg text-xs font-medium mb-1">
                            {isEn ? 'No community posts yet.' : 'Ainda não há publicações na comunidade.'}
                        </p>
                        <p className="text-fg-subtle text-xs">
                            {isEn
                                ? 'Be the first to share market analysis or connect with fellow traders below.'
                                : 'Seja o primeiro a partilhar uma análise ou interaja com outros traders abaixo.'}
                        </p>
                    </div>

                    {suggestions.length > 0 && (
                        <div className="space-y-2.5">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-fg-subtle px-1">
                                {isEn ? 'Traders on the Platform' : 'Traders na Plataforma'}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                {suggestions.map((s) => (
                                    <div
                                        key={s.id}
                                        className="bg-surface border border-line p-3 rounded-xl flex items-center gap-3"
                                    >
                                        <div className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center text-fg font-bold text-xs border border-line-strong overflow-hidden shrink-0">
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
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-xs text-fg truncate">
                                                {s.name || s.username}
                                            </h4>
                                            <p className="text-[11px] text-accent-fg truncate font-mono">
                                                @{s.username}
                                            </p>
                                        </div>
                                        {onMessageUser && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onMessageUser({
                                                        id: s.id,
                                                        username: s.username,
                                                        name: s.name,
                                                        avatarUrl: s.avatarUrl,
                                                    })
                                                }
                                                className="h-7 px-3 rounded-lg text-xs font-semibold bg-accent/10 text-accent-fg hover:bg-accent/20 border border-accent/25 cursor-pointer"
                                            >
                                                {isEn ? 'Message' : 'Conversar'}
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                posts.map((post) => (
                    <PostCard
                        key={post.id}
                        post={post}
                        onLike={handleLike}
                        onCommentAdded={onCommentAdded}
                        onDeletePost={onDeletePost}
                        onMessageUser={onMessageUser}
                    />
                ))
            )}
        </div>
    );
};
