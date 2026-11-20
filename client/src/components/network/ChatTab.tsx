import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ArrowLeft,
    Hash,
    MessageSquare,
    Search,
    Send,
    Users,
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import {
    DirectConversationSummary,
    DirectMessageItem,
} from './networkTypes';

interface ChannelMessage {
    id: number | string;
    content: string;
    room?: string;
    userId: string;
    createdAt: string;
    user: {
        id: string;
        username: string;
        avatarUrl?: string | null;
    };
}

export interface ChatPartnerTarget {
    id: string;
    username: string;
    avatarUrl?: string | null;
}

interface ChatTabProps {
    socket: Socket | null;
    initialPartner?: ChatPartnerTarget | null;
    onClearInitialPartner?: () => void;
    onUnreadChange?: (totalUnread: number) => void;
}

const COMMUNITY_CHANNELS = [
    {
        id: 'global',
        label: 'Geral Traders',
        labelEn: 'General Floor',
        description: 'Conversa aberta entre todos os traders da plataforma.',
        descriptionEn: 'Open floor discussion across all traders on the platform.',
    },
    {
        id: 'forex-gold',
        label: 'Forex & XAUUSD',
        labelEn: 'FX & XAUUSD',
        description: 'Análises de pares cambiais, ouro e liquidez.',
        descriptionEn: 'FX pairs, gold spot structure, and liquidity levels.',
    },
    {
        id: 'indices-synthetics',
        label: 'Índices & Sintéticos',
        labelEn: 'Indices & Synthetics',
        description: 'US100, US30, Volatility 75, Boom/Crash e execução.',
        descriptionEn: 'US100, US30, Volatility 75, Boom/Crash, and execution.',
    },
    {
        id: 'psychology',
        label: 'Gestão & Psicologia',
        labelEn: 'Risk & Psychology',
        description: 'Disciplina operacional, risco diário e consistência.',
        descriptionEn: 'Execution discipline, daily risk caps, and consistency.',
    },
];

