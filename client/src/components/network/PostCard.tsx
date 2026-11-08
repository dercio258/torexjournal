import { Heart, MessageCircle, Share2, MoreHorizontal, TrendingUp, TrendingDown } from 'lucide-react';

const ASSETS_URL = import.meta.env.VITE_API_URL || window.location.origin;
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
    type?: string;
    tradeData?: {
        imageUrl?: string;
        ticket?: string;
        symbol?: string;
        profit?: number;
        isWin?: boolean;
    };
    imageUrl?: string;
}

interface PostCardProps {
    post: Post;
    onLike: (postId: number) => void;
    isRestricted?: boolean;
}

export const PostCard = ({ post, onLike, isRestricted = false }: PostCardProps) => {
    return (
        <div className="bg-white dark:bg-slate-900/40 backdrop-blur-xl border border-line rounded-3xl p-6 shadow-sm dark:shadow-lg hover:border-line-strong transition-all group">
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center text-fg-muted font-bold border-2 border-slate-200 dark:border-slate-700 group-hover:border-indigo-500/50 transition-colors">
                        {post.user?.avatarUrl ? (
                            <img src={post.user.avatarUrl} alt={post.user.username} className="w-full h-full rounded-full object-cover" />
                        ) : (
                            post.user?.username?.[0]?.toUpperCase() || '?'
                        )}
                    </div>
                    <div>
                        <h3 className="font-bold text-fg text-base leading-tight flex items-center gap-2">
                            {post.user?.username || 'Usuário Desconhecido'}
                            <span className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] text-fg-muted font-normal">Trader</span>
                        </h3>
                        <span className="text-xs text-fg-subtle dark:text-slate-400">{new Date(post.createdAt).toLocaleDateString()} às {new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                </div>
                <button className="text-fg-muted hover:text-slate-700 dark:hover:text-white p-2 hover:bg-surface-2 rounded-full transition-colors"><MoreHorizontal size={20} /></button>
            </div>

            <div className="text-fg-muted text-sm mb-4 whitespace-pre-wrap leading-relaxed pl-[3.75rem]">
                {post.content}
            </div>

            {/* Generic Image Post */}
            {post.type === 'image' && post.imageUrl && !post.tradeData?.imageUrl && (
                <div className="mb-4 pl-[3.75rem]">
                    <div className="relative rounded-2xl overflow-hidden border border-line-strong bg-canvas/50 group/image">
                        <img
                            src={`${ASSETS_URL}${post.imageUrl}`}
                            alt="Post Media"
                            className="w-full h-auto max-h-[500px] object-contain cursor-pointer transition-transform duration-500 group-hover/image:scale-[1.02]"
                            loading="lazy"
                            onClick={() => window.open(`${ASSETS_URL}${post.imageUrl}`, '_blank')}
                        />
                    </div>
                </div>
            )}

            {/* Generic Video Post */}
            {post.type === 'video' && post.imageUrl && (
                <div className="mb-4 pl-[3.75rem]">
                    <div className="relative rounded-2xl overflow-hidden border border-line-strong bg-canvas/50">
                        <video
                            src={`${ASSETS_URL}${post.imageUrl}`}
                            controls
                            className="w-full h-auto max-h-[500px] object-contain"
                        />
                    </div>
                </div>
            )}

            {/* Trade Analysis/Share Post (Legacy or specialized) */}
            {post.type === 'image' && post.tradeData?.imageUrl && (
                <div className="mb-4 pl-[3.75rem]">
                    <div className="relative rounded-2xl overflow-hidden border border-line-strong bg-canvas/50 group/image">
                        <img
                            src={`${ASSETS_URL}${post.tradeData?.imageUrl}`}
                            alt="Trade Review"
                            className="w-full h-auto max-h-[500px] object-contain cursor-pointer transition-transform duration-500 group-hover/image:scale-[1.02]"
                            loading="lazy"
                            onClick={() => window.open(`${ASSETS_URL}${post.tradeData?.imageUrl}`, '_blank')}
                        />
                        {post.tradeData?.symbol && (
                            <div className="absolute top-3 left-3 bg-surface/80 backdrop-blur border border-line-strong px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-lg">
                                <span className="text-fg font-bold text-sm tracking-wide">{post.tradeData?.symbol}</span>
                                {post.tradeData?.ticket && (
                                    <span className="text-fg-muted text-xs">#{post.tradeData?.ticket}</span>
                                )}
                            </div>
                        )}
                        {post.tradeData?.profit !== undefined && post.tradeData?.isWin !== undefined && (
                            <div className={`absolute bottom-3 right-3 backdrop-blur px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-lg border text-sm font-bold ${post.tradeData?.isWin
                                ? 'bg-emerald-500/20 text-accent-fg border-emerald-500/30'
                                : 'bg-rose-500/20 text-danger-fg border-rose-500/30'
                                }`}>
                                {post.tradeData?.isWin ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                {post.tradeData?.isWin ? '+' : ''}{Number(post.tradeData?.profit).toFixed(2)}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Interactions */}
            <div className="flex items-center gap-6 pt-4 border-t border-slate-200 dark:border-slate-800/50 ml-[3.75rem]">
                <button
                    onClick={() => !isRestricted && onLike(post.id)}
                    disabled={isRestricted}
                    className={`flex items-center gap-2 text-sm font-bold transition-all ${post.isLiked ? 'text-rose-500' : 'text-fg-subtle hover:text-rose-500'
                        } ${isRestricted
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-rose-500/10 px-2 py-1 -ml-2 rounded-lg'
                        }`}
                >
                    <Heart size={18} fill={post.isLiked ? "currentColor" : "none"} className={post.isLiked ? "animate-bounce" : ""} />
                    {post.likesCount || 0}
                </button>
                <button
                    disabled={isRestricted}
                    className={`flex items-center gap-2 text-sm font-bold text-fg-subtle hover:text-indigo-600 dark:hover:text-indigo-400 transition-all ${isRestricted
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-indigo-500/10 px-2 py-1 rounded-lg'
                        }`}
                >
                    <MessageCircle size={18} />
                    {post.commentsCount || 0}
                </button>
                <button
                    className="flex items-center gap-2 text-sm font-bold text-fg-subtle hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10 px-2 py-1 rounded-lg transition-all ml-auto"
                >
                    <Share2 size={18} />
                </button>
            </div>
        </div>
    );
};
