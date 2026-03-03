import { Heart, MessageCircle, Share2, MoreHorizontal } from 'lucide-react';
import api from '../../api';

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
        avatarUrl?: string;
    };
}

interface PostCardProps {
    post: Post;
    onLike: (postId: number) => void;
}

export const PostCard = ({ post, onLike }: PostCardProps) => {
    return (
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-lg hover:border-slate-700 transition-all group">
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold border-2 border-slate-700 group-hover:border-indigo-500/50 transition-colors">
                        {post.user?.avatarUrl ? (
                            <img src={post.user.avatarUrl} alt={post.user.username} className="w-full h-full rounded-full object-cover" />
                        ) : (
                            post.user?.username?.[0]?.toUpperCase() || '?'
                        )}
                    </div>
                    <div>
                        <h3 className="font-bold text-white text-base leading-tight flex items-center gap-2">
                            {post.user?.username || 'Usuário Desconhecido'}
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-normal">Trader</span>
                        </h3>
                        <span className="text-xs text-slate-500">{new Date(post.createdAt).toLocaleDateString()} às {new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                </div>
                <button className="text-slate-500 hover:text-white p-2 hover:bg-slate-800 rounded-full transition-colors"><MoreHorizontal size={20} /></button>
            </div>

            <div className="text-slate-300 text-sm mb-4 whitespace-pre-wrap leading-relaxed pl-[3.75rem]">
                {post.content}
            </div>

            {/* Interactions */}
            <div className="flex items-center gap-6 pt-4 border-t border-slate-800/50 ml-[3.75rem]">
                <button
                    onClick={() => onLike(post.id)}
                    className={`flex items-center gap-2 text-sm font-bold transition-all ${post.isLiked ? 'text-rose-500' : 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 px-2 py-1 -ml-2 rounded-lg'}`}
                >
                    <Heart size={18} fill={post.isLiked ? "currentColor" : "none"} className={post.isLiked ? "animate-bounce" : ""} />
                    {post.likesCount || 0}
                </button>
                <button className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 px-2 py-1 rounded-lg transition-all">
                    <MessageCircle size={18} />
                    {post.commentsCount || 0}
                </button>
                <button className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 px-2 py-1 rounded-lg transition-all ml-auto">
                    <Share2 size={18} />
                </button>
            </div>
        </div>
    );
};
