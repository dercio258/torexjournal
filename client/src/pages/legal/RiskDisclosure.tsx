import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

export const RiskDisclosure = () => {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-300 py-20 px-6 font-sans">
            <div className="max-w-3xl mx-auto bg-slate-900/40 p-8 md:p-12 rounded-3xl border border-slate-800 shadow-2xl">
                <Link to="/legal" className="inline-flex items-center text-emerald-500 hover:text-emerald-400 mb-8 transition-colors text-sm font-medium">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar para Central Legal
                </Link>

                <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-red-500/10 rounded-xl text-red-500">
                        <AlertTriangle size={32} />
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-white">Aviso de Risco</h1>
                </div>

                <div className="p-4 mb-10 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 font-medium">
                    IMPORTANTE: LEIA COM ATENÇÃO ANTES DE UTILIZAR A PLATAFORMA.
                </div>

                <div className="space-y-8 text-base leading-relaxed">
                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">4.1 O Trading Envolve Risco Significativo</h2>
                        <p>A negociação de instrumentos financeiros, incluindo Forex, ações, commodities e criptoativos, possui um alto nível de risco e pode não ser adequada para todos os investidores. O uso de alavancagem pode aumentar tanto os lucros quanto as perdas.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">4.2 Perdas Podem Exceder o Capital</h2>
                        <p>Você pode sofrer uma perda parcial ou total do seu capital investido. Nunca negocie com dinheiro que você não pode se dar ao luxo de perder.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">4.3 Resultados Passados Não Garantem Resultados Futuros</h2>
                        <p>Quaisquer resultados de backtesting ou performance histórica exibidos no <strong>Torex Journal</strong> são puramente informativos e baseados em dados passados. Não existe garantia de que os mesmos resultados serão replicados em condições de mercado futuras.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">4.4 A Plataforma Não Garante Performance</h2>
                        <p>O Torex Journal é uma ferramenta analítica de suporte à decisão. Não garantimos que o uso do software resultará em lucro ou em qualquer redução de risco. O sucesso no trading depende de inúmeras variantes externas à plataforma.</p>
                    </section>

                    <hr className="border-slate-800 my-10" />

                    <div className="flex items-center gap-3 mb-6">
                        <h1 className="text-2xl md:text-3xl font-bold text-white">Disclaimer Profissional</h1>
                    </div>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">5.1 Natureza do Serviço</h2>
                        <p className="mb-2">O Torex Journal esclarece que:</p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li><strong>NÃO é Corretora (Broker):</strong> Não facilitamos transações de mercado e não custodiamos fundos de clientes.</li>
                            <li><strong>NÃO é Consultoria Financeira:</strong> Não fornecemos recomendações de compra ou venda. Nossas estatísticas são geradas algoritmicamente com base nos dados que você fornece.</li>
                            <li><strong>NÃO Gerencia Fundos:</strong> Não somos gestores de ativos e não temos acesso aos seus terminais de negociação para execução de ordens.</li>
                            <li><strong>NÃO Executa Ordens:</strong> A plataforma é puramente baseada em nuvem para pós-análise e backtesting, sem conexão de execução com o mercado real.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">5.2 Ferramenta Educacional e Analítica</h2>
                        <p>A plataforma deve ser utilizada estritamente como uma ferramenta educacional para aprimorar as habilidades de gestão de risco e psicologia do trader. Toda e qualquer ação tomada no mercado financeiro é de responsabilidade exclusiva e soberana do Usuário.</p>
                    </section>
                </div>
            </div>
        </div>
    );
};
