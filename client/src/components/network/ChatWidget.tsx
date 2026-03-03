import { useEffect, useState, useRef } from 'react';
import { Send, MessageSquare, X } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';
import api from '../../api';

interface Message {
    id: number;
    content: string;
    createdAt: string;
    user: {
        username: string;
        avatarUrl?: string;
    };
}

export const ChatWidget = () => {
    const { token, user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const socketRef = useRef<Socket | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [unreadCount, setUnreadCount] = useState(0);

    // Scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (isOpen) {
            scrollToBottom();
            setUnreadCount(0);
        }
    }, [messages, isOpen]);

    useEffect(() => {
        if (!token) return;

        // Fetch History
        api.get('/network/chat/history').then(res => {
            // Reverse because backend gives us DESC (newest first), but chat displays oldest at top
            setMessages(res.data.reverse());
        });

        // Initialize Socket
        // Using namespace /network
        const socket = io('http://localhost:3000/network', {
            auth: { token },
            transports: ['websocket']
        });

        socket.on('connect', () => {
            console.log('Chat Connected');
        });

        socket.on('msgToClient', (msg: Message) => {
            setMessages(prev => [...prev, msg]);
            if (!isOpen) {
                setUnreadCount(prev => prev + 1);
            }
        });

        socketRef.current = socket;

        return () => {
            socket.disconnect();
        };
    }, [token, isOpen]);

    const handleSend = () => {
        if (!newMessage.trim() || !socketRef.current) return;

        socketRef.current.emit('msgToServer', {
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
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            {/* Chat Window */}
            {isOpen && (
                <div className="mb-4 w-80 md:w-96 h-[500px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-200">
                    {/* Header */}
                    <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            Comunidade Pro
                        </h3>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="bg-slate-800 p-1 rounded-full text-slate-400 hover:text-white"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-900/50">
                        {messages.map((msg, idx) => {
                            const isMe = msg.user.username === user?.username;
                            const showAvatar = idx === 0 || messages[idx - 1].user.username !== msg.user.username;

                            return (
                                <div key={idx} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                                    {/* Avatar (only show if sequence changes) */}
                                    <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${showAvatar ? 'opacity-100' : 'opacity-0'} ${isMe ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                                        {msg.user.avatarUrl ? <img src={msg.user.avatarUrl} className="rounded-full" /> : msg.user.username[0].toUpperCase()}
                                    </div>

                                    <div className={`flex flex-col max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                                        {showAvatar && !isMe && <span className="text-[10px] text-slate-500 ml-1 mb-1">{msg.user.username}</span>}
                                        <div className={`px-3 py-2 rounded-xl text-sm ${isMe ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-tl-none'}`}>
                                            {msg.content}
                                        </div>
                                        <span className="text-[10px] text-slate-600 mt-1">{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="p-3 bg-slate-950 border-t border-slate-800 flex gap-2">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={e => setNewMessage(e.target.value)}
                            onKeyDown={handleKeyPress}
                            placeholder="Digite sua mensagem..."
                            className="flex-1 bg-slate-800 border-none rounded-xl px-4 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                        <button
                            onClick={handleSend}
                            className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* Toggle Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="group relative flex items-center justify-center w-14 h-14 bg-indigo-600 hover:bg-indigo-500 rounded-full shadow-lg shadow-indigo-900/40 transition-all hover:scale-110 active:scale-95"
                >
                    <MessageSquare size={26} className="text-white" />
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center border-2 border-slate-900">
                            {unreadCount}
                        </span>
                    )}
                </button>
            )}
        </div>
    );
};
