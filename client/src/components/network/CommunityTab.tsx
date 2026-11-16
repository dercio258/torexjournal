import React, { useEffect, useState } from 'react';
import { MessageSquare, Search, UserCheck, UserPlus } from 'lucide-react';
import api from '../../api';
import { useLocale } from '../../context/LocaleContext';
import { ChatPartnerTarget } from './ChatTab';

interface CommunityUser {
    id: string;
    username: string;
    name?: string;
    avatarUrl?: string;
    isFollowing?: boolean;
}

interface CommunityTabProps {
    onMessageUser?: (partner: ChatPartnerTarget) => void;
}

export const CommunityTab: React.FC<CommunityTabProps> = ({
    onMessageUser,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [users, setUsers] = useState<CommunityUser[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        void fetchUsers();
    }, []);

    const fetchUsers = async (query = '') => {
        setLoading(true);
        try {
            const res = await api.get('/network/users', {
                params: { q: query },
            });
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
        void fetchUsers(search);
    };

    const toggleFollow = async (target: CommunityUser) => {
        setUsers((prev) =>
            prev.map((u) =>
                u.id === target.id
                    ? { ...u, isFollowing: !u.isFollowing }
                    : u
            )
        );

        try {
            if (target.isFollowing) {
                await api.delete(`/network/follow/${target.id}`);
            } else {
                await api.post(`/network/follow/${target.id}`);
            }
        } catch {
            void fetchUsers(search);
        }
    };

    return (
        <div className="h-full flex flex-col gap-3">
            {/* Cabeçalho de Pesquisa */}
            <div className="bg-surface border border-line rounded-xl p-4">
                <h2 className="text-sm font-bold text-fg mb-0.5">
                    {isEn ? 'Community Members' : 'Membros da Comunidade'}
                </h2>
                <p className="text-xs text-fg-muted mb-3">
                    {isEn
                        ? 'Connect, follow fellow traders, and start real-time direct chats.'
                        : 'Conecte-se, siga outros traders e inicie conversas diretas em tempo real.'}
                </p>

                <form onSubmit={handleSearch} className="relative">
                    <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
                        size={14}
                    />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            if (!e.target.value.trim()) {
                                void fetchUsers('');
                            }
                        }}
                        placeholder={
                            isEn
                                ? 'Search trader by name or @username...'
                                : 'Buscar trader por nome ou @usuário...'
                        }
                        className="w-full h-9 bg-canvas-subtle border border-line rounded-lg pl-8 pr-3 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/50"
                    />
                </form>
            </div>

            {/* Grelha de Traders */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 pb-4">
                {loading ? (
                    <div className="text-center text-fg-subtle py-10 text-xs">
                        {isEn ? 'Searching members...' : 'Pesquisando membros...'}
                    </div>
                ) : users.length === 0 ? (
                    <div className="text-center text-fg-subtle py-10 text-xs">
                        {isEn ? 'No traders found.' : 'Nenhum trader encontrado.'}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {users.map((u) => (
                            <div
                                key={u.id}
                                className="bg-surface border border-line rounded-xl p-3.5 flex items-center gap-3 transition-colors hover:border-line-strong"
                            >
                                <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center text-fg font-bold text-xs border border-line-strong overflow-hidden shrink-0">
                                    {u.avatarUrl ? (
                                        <img
                                            src={u.avatarUrl}
                                            alt={u.username}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <span>
                                            {u.username?.[0]?.toUpperCase()}
                                        </span>
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-xs text-fg truncate">
                                        {u.name || u.username}
                                    </h3>
                                    <p className="text-[11px] text-accent-fg truncate font-mono">
                                        @{u.username}
                                    </p>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                    {onMessageUser && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onMessageUser({
                                                    id: u.id,
                                                    username: u.username,
                                                    name: u.name,
                                                    avatarUrl: u.avatarUrl,
                                                })
                                            }
                                            className="h-8 px-2.5 flex items-center gap-1 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-[11px] font-semibold text-fg transition-colors cursor-pointer"
                                            title={
                                                isEn
                                                    ? 'Send direct message'
                                                    : 'Enviar mensagem direta'
                                            }
                                        >
                                            <MessageSquare
                                                size={13}
                                                className="text-accent-fg"
                                            />
                                            <span className="hidden sm:inline">
                                                Chat
                                            </span>
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => void toggleFollow(u)}
                                        className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                                            u.isFollowing
                                                ? 'bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg border border-line'
                                                : 'bg-accent text-accent-on hover:bg-accent-hover'
                                        }`}
                                        title={
                                            u.isFollowing
                                                ? isEn
                                                    ? 'Unfollow'
                                                    : 'Deixar de seguir'
                                                : isEn
                                                ? 'Follow trader'
                                                : 'Seguir trader'
                                        }
                                    >
                                        {u.isFollowing ? (
                                            <UserCheck size={15} />
                                        ) : (
                                            <UserPlus size={15} />
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
