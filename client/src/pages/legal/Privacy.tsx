import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

export const Privacy = () => {
    const { locale } = useLocale();
    const isEn = locale === 'en';

    return (
        <div className="min-h-screen bg-canvas text-fg/80 py-20 px-6 font-sans">
            <div className="max-w-3xl mx-auto bg-surface/40 p-8 md:p-12 rounded-3xl border border-line shadow-2xl">
                <Link to="/legal" className="inline-flex items-center text-emerald-500 hover:text-accent-fg mb-8 transition-colors text-sm font-medium">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {isEn ? 'Back to Legal Center' : 'Voltar para Central Legal'}
                </Link>

                <h1 className="text-3xl md:text-4xl font-bold text-fg mb-6">
                    {isEn ? 'Privacy Policy' : 'Política de Privacidade'}
                </h1>

                {isEn ? (
                    <>
                        <p className="mb-8 leading-relaxed">
                            This Privacy Policy describes how <strong className="text-fg">Torex Journal</strong> ("we", "platform") collects, processes, and safeguards your data in alignment with GDPR and applicable data protection standards.
                        </p>

                        <div className="space-y-8 text-base leading-relaxed">
                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">3.1 Data We Collect</h2>
                                <p className="mb-2">We collect only the information necessary to operate your workspace:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Account Data:</strong> Name, email address, and billing metadata processed via certified payment partners.</li>
                                    <li><strong>Execution Data:</strong> Trade history, tickets, instruments, sizing, and fills synced or uploaded by you.</li>
                                    <li><strong>Telemetry & Security:</strong> IP address, browser metadata, and session cookies.</li>
                                </ul>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">3.2 Trading Data & Broker APIs</h2>
                                <p>All trade history imported via MT5, Deriv, or file upload remains strictly your property. Torex Journal acts solely as a <strong>Data Processor</strong> to render your private analytics and AI insights. We never share or sell individual strategies or order flow.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">3.3 Cookies & Storage</h2>
                                <p>
                                    We use essential cookies and local storage to maintain authenticated sessions and, with consent, attribution analytics. Review full details in our{' '}
                                    <Link to="/cookies" className="font-semibold text-accent-fg hover:underline">
                                        Cookie Policy
                                    </Link>.
                                </p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">3.4 Data Sharing</h2>
                                <p className="mb-2">We never sell user data. Limited sharing occurs only with:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li>Certified payment processors (M-Pesa, e-Mola, and Card) for subscription billing.</li>
                                    <li>Cloud infrastructure providers (AWS / Google Cloud).</li>
                                    <li>Legal authorities solely when compelled by valid court order.</li>
                                </ul>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">3.5 Security & Encryption</h2>
                                <p>Your records are stored on encrypted cloud servers using strict access controls and industry-standard organizational safeguards.</p>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">3.6 Your Privacy Rights (GDPR / LGPD)</h2>
                                <p className="mb-2">You retain full rights to:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Access:</strong> Request a copy of your stored personal data.</li>
                                    <li><strong>Rectification:</strong> Update inaccurate or incomplete details.</li>
                                    <li><strong>Erasure:</strong> Request deletion of your account and data subject to statutory retention.</li>
                                    <li><strong>Portability:</strong> Export your data in structured machine-readable form.</li>
                                </ul>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-fg mb-3">3.7 Data Retention & International Transfers</h2>
                                <p>We retain data while your account remains active or as required by tax/regulatory law, utilizing EU Standard Contractual Clauses where cross-border processing applies.</p>
                            </section>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="mb-8 leading-relaxed">
                    Esta Política de Privacidade descreve como o <strong className="text-fg">Torex Journal</strong> ("nós", "plataforma") coleta, utiliza e protege suas informações. Estamos comprometidos com a conformidade com o Regulamento Geral de Proteção de Dados (GDPR) da UE e a Lei Geral de Proteção de Dados (LGPD) do Brasil.
                </p>

                <div className="space-y-8 text-base leading-relaxed">
                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">3.1 Coleta de Dados</h2>
                        <p className="mb-2">Coletamos informações necessárias para a prestação do serviço, incluindo:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Dados Cadastrais:</strong> Nome, e-mail, e informações de pagamento (via parceiros de pagamento seguros).</li>
                            <li><strong>Dados de Trading:</strong> Histórico de transações, tickets, ativos negociados e volumes (conforme importado pelo usuário).</li>
                            <li><strong>Dados de Uso:</strong> Endereço IP, tipo de navegador, logs de acesso e comportamento na plataforma via Cookies.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">3.2 Dados de Trading e APIs</h2>
                        <p>Os dados de trading importados via API ou arquivo permanecem como propriedade do Usuário. O Torex Journal atua como um <strong>Processador de Dados</strong>. Utilizamos esses dados exclusivamente para gerar os relatórios analíticos solicitados. Não compartilhamos suas estratégias ou histórico individual com terceiros sem consentimento explícito.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">3.3 Uso de Cookies</h2>
                        <p>
                            Utilizamos cookies e armazenamento local para manter sessões ativas, personalizar a experiência do usuário e, mediante consentimento, coletar métricas de atribuição. Para detalhes completos e gestão de preferências, consulte a nossa{' '}
                            <Link to="/cookies" className="font-semibold text-accent-fg hover:underline">
                                Política de Cookies
                            </Link>.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">3.4 Compartilhamento de Dados</h2>
                        <p className="mb-2">Não vendemos dados de usuários. O compartilhamento ocorre apenas com:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Processadores de pagamento certificados (M-Pesa, e-Mola e Cartão) para faturamento.</li>
                            <li>Serviços de infraestrutura em nuvem (AWS/Google Cloud).</li>
                            <li>Autoridades legais, quando exigido por ordem judicial.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">3.5 Armazenamento e Segurança</h2>
                        <p>Seus dados são armazenados em servidores seguros com criptografia de ponta a ponta. Implementamos medidas técnicas e organizacionais para prevenir acesso não autorizado, alteração ou destruição de dados.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">3.6 Direitos do Usuário (GDPR/LGPD)</h2>
                        <p className="mb-2">Você possui os seguintes direitos:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Acesso:</strong> Solicitar uma cópia de seus dados.</li>
                            <li><strong>Retificação:</strong> Corrigir dados incompletos ou inexatos.</li>
                            <li><strong>Eliminação:</strong> Solicitar a exclusão de sua conta e dados (observando retenções legais).</li>
                            <li><strong>Portabilidade:</strong> Receber seus dados em formato estruturado.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">3.7 Retenção de Dados</h2>
                        <p>Mantemos seus dados enquanto sua conta estiver ativa ou pelo período necessário para cumprir obrigações fiscais e regulatórias. Contas inativas por mais de 24 meses podem ser arquivadas ou anonimizadas.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold text-fg mb-3">3.8 Transferência Internacional de Dados</h2>
                        <p>Como uma plataforma global, os dados podem ser processados em países fora da sua jurisdição de origem. Garantimos que tais transferências ocorram sob mecanismos de proteção adequados (como Cláusulas Contratuais Padrão da UE).</p>
                    </section>
                </div>
                    </>
                )}
            </div>
        </div>
    );
};
