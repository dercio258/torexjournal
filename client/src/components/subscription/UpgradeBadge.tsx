import React from 'react';
import { ArrowUpRight, Crown, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';
import { openWorkspacePlansModal } from '../../lib/planGate';

export interface UpgradeBadgeProps {
    variant?: 'pill' | 'mini' | 'inline';
    label?: string;
    tierLabel?: string;
    sourceFeature?: string;
    extraDetail?: Record<string, any>;
    onClick?: (e: React.MouseEvent<HTMLElement>) => void;
    className?: string;
    asButton?: boolean;
    title?: string;
}

/**
 * Conversion-oriented upgrade badge replacing restrictive padlock icons
 * across gated features; triggers the workspace pricing modal directly.
 */
export const UpgradeBadge: React.FC<UpgradeBadgeProps> = ({
    variant = 'pill',
    label,
    tierLabel = 'PRO',
    sourceFeature,
    extraDetail,
    onClick,
    className,
    asButton = false,
    title,
}) => {
    const handleAction = (e: React.MouseEvent<HTMLElement>) => {
        if (onClick) {
            onClick(e);
            return;
        }
        if (sourceFeature) {
            e.preventDefault();
            e.stopPropagation();
            openWorkspacePlansModal(sourceFeature, extraDetail);
        }
    };

    const isInteractive = Boolean(onClick || (asButton && sourceFeature));

    const content =
        variant === 'mini' ? (
            <>
                <Sparkles size={8.5} className="shrink-0" />
                <span>{label || tierLabel}</span>
            </>
        ) : (
            <>
                <Crown size={10} className="shrink-0 text-amber-500 dark:text-amber-300" />
                <span>{label ? label : `Upgrade · ${tierLabel}`}</span>
                {variant === 'inline' && <ArrowUpRight size={10.5} className="shrink-0 opacity-85" />}
            </>
        );

    const classes = cn(
        'inline-flex items-center font-extrabold uppercase tracking-wider shrink-0 select-none transition-all',
        variant === 'mini'
            ? 'gap-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 text-[8px] leading-none text-slate-950 shadow-sm'
            : variant === 'inline'
              ? 'gap-1 rounded-full border border-amber-500/35 bg-gradient-to-r from-amber-500/18 via-orange-500/12 to-amber-500/18 px-2.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300 hover:border-amber-400/70 hover:from-amber-500/25 hover:to-orange-500/25 shadow-xs'
              : 'gap-1 rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 text-[9.5px] leading-none text-amber-600 dark:text-amber-300 hover:border-amber-400/70 hover:bg-amber-500/25',
        isInteractive && 'cursor-pointer',
        className,
    );

    if (asButton || (onClick && sourceFeature)) {
        return (
            <button
                type="button"
                onClick={handleAction}
                title={title}
                className={classes}
            >
                {content}
            </button>
        );
    }

    return (
        <span onClick={onClick || (sourceFeature ? handleAction : undefined)} title={title} className={classes}>
            {content}
        </span>
    );
};
