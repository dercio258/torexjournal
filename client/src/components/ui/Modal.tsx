import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

type ModalSize = 'md' | 'lg' | 'xl' | '2xl' | 'full';

const SIZE_CLASSES: Record<ModalSize, string> = {
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-5xl',
    full: 'max-w-6xl',
};

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    size?: ModalSize;
    children: React.ReactNode;
}

export const Modal = ({ isOpen, onClose, title, subtitle, size = 'md', children }: ModalProps) => {
    useEffect(() => {
        if (!isOpen) return;
        document.body.style.overflow = 'hidden';
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = 'unset';
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-canvas/80 backdrop-blur-md transition-opacity"
                onClick={onClose}
            />

            {/* Content */}
            <div
                className={cn(
                    'relative bg-surface border border-line rounded-2xl shadow-2xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200',
                    SIZE_CLASSES[size],
                )}
            >
                <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-line bg-surface-2/40">
                    <div className="min-w-0">
                        <h3 className="text-base font-bold text-fg tracking-tight truncate">{title}</h3>
                        {subtitle && (
                            <p className="mt-0.5 text-xs text-fg-muted truncate">{subtitle}</p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fechar"
                        className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors shrink-0"
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="p-5 sm:p-6 max-h-[84vh] overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};
