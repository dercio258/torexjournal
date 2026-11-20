import React, { useState } from 'react';
import {
    Heart,
    MessageCircle,
    MessageSquare,
    Send,
    Share2,
    Trash2,
    TrendingDown,
    TrendingUp,
    Check,
} from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { ChatPartnerTarget } from './ChatTab';

const ASSETS_URL = import.meta.env.VITE_API_URL || window.location.origin;

interface PostComment {
    id: number | string;
    content: string;
    createdAt?: string;
    user: {
        id?: string;
        username: string;
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
        avatarUrl?: string | null;
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
    comments?: PostComment[];
}

interface PostCardProps {
    post: Post;
    onLike: (postId: number) => void;
    onCommentAdded?: (postId: number, comment: PostComment) => void;
    onDeletePost?: (postId: number) => void;
    onMessageUser?: (partner: ChatPartnerTarget) => void;
    isRestricted?: boolean;
}

export const PostCard: React.FC<PostCardProps> = ({
    post,
    onLike,
    onCommentAdded,
    onDeletePost,
    onMessageUser,
    isRestricted = false,
}) => {
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [showComments, setShowComments] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [submittingComment, setSubmittingComment] = useState(false);
    const [copied, setCopied] = useState(false);

    const isOwner = user?.id === post.user?.id;
    const commentsList = Array.isArray(post.comments) ? post.comments : [];

    const resolveMediaUrl = (rawUrl?: string) => {
        if (!rawUrl) return '';
        if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
        return `${ASSETS_URL}${rawUrl}`;
    };

    const handleAddComment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!commentText.trim() || submittingComment) return;

