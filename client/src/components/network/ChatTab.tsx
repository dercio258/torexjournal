import { useEffect, useState, useRef } from 'react';
import { Send } from 'lucide-react';
import { Socket } from 'socket.io-client';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

interface ChatMessage {
    id: number;
    content: string;
    userId: string;
    createdAt: string;
    user: {
        id: string;
        username: string;
        avatarUrl?: string;
    };
}

interface ChatTabProps {
    socket: Socket | null;
}

export const ChatTab = ({ socket }: ChatTabProps) => {
    const { user } = useAuth();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchHistory();
    }, []);

    useEffect(() => {
        if (!socket) return;

        socket.on('msgToClient', (msg: ChatMessage) => {
            setMessages(prev => [...prev, msg]);
            scrollToBottom();
        });

        return () => {
            socket.off('msgToClient');
        };
    }, [socket]);

    const fetchHistory = async () => {
        try {
            const res = await api.get('/network/chat/history');
            // Backend currently returns DESC (newest first), so we reverse for chat display
            if (Array.isArray(res.data)) {
                setMessages(res.data.reverse());
                scrollToBottom();
            }
        } catch (e) {
            console.error(e);
        }
    };

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
    };

    const handleSend = () => {
        if (!newMessage.trim() || !socket || !user) return;

        const token = localStorage.getItem('token');
        socket.emit('msgToServer', {
            content: newMessage,
            token
        });

        setNewMessage('');
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-900/50">
                <h3 className="font-bold text-slate-200">Chat Global</h3>
                <p className="text-xs text-slate-500">Converse com todos os traders da plataforma.</p>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {messages.map(msg => {
                    const isMe = msg.userId === user?.id;
                    return (
                        <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 border border-slate-700 shrink-0">
                                {msg.user?.avatarUrl ? (
                                    <img src={msg.user.avatarUrl} className="w-full h-full rounded-full object-cover" />
                                ) : (
                                    <span className="text-xs">{msg.user?.username?.[0]?.toUpperCase()}</span>
                                )}
                            </div>
                            <div className={`max-w-[70%] rounded-2xl p-3 ${isMe
                                ? 'bg-indigo-600 text-white rounded-tr-none'
                                : 'bg-slate-800 text-slate-200 rounded-tl-none'
                                }`}>
                                <div className="flex items-center gap-2 mb-1">
                                    {!isMe && <span className="text-xs font-bold text-indigo-400">{msg.user?.username}</span>}
                                    <span className={`text-[10px] ${isMe ? 'text-indigo-200' : 'text-slate-500'}`}>
                                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-slate-900/50 border-t border-slate-800">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newMessage}
                        onChange={e => setNewMessage(e.target.value)}
                        onKeyDown={handleKeyPress}
                        placeholder="Digite sua mensagem..."
                        className="flex-1 bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-2 text-slate-200 focus:outline-none focus:border-indigo-500/50"
                    />
                    <button
                        onClick={handleSend}
                        className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors shadow-lg shadow-indigo-900/20"
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
};
