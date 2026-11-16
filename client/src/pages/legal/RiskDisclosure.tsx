import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

export const RiskDisclosure = () => {
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
                    <div className="p-3 bg-red-500/10 rounded-xl text-red-500">
                        <AlertTriangle size={32} />
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-fg">
                        {isEn ? 'Risk Disclosure' : 'Aviso de Risco'}
                    </h1>
                </div>

                <div className="p-4 mb-10 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 font-medium">
                    {isEn
                        ? 'IMPORTANT: READ CAREFULLY BEFORE USING THE PLATFORM.'
                        : 'IMPORTANTE: LEIA COM ATENÇÃO ANTES DE UTILIZAR A PLATAFORMA.'}
                </div>

                {isEn ? (
                    <div className="space-y-8 text-base leading-relaxed">
                        <section>
                            <h2 className="text-xl font-bold text-fg mb-3">4.1 High Risk of Financial Loss</h2>
                            <p>Trading leveraged financial instruments — including FX, indices, commodities, futures, and digital assets — carries substantial risk and may not be suitable for all participants. Leverage can amplify both gains and drawdowns.</p>
                        </section>

                        <section>
                            <h2 className="text-xl font-bold text-fg mb-3">4.2 Risk Capital Only</h2>
                            <p>You may sustain partial or total loss of initial capital. Never trade with funds you cannot afford to lose.</p>
                        </section>

                        <section>
                            <h2 className="text-xl font-bold text-fg mb-3">4.3 Hypothetical & Historical Performance</h2>
                            <p>Market replay sessions, backtesting statistics, and historical analytics rendered in <strong>Torex Journal</strong> are strictly informational and do not guarantee future execution outcomes or live liquidity fills.</p>
                        </section>

                        <section>
                            <h2 className="text-xl font-bold text-fg mb-3">4.4 No Performance Guarantees</h2>
                            <p>Torex Journal is a post-trade and simulation decision-support workspace. Using the software does not guarantee profitability or eliminate market risk.</p>
                        </section>

                        <hr className="border-line my-10" />

                        <div className="flex items-center gap-3 mb-6">
                            <h1 className="text-2xl md:text-3xl font-bold text-fg">Professional Disclaimer</h1>
                        </div>

                        <section>
                            <h2 className="text-xl font-bold text-fg mb-3">5.1 Scope of Service</h2>
                            <p className="mb-2">Torex Journal explicitly clarifies that it:</p>
                            <ul className="list-disc pl-5 space-y-2">
                                <li><strong>Is NOT a Broker:</strong> We do not intermediate market orders or custody client capital.</li>
                                <li><strong>Is NOT Investment Advice:</strong> We issue zero buy/sell signals or portfolio recommendations; all telemetry is algorithmically derived from your own execution ledger.</li>
                                <li><strong>Does NOT Manage Funds:</strong> We are not asset managers and never execute live trades in your brokerage account.</li>
                                <li><strong>Does NOT Route Live Orders:</strong> Torex Journal operates purely as an analytical cloud workspace for journaling and market replay.</li>
                            </ul>
                        </section>
                    </div>
                ) : (
                    <div className="space-y-8 text-base leading-relaxed">
                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">4.1 O Trading Envolve Risco Significativo</h2>
                        <p>A negociação de instrumentos financeiros, incluindo Forex, ações, commodities e criptoativos, possui um alto nível de risco e pode não ser adequada para todos os investidores. O uso de alavancagem pode aumentar tanto os lucros quanto as perdas.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">4.2 Perdas Podem Exceder o Capital</h2>
                        <p>Você pode sofrer uma perda parcial ou total do seu capital investido. Nunca negocie com dinheiro que você não pode se dar ao luxo de perder.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">4.3 Resultados Passados Não Garantem Resultados Futuros</h2>
                        <p>Quaisquer resultados de backtesting ou performance histórica exibidos no <strong>Torex Journal</strong> são puramente informativos e baseados em dados passados. Não existe garantia de que os mesmos resultados serão replicados em condições de mercado futuras.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">4.4 A Plataforma Não Garante Performance</h2>
                        <p>O Torex Journal é uma ferramenta analítica de suporte à decisão. Não garantimos que o uso do software resultará em lucro ou em qualquer redução de risco. O sucesso no trading depende de inúmeras variantes externas à plataforma.</p>
                    </section>

                    <hr className="border-line my-10" />

                    <div className="flex items-center gap-3 mb-6">
                        <h1 className="text-2xl md:text-3xl font-bold text-fg">Disclaimer Profissional</h1>
                    </div>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">5.1 Natureza do Serviço</h2>
                        <p className="mb-2">O Torex Journal esclarece que:</p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li><strong>NÃO é Corretora (Broker):</strong> Não facilitamos transações de mercado e não custodiamos fundos de clientes.</li>
                            <li><strong>NÃO é Consultoria Financeira:</strong> Não fornecemos recomendações de compra ou venda. Nossas estatísticas são geradas algoritmicamente com base nos dados que você fornece.</li>
                            <li><strong>NÃO Gerencia Fundos:</strong> Não somos gestores de ativos e não temos acesso aos seus terminais de negociação para execução de ordens.</li>
                            <li><strong>NÃO Executa Ordens:</strong> A plataforma é puramente baseada em nuvem para pós-análise e backtesting, sem conexão de execução com o mercado real.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">5.2 Ferramenta Educacional e Analítica</h2>
                        <p>A plataforma deve ser utilizada estritamente como uma ferramenta educacional para aprimorar as habilidades de gestão de risco e psicologia do trader. Toda e qualquer ação tomada no mercado financeiro é de responsabilidade exclusiva e soberana do Usuário.</p>
                    </section>
                </div>
                )}
            </div>
        </div>
    );
};
