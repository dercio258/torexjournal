import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

export const RefundPolicy = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';

    return (
        <div className="min-h-screen bg-canvas text-fg/80 py-20 px-6 font-sans">
            <div className="max-w-3xl mx-auto bg-surface/40 p-8 md:p-12 rounded-3xl border border-line shadow-2xl">
                <Link to="/legal" className="inline-flex items-center text-emerald-500 hover:text-accent-fg mb-8 transition-colors text-sm font-medium">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {isEn ? 'Back to Legal Center' : 'Voltar para Central Legal'}
                </Link>

                <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-blue-500/10 rounded-xl text-blue-500">
                        <RefreshCcw size={32} />
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-fg">
                        {isEn ? 'Refund Policy' : 'Política de Reembolso'}
                    </h1>
                </div>

                {isEn ? (
                    <>
                        <p className="mb-8 leading-relaxed">
                            At <strong>Torex Journal</strong>, we stand behind our analytics workspace. Below are the terms governing subscription cancellations and refund requests.
                        </p>

                        <div className="space-y-8 text-base leading-relaxed">
                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">1. 7-Day First-Purchase Refund Window</h2>
                                <p>We offer a <strong>7-day</strong> refund window from the date of your initial subscription purchase, subject to the usage conditions below.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2. Refund Exceptions</h2>
                                <p className="mb-2">Refund requests may be <strong>declined</strong> if:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li>Bulk trade imports (thousands of records) and full report exports are executed immediately after subscribing solely to extract data prior to cancellation.</li>
                                    <li>The charge corresponds to a recurring renewal cycle rather than an initial subscription purchase.</li>
                                    <li>The workspace was suspended for breaching our Terms of Service (e.g., credential sharing or platform abuse).</li>
                                </ul>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">3. Canceling Your Subscription</h2>
                                <p>You may <strong>cancel auto-renewal</strong> at any time via Settings {'>'} Billing & Plans. Canceling stops future recurring charges while keeping workspace access active through the end of the current paid period.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">4. How to Request a Refund</h2>
                                <p>If you are within the 7-day window and meet eligibility criteria, reach out via our official support channels with your account email. Approved refunds return to your original payment method.</p>
                            </section>

                            <div className="mt-12 p-6 bg-surface-2/50 rounded-xl border border-line-strong">
                                <h3 className="font-bold text-fg mb-2">Need Billing Assistance?</h3>
                                <p className="text-sm">Contact our desk support team via official channels if you encounter any billing or invoice issue.</p>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="mb-8 leading-relaxed">
                    No <strong>Torex Journal</strong>, buscamos garantir a satisfação dos nossos usuários com as ferramentas analíticas oferecidas. Abaixo detalhamos nossa política referente a cancelamentos e reembolsos.
                </p>

                <div className="space-y-8 text-base leading-relaxed">
                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">1. Regra Geral de Reembolso</h2>
                        <p>Oferecemos uma política de reembolso de <strong>7 dias</strong> a partir da data da primeira compra de uma assinatura, conforme estabelecido por leis de defesa do consumidor de algumas jurisdições (como o prazo de arrependimento no Brasil).</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2. Exceções à Regra de Reembolso</h2>
                        <p className="mb-2">O reembolso pode ser <strong>negado</strong> nas seguintes situações:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Se o usuário tiver realizado <strong>importações massivas de dados</strong> (milhares de trades) logo após assinar, sugerindo uso integral do serviço apenas para extrair relatórios antes de cancelar.</li>
                            <li>Para renovações de assinaturas (o reembolso se aplica apenas à primeira compra).</li>
                            <li>Se a conta for suspensa por violação dos Termos de Serviço (ex: abuso de plataforma ou compartilhamento de conta).</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">3. Cancelamento da Assinatura</h2>
                        <p>O <strong>Cancelamento</strong> pode ser feito a qualquer momento através do seu painel de controle (Configurações {'>'} Assinatura). Cancelar a assinatura evita cobranças futuras (nos próximos ciclos), mas não gera reembolso automático referente ao período já pago de forma isolada do prazo de 7 dias iniciais. O seu acesso continuará ativo até o término do ciclo atual.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">4. Como Solicitar</h2>
                        <p>Se você estiver dentro do prazo de 7 dias e cumprir os requisitos, entre em contato através do email de suporte, fornecendo o e-mail da sua conta para processarmos a devolução. O estorno será feito no mesmo método de pagamento utilizado na compra e pode levar alguns dias para ser refletido na sua fatura.</p>
                    </section>

                    <div className="mt-12 p-6 bg-surface-2/50 rounded-xl border border-line-strong">
                        <h3 className="font-bold text-fg mb-2">Tem dúvidas?</h3>
                        <p className="text-sm">Nossa equipe de suporte está pronta para te ajudar. Basta entrar em contato através dos nossos canais oficiais de atendimento se tiver qualquer problema com seu faturamento.</p>
                    </div>
                </div>
                    </>
                )}
            </div>
        </div>
    );
};
