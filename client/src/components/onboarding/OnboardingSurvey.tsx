import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  TrendingUp, 
  Users, 
  DollarSign, 
  Target, 
  Globe, 
  ShieldCheck, 
  Search,
  Sparkles
} from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';

interface OnboardingSurveyProps {
  onComplete: () => void;
}

const getSteps = (isEn: boolean) => [
  {
    id: 'experience',
    title: isEn ? 'Market Experience' : 'Sua Experiência',
    question: isEn ? 'How long have you been actively trading financial markets?' : 'Quanto tempo você opera no mercado financeiro?',
    icon: TrendingUp,
    options: [
      { label: isEn ? 'Developing (< 1 year)' : 'Iniciante (< 1 ano)', value: 'beginner' },
      { label: isEn ? 'Intermediate (1-3 years)' : 'Intermediário (1-3 anos)', value: 'intermediate' },
      { label: isEn ? 'Experienced (3-5 years)' : 'Avançado (3-5 anos)', value: 'advanced' },
      { label: isEn ? 'Institutional / Desk (5+ years)' : 'Profissional (5+ anos)', value: 'pro' },
    ]
  },
  {
    id: 'entity',
    title: isEn ? 'Trading Profile' : 'Seu Perfil',
    question: isEn ? 'Do you trade individual capital or under a prop firm / entity?' : 'Você opera como indivíduo ou em nome de uma empresa?',
    icon: Users,
    options: [
      { label: isEn ? 'Retail / Personal Capital' : 'Individual (Varejo)', value: 'individual' },
      { label: isEn ? 'Prop Firm / Institutional Desk' : 'Empresa / Institucional', value: 'company' },
    ]
  },
  {
    id: 'volume',
    title: isEn ? 'Daily Turnover' : 'Volume Operacional',
    question: isEn ? 'What is your average daily notional trading volume?' : 'Qual o seu volume médio de movimentação diária?',
    icon: DollarSign,
    options: [
      { label: '$0 - $100', value: 'low' },
      { label: '$100 - $1,000', value: 'medium' },
      { label: '$1,000 - $10,000', value: 'high' },
      { label: isEn ? '$10,000+' : 'Acima de 10.000$', value: 'whale' },
    ]
  },
  {
    id: 'goal',
    title: isEn ? 'Primary Objective' : 'Seu Objetivo',
    question: isEn ? 'What is your main goal inside Torex Journal?' : 'Qual o seu objetivo principal ao usar o Torex Journal?',
    icon: Target,
    options: [
      { label: isEn ? 'Full-Time Trading Career' : 'Viver de Trading', value: 'full_time' },
      { label: isEn ? 'Consistent Side Income' : 'Renda Extra', value: 'side_income' },
      { label: isEn ? 'Capital & Prop Firm Risk Control' : 'Gestão de Capital', value: 'management' },
      { label: isEn ? 'Edge Refinement & Discipline' : 'Aprendizado e Disciplina', value: 'learning' },
    ]
  },
  {
    id: 'market',
    title: isEn ? 'Primary Asset Class' : 'Mercado Principal',
    question: isEn ? 'Which asset class represents most of your executions?' : 'Em qual mercado você foca a maior parte das suas operações?',
    icon: Globe,
    options: [
      { label: isEn ? 'FX / Spot Currencies' : 'Forex', value: 'forex' },
      { label: isEn ? 'Crypto Perpetuals & Spot' : 'Criptoativos', value: 'crypto' },
      { label: isEn ? 'Indices & Equities' : 'Índices / Ações', value: 'indices' },
      { label: isEn ? 'Synthetics / Deriv' : 'Sintéticos / Deriv', value: 'synthetic' },
    ]
  },
  {
    id: 'discipline',
    title: isEn ? 'Execution Discipline' : 'Autoavalição',
    question: isEn ? 'How would you rate your adherence to your risk plan?' : 'Como você avalia seu nível atual de disciplina e controle emocional?',
    icon: ShieldCheck,
    options: [
      { label: isEn ? 'Strictly follow my playbook & stops' : 'Sigo meu plano à risca', value: 'disciplined' },
      { label: isEn ? 'Occasional rule drift or overtrading' : 'Ocasionalmente saio do plano', value: 'improving' },
      { label: isEn ? 'Struggle with tilt & revenge trading' : 'Tenho dificuldade em seguir regras', value: 'struggling' },
      { label: isEn ? 'Still formalizing my trading plan' : 'Ainda não tenho um plano definido', value: 'no_plan' },
    ]
  },
  {
    id: 'referral',
    title: isEn ? 'Discovery Channel' : 'Como nos encontrou?',
    question: isEn ? 'How did you hear about Torex Journal?' : 'Como você ficou sabendo do Torex Journal?',
    icon: Search,
    options: [
      { label: isEn ? 'Instagram / Social Media' : 'Instagram / Redes Sociais', value: 'social' },
      { label: 'YouTube', value: 'youtube' },
      { label: isEn ? 'Trader Referral' : 'Recomendação de Amigo', value: 'friend' },
      { label: isEn ? 'Google Search' : 'Pesquisa no Google', value: 'search' },
      { label: isEn ? 'Other' : 'Outro', value: 'other' },
    ]
  }
];

