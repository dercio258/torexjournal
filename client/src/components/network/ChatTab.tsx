import { useEffect, useState, useRef } from 'react';
import { Send, BrainCircuit, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Socket } from 'socket.io-client';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

interface ChatMessage {
    id: number | string;
    content: string;
    userId: string;
    createdAt: string;
    user: {
        id: string;
        username: string;
        avatarUrl?: string;
    };
    isAi?: boolean; // Flag to identify AI insights
    aiData?: any; // Store the original insight payload
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
            // Fetch normal chat history
            const res = await api.get('/network/chat/history');
            let allMessages: ChatMessage[] = [];

            if (Array.isArray(res.data)) {
                allMessages = res.data;
            }

            // Fetch AI Insights
            try {
                const aiRes = await api.get('/ai/insights');
                if (Array.isArray(aiRes.data)) {
                    const aiMessages: ChatMessage[] = aiRes.data.map((insight: any) => ({
                        id: `ai-${insight.id}`,
                        content: insight.headline,
                        userId: 'ai-bot',
                        createdAt: insight.createdAt,
                        user: {
                            id: 'ai-bot',
                            username: 'Assistente IA Torex',
                            avatarUrl: ''
                        },
                        isAi: true,
                        aiData: insight
                    }));
                    allMessages = [...allMessages, ...aiMessages];
                }
            } catch (aiError) {
                console.error("Failed to fetch AI insights for chat", aiError);
            }

            // Sort all messages by date ascending (oldest first for chat display)
            allMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

            setMessages(allMessages);
            scrollToBottom();
        } catch (e) {
            console.error(e);
        }
    };

    const renderSeverityIcon = (severity: string) => {
        switch (severity) {
            case 'red': return <AlertTriangle className="text-rose-500 w-4 h-4 flex-shrink-0" />;
            case 'yellow': return <AlertCircle className="text-amber-500 w-4 h-4 flex-shrink-0" />;
            case 'green':
            default: return <CheckCircle2 className="text-emerald-500 w-4 h-4 flex-shrink-0" />;
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
                    const isAi = msg.isAi;

                    return (
                        <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border shrink-0 overflow-hidden ${isAi ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                                {isAi ? (
                                    <BrainCircuit size={16} />
                                ) : msg.user?.avatarUrl ? (
                                    <img src={msg.user.avatarUrl} className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-xs">{msg.user?.username?.[0]?.toUpperCase()}</span>
                                )}
                            </div>

                            <div className={`max-w-[75%] rounded-2xl p-3 ${isAi
                                ? 'bg-emerald-900/20 border border-emerald-500/20 text-slate-200 rounded-tl-none'
                                : isMe
                                    ? 'bg-indigo-600 text-white rounded-tr-none'
                                    : 'bg-slate-800 text-slate-200 rounded-tl-none'
                                }`}>
                                <div className="flex items-center gap-2 mb-1">
                                    {!isMe && <span className={`text-xs font-bold ${isAi ? 'text-emerald-400' : 'text-indigo-400'}`}>{msg.user?.username}</span>}
                                    <span className={`text-[10px] ${isMe ? 'text-indigo-200' : 'text-slate-500'}`}>
                                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>

                                {isAi ? (
                                    <div className="space-y-3">
                                        <p className="text-sm font-bold text-emerald-100">{msg.content}</p>

                                        {msg.aiData?.insights && msg.aiData.insights.length > 0 && (
                                            <div className="space-y-1 mt-2">
                                                {msg.aiData.insights.map((insight: any, idx: number) => (
                                                    <div key={idx} className="flex gap-2 text-xs text-slate-300 items-start">
                                                        <div className="mt-0.5">{renderSeverityIcon(insight.severity)}</div>
                                                        <span className="leading-snug">{insight.text}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {msg.aiData?.actions && msg.aiData.actions.length > 0 && (
                                            <div className="space-y-1 mt-2 pt-2 border-t border-emerald-500/20">
                                                <span className="text-[10px] uppercase font-bold text-emerald-500 tracking-wider">Ações Sugeridas</span>
                                                <ul className="list-disc pl-4 text-xs text-slate-300 space-y-0.5">
                                                    {msg.aiData.actions.map((action: string, idx: number) => (
                                                        <li key={idx}>{action}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                )}
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
