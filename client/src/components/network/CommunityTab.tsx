import { useEffect, useState } from 'react';
import { Search, UserPlus, UserCheck } from 'lucide-react';
import api from '../../api';

interface User {
    id: string;
    username: string;
    name?: string;
    avatarUrl?: string;
    isFollowing?: boolean;
}

export const CommunityTab = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async (query = '') => {
        setLoading(true);
        try {
            const res = await api.get('/network/users', { params: { q: query } });
            if (Array.isArray(res.data)) {
                setUsers(res.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchUsers(search);
    };

    const toggleFollow = async (user: User) => {
        // Optimistic update
        setUsers(users.map(u => {
            if (u.id === user.id) {
                return { ...u, isFollowing: !u.isFollowing };
            }
            return u;
        }));

        try {
            if (user.isFollowing) {
                await api.delete(`/network/follow/${user.id}`);
            } else {
                await api.post(`/network/follow/${user.id}`);
            }
        } catch (e) {
            // Revert
            fetchUsers(search);
        }
    };

    return (
        <div className="h-full flex flex-col gap-6">
            {/* Search Header */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-lg">
                <h2 className="text-xl font-bold text-white mb-2">Comunidade</h2>
                <p className="text-sm text-slate-400 mb-4">Encontre e conecte-se com outros traders.</p>

                <form onSubmit={handleSearch} className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nome ou usuário..."
                        className="w-full bg-slate-950/50 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-slate-200 focus:outline-none focus:border-indigo-500/50"
                    />
                </form>
            </div>

            {/* Users Grid */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="text-center text-slate-500 py-10">Pesquisando...</div>
                ) : users.length === 0 ? (
                    <div className="text-center text-slate-500 py-10">Nenhum usuário encontrado.</div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {users.map(user => (
                            <div key={user.id} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex gap-4 items-center hover:border-slate-700 transition-all">
                                <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold border-2 border-slate-700 overflow-hidden shrink-0">
                                    {user.avatarUrl ? (
                                        <img src={user.avatarUrl} alt={user.username} className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-lg">{user.username?.[0]?.toUpperCase()}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-slate-200 truncate">{user.name || user.username}</h3>
                                    <p className="text-xs text-slate-500 truncate">@{user.username}</p>
                                </div>
                                <button
                                    onClick={() => toggleFollow(user)}
                                    className={`px-3 py-2 rounded-xl transition-all ${user.isFollowing
                                            ? 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                                            : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/20'
                                        }`}
                                >
                                    {user.isFollowing ? <UserCheck size={18} /> : <UserPlus size={18} />}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
