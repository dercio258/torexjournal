import { Card } from '../components/ui/Card';
import { BookOpen } from 'lucide-react';
import { ConnectionManager } from '../components/dashboard/ConnectionManager';

export const TraderConnection = () => {
    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <header className="mb-8">
                <h1 className="text-2xl font-bold text-slate-100">Conexão & Importação</h1>
                <p className="text-sm text-slate-400">Conecte sua conta MT4/MT5 ou importe trades manualmente</p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Connection Manager */}
                <div className="lg:col-span-2 space-y-6">
                    <ConnectionManager />
                </div>

                {/* Right Column: Guide */}
                <div className="lg:col-span-1">
                    <Card className="p-6 sticky top-6">
                        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-amber-400" /> Guia de Conexão
                        </h2>

                        <div className="space-y-6">
                            {[
                                { step: 1, title: 'Baixar EA', text: 'Baixe o EA oficial para sua plataforma (MT4 ou MT5) nos botões ao lado.', color: 'bg-indigo-600' },
                                { step: 2, title: 'Instalar no MetaTrader', text: 'Vá em Arquivo > Abrir Pasta de Dados > MQL5/Experts e cole o arquivo.', color: 'bg-indigo-600' },
                                { step: 3, title: 'Ativar EA', text: 'Reinicie o MT5, arraste o EA para o gráfico e habilite "Importação de DLL".', color: 'bg-indigo-600' },
                                { step: 4, title: 'Inserir Token', text: 'Cole seu Token de Conexão nas configurações do EA. Pronto!', color: 'bg-emerald-500' }
                            ].map((item, i) => (
                                <div key={i} className="flex gap-4">
                                    <div className={`flex-shrink-0 w-8 h-8 ${item.color} rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg`}>
                                        {item.step}
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-bold text-slate-200 mb-0.5">{item.title}</h3>
                                        <p className="text-[11px] text-slate-400 leading-relaxed">{item.text}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};
