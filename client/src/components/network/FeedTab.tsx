import { useState } from 'react';
import { User, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PostCard } from './PostCard';

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
    handleCreatePost: (content: string) => Promise<void>;
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

    const onSubmit = async () => {
        if (!newPostContent.trim()) return;
        await handleCreatePost(newPostContent);
        setNewPostContent('');
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
                        <div className="flex justify-between items-center mt-3">
                            <div className="flex gap-2 text-slate-500">
                                {/* Attachments buttons could go here */}
                            </div>
                            <button
                                onClick={onSubmit}
                                disabled={!newPostContent.trim()}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg shadow-indigo-900/20 transition-all flex items-center gap-2"
                            >
                                <Send size={16} /> Publicar
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
