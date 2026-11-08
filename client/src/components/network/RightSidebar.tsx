import { TrendingUp, Heart } from 'lucide-react';

interface SuggestedUser {
    id: string;
    username: string;
    avatarUrl?: string;
    name?: string;
}

interface Post {
    id: number;
    content: string;
    likesCount: number;
    user: {
        username: string;
    };
}

interface RightSidebarProps {
    trending: Post[];
    suggestions: SuggestedUser[];
}

export const RightSidebar = ({ trending }: RightSidebarProps) => {
    return (
        <div className="w-80 hidden lg:flex flex-col gap-6 flex-shrink-0">
            {/* Trending Section - White background in light mode as requested */}
            <div className="bg-white dark:bg-slate-900/60 backdrop-blur-xl border border-line rounded-3xl p-6 shadow-sm dark:shadow-xl">
                <h3 className="text-lg font-bold text-fg mb-4 flex items-center gap-2">
                    <TrendingUp className="text-emerald-500 dark:text-emerald-400" /> Destaques
                </h3>
                <div className="space-y-4">
                    {trending.length === 0 ? (
                        <p className="text-fg-subtle dark:text-slate-400 text-sm">Nenhum destaque hoje.</p>
                    ) : trending.map(t => (
                        <div key={t.id} className="p-3 bg-slate-50 hover:bg-surface-2 dark:bg-slate-800/50 transition-colors cursor-pointer border border-slate-200 dark:border-slate-700/50 rounded-xl">
                            <p className="text-xs text-indigo-600 dark:text-indigo-400 font-bold mb-1">@{t.user?.username || 'user'}</p>
                            <p className="text-sm text-slate-700 dark:text-slate-200 line-clamp-2">{t.content}</p>
                            <div className="flex gap-2 mt-2 text-[10px] text-fg-subtle dark:text-slate-400 font-bold">
                                <span className="flex items-center gap-1"><Heart size={10} className="text-rose-500" /> {t.likesCount}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Community Pro Promo */}
            <div className="bg-gradient-to-br from-indigo-50 dark:from-indigo-900/20 to-purple-50 dark:to-purple-900/20 border border-indigo-200 dark:border-indigo-500/20 rounded-3xl p-6 shadow-sm dark:shadow-none">
                <h4 className="font-bold text-fg mb-2">Comunidade Pro</h4>
                <p className="text-xs text-fg-muted mb-4">Conecte-se com os melhores traders da plataforma e troque experiências em tempo real.</p>
                <button className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-900/20">
                    Entrar no Chat Global
                </button>
            </div>
        </div>
    );
};
