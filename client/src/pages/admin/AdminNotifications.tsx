import React, { useState, useEffect } from 'react';
import { 
  Send, 
  Calendar, 
  Users, 
  MessageSquare, 
  Mail, 
  History, 
  Clock, 
  Trash2, 
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Phone
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import api from '../../api';

export const AdminNotifications = () => {
    const [broadcasts, setBroadcasts] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Form state
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [category, setCategory] = useState('all');
    const [channels, setChannels] = useState<string[]>(['email', 'in_app']);
    const [scheduledAt, setScheduledAt] = useState('');
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurrenceInterval, setRecurrenceInterval] = useState('none');

    useEffect(() => {
        fetchBroadcasts();
    }, []);

    const fetchBroadcasts = async () => {
        try {
            const { data } = await api.get('/admin/broadcasts');
            setBroadcasts(data);
        } catch (error) {
            console.error('Failed to fetch broadcasts', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateBroadcast = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await api.post('/admin/broadcasts', {
                title,
                message,
                category,
                channels,
                scheduledAt: scheduledAt || null,
                isRecurring,
                recurrenceInterval
            });
            
            // Reset form
            setTitle('');
            setMessage('');
            setScheduledAt('');
            setIsRecurring(false);
            setRecurrenceInterval('none');
            
            fetchBroadcasts();
        } catch (error) {
            console.error('Failed to create broadcast', error);
            alert('Erro ao criar notificação');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir esta campanha?')) return;
        try {
            await api.delete(`/admin/broadcasts/${id}`);
            fetchBroadcasts();
        } catch (error) {
            console.error(error);
        }
    };

    const toggleChannel = (channel: string) => {
        setChannels(prev => 
            prev.includes(channel) 
                ? prev.filter(c => c !== channel) 
                : [...prev, channel]
        );
    };

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white">Notificações em Massa</h1>
                    <p className="text-slate-400 mt-1">Envie comunicados, avisos e anúncios para seus usuários.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Composition Form */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <Send size={20} className="text-indigo-400" />
                            Nova Campanha
                        </h2>
                        
                        <form onSubmit={handleCreateBroadcast} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Título da Mensagem</label>
                                <input 
                                    type="text" 
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Ex: Atualização do Sistema"
                                    className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Conteúdo da Mensagem</label>
                                <textarea 
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="Escreva sua mensagem aqui..."
                                    rows={5}
                                    className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 transition-all outline-none resize-none"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Categoria de Usuários</label>
                                    <select 
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-3 text-white outline-none"
                                    >
                                        <option value="all">Todos os Usuários</option>
                                        <option value="free">Somente Free</option>
                                        <option value="basic">Traders Básico</option>
                                        <option value="premium">Analista Premium</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Canais de Envio</label>
                                    <div className="flex gap-2">
                                        <button 
                                            type="button"
                                            onClick={() => toggleChannel('email')}
                                            className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${channels.includes('email') ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                                        >
                                            <Mail size={18} /> Email
                                        </button>
                                        <button 
                                            type="button"
                                            onClick={() => toggleChannel('in_app')}
                                            className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${channels.includes('in_app') ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                                        >
                                            <MessageSquare size={18} /> In-App
                                        </button>
                                        <button 
                                            type="button"
                                            onClick={() => toggleChannel('sms')}
                                            className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${channels.includes('sms') ? 'bg-amber-500/10 border-amber-500 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                                        >
                                            <Phone size={18} /> SMS
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-800">
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1 flex items-center gap-2">
                                        <Clock size={14} /> Agendar para (Opcional)
                                    </label>
                                    <input 
                                        type="datetime-local" 
                                        value={scheduledAt}
                                        onChange={(e) => setScheduledAt(e.target.value)}
                                        className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-3 text-white outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1 flex items-center gap-2">
                                        <RefreshCw size={14} /> Recorrência
                                    </label>
                                    <select 
                                        value={recurrenceInterval}
                                        onChange={(e) => {
                                            setRecurrenceInterval(e.target.value);
                                            setIsRecurring(e.target.value !== 'none');
                                        }}
                                        className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-3 text-white outline-none"
                                    >
                                        <option value="none">Uma única vez</option>
                                        <option value="daily">Diário</option>
                                        <option value="weekly">Semanal</option>
                                        <option value="monthly">Mensal</option>
                                    </select>
                                </div>
                            </div>

                            <button 
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 mt-4"
                            >
                                {isSubmitting ? 'Processando...' : scheduledAt ? 'Agendar Notificação' : 'Enviar Agora'}
                                <Send size={20} />
                            </button>
                        </form>
                    </Card>
                </div>

                {/* Status and Summary Info */}
                <div className="space-y-6">
                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                            <Users size={18} className="text-indigo-400" />
                            Público Alvo
                        </h3>
                        <p className="text-sm text-slate-400">
                            Ao selecionar uma categoria, o sistema filtrará automaticamente os usuários correspondentes.
                        </p>
                        <div className="mt-4 space-y-2">
                            <div className="flex items-center justify-between text-xs p-2 bg-slate-800/50 rounded-lg">
                                <span className="text-slate-300">Total de Usuários</span>
                                <span className="text-white font-mono">Calculando...</span>
                            </div>
                        </div>
                    </Card>

                    <Card className="p-6 border-slate-800 bg-slate-900/50">
                        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                            <AlertCircle size={18} className="text-amber-400" />
                            Regras de Envio
                        </h3>
                        <ul className="text-xs text-slate-400 space-y-2 list-disc pl-4">
                            <li>Mensagens agendadas serão disparadas automaticamente.</li>
                            <li>Recorrências geram novos disparos baseados no intervalo.</li>
                            <li><strong>SMS:</strong> Sujeito a limites mensais por plano (Basic: 5, Pro: 20).</li>
                            <li>Notificações de renovação (5 dias) são automáticas do sistema.</li>
                        </ul>
                    </Card>
                </div>
            </div>

            {/* History Table */}
            <div className="space-y-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <History size={20} className="text-indigo-400" />
                    Histórico de Envios
                </h2>
                
                <Card className="border-slate-800 bg-slate-900/50 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-900 text-slate-400 uppercase font-medium text-[10px] tracking-wider">
                                <tr>
                                    <th className="px-6 py-4">Título / Mensagem</th>
                                    <th className="px-6 py-4">Público</th>
                                    <th className="px-6 py-4">Canais</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4">Agendado/Enviado em</th>
                                    <th className="px-6 py-4">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 text-slate-300">
                                {isLoading ? (
                                    <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500">Carregando histórico...</td></tr>
                                ) : broadcasts.length === 0 ? (
                                    <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500">Nenhuma campanha encontrada.</td></tr>
                                ) : broadcasts.map((b) => (
                                    <tr key={b.id} className="hover:bg-slate-800/30">
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-white mb-1">{b.title}</div>
                                            <div className="text-xs text-slate-500 truncate max-w-[200px]">{b.message}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="capitalize px-2 py-0.5 rounded-full bg-slate-800 text-xs">
                                                {b.category}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex gap-1">
                                                {b.channels?.map((c: string) => (
                                                    <div key={c} className="p-1 bg-slate-800 rounded text-slate-400" title={c}>
                                                        {c === 'email' ? <Mail size={12} /> : c === 'sms' ? <Phone size={12} /> : <MessageSquare size={12} />}
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {b.status === 'sent' ? (
                                                <span className="flex items-center gap-1 text-emerald-500 text-xs font-bold">
                                                    <CheckCircle2 size={12} /> Enviado
                                                </span>
                                            ) : b.status === 'scheduled' ? (
                                                <span className="flex items-center gap-1 text-indigo-400 text-xs font-bold">
                                                    <Calendar size={12} /> Agendado
                                                </span>
                                            ) : (
                                                <span className="text-slate-500 text-xs italic">{b.status}</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-xs">
                                            {b.nextRunAt ? new Date(b.nextRunAt).toLocaleString() : b.sentAt ? new Date(b.sentAt).toLocaleString() : '-'}
                                            {b.isRecurring && (
                                                <div className="text-amber-500 font-bold mt-1 text-[10px] uppercase">
                                                    Recorrente ({b.recurrenceInterval})
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <button 
                                                onClick={() => handleDelete(b.id)}
                                                className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
        </div>
    );
};
