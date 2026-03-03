import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const Terms = () => {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-300 py-20 px-6 font-sans">
            <div className="max-w-3xl mx-auto bg-slate-900/40 p-8 md:p-12 rounded-3xl border border-slate-800 shadow-2xl">
                <Link to="/legal" className="inline-flex items-center text-emerald-500 hover:text-emerald-400 mb-8 transition-colors text-sm font-medium">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar para Central Legal
                </Link>

                <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">Termos e Condições de Uso</h1>
                <p className="text-slate-500 text-sm mb-12">Última Atualização: 28 de Fevereiro de 2026</p>

                <div className="space-y-8 text-base leading-relaxed">
                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.1 Aceitação dos Termos</h2>
                        <p>Ao acessar ou utilizar a plataforma Torex Journal, você ("Usuário") concorda em cumprir e estar vinculado a estes Termos e Condições. Se você não concordar com qualquer parte destes termos, não deverá utilizar nossos serviços.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.2 Elegibilidade</h2>
                        <p>O serviço é destinado exclusivamente a pessoas físicas com idade igual ou superior a 18 anos e pessoas jurídicas devidamente constituídas, com plena capacidade legal para contratar.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.3 Descrição do Serviço</h2>
                        <p>O Torex Journal fornece um software baseado em nuvem para análise de dados de negociação financeira, registro de diário e ferramentas de backtesting. O serviço é puramente informativo e tecnológico.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.4 Não é Aconselhamento Financeiro</h2>
                        <p>O Torex Journal <strong className="text-slate-100">NÃO</strong> fornece aconselhamento de investimento, jurídico ou fiscal. Todas as informações, estatísticas e dados apresentados pela plataforma são para fins educacionais e analíticos. O Usuário é o único responsável por suas decisões de trading.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.5 Risco de Mercado</h2>
                        <p>O trading de ativos financeiros (Forex, Cripto, Ações, Futuros) envolve risco substancial de perda. O Usuário reconhece que o desempenho passado, mesmo que analisado pela plataforma, não é garantia de resultados futuros.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.6 Limitação de Responsabilidade</h2>
                        <p>Qualquer responsabilidade agregada do Torex Journal decorrente de ou relacionada a este contrato, independentemente da forma de ação, não excederá as taxas totais pagas pelo cliente durante o período de doze meses imediatamente anterior ao evento que deu origem à reivindicação.</p>
                        <p className="mt-2">Não garantimos serviço ininterrupto. O Torex Journal não será responsável por quaisquer perdas incorridas devido a tempo de inatividade do servidor, manutenção programada, bugs de software ou falhas de provedores de infraestrutura de terceiros.</p>
                        <p className="mt-2">Os cálculos do sistema dependem inteiramente da integridade dos dados fornecidos por terceiros (corretoras/terminais). Erros originados na fonte dos dados não são de responsabilidade do Torex Journal e não invalidam a cobrança da assinatura.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.7 Propriedade Intelectual</h2>
                        <p>Todo o conteúdo, algoritmos, design e interface do Torex Journal são de propriedade exclusiva da nossa empresa e protegidos por leis de direitos autorais e propriedade intelectual internacionais.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.8 Uso Proibido</h2>
                        <p className="mb-2">É proibido:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Realizar engenharia reversa do software.</li>
                            <li>Utilizar o serviço para fins ilegais ou fraudulentos.</li>
                            <li>Compartilhar credenciais de acesso com terceiros.</li>
                            <li>Extrair dados da plataforma (scraping) sem autorização prévia por escrito.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.9 Suspensão de Conta</h2>
                        <p>Reservamo-nos o direito de suspender ou encerrar contas que violem estes termos, sem aviso prévio, visando a segurança da plataforma e de outros usuários.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.10 Pagamentos e Assinaturas</h2>
                        <p>As assinaturas são faturadas de forma recorrente. O Usuário autoriza a cobrança automática no método de pagamento escolhido. Falhas de pagamento resultarão na suspensão do acesso aos recursos Premium.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.11 Cláusula de Uso de API e Dados Importados</h2>
                        <p>O Usuário é responsável por garantir que possui o direito legal de importar dados de suas respectivas corretoras/exchanges. O Torex Journal armazena esses dados apenas para processamento analítico a pedido do Usuário. Não nos responsabilizamos por falhas na API de terceiros que impactem a precisão dos registros.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.12 Lei Aplicável e Jurisdição</h2>
                        <p>Estes Termos serão regidos e interpretados de acordo com os princípios de direito internacional e aplicáveis à jurisdição escolhida ou local de operação primária. Qualquer disputa será resolvida via arbitragem conforme a Cláusula 2.13.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">2.13 Resolução de Conflitos (Arbitragem)</h2>
                        <p>Qualquer controvérsia decorrente destes Termos será resolvida definitivamente por arbitragem, renunciando as partes a qualquer outro foro, por mais privilegiado que seja.</p>
                    </section>
                </div>

                <div className="mt-12 pt-8 border-t border-slate-800 flex justify-center">
                    <Link to="/register" className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl transition-colors">
                        Aceitar e Criar Conta
                    </Link>
                </div>
            </div>
        </div>
    );
};
