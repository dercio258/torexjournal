import { useState, useRef, useEffect } from 'react';
import { User, Send, Image as ImageIcon, Video, X, Smile } from 'lucide-react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { useAuth } from '../../context/AuthContext';
import { PostCard } from './PostCard';
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
    handleCreatePost: (content: string, options?: { imageUrl?: string, type?: string }) => Promise<void>;
    handleLike: (postId: number) => Promise<void>;
    isRestricted?: boolean;
}

export const FeedTab = ({
    posts,
    loading,
    error,
    suggestions,
    handleCreatePost,
    handleLike,
    isRestricted = false
}: FeedTabProps) => {
    const { user } = useAuth();
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
            if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
                setShowEmojiPicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const onEmojiClick = (emojiObject: any) => {
        setNewPostContent(prev => prev + emojiObject.emoji);
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
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                uploadedImageUrl = uploadRes.data.imageUrl;
            }

            await handleCreatePost(newPostContent, {
                imageUrl: uploadedImageUrl,
                type: mediaType || 'text'
            });

            setNewPostContent('');
            removeMedia();
        } catch (e) {
            console.error("Failed to post:", e);
        } finally {
            setIsPosting(false);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">

            {/* Create Post Card */}
            {!isRestricted && (
                <div className="bg-white dark:bg-slate-900/40 backdrop-blur-xl border border-line rounded-3xl p-6 shadow-sm dark:shadow-lg">
                    <div className="flex gap-4">
                        <div className="w-10 h-10 rounded-full bg-indigo-500/15 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold shrink-0">
                            {user?.username?.[0]?.toUpperCase() || <User size={20} />}
                        </div>
                        <div className="flex-1">
                            <textarea
                                value={newPostContent}
                                onChange={e => setNewPostContent(e.target.value)}
                                placeholder="Compartilhe um trade, uma ideia ou uma dúvida..."
                                className="w-full bg-slate-50 dark:bg-slate-950/30 border border-line rounded-xl p-3 text-slate-800 dark:text-slate-300 placeholder:text-fg-muted dark:placeholder:text-slate-600 focus:bg-white dark:focus:bg-slate-950/30 focus:outline-none focus:border-indigo-500 transition-colors"
                            />
                            {mediaPreview && (
                                <div className="relative mt-3 inline-block">
                                    {mediaType === 'video' ? (
                                        <video src={mediaPreview} className="max-h-48 rounded-lg border border-slate-200 dark:border-slate-700" controls />
                                    ) : (
                                        <img src={mediaPreview} alt="Preview" className="max-h-48 rounded-lg border border-slate-200 dark:border-slate-700 object-contain" />
                                    )}
                                    <button onClick={removeMedia} className="absolute -top-2 -right-2 bg-surface-2 hover:bg-rose-500 text-fg p-1 rounded-full transition-colors shadow-lg">
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                            <div className="flex justify-between items-center mt-3">
                                <div className="flex gap-2 text-fg-subtle relative">
                                    <button onClick={() => fileInputRef.current?.click()} className="p-2 hover:bg-surface-2 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg transition-colors flex items-center gap-2 text-sm" title="Adicionar Foto/Vídeo">
                                        <ImageIcon size={18} /> <Video size={18} />
                                    </button>
                                    <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-2 hover:bg-surface-2 hover:text-yellow-600 dark:hover:text-yellow-500 rounded-lg transition-colors flex items-center gap-2 text-sm" title="Adicionar Emoji">
                                        <Smile size={18} />
                                    </button>

                                    {showEmojiPicker && (
                                        <div ref={emojiPickerRef} className="absolute top-12 left-0 z-50 shadow-2xl">
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
                                    onClick={onSubmit}
                                    disabled={(!newPostContent.trim() && !mediaFile) || isPosting}
                                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg shadow-indigo-900/20 transition-all flex items-center gap-2"
                                >
                                    {isPosting ? <span className="animate-pulse">Publicando...</span> : <><Send size={16} /> Publicar</>}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Restricted Message for Basic Users */}
            {isRestricted && (
                <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-4 flex items-center gap-3 text-sm text-indigo-300/80">
                    <div className="p-2 bg-indigo-500/10 rounded-lg">
                        <User size={16} />
                    </div>
                    <span>Você está no plano <strong>Básico</strong>. Para participar das discussões e postar conteúdo, faça o upgrade para o plano <strong>Premium</strong>.</span>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-center text-sm">
                    {error}
                </div>
            )}

            {/* Feed List */}
            {loading ? (
                <div className="text-center text-fg-subtle py-10">Carregando feed...</div>
            ) : posts.length === 0 ? (
                <div className="flex flex-col gap-6">
                    <div className="text-center py-10 bg-surface/30 rounded-3xl border border-line border-dashed">
                        <p className="text-fg-muted mb-4">Ainda não há posts no seu feed.</p>
                        <p className="text-fg-subtle text-sm">Siga outros traders para ver o conteúdo deles aqui.</p>
                    </div>

                    {suggestions.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="font-bold text-fg/80 px-2">Sugestões de Conexão</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {suggestions.map(s => (
                                    <div key={s.id} className="bg-surface/40 border border-line p-4 rounded-xl flex items-center gap-4 hover:border-line-strong transition-colors">
                                        <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center text-fg/80 font-bold border border-line-strong overflow-hidden shrink-0">
                                            {s.avatarUrl ? <img src={s.avatarUrl} className="w-full h-full object-cover" /> : s.username?.[0]?.toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-fg truncate">{s.name || s.username}</h4>
                                            <p className="text-xs text-fg-subtle truncate">@{s.username}</p>
                                        </div>
                                        <button
                                            disabled={isRestricted}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${isRestricted
                                                ? 'bg-surface-2/50 text-fg-subtle border-line-strong opacity-50 cursor-not-allowed'
                                                : 'bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-fg border-indigo-500/30'
                                                }`}
                                        >
                                            Seguir
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : posts.map(post => (
                <PostCard key={post.id} post={post} onLike={handleLike} isRestricted={isRestricted} />
            ))}
        </div>
    );
};
