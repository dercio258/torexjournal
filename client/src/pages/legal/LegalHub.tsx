import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, Shield, AlertTriangle, RefreshCcw, Cookie } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

export const LegalHub = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';

    return (
        <div className="min-h-screen bg-canvas text-fg py-20 px-6">
            <div className="max-w-4xl mx-auto">
                <Link to="/" className="inline-flex items-center text-emerald-500 hover:text-accent-fg mb-8 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {isEn ? 'Back to Home' : 'Voltar para Home'}
                </Link>

                <h1 className="text-4xl md:text-5xl font-bold text-fg mb-6">
                    {isEn ? 'Legal & Compliance Center' : 'Central Legal'}
                </h1>
                <p className="text-fg-muted text-lg mb-12">
                    {isEn
                        ? 'Review the legal terms, data privacy practices, risk disclosures, and billing policies governing Torex Journal. We are committed to transparency and protecting your trading data.'
                        : 'Nesta seção, você encontra todos os documentos legais e políticas que regem o uso do Torex Journal. Nosso compromisso é com a transparência e a segurança dos seus dados.'}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Termos e Condições */}
                    <Link to="/terms" className="block p-6 rounded-2xl bg-surface/50 border border-line hover:border-emerald-500/30 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/10 group">
                        <div className="w-12 h-12 bg-surface-2 rounded-lg flex items-center justify-center mb-4 text-accent-fg group-hover:bg-emerald-500/10 group-hover:scale-110 transition-all">
                            <FileText size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-fg mb-2 group-hover:text-accent-fg transition-colors">
                            {isEn ? 'Terms & Conditions' : 'Termos e Condições'}
                        </h2>
                        <p className="text-fg-muted text-sm">
                            {isEn
                                ? 'Platform usage rules, liability limitations, and recurring subscription terms.'
                                : 'Regras gerais de uso, limitações de responsabilidade e detalhes sobre assinaturas.'}
                        </p>
                    </Link>

                    {/* Política de Privacidade */}
                    <Link to="/privacy" className="block p-6 rounded-2xl bg-surface/50 border border-line hover:border-emerald-500/30 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/10 group">
                        <div className="w-12 h-12 bg-surface-2 rounded-lg flex items-center justify-center mb-4 text-accent-fg group-hover:bg-emerald-500/10 group-hover:scale-110 transition-all">
                            <Shield size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-fg mb-2 group-hover:text-accent-fg transition-colors">
                            {isEn ? 'Privacy Policy' : 'Política de Privacidade'}
                        </h2>
                        <p className="text-fg-muted text-sm">
                            {isEn
                                ? 'How we collect, process, and safeguard your account credentials and execution history.'
                                : 'Como coletamos, usamos e protegemos seus dados pessoais e de trading.'}
                        </p>
                    </Link>

                    {/* Aviso de Risco */}
                    <Link to="/risk-disclosure" className="block p-6 rounded-2xl bg-surface/50 border border-line hover:border-emerald-500/30 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/10 group">
                        <div className="w-12 h-12 bg-surface-2 rounded-lg flex items-center justify-center mb-4 text-accent-fg group-hover:bg-emerald-500/10 group-hover:scale-110 transition-all">
                            <AlertTriangle size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-fg mb-2 group-hover:text-accent-fg transition-colors">
                            {isEn ? 'Risk Disclosure' : 'Aviso de Risco'}
                        </h2>
                        <p className="text-fg-muted text-sm">
                            {isEn
                                ? 'Important disclosures regarding financial market risk and non-advisory software scope.'
                                : 'Informações importantes sobre os riscos envolvidos no trading e limitações da plataforma.'}
                        </p>
                    </Link>

                    {/* Política de Reembolso */}
                    <Link to="/refund-policy" className="block p-6 rounded-2xl bg-surface/50 border border-line hover:border-emerald-500/30 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/10 group">
                        <div className="w-12 h-12 bg-surface-2 rounded-lg flex items-center justify-center mb-4 text-accent-fg group-hover:bg-emerald-500/10 group-hover:scale-110 transition-all">
                            <RefreshCcw size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-fg mb-2 group-hover:text-accent-fg transition-colors">
                            {isEn ? 'Refund Policy' : 'Política de Reembolso'}
                        </h2>
                        <p className="text-fg-muted text-sm">
                            {isEn
                                ? 'Subscription cancellation rules and eligibility criteria for refund requests.'
                                : 'Condições para cancelamento de assinaturas e solicitação de reembolsos.'}
                        </p>
                    </Link>

                    {/* Política de Cookies */}
                    <Link to="/cookies" className="block p-6 rounded-2xl bg-surface/50 border border-line hover:border-emerald-500/30 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/10 group">
                        <div className="w-12 h-12 bg-surface-2 rounded-lg flex items-center justify-center mb-4 text-accent-fg group-hover:bg-emerald-500/10 group-hover:scale-110 transition-all">
                            <Cookie size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-fg mb-2 group-hover:text-accent-fg transition-colors">
                            {isEn ? 'Cookie Policy' : 'Política de Cookies'}
                        </h2>
                        <p className="text-fg-muted text-sm">
                            {isEn
                                ? 'Transparent inventory of cookies, local storage keys, and consent preferences.'
                                : 'Inventário transparente de cookies, armazenamento local e centro de preferências.'}
                        </p>
                    </Link>
                </div>
            </div>
        </div>
    );
};
