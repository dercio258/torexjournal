import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCcw } from 'lucide-react';

export const RefundPolicy = () => {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-300 py-20 px-6 font-sans">
            <div className="max-w-3xl mx-auto bg-slate-900/40 p-8 md:p-12 rounded-3xl border border-slate-800 shadow-2xl">
                <Link to="/legal" className="inline-flex items-center text-emerald-500 hover:text-emerald-400 mb-8 transition-colors text-sm font-medium">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar para Central Legal
                </Link>

                <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-blue-500/10 rounded-xl text-blue-500">
                        <RefreshCcw size={32} />
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-white">Política de Reembolso</h1>
                </div>

                <p className="mb-8 leading-relaxed">
                    No <strong>Torex Journal</strong>, buscamos garantir a satisfação dos nossos usuários com as ferramentas analíticas oferecidas. Abaixo detalhamos nossa política referente a cancelamentos e reembolsos.
                </p>

                <div className="space-y-8 text-base leading-relaxed">
                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">1. Regra Geral de Reembolso</h2>
                        <p>Oferecemos uma política de reembolso de <strong>7 dias</strong> a partir da data da primeira compra de uma assinatura, conforme estabelecido por leis de defesa do consumidor de algumas jurisdições (como o prazo de arrependimento no Brasil).</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2. Exceções à Regra de Reembolso</h2>
                        <p className="mb-2">O reembolso pode ser <strong>negado</strong> nas seguintes situações:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Se o usuário tiver realizado <strong>importações massivas de dados</strong> (milhares de trades) logo após assinar, sugerindo uso integral do serviço apenas para extrair relatórios antes de cancelar.</li>
                            <li>Para renovações de assinaturas (o reembolso se aplica apenas à primeira compra).</li>
                            <li>Se a conta for suspensa por violação dos Termos de Serviço (ex: abuso de plataforma ou compartilhamento de conta).</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">3. Cancelamento da Assinatura</h2>
                        <p>O <strong>Cancelamento</strong> pode ser feito a qualquer momento através do seu painel de controle (Configurações {'>'} Assinatura). Cancelar a assinatura evita cobranças futuras (nos próximos ciclos), mas não gera reembolso automático referente ao período já pago de forma isolada do prazo de 7 dias iniciais. O seu acesso continuará ativo até o término do ciclo atual.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">4. Como Solicitar</h2>
                        <p>Se você estiver dentro do prazo de 7 dias e cumprir os requisitos, entre em contato através do email de suporte, fornecendo o e-mail da sua conta para processarmos a devolução. O estorno será feito no mesmo método de pagamento utilizado na compra e pode levar alguns dias para ser refletido na sua fatura.</p>
                    </section>

                    <div className="mt-12 p-6 bg-slate-800/50 rounded-xl border border-slate-700">
                        <h3 className="font-bold text-white mb-2">Tem dúvidas?</h3>
                        <p className="text-sm">Nossa equipe de suporte está pronta para te ajudar. Basta entrar em contato através dos nossos canais oficiais de atendimento se tiver qualquer problema com seu faturamento.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
