import { useEffect, useState } from 'react';
import { Calendar, Grid } from 'lucide-react';
import api from '../../api';
// AuthContext import removed because unused here
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
    // const { user } = useAuth(); // Ignorando auth para UI mockada
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [posts, setPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        setLoading(true);
        try {
            // Fetch 'me' profile
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
        // Optimistic update
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

    if (loading) return <div className="text-center text-slate-500 py-10">Carregando perfil...</div>;
    if (!profile) return <div className="text-center text-slate-500 py-10">Perfil não encontrado.</div>;

    return (
        <div className="h-full flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-2">
            {/* Profile Header */}
            <div className="relative">
                {/* Cover Image Placeholder */}
                <div className="h-32 bg-gradient-to-r from-indigo-900/50 to-purple-900/50 rounded-t-3xl border border-slate-800 border-b-0"></div>

                <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-b-3xl p-6 shadow-lg -mt-1 pt-12 relative">
                    <div className="absolute -top-10 left-6">
                        <div className="w-24 h-24 rounded-full bg-slate-900 flex items-center justify-center text-slate-300 font-bold border-4 border-slate-900 overflow-hidden shadow-xl">
                            {profile.avatarUrl ? (
                                <img src={profile.avatarUrl} alt={profile.username} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-3xl">{profile.username?.[0]?.toUpperCase()}</span>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-between items-start pl-24 ml-2">
                        <div>
                            <h2 className="text-2xl font-bold text-white">{profile.name || profile.username}</h2>
                            <p className="text-slate-500 font-bold">@{profile.username}</p>
                        </div>
                        <button className="px-4 py-2 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl font-bold text-sm transition-all">
                            Editar Perfil
                        </button>
                    </div>

                    <div className="mt-6 flex flex-wrap gap-6 text-sm text-slate-400">
                        <div className="flex items-center gap-2">
                            <Calendar size={16} className="text-slate-500" />
                            <span>Entrou em {new Date(profile.createdAt).toLocaleDateString()}</span>
                        </div>
                    </div>

                    <div className="mt-6 flex gap-8 border-t border-slate-800 pt-6">
                        <div className="text-center">
                            <span className="block text-xl font-bold text-white">{profile.stats.posts}</span>
                            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Posts</span>
                        </div>
                        <div className="text-center">
                            <span className="block text-xl font-bold text-white">{profile.stats.followers}</span>
                            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Seguidores</span>
                        </div>
                        <div className="text-center">
                            <span className="block text-xl font-bold text-white">{profile.stats.following}</span>
                            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Seguindo</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Tabs (Just Posts for now) */}
            <div className="flex gap-1 p-1 bg-slate-900/50 rounded-xl w-fit border border-slate-800 mx-auto lg:mx-0">
                <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg shadow-indigo-900/20">
                    <Grid size={16} /> Publicações
                </button>
            </div>

            {/* Posts Grid/List */}
            <div className="space-y-6 pb-10">
                {posts.length === 0 ? (
                    <div className="text-center py-10 bg-slate-900/30 rounded-3xl border border-slate-800 border-dashed">
                        <p className="text-slate-400 mb-4">Você ainda não publicou nada.</p>
                    </div>
                ) : (
                    posts.map(post => <PostCard key={post.id} post={post} onLike={handleLike} />)
                )}
            </div>
        </div>
    );
};
