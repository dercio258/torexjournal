import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, FileSpreadsheet, Monitor } from 'lucide-react';
import { cn } from '../../lib/cn';
import { DerivIcon, Mt5Icon } from './icons';
import { useLocale } from '../../context/LocaleContext';

const getSubNav = (isEn: boolean) => [
    { to: '/add-trades/deriv-sync', label: 'Deriv', icon: <DerivIcon className="w-3.5 h-3.5" /> },
    { to: '/add-trades/mt5-sync', label: 'MetaTrader 5', icon: <Mt5Icon className="w-3.5 h-3.5" /> },
    { to: '/add-trades/mt5-ea', label: isEn ? 'PC Connector' : 'Computador', icon: <Monitor size={13} /> },
    { to: '/add-trades/import', label: isEn ? 'File Upload' : 'Arquivo', icon: <FileSpreadsheet size={13} /> },
    { to: '/add-trades/history', label: isEn ? 'Import Log' : 'Histórico', icon: <Clock size={13} /> },
];

export const AddTradesLayout = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const SUB_NAV = getSubNav(isEn);
    const isHub = location.pathname === '/add-trades' || location.pathname === '/add-trades/';

    return (
        <div className="w-full space-y-3 pb-8">
            {isHub ? (
                <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
                    <p className="text-xs text-fg-muted">
                        {isEn
                            ? 'Select a broker auto-sync or execution file importer to log your trades.'
                            : 'Selecione o método de sincronização ou importação para registrar suas operações.'}
                    </p>
                    <button
                        type="button"
                        onClick={() => navigate('/add-trades/history')}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-canvas-subtle hover:bg-surface-2 border border-line text-xs font-semibold text-fg transition-colors ml-auto"
                    >
                        <Clock size={13} className="text-fg-muted" />
                        <span>{isEn ? 'Import Log' : 'Histórico de Importações'}</span>
                    </button>
                </div>
            ) : (
                <div className="rounded-xl border border-line bg-surface p-2 sm:px-3.5 flex flex-wrap items-center justify-between gap-2.5">
                    <Link
                        to="/add-trades"
                        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors shrink-0"
                    >
                        <ArrowLeft size={14} />
                        <span>{isEn ? 'Methods' : 'Opções'}</span>
                    </Link>

                    <nav
                        aria-label={isEn ? 'Import methods' : 'Métodos'}
                        className="flex items-center gap-1 overflow-x-auto no-scrollbar bg-canvas-subtle border border-line-subtle p-1 rounded-lg max-w-full"
                    >
                        {SUB_NAV.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                className={({ isActive }) =>
                                    cn(
                                        'inline-flex shrink-0 items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-semibold border transition-colors',
                                        isActive
                                            ? 'bg-surface-2 border-line text-fg'
                                            : 'border-transparent text-fg-muted hover:text-fg'
                                    )
                                }
                            >
                                {item.icon}
                                <span>{item.label}</span>
                            </NavLink>
                        ))}
                    </nav>
                </div>
            )}

            <div className={cn('w-full', !isHub && 'max-w-4xl')}>
                <Outlet />
            </div>
        </div>
    );
};
