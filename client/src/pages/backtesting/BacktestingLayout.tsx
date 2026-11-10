import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FlaskConical, FolderKanban, Layers, LayoutGrid, Lightbulb, Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { BacktestWorkspaceProvider, useBacktestWorkspace } from './BacktestWorkspaceContext';

const Nav = () => {
    const { sessions, strategies } = useBacktestWorkspace();
    const items = [
        { to: '/backtesting/sessions', label: 'Sessões', icon: <FolderKanban size={15} />, count: sessions.length },
        { to: '/backtesting/strategies', label: 'Estratégias', icon: <Layers size={15} />, count: strategies.length },
        { to: '/backtesting/dashboard', label: 'Dashboard', icon: <LayoutGrid size={15} /> },
        { to: '/backtesting/hypotheses', label: 'Otimização de hipóteses', icon: <Lightbulb size={15} /> },
    ];
    return (
        <nav aria-label="Secções do backtesting" className="-mb-px flex gap-1 overflow-x-auto">
            {items.map((it) => (
                <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) =>
                        cn(
                            'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50',
                            isActive ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'
                        )
                    }
                >
                    {({ isActive }) => (
                        <>
                            <span aria-hidden className={isActive ? 'text-accent-fg' : 'text-fg-subtle'}>
                                {it.icon}
                            </span>
                            {it.label}
                            {it.count !== undefined && (
                                <span className="rounded-full bg-surface-3 px-1.5 text-[10px] tabular-nums text-fg-muted">{it.count}</span>
                            )}
                        </>
                    )}
                </NavLink>
            ))}
        </nav>
    );
};

const Header = () => {
    const navigate = useNavigate();
    return (
        <header className="rounded-xl border border-line bg-surface px-4 pt-4 sm:px-6 sm:pt-5">
            <div className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-fg">
                        <FlaskConical size={13} aria-hidden />
                        Backtesting
                    </p>
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-fg">Laboratório de backtesting</h1>
                    <p className="mt-1 max-w-2xl text-sm text-fg-muted">
                        Treine em replay vela a vela, registe cada sessão e teste hipóteses sobre o histórico real da conta.
                    </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                    <Button variant="outline" size="sm" icon={<Layers size={14} />} onClick={() => navigate('/backtesting/strategies?new=1')}>
                        Nova estratégia
                    </Button>
                    <Button variant="brand" size="sm" icon={<Plus size={14} />} onClick={() => navigate('/backtesting/sessions/new')}>
                        Nova sessão
                    </Button>
                </div>
            </div>
            <div className="border-t border-line">
                <Nav />
            </div>
        </header>
    );
};

/** Shell for every /backtesting page except the full-screen replay terminal. */
export const BacktestingLayout = () => (
    <BacktestWorkspaceProvider>
        <div className="mx-auto w-full space-y-5 pb-10">
            <Header />
            <Outlet />
        </div>
    </BacktestWorkspaceProvider>
);
