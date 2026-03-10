import { useEffect, useState } from 'react';
import { TrendingUp, Users, MessageSquare, UserCheck } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import api from '../api';
import { ChatTab } from '../components/network/ChatTab';
import { CommunityTab } from '../components/network/CommunityTab';
import { ProfileTab } from '../components/network/ProfileTab';
import { FeedTab } from '../components/network/FeedTab';
import { RightSidebar } from '../components/network/RightSidebar';

// Types
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
    comments?: Comment[];
}

interface Comment {
    id: number;
    content: string;
    user: {
        username: string;
        avatarUrl?: string;
    };
}

interface SuggestedUser {
    id: string;
    username: string;
    avatarUrl?: string;
    name?: string;
}

export const Network = () => {
    const [activeTab, setActiveTab] = useState<'feed' | 'messages' | 'community' | 'profile'>('feed');
    const [socket, setSocket] = useState<Socket | null>(null);

    // Feed State
    const [posts, setPosts] = useState<Post[]>([]);
    const [trending, setTrending] = useState<Post[]>([]);
    const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchFeed();
        fetchTrending();
        fetchSuggestions();
    }, []);

    // Real-time listener
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;

        const newSocket = io('http://localhost:3000/network', {
            auth: { token },
            transports: ['websocket']
        });

        setSocket(newSocket);

        newSocket.on('newPost', (post: Post) => {
            setPosts(prev => [post, ...prev]);
        });

        newSocket.on('interaction', (data: any) => {
            setPosts(prev => prev.map(p => {
                if (p.id === data.postId) {
                    if (data.type === 'like') {
                        return { ...p, likesCount: data.likesCount };
                    } else if (data.type === 'comment') {
                        return { ...p, commentsCount: data.commentsCount };
                    }
                }
                return p;
            }));
        });

        return () => {
            newSocket.disconnect();
        };
    }, []);

    const fetchFeed = async () => {
        setLoading(true);
        try {
            const res = await api.get('/network/feed');
            // Ensure data is an array
            if (res.data && Array.isArray(res.data.data)) {
                setPosts(res.data.data);
            } else if (Array.isArray(res.data)) {
                setPosts(res.data);
            } else {
                setPosts([]);
            }
        } catch (e) {
            console.error("Failed to fetch feed", e);
            setError("Não foi possível carregar o feed. Tente novamente mais tarde.");
        } finally {
            setLoading(false);
        }
    };

    const fetchTrending = async () => {
        try {
            const res = await api.get('/network/trending');
            if (Array.isArray(res.data)) {
                setTrending(res.data);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchSuggestions = async () => {
        try {
            const res = await api.get('/network/suggestions');
            if (Array.isArray(res.data)) {
                setSuggestions(res.data);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleCreatePost = async (content: string, options?: { imageUrl?: string, type?: string }) => {
        if (!content.trim() && !options?.imageUrl) return;
        try {
            await api.post('/network/post', {
                content,
                imageUrl: options?.imageUrl,
                type: options?.type || 'text'
            });
            // Socket will handle update, but good for optimistic UI or fallback
            // setPosts([res.data, ...posts]); 
        } catch (e) {
            console.error(e);
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
            fetchFeed(); // Revert on error
        }
    };

    const renderFeed = () => (
        <FeedTab
            posts={posts}
            loading={loading}
            error={error}
            suggestions={suggestions}
            handleCreatePost={handleCreatePost}
            handleLike={handleLike}
        />
    );

    return (
        <div className="h-[calc(100vh-7rem)] flex flex-col">
            {/* Tabs Header */}
            <div className="flex gap-1 mb-6 p-1 bg-slate-900/50 rounded-xl w-fit border border-slate-800">
                {[
                    { id: 'feed', label: 'Feed', icon: <TrendingUp size={16} /> },
                    { id: 'messages', label: 'Mensagens', icon: <MessageSquare size={16} /> },
                    { id: 'community', label: 'Comunidade', icon: <Users size={16} /> },
                    { id: 'profile', label: 'Perfil', icon: <UserCheck size={16} /> },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`
                            px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all
                            ${activeTab === tab.id
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20'
                                : 'text-slate-400 hover:text-white hover:bg-slate-800'
                            }
                        `}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* Main Area & Right Sidebar Layout */}
            <div className="flex gap-6 flex-1 min-h-0">
                {/* Active Tab Content */}
                <div className="flex-1 overflow-hidden h-full flex flex-col">
                    {activeTab === 'feed' && renderFeed()}
                    {activeTab === 'messages' && <ChatTab socket={socket} />}
                    {activeTab === 'community' && <CommunityTab />}
                    {activeTab === 'profile' && <ProfileTab />}
                </div>

                {/* Shared Right Sidebar */}
                <RightSidebar trending={trending} suggestions={suggestions} />
            </div>
        </div>
    );
};
