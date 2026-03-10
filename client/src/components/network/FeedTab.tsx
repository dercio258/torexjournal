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
}

export const FeedTab = ({
    posts,
    loading,
    error,
    suggestions,
    handleCreatePost,
    handleLike
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
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-lg">
                <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold shrink-0">
                        {user?.username?.[0]?.toUpperCase() || <User size={20} />}
                    </div>
                    <div className="flex-1">
                        <textarea
                            value={newPostContent}
                            onChange={e => setNewPostContent(e.target.value)}
                            placeholder="Compartilhe um trade, uma ideia ou uma dúvida..."
                            className="w-full bg-slate-950/30 border border-slate-800 rounded-xl p-3 text-slate-300 focus:outline-none focus:border-indigo-500/50 min-h-[80px] resize-none transition-colors"
                        />
                        {mediaPreview && (
                            <div className="relative mt-3 inline-block">
                                {mediaType === 'video' ? (
                                    <video src={mediaPreview} className="max-h-48 rounded-lg border border-slate-700" controls />
                                ) : (
                                    <img src={mediaPreview} alt="Preview" className="max-h-48 rounded-lg border border-slate-700 object-contain" />
                                )}
                                <button onClick={removeMedia} className="absolute -top-2 -right-2 bg-slate-800 hover:bg-rose-500 text-white p-1 rounded-full transition-colors shadow-lg">
                                    <X size={14} />
                                </button>
                            </div>
                        )}
                        <div className="flex justify-between items-center mt-3">
                            <div className="flex gap-2 text-slate-500 relative">
                                <button onClick={() => fileInputRef.current?.click()} className="p-2 hover:bg-slate-800 hover:text-indigo-400 rounded-lg transition-colors flex items-center gap-2 text-sm" title="Adicionar Foto/Vídeo">
                                    <ImageIcon size={18} /> <Video size={18} />
                                </button>
                                <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-2 hover:bg-slate-800 hover:text-yellow-500 rounded-lg transition-colors flex items-center gap-2 text-sm" title="Adicionar Emoji">
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

            {/* Error Message */}
            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-center text-sm">
                    {error}
                </div>
            )}

            {/* Feed List */}
            {loading ? (
                <div className="text-center text-slate-500 py-10">Carregando feed...</div>
            ) : posts.length === 0 ? (
                <div className="flex flex-col gap-6">
                    <div className="text-center py-10 bg-slate-900/30 rounded-3xl border border-slate-800 border-dashed">
                        <p className="text-slate-400 mb-4">Ainda não há posts no seu feed.</p>
                        <p className="text-slate-500 text-sm">Siga outros traders para ver o conteúdo deles aqui.</p>
                    </div>

                    {suggestions.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="font-bold text-slate-300 px-2">Sugestões de Conexão</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {suggestions.map(s => (
                                    <div key={s.id} className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl flex items-center gap-4 hover:border-slate-700 transition-colors">
                                        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold border border-slate-700 overflow-hidden shrink-0">
                                            {s.avatarUrl ? <img src={s.avatarUrl} className="w-full h-full object-cover" /> : s.username?.[0]?.toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-slate-200 truncate">{s.name || s.username}</h4>
                                            <p className="text-xs text-slate-500 truncate">@{s.username}</p>
                                        </div>
                                        <button className="px-3 py-1.5 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white rounded-lg text-xs font-bold transition-all border border-indigo-500/30">
                                            Seguir
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : posts.map(post => (
                <PostCard key={post.id} post={post} onLike={handleLike} />
            ))}
        </div>
    );
};
