import React from 'react';
import { Check, Circle, ShieldAlert } from 'lucide-react';
import type { ClientPasswordEvaluation } from '../../lib/registrationValidation';

interface PasswordStrengthChecklistProps {
    password: string;
    evaluation: ClientPasswordEvaluation;
    locale: 'pt' | 'en';
}

export const PasswordStrengthChecklist: React.FC<PasswordStrengthChecklistProps> = ({
    password,
    evaluation,
    locale,
}) => {
    const isEn = locale === 'en';
    const hasValue = password.length > 0;
    const { score, checks } = evaluation;

    const strengthLabel = !hasValue
        ? ''
        : score >= 4
          ? isEn
              ? 'Excellent'
              : 'Excelente'
          : score === 3
            ? isEn
                ? 'Strong'
                : 'Forte'
            : score === 2
              ? isEn
                  ? 'Fair'
                  : 'Média'
              : isEn
                ? 'Weak'
                : 'Fraca';

    const barColor =
        score >= 4
            ? 'bg-emerald-500'
            : score === 3
              ? 'bg-emerald-400'
              : score === 2
                ? 'bg-amber-400'
                : 'bg-rose-500';

    const labelColor =
        score >= 3
            ? 'text-emerald-400'
            : score === 2
              ? 'text-amber-400'
              : 'text-rose-400';

    const items = [
        {
            ok: checks.minLength,
            label: isEn ? 'At least 8 characters' : 'Mínimo de 8 caracteres',
        },
        {
            ok: checks.hasUpperAndLower,
            label: isEn
                ? 'Uppercase (A-Z) and lowercase (a-z) letters'
                : 'Letras maiúsculas (A-Z) e minúsculas (a-z)',
        },
        {
            ok: checks.hasNumber,
            label: isEn ? 'At least one number (0-9)' : 'Pelo menos um número (0-9)',
        },
        {
            ok: checks.hasSpecial,
            label: isEn
                ? 'At least one special character (!@#$%&*)'
                : 'Pelo menos um caractere especial (!@#$%&*)',
        },
        {
            ok: hasValue && checks.noPredictablePatterns,
            warn: hasValue && !checks.noPredictablePatterns,
            label: isEn
                ? 'No number sequences, keyboard patterns, or part of your name/email'
                : 'Sem sequências (123, abcd), repetições ou partes do seu nome/e-mail',
        },
    ];

    return (
        <div className="mt-2 rounded-xl border border-border/70 bg-surface-subtle/60 px-3 py-2.5 text-[11px]">
            {hasValue && (
                <div className="mb-2">
                    <div className="mb-1 flex items-center justify-between">
                        <span className="font-medium text-fg-subtle">
                            {isEn ? 'Password strength' : 'Força da senha'}
                        </span>
                        <span className={`font-semibold ${labelColor}`}>{strengthLabel}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((lvl) => (
                            <div
                                key={lvl}
                                className={`h-1 rounded-full transition-colors ${
                                    score >= lvl ? barColor : 'bg-border/70'
                                }`}
                            />
                        ))}
                    </div>
                </div>
            )}

            <ul className="space-y-1">
                {items.map((item) => (
                    <li
                        key={item.label}
                        className={`flex items-start gap-1.5 leading-snug transition-colors ${
                            item.warn
                                ? 'text-rose-400'
                                : item.ok
                                  ? 'text-emerald-400'
                                  : 'text-fg-subtle'
                        }`}
                    >
                        {item.warn ? (
                            <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                        ) : item.ok ? (
                            <Check size={13} className="mt-0.5 shrink-0" aria-hidden />
                        ) : (
                            <Circle size={11} className="mt-0.5 shrink-0 opacity-60" aria-hidden />
                        )}
                        <span>{item.label}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};
