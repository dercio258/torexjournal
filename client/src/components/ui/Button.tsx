import React, { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'gradient';
    isLoading?: boolean;
    icon?: React.ReactNode;
}

export const Button = ({
    children,
    variant = 'primary',
    isLoading,
    icon,
    className = '',
    disabled,
    ...props
}: ButtonProps) => {
    const variants = {
        primary: 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20',
        secondary: 'bg-slate-500/10 hover:bg-slate-500/20 text-slate-400 border-slate-500/20',
        danger: 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/20',
        ghost: 'hover:bg-slate-800/50 text-slate-400 hover:text-slate-100 border-transparent',
        gradient: 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg shadow-emerald-500/30 border-none'
    };

    return (
        <button
            className={`
                px-4 py-2 rounded-lg font-medium text-sm transition-all border flex items-center justify-center gap-2
                disabled:opacity-50 disabled:cursor-not-allowed
                ${variants[variant]} 
                ${className}
            `}
            disabled={isLoading || disabled}
            {...props}
        >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {!isLoading && icon}
            {children}
        </button>
    );
};
