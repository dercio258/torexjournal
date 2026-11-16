import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

export const Terms = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';

    return (
        <div className="min-h-screen bg-canvas text-fg/80 py-20 px-6 font-sans">
            <div className="max-w-3xl mx-auto bg-surface/40 p-8 md:p-12 rounded-3xl border border-line shadow-2xl">
                <Link to="/legal" className="inline-flex items-center text-emerald-500 hover:text-accent-fg mb-8 transition-colors text-sm font-medium">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {isEn ? 'Back to Legal Center' : 'Voltar para Central Legal'}
                </Link>

                <h1 className="text-3xl md:text-4xl font-bold text-fg mb-4">
                    {isEn ? 'Terms & Conditions of Use' : 'Termos e Condições de Uso'}
                </h1>
                <p className="text-fg-subtle text-sm mb-12">
                    {isEn ? 'Last Updated: February 28, 2026' : 'Última Atualização: 28 de Fevereiro de 2026'}
                </p>

                {isEn ? (
                    <>
                        <div className="space-y-8 text-base leading-relaxed">
                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.1 Acceptance of Terms</h2>
                                <p>By accessing or using the Torex Journal platform, you ("User") agree to comply with and be bound by these Terms and Conditions. If you do not agree with any part of these terms, you must not use our services.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.2 Eligibility</h2>
                                <p>The service is strictly intended for individuals aged 18 or older and duly incorporated legal entities with full legal capacity to enter into binding agreements.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.3 Service Description</h2>
                                <p>Torex Journal provides cloud-based software for financial trading telemetry, execution journaling, and historical market replay backtesting tools. The service is strictly informational and technological.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.4 Not Financial Advice</h2>
                                <p>Torex Journal does <strong className="text-fg">NOT</strong> provide investment, legal, or tax advice. All analytics, AI observations, and telemetry metrics presented on the platform are for educational and analytical purposes only. The User retains sole responsibility for all trading decisions.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.5 Market Risk</h2>
                                <p>Trading financial instruments (FX, Crypto, Equities, Futures, CFDs) carries a substantial risk of capital loss. Past performance or historical simulation does not guarantee future results.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.6 Limitation of Liability</h2>
                                <p>Torex Journal's aggregate liability arising out of or related to this agreement, regardless of form of action, shall not exceed the total fees paid by the customer during the twelve months immediately preceding the event giving rise to the claim.</p>
                                <p className="mt-2">We do not guarantee uninterrupted uptime and shall not be liable for losses resulting from scheduled maintenance, server downtime, software defects, or third-party infrastructure failures.</p>
                                <p className="mt-2">System calculations depend on the integrity of data supplied by external brokers and terminals. Third-party feed inaccuracies do not invalidate subscription charges.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.7 Intellectual Property</h2>
                                <p>All algorithms, interface architecture, analytics engines, and brand assets of Torex Journal remain our exclusive intellectual property protected under international copyright law.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.8 Prohibited Conduct</h2>
                                <p className="mb-2">Users may not:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li>Reverse engineer or decompile any platform software.</li>
                                    <li>Use the platform for unlawful or fraudulent activity.</li>
                                    <li>Share workspace credentials with unauthorized third parties.</li>
                                    <li>Scrape or extract platform data without prior written consent.</li>
                                </ul>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.9 Account Suspension</h2>
                                <p>We reserve the right to suspend or terminate accounts that violate these terms without prior notice to protect platform integrity and other members.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.10 Billing & Subscriptions</h2>
                                <p>Subscriptions renew on a recurring schedule via your selected billing cycle. Failed charges may result in temporary suspension of workspace features until resolved.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.11 Broker APIs & Imported Execution Data</h2>
                                <p>The User warrants legal authorization to import data from connected brokers or prop firms. Torex Journal processes such execution records strictly on the User's behalf and is not liable for third-party broker API outages.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.12 Governing Law & Jurisdiction</h2>
                                <p>These Terms are governed by international commercial law principles applicable to our primary operating jurisdiction. Disputes shall be settled via arbitration pursuant to Section 2.13.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">2.13 Dispute Resolution (Arbitration)</h2>
                                <p>Any controversy arising from these Terms shall be definitively resolved through binding arbitration, with both parties waiving any other forum.</p>
                            </section>
                        </div>

                        <div className="mt-12 pt-8 border-t border-line flex justify-center">
                            <Link to="/register" className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl transition-colors">
                                Accept & Create Account
                            </Link>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="space-y-8 text-base leading-relaxed">
                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.1 Aceitação dos Termos</h2>
                        <p>Ao acessar ou utilizar a plataforma Torex Journal, você ("Usuário") concorda em cumprir e estar vinculado a estes Termos e Condições. Se você não concordar com qualquer parte destes termos, não deverá utilizar nossos serviços.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.2 Elegibilidade</h2>
                        <p>O serviço é destinado exclusivamente a pessoas físicas com idade igual ou superior a 18 anos e pessoas jurídicas devidamente constituídas, com plena capacidade legal para contratar.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.3 Descrição do Serviço</h2>
                        <p>O Torex Journal fornece um software baseado em nuvem para análise de dados de negociação financeira, registro de diário e ferramentas de backtesting. O serviço é puramente informativo e tecnológico.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.4 Não é Aconselhamento Financeiro</h2>
                        <p>O Torex Journal <strong className="text-fg">NÃO</strong> fornece aconselhamento de investimento, jurídico ou fiscal. Todas as informações, estatísticas e dados apresentados pela plataforma são para fins educacionais e analíticos. O Usuário é o único responsável por suas decisões de trading.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.5 Risco de Mercado</h2>
                        <p>O trading de ativos financeiros (Forex, Cripto, Ações, Futuros) envolve risco substancial de perda. O Usuário reconhece que o desempenho passado, mesmo que analisado pela plataforma, não é garantia de resultados futuros.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.6 Limitação de Responsabilidade</h2>
                        <p>Qualquer responsabilidade agregada do Torex Journal decorrente de ou relacionada a este contrato, independentemente da forma de ação, não excederá as taxas totais pagas pelo cliente durante o período de doze meses imediatamente anterior ao evento que deu origem à reivindicação.</p>
                        <p className="mt-2">Não garantimos serviço ininterrupto. O Torex Journal não será responsável por quaisquer perdas incorridas devido a tempo de inatividade do servidor, manutenção programada, bugs de software ou falhas de provedores de infraestrutura de terceiros.</p>
                        <p className="mt-2">Os cálculos do sistema dependem inteiramente da integridade dos dados fornecidos por terceiros (corretoras/terminais). Erros originados na fonte dos dados não são de responsabilidade do Torex Journal e não invalidam a cobrança da assinatura.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.7 Propriedade Intelectual</h2>
                        <p>Todo o conteúdo, algoritmos, design e interface do Torex Journal são de propriedade exclusiva da nossa empresa e protegidos por leis de direitos autorais e propriedade intelectual internacionais.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.8 Uso Proibido</h2>
                        <p className="mb-2">É proibido:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Realizar engenharia reversa do software.</li>
                            <li>Utilizar o serviço para fins ilegais ou fraudulentos.</li>
                            <li>Compartilhar credenciais de acesso com terceiros.</li>
                            <li>Extrair dados da plataforma (scraping) sem autorização prévia por escrito.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.9 Suspensão de Conta</h2>
                        <p>Reservamo-nos o direito de suspender ou encerrar contas que violem estes termos, sem aviso prévio, visando a segurança da plataforma e de outros usuários.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.10 Pagamentos e Assinaturas</h2>
                        <p>As assinaturas são faturadas de forma recorrente. O Usuário autoriza a cobrança automática no método de pagamento escolhido. Falhas de pagamento resultarão na suspensão do acesso aos recursos Premium.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.11 Cláusula de Uso de API e Dados Importados</h2>
                        <p>O Usuário é responsável por garantir que possui o direito legal de importar dados de suas respectivas corretoras/exchanges. O Torex Journal armazena esses dados apenas para processamento analítico a pedido do Usuário. Não nos responsabilizamos por falhas na API de terceiros que impactem a precisão dos registros.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.12 Lei Aplicável e Jurisdição</h2>
                        <p>Estes Termos serão regidos e interpretados de acordo com os princípios de direito internacional e aplicáveis à jurisdição escolhida ou local de operação primária. Qualquer disputa será resolvida via arbitragem conforme a Cláusula 2.13.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">2.13 Resolução de Conflitos (Arbitragem)</h2>
                        <p>Qualquer controvérsia decorrente destes Termos será resolvida definitivamente por arbitragem, renunciando as partes a qualquer outro foro, por mais privilegiado que seja.</p>
                    </section>
                </div>

                        <div className="mt-12 pt-8 border-t border-line flex justify-center">
                            <Link to="/register" className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl transition-colors">
                                Aceitar e Criar Conta
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