export const OnboardingSurvey: React.FC<OnboardingSurveyProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { updateUser } = useAuth();
  const { locale } = useLocale();
  const isEn = locale === 'en';
  const steps = getSteps(isEn);

  const handleOptionSelect = (value: string) => {
    const stepId = steps[currentStep].id;
    setAnswers(prev => ({ ...prev, [stepId]: value }));
    
    // Auto-advance with a slight delay for better UX
    setTimeout(() => {
      if (currentStep < steps.length - 1) {
        setCurrentStep(prev => prev + 1);
      }
    }, 300);
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    try {
      await api.post('/auth/onboarding', answers);
      updateUser({ onboardingCompleted: true });
      onComplete();
    } catch (error) {
      console.error('Failed to complete onboarding', error);
      alert(isEn ? 'Failed to save onboarding responses. Please try again.' : 'Houve um erro ao salvar suas respostas. Por favor, tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const progress = ((currentStep + 1) / steps.length) * 100;
  const activeStep = steps[currentStep];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-canvas/90 backdrop-blur-xl p-4 md:p-6 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-2xl bg-surface border border-line rounded-3xl shadow-2xl overflow-hidden relative"
      >
        {/* Progress header */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-surface">
          <motion.div 
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        <div className="p-8 md:p-12">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400">
                <activeStep.icon size={24} />
              </div>
              <div>
                <span className="text-xs font-bold text-indigo-500 uppercase tracking-widest">
                  {isEn ? `Step ${currentStep + 1} of ${steps.length}` : `Passo ${currentStep + 1} de ${steps.length}`}
                </span>
                <h2 className="text-fg font-bold">{activeStep.title}</h2>
              </div>
            </div>
            {currentStep > 0 && (
              <button 
                onClick={() => setCurrentStep(prev => prev - 1)}
                className="p-2 text-fg-subtle hover:text-fg transition-colors"
                title={isEn ? 'Back' : 'Voltar'}
              >
                <ChevronLeft size={20} />
              </button>
            )}
          </div>

          {/* Question area */}
          <div className="min-h-[300px] flex flex-col">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -20, opacity: 0 }}
                className="flex-1"
              >
                <h1 className="text-2xl md:text-3xl font-bold text-fg mb-8 leading-tight">
                  {activeStep.question}
                </h1>

                <div className="grid grid-cols-1 gap-3">
                  {activeStep.options.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleOptionSelect(option.value)}
                      className={`group relative flex items-center justify-between p-5 rounded-2xl border transition-all text-left ${
                        answers[activeStep.id] === option.value
                          ? 'bg-indigo-500/10 border-indigo-500/50 text-fg'
                          : 'bg-surface/50 border-line text-fg-muted hover:border-line-strong hover:bg-surface-2/50'
                      }`}
                    >
                      <span className="font-medium">{option.label}</span>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                        answers[activeStep.id] === option.value
                          ? 'bg-indigo-500 border-indigo-500'
                          : 'border-line-strong group-hover:border-slate-600'
                      }`}>
                        {answers[activeStep.id] === option.value && <Check size={14} className="text-fg" />}
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer actions */}
          <div className="mt-12 flex items-center justify-between">
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <div 
                  key={i} 
                  className={`h-1 w-4 rounded-full transition-all ${
                    i === currentStep ? 'bg-indigo-500 w-8' : i < currentStep ? 'bg-emerald-500/40' : 'bg-surface-2'
                  }`}
                />
              ))}
            </div>

            {currentStep === steps.length - 1 && answers[activeStep.id] && (
              <motion.button
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                onClick={handleFinish}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl shadow-xl shadow-indigo-600/20 transition-all disabled:opacity-50"
              >
                {isSubmitting
                  ? (isEn ? 'Saving...' : 'Salvando...')
                  : (isEn ? 'Complete Setup' : 'Finalizar')}
                <Sparkles size={18} />
              </motion.button>
            )}
            
            {currentStep < steps.length - 1 && answers[activeStep.id] && (
              <button 
                onClick={() => setCurrentStep(prev => prev + 1)}
                className="flex items-center gap-2 text-indigo-400 font-bold hover:text-indigo-300 transition-colors"
                title={isEn ? 'Next' : 'Próximo'}
              >
                {isEn ? 'Next' : 'Próximo'}
                <ChevronRight size={20} />
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Background Elements */}
        <div className="absolute top-1/2 left-0 -translate-y-1/2 -z-10 w-64 h-64 bg-indigo-500/5 blur-[100px] rounded-full" />
        <div className="absolute bottom-0 right-0 -z-10 w-96 h-96 bg-purple-500/5 blur-[120px] rounded-full" />
      </motion.div>
    </div>
  );
};
