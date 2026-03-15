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

interface OnboardingSurveyProps {
  onComplete: () => void;
}

const steps = [
  {
    id: 'experience',
    title: 'Sua Experiência',
    question: 'Quanto tempo você opera no mercado financeiro?',
    icon: TrendingUp,
    options: [
      { label: 'Iniciante (< 1 ano)', value: 'beginner' },
      { label: 'Intermediário (1-3 anos)', value: 'intermediate' },
      { label: 'Avançado (3-5 anos)', value: 'advanced' },
      { label: 'Profissional (5+ anos)', value: 'pro' },
    ]
  },
  {
    id: 'entity',
    title: 'Seu Perfil',
    question: 'Você opera como indivíduo ou em nome de uma empresa?',
    icon: Users,
    options: [
      { label: 'Individual (Varejo)', value: 'individual' },
      { label: 'Empresa / Institucional', value: 'company' },
    ]
  },
  {
    id: 'volume',
    title: 'Volume Operacional',
    question: 'Qual o seu volume médio de movimentação diária?',
    icon: DollarSign,
    options: [
      { label: '0 - 100$', value: 'low' },
      { label: '100$ - 1.000$', value: 'medium' },
      { label: '1.000$ - 10.000$', value: 'high' },
      { label: 'Acima de 10.000$', value: 'whale' },
    ]
  },
  {
    id: 'goal',
    title: 'Seu Objetivo',
    question: 'Qual o seu objetivo principal ao usar o Torex Journal?',
    icon: Target,
    options: [
      { label: 'Viver de Trading', value: 'full_time' },
      { label: 'Renda Extra', value: 'side_income' },
      { label: 'Gestão de Capital', value: 'management' },
      { label: 'Aprendizado e Disciplina', value: 'learning' },
    ]
  },
  {
    id: 'market',
    title: 'Mercado Principal',
    question: 'Em qual mercado você foca a maior parte das suas operações?',
    icon: Globe,
    options: [
      { label: 'Forex', value: 'forex' },
      { label: 'Criptoativos', value: 'crypto' },
      { label: 'Índices / Ações', value: 'indices' },
      { label: 'Sintéticos / Deriv', value: 'synthetic' },
    ]
  },
  {
    id: 'discipline',
    title: 'Autoavalição',
    question: 'Como você avalia seu nível atual de disciplina e controle emocional?',
    icon: ShieldCheck,
    options: [
      { label: 'Sigo meu plano à risca', value: 'disciplined' },
      { label: 'Ocasionalmente saio do plano', value: 'improving' },
      { label: 'Tenho dificuldade em seguir regras', value: 'struggling' },
      { label: 'Ainda não tenho um plano definido', value: 'no_plan' },
    ]
  },
  {
    id: 'referral',
    title: 'Como nos encontrou?',
    question: 'Como você ficou sabendo do Torex Journal?',
    icon: Search,
    options: [
      { label: 'Instagram / Redes Sociais', value: 'social' },
      { label: 'YouTube', value: 'youtube' },
      { label: 'Recomendação de Amigo', value: 'friend' },
      { label: 'Pesquisa no Google', value: 'search' },
      { label: 'Outro', value: 'other' },
    ]
  }
];

export const OnboardingSurvey: React.FC<OnboardingSurveyProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { updateUser } = useAuth();

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
      alert('Houve um erro ao salvar suas respostas. Por favor, tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const progress = ((currentStep + 1) / steps.length) * 100;
  const activeStep = steps[currentStep];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 md:p-6 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-2xl bg-[#0d1117] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden relative"
      >
        {/* Progress header */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-slate-900">
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
                  Passo {currentStep + 1} de {steps.length}
                </span>
                <h2 className="text-white font-bold">{activeStep.title}</h2>
              </div>
            </div>
            {currentStep > 0 && (
              <button 
                onClick={() => setCurrentStep(prev => prev - 1)}
                className="p-2 text-slate-500 hover:text-white transition-colors"
                title="Voltar"
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
                <h1 className="text-2xl md:text-3xl font-bold text-white mb-8 leading-tight">
                  {activeStep.question}
                </h1>

                <div className="grid grid-cols-1 gap-3">
                  {activeStep.options.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleOptionSelect(option.value)}
                      className={`group relative flex items-center justify-between p-5 rounded-2xl border transition-all text-left ${
                        answers[activeStep.id] === option.value
                          ? 'bg-indigo-500/10 border-indigo-500/50 text-white'
                          : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700 hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="font-medium">{option.label}</span>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                        answers[activeStep.id] === option.value
                          ? 'bg-indigo-500 border-indigo-500'
                          : 'border-slate-700 group-hover:border-slate-600'
                      }`}>
                        {answers[activeStep.id] === option.value && <Check size={14} className="text-white" />}
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
                    i === currentStep ? 'bg-indigo-500 w-8' : i < currentStep ? 'bg-emerald-500/40' : 'bg-slate-800'
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
                {isSubmitting ? 'Salvando...' : 'Finalizar'}
                <Sparkles size={18} />
              </motion.button>
            )}
            
            {currentStep < steps.length - 1 && answers[activeStep.id] && (
              <button 
                onClick={() => setCurrentStep(prev => prev + 1)}
                className="flex items-center gap-2 text-indigo-400 font-bold hover:text-indigo-300 transition-colors"
                title="Próximo"
              >
                Próximo
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
