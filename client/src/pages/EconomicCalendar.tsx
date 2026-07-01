import { useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';

const EconomicCalendar = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-[500px] h-[calc(100vh-10rem)] flex flex-col items-center justify-center text-center p-8 bg-slate-950/40 backdrop-blur-xl relative overflow-hidden rounded-3xl border border-slate-900 shadow-2xl">
            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-emerald-500/5 rounded-full blur-[80px] -z-10" />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-[80px] -z-10" />
            
            <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 shadow-xl shadow-emerald-500/5">
                <Lock size={36} className="animate-pulse" />
            </div>

            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight mb-3">
                Calendário Econômico em Desenvolvimento
            </h1>
            <p className="text-slate-400 text-sm max-w-md leading-relaxed mb-8">
                Estamos preparando o Calendário Econômico Inteligente integrado para exibir eventos macroeconômicos de alto impacto em tempo real diretamente acoplados ao seu painel. Em breve estará disponível.
            </p>

            <button
                onClick={() => navigate('/dashboard')}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white font-bold py-2.5 px-6 rounded-xl border border-slate-800 hover:border-slate-700 transition-all cursor-pointer"
            >
                <ArrowLeft size={16} />
                Voltar ao Painel
            </button>
        </div>
    );
};

export default EconomicCalendar;
