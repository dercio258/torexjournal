import { useQuery } from '@tanstack/react-query';
import api from '../../../api';

interface HeatmapCell {
    day: number;
    hour: number;
    val: number;
}

interface HeatmapData {
    pnl: HeatmapCell[][];
    counts: HeatmapCell[][];
}

export const HeatmapChart = ({ endDate }: { endDate?: string }) => {
    const { data, isLoading } = useQuery<HeatmapData>({
        queryKey: ['heatmap', endDate],
        queryFn: async () => {
            const res = await api.get('/dashboard/heatmap', { params: { endDate } });
            return res.data;
        }
    });

    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const hours = Array.from({ length: 24 }, (_, i) => `${i}h`);

    const getColor = (val: number) => {
        if (Math.abs(val) < 0.01) return 'rgba(30, 41, 59, 0.2)'; // bg-slate-800/20
        if (val > 0) {
            if (val > 1000) return '#10b981'; // emerald-500
            if (val > 500) return '#059669'; // emerald-600
            return '#047857'; // emerald-700
        } else {
            if (val < -1000) return '#f43f5e'; // rose-500
            if (val < -500) return '#e11d48'; // rose-600
            return '#be123c'; // rose-700
        }
    };

    if (isLoading) {
        return (
            <div className="w-full h-full min-h-[300px] flex items-center justify-center bg-slate-900/40 rounded-2xl border border-slate-800">
                <div className="animate-pulse text-slate-500 text-sm">Carregando heatmap...</div>
            </div>
        );
    }

    return (
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl h-full flex flex-col shadow-xl">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-white font-bold text-lg">Distribuição de Lucratividade</h3>
                    <p className="text-xs text-slate-500">Seu desempenho por dia e hora (GMT)</p>
                </div>
                <div className="flex gap-4 items-center scale-75 md:scale-100 origin-right">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 uppercase font-bold">Perda</span>
                        <div className="flex gap-0.5">
                            <div className="w-3 h-3 rounded-xs" style={{ backgroundColor: '#be123c' }}></div>
                            <div className="w-3 h-3 rounded-xs" style={{ backgroundColor: '#f43f5e' }}></div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex gap-0.5">
                            <div className="w-3 h-3 rounded-xs" style={{ backgroundColor: '#10b981' }}></div>
                            <div className="w-3 h-3 rounded-xs" style={{ backgroundColor: '#047857' }}></div>
                        </div>
                        <span className="text-[10px] text-slate-500 uppercase font-bold">Lucro</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-x-auto no-scrollbar">
                <div className="min-w-[700px]">
                    {/* Header Hours */}
                    <div className="flex mb-3">
                        <div className="w-12"></div>
                        <div className="flex-1 flex gap-1">
                            {hours.map((h, i) => (
                                <div key={i} className="flex-1 text-[9px] text-slate-500 text-center font-bold">
                                    {i % 2 === 0 ? h : ''}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Rows */}
                    <div className="space-y-1">
                        {days.map((day, dayIdx) => (
                            <div key={day} className="flex items-center group">
                                <div className="w-12 text-[10px] text-slate-400 font-bold uppercase">{day}</div>
                                <div className="flex-1 flex gap-1">
                                    {Array.from({ length: 24 }).map((_, hourIdx) => {
                                        const pnlCell = data?.pnl?.[dayIdx]?.[hourIdx];
                                        const val = pnlCell?.val || 0;
                                        const count = data?.counts?.[dayIdx]?.[hourIdx]?.val || 0;
                                        
                                        return (
                                            <div
                                                key={hourIdx}
                                                title={`${days[dayIdx]} ${hourIdx}h: ${val.toFixed(2)} MT (${count} trades)`}
                                                className="flex-1 h-8 rounded-[2px] transition-all cursor-crosshair transform hover:scale-110 hover:z-10 hover:ring-1 hover:ring-white/30"
                                                style={{ backgroundColor: getColor(val) }}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            
            <div className="mt-6 pt-4 border-top border-slate-800/50 flex items-center justify-between">
                <div className="text-[10px] text-slate-500 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                    Métricas baseadas em {data?.counts.flat().reduce((acc, c) => acc + (c?.val || 0), 0) || 0} operações encerradas
                </div>
                <p className="text-[10px] text-slate-600 italic">
                    Cores intensas indicam maior volume de lucro/prejuízo
                </p>
            </div>
        </div>
    );
};
