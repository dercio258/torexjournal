import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const Privacy = () => {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-300 py-20 px-6 font-sans">
            <div className="max-w-3xl mx-auto bg-slate-900/40 p-8 md:p-12 rounded-3xl border border-slate-800 shadow-2xl">
                <Link to="/legal" className="inline-flex items-center text-emerald-500 hover:text-emerald-400 mb-8 transition-colors text-sm font-medium">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar para Central Legal
                </Link>

                <h1 className="text-3xl md:text-4xl font-bold text-white mb-6">Política de Privacidade</h1>

                <p className="mb-8 leading-relaxed">
                    Esta Política de Privacidade descreve como o <strong className="text-slate-100">Torex Journal</strong> ("nós", "plataforma") coleta, utiliza e protege suas informações. Estamos comprometidos com a conformidade com o Regulamento Geral de Proteção de Dados (GDPR) da UE e a Lei Geral de Proteção de Dados (LGPD) do Brasil.
                </p>

                <div className="space-y-8 text-base leading-relaxed">
                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">3.1 Coleta de Dados</h2>
                        <p className="mb-2">Coletamos informações necessárias para a prestação do serviço, incluindo:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Dados Cadastrais:</strong> Nome, e-mail, e informações de pagamento (via parceiros de pagamento seguros).</li>
                            <li><strong>Dados de Trading:</strong> Histórico de transações, tickets, ativos negociados e volumes (conforme importado pelo usuário).</li>
                            <li><strong>Dados de Uso:</strong> Endereço IP, tipo de navegador, logs de acesso e comportamento na plataforma via Cookies.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">3.2 Dados de Trading e APIs</h2>
                        <p>Os dados de trading importados via API ou arquivo permanecem como propriedade do Usuário. O Torex Journal atua como um <strong>Processador de Dados</strong>. Utilizamos esses dados exclusivamente para gerar os relatórios analíticos solicitados. Não compartilhamos suas estratégias ou histórico individual com terceiros sem consentimento explícito.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">3.3 Uso de Cookies</h2>
                        <p>Utilizamos cookies para manter sessões ativas, personalizar a experiência do usuário e coletar métricas agregadas de desempenho através de ferramentas analíticas.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">3.4 Compartilhamento de Dados</h2>
                        <p className="mb-2">Não vendemos dados de usuários. O compartilhamento ocorre apenas com:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Processadores de pagamento (Debito.co.mz) para faturamento.</li>
                            <li>Serviços de infraestrutura em nuvem (AWS/Google Cloud).</li>
                            <li>Autoridades legais, quando exigido por ordem judicial.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">3.5 Armazenamento e Segurança</h2>
                        <p>Seus dados são armazenados em servidores seguros com criptografia de ponta a ponta. Implementamos medidas técnicas e organizacionais para prevenir acesso não autorizado, alteração ou destruição de dados.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">3.6 Direitos do Usuário (GDPR/LGPD)</h2>
                        <p className="mb-2">Você possui os seguintes direitos:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Acesso:</strong> Solicitar uma cópia de seus dados.</li>
                            <li><strong>Retificação:</strong> Corrigir dados incompletos ou inexatos.</li>
                            <li><strong>Eliminação:</strong> Solicitar a exclusão de sua conta e dados (observando retenções legais).</li>
                            <li><strong>Portabilidade:</strong> Receber seus dados em formato estruturado.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">3.7 Retenção de Dados</h2>
                        <p>Mantemos seus dados enquanto sua conta estiver ativa ou pelo período necessário para cumprir obrigações fiscais e regulatórias. Contas inativas por mais de 24 meses podem ser arquivadas ou anonimizadas.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-slate-100 mb-3">3.8 Transferência Internacional de Dados</h2>
                        <p>Como uma plataforma global, os dados podem ser processados em países fora da sua jurisdição de origem. Garantimos que tais transferências ocorram sob mecanismos de proteção adequados (como Cláusulas Contratuais Padrão da UE).</p>
                    </section>
                </div>
            </div>
        </div>
    );
};
