import { useEffect, useState, useRef } from 'react';
import { Calendar, Grid, Camera } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { PostCard } from './PostCard';

interface UserProfile {
    id: string;
    username: string;
    name?: string;
    avatarUrl?: string;
    createdAt: string;
    stats: {
        followers: number;
        following: number;
        posts: number;
    };
    isFollowing?: boolean;
}

export const ProfileTab = () => {
    const { user, updateUser } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [posts, setPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        setLoading(true);
        try {
            const [profileRes, postsRes] = await Promise.all([
                api.get('/network/profile/me'),
                api.get('/network/profile/me/posts')
            ]);

            setProfile(profileRes.data);
            if (Array.isArray(postsRes.data)) {
                setPosts(postsRes.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleLike = async (postId: number) => {
        setPosts(posts.map(p => {
            if (p.id === postId) {
                return {
                    ...p,
                    isLiked: !p.isLiked,
                    likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1
                };
            }
            return p;
        }));

        try {
            await api.post(`/network/post/${postId}/like`);
        } catch (e) {
            // revert if needed
        }
    };

    if (loading) return <div className="text-center text-fg-subtle py-10 text-xs">{isEn ? 'Loading profile...' : 'Carregando perfil...'}</div>;
    if (!profile) return <div className="text-center text-fg-subtle py-10 text-xs">{isEn ? 'Profile not found.' : 'Perfil não encontrado.'}</div>;

    const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const uploadRes = await api.post('/auth/profile/avatar', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            const newAvatarUrl = uploadRes.data.avatarUrl;

            setProfile({ ...profile, avatarUrl: newAvatarUrl });
            updateUser({ avatarUrl: newAvatarUrl });
        } catch (error) {
            console.error('Failed to upload avatar', error);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const isOwnProfile = user?.id === profile.id;

    return (
        <div className="h-full flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
            {/* Profile Header Card */}
            <div className="bg-surface border border-line rounded-xl overflow-hidden">
                <div className="h-20 bg-gradient-to-r from-surface-2 via-accent/10 to-surface-2 border-b border-line-subtle" />

                <div className="p-4 sm:p-5 relative">
                    <div className="flex flex-wrap items-end justify-between gap-3 -mt-10 mb-3">
                        <div
                            className={`w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center text-fg font-bold border-2 border-surface ring-1 ring-line-strong overflow-hidden relative group ${isOwnProfile ? 'cursor-pointer' : ''}`}
                            onClick={() => isOwnProfile && fileInputRef.current?.click()}
                        >
                            {isUploading && (
                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent border-t-transparent" />
                                </div>
                            )}
                            {profile.avatarUrl ? (
                                <img src={profile.avatarUrl} alt={profile.username} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-xl">{profile.username?.[0]?.toUpperCase()}</span>
                            )}
                            {isOwnProfile && !isUploading && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Camera size={16} className="text-white" />
                                </div>
                            )}
                        </div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            accept="image/*"
                            onChange={handleAvatarUpload}
                        />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h2 className="text-base font-bold text-fg font-mono">@{profile.username}</h2>
                            <p className="text-xs text-fg-subtle">{isEn ? 'Community Member' : 'Membro da Comunidade'}</p>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                            <Calendar size={13} />
                            <span>
                                {isEn ? 'Joined' : 'Entrou em'}{' '}
                                {new Date(profile.createdAt).toLocaleDateString(isEn ? 'en-US' : 'pt-BR')}
                            </span>
                        </div>
                    </div>

                    <div className="mt-4 flex gap-6 border-t border-line-subtle pt-3.5 tabular-nums">
                        <div>
                            <span className="block text-sm font-bold text-fg">{profile.stats.posts}</span>
                            <span className="text-[10px] text-fg-subtle font-semibold uppercase tracking-wider">{isEn ? 'Posts' : 'Posts'}</span>
                        </div>
                        <div>
                            <span className="block text-sm font-bold text-fg">{profile.stats.followers}</span>
                            <span className="text-[10px] text-fg-subtle font-semibold uppercase tracking-wider">{isEn ? 'Followers' : 'Seguidores'}</span>
                        </div>
                        <div>
                            <span className="block text-sm font-bold text-fg">{profile.stats.following}</span>
                            <span className="text-[10px] text-fg-subtle font-semibold uppercase tracking-wider">{isEn ? 'Following' : 'Seguindo'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Tabs */}
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg-subtle px-1">
                <Grid size={13} className="text-accent-fg" /> {isEn ? 'Posts' : 'Publicações'}
            </div>

            {/* Posts List */}
            <div className="space-y-3 pb-8">
                {posts.length === 0 ? (
                    <div className="text-center py-10 bg-surface rounded-xl border border-line border-dashed">
                        <p className="text-fg-muted text-xs">{isEn ? 'You have not posted anything yet.' : 'Você ainda não publicou nada.'}</p>
                    </div>
                ) : (
                    posts.map(post => (
                        <PostCard
                            key={post.id}
                            post={post}
                            onLike={handleLike}
                            onDeletePost={(deletedId) =>
                                setPosts(prev => prev.filter(p => p.id !== deletedId))
                            }
                            onCommentAdded={(postId, comment) =>
                                setPosts(prev =>
                                    prev.map(p =>
                                        p.id === postId
                                            ? {
                                                  ...p,
                                                  commentsCount: (p.commentsCount || 0) + 1,
                                                  comments: [...(p.comments || []), comment],
                                              }
                                            : p
                                    )
                                )
                            }
                        />
                    ))
                )}
            </div>
        </div>
    );
};
