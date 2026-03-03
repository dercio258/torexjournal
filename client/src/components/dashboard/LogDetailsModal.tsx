import { X } from 'lucide-react';


interface LogDetailsModalProps {
    log: any;
    onClose: () => void;
}

const MetricDisplay = ({ label, value, colorClass = "text-slate-200" }: any) => (
    <div className="bg-slate-800/50 p-3 rounded-lg flex justify-between items-center">
        <span className="text-slate-400 text-sm">{label}</span>
        <span className={`font-bold ${colorClass}`}>{value}/10</span>
    </div>
);

export const LogDetailsModal = ({ log, onClose }: LogDetailsModalProps) => {
    if (!log) return null;

    const getInsight = (score: number) => {
        if (score >= 80) return "Estado mental excelente para operar! Disciplina máxima.";
        if (score >= 60) return "Estado bom. Mantenha o foco.";
        if (score >= 40) return "Cuidado. Você não está no seu melhor.";
        return "PERIGO! Não opere. Estado mental comprometido.";
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700/50 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl relative">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-slate-800">
                    <h3 className="text-xl font-bold text-slate-100">Detalhes do Registro</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Header Info */}
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Data & Hora</p>
                            <p className="text-slate-200 font-medium">
                                {new Date(log.updatedAt || log.createdAt || log.date).toLocaleString('pt-BR')}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Score Geral</p>
                            <p className={`text-2xl font-bold ${log.overallScore >= 75 ? 'text-emerald-400' : log.overallScore >= 50 ? 'text-yellow-400' : 'text-rose-400'}`}>
                                {log.overallScore}
                            </p>
                        </div>
                    </div>

                    {/* Insight */}
                    <div className="bg-slate-800/30 border border-slate-700/50 p-4 rounded-xl">
                        <p className="text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Insight do Sistema</p>
                        <p className="text-sm text-slate-300 italic">"{getInsight(log.overallScore)}"</p>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-3">
                        <MetricDisplay label="Sono" value={log.sleepQuality} colorClass="text-indigo-400" />
                        <MetricDisplay label="Energia" value={log.energy} colorClass="text-yellow-400" />
                        <MetricDisplay label="Foco" value={log.focus} colorClass="text-blue-400" />
                        <MetricDisplay label="Humor" value={log.mood} colorClass="text-emerald-400" />
                        <MetricDisplay label="Stress" value={log.stress} colorClass="text-rose-400" />
                        <MetricDisplay label="Cafeína" value={log.caffeine} colorClass="text-amber-600" />
                    </div>

                    {/* Notes */}
                    {log.notes && (
                        <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wider font-bold mb-2">Notas</p>
                            <div className="bg-slate-800/30 p-4 rounded-xl text-sm text-slate-300 border border-slate-800">
                                {log.notes}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
