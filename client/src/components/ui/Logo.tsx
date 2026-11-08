import { Link } from 'react-router-dom';
import { BRAND } from '../../constants/brand';
import { cn } from '../../lib/cn';

interface LogoProps {
    /** Show the wordmark next to the mark. */
    withWordmark?: boolean;
    size?: 'sm' | 'md' | 'lg';
    /** Wrap in a link to this route. */
    to?: string;
    className?: string;
}

const MARK_SIZE = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' } as const;

export const Logo = ({ withWordmark = true, size = 'md', to, className }: LogoProps) => {
    const content = (
        <>
            <img
                src={BRAND.logoUrl}
                alt={withWordmark ? '' : BRAND.name}
                className={cn(MARK_SIZE[size], 'rounded-lg object-contain drop-shadow-md transition-transform group-hover:scale-105')}
            />
            {withWordmark && (
                <span className="text-xl font-bold tracking-tight text-fg">
                    TOREX <span className="text-accent-fg">JOURNAL</span>
                </span>
            )}
        </>
    );

    const classes = cn('group inline-flex items-center gap-3', className);

    return to ? (
        <Link
            to={to}
            aria-label={`${BRAND.name} — página inicial`}
            className={cn(classes, 'rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60')}
        >
            {content}
        </Link>
    ) : (
        <span className={classes}>{content}</span>
    );
};