        setSubmittingComment(true);
        try {
            const res = await api.post(`/network/post/${post.id}/comment`, {
                content: commentText.trim(),
            });
            if (res.data) {
                onCommentAdded?.(post.id, res.data);
            }
            setCommentText('');
        } catch {
            // ignore
        } finally {
            setSubmittingComment(false);
        }
    };

    const handleShare = async () => {
        try {
            await navigator.clipboard.writeText(`${window.location.origin}/network`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            // ignore
        }
    };

    return (
        <div className="bg-surface border border-line rounded-xl p-4 transition-colors">
            <div className="flex justify-between items-start gap-2 mb-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center text-fg font-bold text-xs border border-line-strong shrink-0 overflow-hidden">
                        {post.user?.avatarUrl ? (
                            <img
                                src={post.user.avatarUrl}
                                alt={post.user.username}
                                className="w-full h-full rounded-full object-cover"
                            />
                        ) : (
                            post.user?.username?.[0]?.toUpperCase() || 'T'
                        )}
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-bold text-fg text-xs leading-tight flex items-center gap-1.5 truncate">
                            <span className="truncate">
                                @{post.user?.username || 'trader'}
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-surface-2 text-[10px] text-fg-subtle font-medium border border-line-subtle shrink-0">
                                Trader
                            </span>
                        </h3>
                        <span className="text-[11px] text-fg-subtle tabular-nums">
                            {new Date(post.createdAt).toLocaleDateString(isEn ? 'en-US' : 'pt-BR')} ·{' '}
                            {new Date(post.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    {!isOwner &&
                        onMessageUser &&
                        post.user?.id &&
                        post.user.id !== 'deleted' && (
                            <button
                                type="button"
                                onClick={() =>
                                    onMessageUser({
                                        id: post.user.id,
                                        username: post.user.username,
                                        avatarUrl: post.user.avatarUrl,
                                    })
                                }
                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-[11px] font-semibold text-fg-muted hover:text-fg transition-colors cursor-pointer"
                                title={isEn ? 'Start direct chat' : 'Iniciar conversa direta'}
                            >
                                <MessageSquare size={12} className="text-accent-fg" />
                                <span>{isEn ? 'Message' : 'Conversar'}</span>
                            </button>
                        )}

                    {isOwner && onDeletePost && (
                        <button
                            type="button"
                            onClick={() => onDeletePost(post.id)}
                            className="p-1.5 rounded-lg text-fg-subtle hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                            title={isEn ? 'Delete post' : 'Remover publicação'}
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            </div>

            {post.content && (
                <div className="text-fg text-xs mb-3 whitespace-pre-wrap leading-relaxed pl-0 sm:pl-[2.875rem] break-words">
                    {post.content}
                </div>
            )}

            {/* Imagem Genérica */}
            {post.type === 'image' && post.imageUrl && !post.tradeData?.imageUrl && (
                <div className="mb-3 pl-0 sm:pl-[2.875rem]">
                    <div className="relative rounded-xl overflow-hidden border border-line bg-canvas-subtle">
                        <img
                            src={resolveMediaUrl(post.imageUrl)}
                            alt="Post Media"
                            className="w-full h-auto max-h-[420px] object-contain cursor-pointer"
                            loading="lazy"
                            onClick={() =>
                                window.open(resolveMediaUrl(post.imageUrl), '_blank')
                            }
                        />
                    </div>
                </div>
            )}

            {/* Vídeo no Feed */}
            {post.type === 'video' && post.imageUrl && (
                <div className="mb-3 pl-0 sm:pl-[2.875rem]">
                    <div className="relative rounded-xl overflow-hidden border border-line bg-canvas-subtle">
                        <video
                            src={resolveMediaUrl(post.imageUrl)}
                            controls
                            className="w-full h-auto max-h-[420px] object-contain"
                        />
                    </div>
                </div>
            )}

            {/* Partilha de Trade */}
            {post.type === 'image' && post.tradeData?.imageUrl && (
                <div className="mb-3 pl-[2.875rem]">
                    <div className="relative rounded-xl overflow-hidden border border-line bg-canvas-subtle">
                        <img
                            src={resolveMediaUrl(post.tradeData.imageUrl)}
                            alt="Trade Review"
                            className="w-full h-auto max-h-[420px] object-contain cursor-pointer"
                            loading="lazy"
                            onClick={() =>
                                window.open(
                                    resolveMediaUrl(post.tradeData?.imageUrl),
                                    '_blank'
                                )
                            }
                        />
                        {post.tradeData?.symbol && (
                            <div className="absolute top-2.5 left-2.5 bg-surface/90 backdrop-blur border border-line px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                                <span className="text-fg font-bold text-xs">
                                    {post.tradeData.symbol}
                                </span>
                                {post.tradeData.ticket && (
                                    <span className="text-fg-muted text-[11px] font-mono">
                                        #{post.tradeData.ticket}
                                    </span>
                                )}
                            </div>
                        )}
                        {post.tradeData?.profit !== undefined &&
                            post.tradeData?.isWin !== undefined && (
                                <div
                                    className={`absolute bottom-2.5 right-2.5 backdrop-blur px-2.5 py-1 rounded-lg flex items-center gap-1.5 border text-xs font-bold font-mono tabular-nums ${
                                        post.tradeData.isWin
                                            ? 'bg-accent/15 text-accent-fg border-accent/30'
                                            : 'bg-danger/15 text-danger-fg border-danger/30'
                                    }`}
                                >
                                    {post.tradeData.isWin ? (
                                        <TrendingUp size={13} />
                                    ) : (
                                        <TrendingDown size={13} />
                                    )}
                                    {post.tradeData.isWin ? '+' : ''}$
                                    {Number(post.tradeData.profit).toFixed(2)}
                                </div>
                            )}
                    </div>
                </div>
            )}

            {/* Barra de Interações */}
            <div className="flex items-center gap-5 pt-2.5 border-t border-line-subtle ml-0 sm:ml-[2.875rem]">
                <button
                    type="button"
                    onClick={() => !isRestricted && onLike(post.id)}
                    disabled={isRestricted}
                    className={`flex items-center gap-1.5 text-xs font-semibold transition-colors tabular-nums ${
                        post.isLiked
                            ? 'text-danger-fg'
                            : 'text-fg-subtle hover:text-danger-fg'
                    } ${isRestricted ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                    <Heart size={14} fill={post.isLiked ? 'currentColor' : 'none'} />
                    <span>{post.likesCount || 0}</span>
                </button>

                <button
                    type="button"
                    onClick={() => setShowComments((prev) => !prev)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-fg-subtle hover:text-fg transition-colors tabular-nums cursor-pointer"
                >
                    <MessageCircle size={14} />
                    <span>{post.commentsCount || commentsList.length || 0}</span>
                </button>

                <button
                    type="button"
                    onClick={() => void handleShare()}
                    className="flex items-center gap-1 text-xs font-semibold text-fg-subtle hover:text-accent-fg transition-colors ml-auto cursor-pointer"
                    title={isEn ? 'Copy link' : 'Copiar link'}
                >
                    {copied ? (
                        <Check size={14} className="text-accent-fg" />
                    ) : (
                        <Share2 size={14} />
                    )}
                </button>
            </div>

            {/* Comentários Expansíveis da Publicação */}
            {showComments && (
                <div className="mt-3 pt-3 border-t border-line-subtle ml-0 sm:ml-[2.875rem] space-y-2.5">
                    {commentsList.length > 0 && (
                        <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                            {commentsList.map((c) => (
                                <div
                                    key={c.id}
                                    className="p-2.5 rounded-lg bg-canvas-subtle border border-line-subtle text-xs"
                                >
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                        <span className="font-bold text-accent-fg font-mono text-[11px]">
                                            @{c.user?.username || 'trader'}
                                        </span>
                                    </div>
                                    <p className="text-fg-muted whitespace-pre-wrap break-words leading-relaxed">
                                        {c.content}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}

                    {!isRestricted && (
                        <form
                            onSubmit={handleAddComment}
                            className="flex items-center gap-2"
                        >
                            <input
                                type="text"
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                placeholder={isEn ? 'Write a comment...' : 'Escreva um comentário...'}
                                className="flex-1 h-8 rounded-lg bg-canvas-subtle border border-line px-3 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/60"
                            />
                            <button
                                type="submit"
                                disabled={!commentText.trim() || submittingComment}
                                className="h-8 px-3 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-45 text-accent-on text-xs font-bold flex items-center gap-1 cursor-pointer"
                            >
                                <Send size={12} />
                            </button>
                        </form>
                    )}
                </div>
            )}
        </div>
    );
};
