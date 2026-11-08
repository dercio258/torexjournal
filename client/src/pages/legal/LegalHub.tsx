import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, Shield, AlertTriangle, RefreshCcw } from 'lucide-react';

export const LegalHub = () => {
    return (
        <div className="min-h-screen bg-canvas text-fg py-20 px-6">
            <div className="max-w-4xl mx-auto">
                <Link to="/" className="inline-flex items-center text-emerald-500 hover:text-accent-fg mb-8 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar para Home
                </Link>

                <h1 className="text-4xl md:text-5xl font-bold text-fg mb-6">Central Legal</h1>
                <p className="text-fg-muted text-lg mb-12">
                    Nesta seção, você encontra todos os documentos legais e políticas que regem o uso do Torex Journal.
                    Nosso compromisso é com a transparência e a segurança dos seus dados.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Termos e Condições */}
                    <Link to="/terms" className="block p-6 rounded-2xl bg-surface/50 border border-line hover:border-emerald-500/30 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/10 group">
                        <div className="w-12 h-12 bg-surface-2 rounded-lg flex items-center justify-center mb-4 text-accent-fg group-hover:bg-emerald-500/10 group-hover:scale-110 transition-all">
                            <FileText size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-fg mb-2 group-hover:text-accent-fg transition-colors">Termos e Condições</h2>
                        <p className="text-fg-muted text-sm">
                            Regras gerais de uso, limitações de responsabilidade e detalhes sobre assinaturas.
                        </p>
                    </Link>

                    {/* Política de Privacidade */}
                    <Link to="/privacy" className="block p-6 rounded-2xl bg-surface/50 border border-line hover:border-emerald-500/30 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/10 group">
                        <div className="w-12 h-12 bg-surface-2 rounded-lg flex items-center justify-center mb-4 text-accent-fg group-hover:bg-emerald-500/10 group-hover:scale-110 transition-all">
                            <Shield size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-fg mb-2 group-hover:text-accent-fg transition-colors">Política de Privacidade</h2>
                        <p className="text-fg-muted text-sm">
                            Como coletamos, usamos e protegemos seus dados pessoais e de trading.
                        </p>
                    </Link>

                    {/* Aviso de Risco */}
                    <Link to="/risk-disclosure" className="block p-6 rounded-2xl bg-surface/50 border border-line hover:border-emerald-500/30 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/10 group">
                        <div className="w-12 h-12 bg-surface-2 rounded-lg flex items-center justify-center mb-4 text-accent-fg group-hover:bg-emerald-500/10 group-hover:scale-110 transition-all">
                            <AlertTriangle size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-fg mb-2 group-hover:text-accent-fg transition-colors">Aviso de Risco</h2>
                        <p className="text-fg-muted text-sm">
                            Informações importantes sobre os riscos envolvidos no trading e limitações da plataforma.
                        </p>
                    </Link>

                    {/* Política de Reembolso */}
                    <Link to="/refund-policy" className="block p-6 rounded-2xl bg-surface/50 border border-line hover:border-emerald-500/30 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/10 group">
                        <div className="w-12 h-12 bg-surface-2 rounded-lg flex items-center justify-center mb-4 text-accent-fg group-hover:bg-emerald-500/10 group-hover:scale-110 transition-all">
                            <RefreshCcw size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-fg mb-2 group-hover:text-accent-fg transition-colors">Política de Reembolso</h2>
                        <p className="text-fg-muted text-sm">
                            Condições para cancelamento de assinaturas e solicitação de reembolsos.
                        </p>
                    </Link>
                </div>
            </div>
        </div>
    );
};
