import { X } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

interface LogDetailsModalProps {
    log: any;
    onClose: () => void;
}

const MetricDisplay = ({ label, value, colorClass = "text-fg" }: any) => (
    <div className="bg-canvas border border-line p-3 rounded-xl flex justify-between items-center">
        <span className="text-fg-muted text-sm">{label}</span>
        <span className={`font-bold ${colorClass}`}>{value}/10</span>
    </div>
);

export const LogDetailsModal = ({ log, onClose }: LogDetailsModalProps) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    if (!log) return null;

    const getInsight = (score: number) => {
        if (isEn) {
            if (score >= 80) return "Peak mental readiness for execution. Maximum discipline.";
            if (score >= 60) return "Solid baseline. Stay sharp on your setup criteria.";
            if (score >= 40) return "Caution. Cognitive readiness is below optimal.";
            return "HIGH RISK! Stand down — trading readiness is compromised.";
        }
        if (score >= 80) return "Estado mental excelente para operar! Disciplina máxima.";
        if (score >= 60) return "Estado bom. Mantenha o foco.";
        if (score >= 40) return "Cuidado. Você não está no seu melhor.";
        return "PERIGO! Não opere. Estado mental comprometido.";
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/85 backdrop-blur-md">
            <div className="bg-surface border border-line rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl relative">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-line bg-canvas-subtle/90">
                    <h3 className="text-xl font-bold text-fg">{isEn ? 'Check-In Details' : 'Detalhes do Registro'}</h3>
                    <button onClick={onClose} className="text-fg-muted hover:text-fg transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Header Info */}
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="text-xs text-fg-subtle uppercase tracking-wider font-bold">{isEn ? 'Date & Time' : 'Data & Hora'}</p>
                            <p className="text-fg font-medium">
                                {new Date(log.updatedAt || log.createdAt || log.date).toLocaleString(isEn ? 'en-US' : 'pt-BR')}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-fg-subtle uppercase tracking-wider font-bold">{isEn ? 'Overall Score' : 'Score Geral'}</p>
                            <p className={`text-2xl font-bold ${log.overallScore >= 75 ? 'text-accent-fg' : log.overallScore >= 50 ? 'text-yellow-400' : 'text-danger-fg'}`}>
                                {log.overallScore}
                            </p>
                        </div>
                    </div>

                    {/* Insight */}
                    <div className="bg-canvas/60 border border-line p-4 rounded-xl">
                        <p className="text-xs text-fg-subtle uppercase tracking-wider font-bold mb-1">{isEn ? 'System Insight' : 'Insight do Sistema'}</p>
                        <p className="text-sm text-fg-muted italic">"{getInsight(log.overallScore)}"</p>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-3">
                        <MetricDisplay label={isEn ? 'Sleep' : 'Sono'} value={log.sleepQuality} colorClass="text-indigo-400" />
                        <MetricDisplay label={isEn ? 'Energy' : 'Energia'} value={log.energy} colorClass="text-yellow-400" />
                        <MetricDisplay label={isEn ? 'Focus' : 'Foco'} value={log.focus} colorClass="text-blue-400" />
                        <MetricDisplay label={isEn ? 'Mood' : 'Humor'} value={log.mood} colorClass="text-accent-fg" />
                        <MetricDisplay label={isEn ? 'Stress' : 'Stress'} value={log.stress} colorClass="text-danger-fg" />
                        <MetricDisplay label={isEn ? 'Caffeine' : 'Cafeína'} value={log.caffeine} colorClass="text-amber-600" />
                    </div>

                    {/* Notes */}
                    {log.notes && (
                        <div>
                            <p className="text-xs text-fg-subtle uppercase tracking-wider font-bold mb-2">{isEn ? 'Notes' : 'Notas'}</p>
                            <div className="bg-canvas/60 p-4 rounded-xl text-sm text-fg border border-line">
                                {log.notes}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