export const ChatTab: React.FC<ChatTabProps> = ({
    socket,
    initialPartner,
    onClearInitialPartner,
    onUnreadChange,
}) => {
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';

    const [mode, setMode] = useState<'channel' | 'dm'>('channel');
    const [activeRoom, setActiveRoom] = useState<string>('global');
    const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);

    const [conversations, setConversations] = useState<
        DirectConversationSummary[]
    >([]);
    const [activePartner, setActivePartner] =
        useState<ChatPartnerTarget | null>(null);
    const [directMessages, setDirectMessages] = useState<DirectMessageItem[]>(
        []
    );

    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<ChatPartnerTarget[]>([]);

    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [mobilePane, setMobilePane] = useState<'list' | 'chat'>(() =>
        initialPartner?.id ? 'chat' : 'list'
    );
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = useCallback(() => {
        window.setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 80);
    }, []);

    const loadConversations = useCallback(async () => {
        try {
            const res = await api.get('/network/conversations');
            const list: DirectConversationSummary[] = Array.isArray(res.data)
                ? res.data
                : [];
            setConversations(list);
            const unreadTotal = list.reduce(
                (acc, item) => acc + (item.unreadCount || 0),
                0
            );
            onUnreadChange?.(unreadTotal);
        } catch {
            // ignore
        }
    }, [onUnreadChange]);

    const loadChannelHistory = useCallback(
        async (room: string) => {
            try {
                const res = await api.get('/network/chat/history', {
                    params: { room },
                });
                if (Array.isArray(res.data)) {
                    setChannelMessages(res.data);
                    scrollToBottom();
                }
            } catch {
                // ignore
            }
        },
        [scrollToBottom]
    );

    const loadDirectThread = useCallback(
        async (partner: ChatPartnerTarget) => {
            setMode('dm');
            setActivePartner(partner);
            setMobilePane('chat');
            try {
                const res = await api.get(
                    `/network/conversations/${partner.id}/messages`
                );
                if (res.data?.partner) {
                    setActivePartner(res.data.partner);
                }
                setDirectMessages(
                    Array.isArray(res.data?.messages) ? res.data.messages : []
                );
                scrollToBottom();
                void loadConversations();
            } catch {
                setDirectMessages([]);
            }
        },
        [loadConversations, scrollToBottom]
    );

    useEffect(() => {
        void loadConversations();
    }, [loadConversations]);

    useEffect(() => {
        if (mode === 'channel') {
            void loadChannelHistory(activeRoom);
        }
    }, [mode, activeRoom, loadChannelHistory]);

    useEffect(() => {
        if (initialPartner && initialPartner.id) {
            void loadDirectThread(initialPartner);
            onClearInitialPartner?.();
        }
    }, [initialPartner, loadDirectThread, onClearInitialPartner]);

    // Pesquisa rápida de usuários para iniciar conversa 1-a-1
    useEffect(() => {
        const q = userSearchQuery.trim();
        if (!q) {
            setSearchResults([]);
            return;
        }
        const timer = window.setTimeout(async () => {
            try {
                const res = await api.get('/network/users', {
                    params: { q },
                });
                setSearchResults(Array.isArray(res.data) ? res.data.slice(0, 6) : []);
            } catch {
                setSearchResults([]);
            }
        }, 250);
        return () => window.clearTimeout(timer);
    }, [userSearchQuery]);

    // Eventos em tempo real (Canais e Mensagens Diretas)
    useEffect(() => {
        if (!socket) return;

        const onChannelMsg = (msg: ChannelMessage) => {
            const msgRoom = msg.room || 'global';
            if (mode === 'channel' && msgRoom === activeRoom) {
                setChannelMessages((prev) => {
                    if (prev.some((m) => String(m.id) === String(msg.id))) {
                        return prev;
                    }
                    return [...prev, msg];
                });
                scrollToBottom();
            }
        };

        const onDirectMsg = (payload: any) => {
            const partnerId =
                payload.senderId === user?.id
                    ? payload.recipientId
                    : payload.senderId;

            if (mode === 'dm' && activePartner?.id === partnerId) {
                setDirectMessages((prev) => {
                    if (prev.some((m) => m.id === payload.id)) return prev;
                    return [
                        ...prev,
                        {
                            id: payload.id,
                            senderId: payload.senderId,
                            recipientId: payload.recipientId,
                            content: payload.content,
                            isRead: true,
                            createdAt: payload.createdAt,
                        },
                    ];
                });
                scrollToBottom();
            }
            void loadConversations();
        };

        socket.on('msgToClient', onChannelMsg);
        socket.on('dmToClient', onDirectMsg);

        return () => {
            socket.off('msgToClient', onChannelMsg);
            socket.off('dmToClient', onDirectMsg);
        };
    }, [socket, mode, activeRoom, activePartner, user?.id, loadConversations, scrollToBottom]);

    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const text = newMessage.trim();
        if (!text || !user || sending) return;

        setNewMessage('');
        setSending(true);

        try {
            if (mode === 'channel') {
                if (socket && socket.connected) {
                    const token = localStorage.getItem('token') || '';
                    socket.emit('msgToServer', {
                        content: text,
                        room: activeRoom,
                        token,
                    });
                } else {
                    const res = await api.post('/network/chat/message', {
                        content: text,
                        room: activeRoom,
                    });
                    if (res.data) {
                        setChannelMessages((prev) =>
                            prev.some((m) => String(m.id) === String(res.data.id))
                                ? prev
                                : [...prev, res.data]
                        );
                        scrollToBottom();
                    }
                }
            } else if (mode === 'dm' && activePartner) {
                const res = await api.post(
                    `/network/conversations/${activePartner.id}/messages`,
                    { content: text }
                );
                const saved = res.data;
                if (saved?.id) {
                    setDirectMessages((prev) =>
                        prev.some((m) => m.id === saved.id)
                            ? prev
                            : [
                                  ...prev,
                                  {
                                      id: saved.id,
                                      senderId: saved.senderId,
                                      recipientId: saved.recipientId,
                                      content: saved.content,
                                      isRead: saved.isRead,
                                      createdAt: saved.createdAt,
                                  },
                              ]
                    );
                    scrollToBottom();
                    void loadConversations();
                }
            }
        } catch {
            setNewMessage(text);
        } finally {
            setSending(false);
        }
    };

    const currentChannelMeta =
        COMMUNITY_CHANNELS.find((c) => c.id === activeRoom) ||
        COMMUNITY_CHANNELS[0];

    return (
        <div className="h-full min-h-[420px] bg-surface border border-line rounded-xl overflow-hidden flex flex-col md:flex-row">
            {/* Coluna Lateral: Salas Temáticas + Conversas Diretas entre Usuários */}
            <div
                className={`${
                    mobilePane === 'chat' ? 'hidden md:flex' : 'flex'
                } w-full md:w-64 lg:w-72 border-b md:border-b-0 md:border-r border-line-subtle bg-canvas-subtle flex-col shrink-0 flex-1 md:flex-initial min-h-0`}
            >
                {/* Salas da Comunidade */}
                <div className="p-3 border-b border-line-subtle">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle px-1.5 mb-1.5 flex items-center gap-1.5">
                        <Users size={11} className="text-accent-fg" />
                        <span>{isEn ? 'Community Rooms' : 'Salas da Comunidade'}</span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-1 gap-1">
                        {COMMUNITY_CHANNELS.map((ch) => {
                            const selected =
                                mode === 'channel' && activeRoom === ch.id;
                            return (
                                <button
                                    key={ch.id}
                                    type="button"
                                    onClick={() => {
                                        setMode('channel');
                                        setActiveRoom(ch.id);
                                        setMobilePane('chat');
                                    }}
                                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer text-left ${
                                        selected
                                            ? 'bg-surface-2 text-fg font-bold border border-line'
                                            : 'text-fg-muted hover:text-fg hover:bg-surface'
                                    }`}
                                >
                                    <Hash
                                        size={13}
                                        className={
                                            selected
                                                ? 'text-accent-fg shrink-0'
                                                : 'text-fg-subtle shrink-0'
                                        }
                                    />
                                    <span className="truncate">{isEn ? ch.labelEn : ch.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Conversas Diretas (1-para-1 entre Traders) */}
                <div className="flex-1 flex flex-col min-h-0 p-3 space-y-2 overflow-hidden">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle px-1 flex items-center gap-1.5">
                        <MessageSquare size={11} className="text-accent-fg" />
                        <span>{isEn ? 'Direct Messages' : 'Mensagens Diretas'}</span>
                    </div>

                    <div className="relative">
                        <Search
                            size={12}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
                        />
                        <input
                            type="text"
                            value={userSearchQuery}
                            onChange={(e) => setUserSearchQuery(e.target.value)}
                            placeholder={isEn ? 'Start chat with @trader...' : 'Iniciar conversa com @trader...'}
                            className="w-full h-8 rounded-lg bg-surface border border-line pl-7 pr-2.5 text-[11px] text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/60"
                        />

                        {searchResults.length > 0 && (
                            <div className="absolute left-0 right-0 top-9 z-30 rounded-xl bg-surface border border-line shadow-xl overflow-hidden divide-y divide-line-subtle">
                                {searchResults.map((u) => (
                                    <button
                                        key={u.id}
                                        type="button"
                                        onClick={() => {
                                            setUserSearchQuery('');
                                            setSearchResults([]);
                                            void loadDirectThread(u);
                                        }}
                                        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-surface-2 text-left cursor-pointer"
                                    >
                                        <div className="w-6 h-6 rounded-full bg-surface-2 border border-line flex items-center justify-center text-[10px] font-bold text-fg overflow-hidden shrink-0">
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
                                        <div className="min-w-0">
                                            <div className="text-xs font-bold text-fg font-mono truncate">
                                                @{u.username}
                                            </div>
                                            <div className="text-[10px] text-fg-subtle truncate">
                                                {isEn ? 'Community Trader' : 'Trader Torex'}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                        {conversations.length === 0 ? (
                            <p className="text-[11px] text-fg-subtle px-1 py-3">
                                {isEn
                                    ? 'Search a trader above or click "Message" on a profile to start a direct chat.'
                                    : 'Pesquise um trader acima ou clique em "Conversar" num perfil para abrir um chat direto.'}
                            </p>
                        ) : (
                            conversations.map((conv) => {
                                const isSelected =
                                    mode === 'dm' &&
                                    activePartner?.id === conv.partner.id;

                                return (
                                    <button
                                        key={conv.partner.id}
                                        type="button"
                                        onClick={() =>
                                            void loadDirectThread(conv.partner)
                                        }
                                        className={`w-full p-2 rounded-lg flex items-center gap-2.5 text-left transition-colors cursor-pointer ${
                                            isSelected
                                                ? 'bg-surface-2 border border-line'
                                                : 'hover:bg-surface border border-transparent'
                                        }`}
                                    >
                                        <div className="w-8 h-8 rounded-full bg-surface-2 border border-line-strong flex items-center justify-center text-xs font-bold text-fg overflow-hidden shrink-0">
                                            {conv.partner.avatarUrl ? (
                                                <img
                                                    src={conv.partner.avatarUrl}
                                                    alt={conv.partner.username}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <span>
                                                    {conv.partner.username?.[0]?.toUpperCase()}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-1">
                                                <span className="text-xs font-bold text-fg font-mono truncate">
                                                    @{conv.partner.username}
                                                </span>
                                                {conv.unreadCount > 0 && (
                                                    <span className="px-1.5 py-0.2 rounded-full bg-accent text-accent-on text-[10px] font-extrabold tabular-nums">
                                                        {conv.unreadCount}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-fg-subtle truncate">
                                                {conv.lastMessage}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Palco Principal da Conversa */}
            <div
                className={`${
                    mobilePane === 'list' ? 'hidden md:flex' : 'flex'
                } flex-1 flex-col min-w-0 min-h-0`}
            >
                {/* Cabeçalho da Conversa Ativa */}
                <div className="px-3 sm:px-4 py-2.5 border-b border-line-subtle bg-canvas-subtle flex items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <button
                            type="button"
                            onClick={() => setMobilePane('list')}
                            className="md:hidden p-1.5 -ml-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
                            aria-label={isEn ? 'Back to rooms & chats' : 'Voltar para salas e conversas'}
                        >
                            <ArrowLeft size={16} />
                        </button>
                        {mode === 'channel' ? (
                            <div className="min-w-0">
                                <h3 className="text-xs font-bold text-fg flex items-center gap-1.5">
                                    <Hash size={14} className="text-accent-fg shrink-0" />
                                    <span className="truncate">{isEn ? currentChannelMeta.labelEn : currentChannelMeta.label}</span>
                                </h3>
                                <p className="text-[11px] text-fg-muted truncate">
                                    {isEn ? currentChannelMeta.descriptionEn : currentChannelMeta.description}
                                </p>
                            </div>
                        ) : activePartner ? (
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-full bg-surface-2 border border-line-strong flex items-center justify-center text-xs font-bold text-fg overflow-hidden shrink-0">
                                    {activePartner.avatarUrl ? (
                                        <img
                                            src={activePartner.avatarUrl}
                                            alt={activePartner.username}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <span>
                                            {activePartner.username?.[0]?.toUpperCase()}
                                        </span>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xs font-bold text-fg font-mono truncate">
                                        @{activePartner.username}
                                    </h3>
                                    <p className="text-[11px] text-accent-fg truncate">
                                        {isEn ? 'Direct Message' : 'Conversa Direta'}
                                    </p>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* Lista de Mensagens */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {mode === 'channel' ? (
                        channelMessages.length === 0 ? (
                            <div className="py-16 text-center text-xs text-fg-subtle">
                                {isEn
                                    ? 'No messages in this room yet. Start the discussion with the community!'
                                    : 'Nenhuma mensagem nesta sala ainda. Inicie a conversa com a comunidade!'}
                            </div>
                        ) : (
                            channelMessages.map((msg) => {
                                const isMe = msg.userId === user?.id;
                                const avatarSrc = isMe
                                    ? user?.avatarUrl || msg.user?.avatarUrl
                                    : msg.user?.avatarUrl;

                                return (
                                    <div
                                        key={msg.id}
                                        className={`flex items-start gap-2.5 ${
                                            isMe ? 'flex-row-reverse' : ''
                                        }`}
                                    >
                                        <div
                                            onClick={() => {
                                                if (!isMe && msg.user?.id) {
                                                    void loadDirectThread({
                                                        id: msg.user.id,
                                                        username:
                                                            msg.user.username,
                                                        avatarUrl:
                                                            msg.user.avatarUrl,
                                                    });
                                                }
                                            }}
                                            title={
                                                !isMe
                                                    ? isEn
                                                        ? `Direct message @${msg.user?.username}`
                                                        : `Conversar em privado com @${msg.user?.username}`
                                                    : undefined
                                            }
                                            className={`w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold shrink-0 overflow-hidden ${
                                                isMe
                                                    ? 'border-emerald-500/50 bg-surface-2 text-accent-fg'
                                                    : 'border-line-strong bg-surface-2 text-fg cursor-pointer hover:border-accent'
                                            }`}
                                        >
                                            {avatarSrc ? (
                                                <img
                                                    src={avatarSrc}
                                                    alt={msg.user?.username}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <span>
                                                    {(isMe
                                                        ? user?.username
                                                        : msg.user?.username)?.[0]?.toUpperCase() ||
                                                        'T'}
                                                </span>
                                            )}
                                        </div>

                                        <div
                                            className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-xs ${
                                                isMe
                                                    ? 'bg-emerald-600 text-white rounded-tr-sm font-medium'
                                                    : 'bg-surface-2 border border-line-subtle text-fg rounded-tl-sm'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 mb-0.5">
                                                {!isMe && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            msg.user?.id &&
                                                            void loadDirectThread(
                                                                {
                                                                    id: msg.user
                                                                        .id,
                                                                    username:
                                                                        msg.user
                                                                            .username,
                                                                    avatarUrl:
                                                                        msg.user
                                                                            .avatarUrl,
                                                                }
                                                            )
                                                        }
                                                        className="text-[11px] font-bold text-accent-fg hover:underline cursor-pointer"
                                                    >
                                                        @{msg.user?.username}
                                                    </button>
                                                )}
                                                <span
                                                    className={`text-[10px] tabular-nums ${
                                                        isMe
                                                            ? 'text-white/75'
                                                            : 'text-fg-subtle'
                                                    }`}
                                                >
                                                    {new Date(
                                                        msg.createdAt
                                                    ).toLocaleTimeString([], {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </span>
                                            </div>
                                            <p className="whitespace-pre-wrap break-words leading-relaxed">
                                                {msg.content}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })
                        )
                    ) : directMessages.length === 0 ? (
                        <div className="py-16 text-center text-xs text-fg-subtle">
                            {isEn ? (
                                <>
                                    Send the first direct message to{' '}
                                    <strong className="text-fg">
                                        @{activePartner?.username}
                                    </strong>
                                    .
                                </>
                            ) : (
                                <>
                                    Envie a primeira mensagem direta para{' '}
                                    <strong className="text-fg">
                                        @{activePartner?.username}
                                    </strong>
                                    .
                                </>
                            )}
                        </div>
                    ) : (
                        directMessages.map((dm) => {
                            const isMe = dm.senderId === user?.id;
                            const avatarSrc = isMe
                                ? user?.avatarUrl
                                : activePartner?.avatarUrl;
                            const initial = (isMe
                                ? user?.username
                                : activePartner?.username)?.[0]?.toUpperCase();

                            return (
                                <div
                                    key={dm.id}
                                    className={`flex items-start gap-2.5 ${
                                        isMe ? 'flex-row-reverse' : ''
                                    }`}
                                >
                                    <div
                                        className={`w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold shrink-0 overflow-hidden ${
                                            isMe
                                                ? 'border-emerald-500/50 bg-surface-2 text-accent-fg'
                                                : 'border-line-strong bg-surface-2 text-fg'
                                        }`}
                                    >
                                        {avatarSrc ? (
                                            <img
                                                src={avatarSrc}
                                                alt="Avatar"
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <span>{initial || 'T'}</span>
                                        )}
                                    </div>

                                    <div
                                        className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-xs ${
                                            isMe
                                                ? 'bg-emerald-600 text-white rounded-tr-sm font-medium'
                                                : 'bg-surface-2 border border-line-subtle text-fg rounded-tl-sm'
                                        }`}
                                    >
                                        <p className="whitespace-pre-wrap break-words leading-relaxed">
                                            {dm.content}
                                        </p>
                                        <div
                                            className={`text-[10px] mt-0.5 tabular-nums text-right ${
                                                isMe
                                                    ? 'text-white/75'
                                                    : 'text-fg-subtle'
                                            }`}
                                        >
                                            {new Date(
                                                dm.createdAt
                                            ).toLocaleTimeString([], {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Composer de Mensagem */}
                <form
                    onSubmit={handleSend}
                    className="p-3 bg-canvas-subtle border-t border-line-subtle flex items-center gap-2 shrink-0"
                >
                    <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder={
                            mode === 'channel'
                                ? isEn
                                    ? `Message in #${currentChannelMeta.labelEn}...`
                                    : `Mensagem em #${currentChannelMeta.label}...`
                                : isEn
                                ? `Direct message to @${activePartner?.username || 'trader'}...`
                                : `Mensagem direta para @${activePartner?.username || 'trader'}...`
                        }
                        className="flex-1 h-9 bg-surface border border-line rounded-xl px-3.5 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/60"
                    />
                    <button
                        type="submit"
                        disabled={!newMessage.trim() || sending}
                        className="h-9 px-3.5 flex items-center justify-center gap-1.5 bg-accent hover:bg-accent-hover disabled:opacity-45 text-accent-on rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0"
                    >
                        <Send size={14} />
                        <span className="hidden sm:inline">{isEn ? 'Send' : 'Enviar'}</span>
                    </button>
                </form>
            </div>
        </div>
    );
};
