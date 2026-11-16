import { Injectable } from '@nestjs/common';
import { AiActionLink } from './ai-chat.entity';
import {
    EXISTING_CONCEPT_ALIASES,
    TRADING_GLOSSARY,
    matchGlossaryConcept,
} from './ai-trading-glossary';

export interface PlatformGuideMatch {
    topicId: string;
    title: string;
    answer: string;
    actions: AiActionLink[];
    suggestions: string[];
}

export interface TradingConceptGuide {
    conceptKey: string;
    title: string;
    answer: string;
    suggestions: string[];
}

export interface PlatformRagDocumentSeed {
    sourceId: string;
    locale: 'pt' | 'en';
    title: string;
    content: string;
    routes: string[];
    kind: 'platform_guide' | 'trading_concept';
}

interface TradingConceptItem {
    key: string;
    aliases?: string[];
    strictCue?: boolean;
    title: string;
    titleEn: string;
    answer: string;
    answerEn: string;
    suggestions: string[];
    suggestionsEn: string[];
}

interface KnowledgeTopic {
    id: string;
    title: string;
    titleEn: string;
    keywords: string[];
    answer: string;
    answerEn: string;
    actions: AiActionLink[];
    actionsEn: AiActionLink[];
    suggestions: string[];
    suggestionsEn: string[];
}

@Injectable()
export class AiKnowledgeBaseService {
    private readonly topics: KnowledgeTopic[] = [
        {
            id: 'import_trades',
            title: 'Importar e Sincronizar Operações',
            titleEn: 'Import & Sync Executions',
            keywords: [
                'importar',
                'importacao',
                'ilportar',
                'sincronizar',
                'conectar conta',
                'conectar corretora',
                'corretora',
                'corretoras',
                'adicionar trade',
                'add trade',
                'adicionar operac',
                'subir csv',
                'enviar csv',
                'mt5',
                'metatrader',
                'deriv',
                'expert advisor',
                'planilha',
                'html',
                'xlsx',
                'import trades',
                'how to import',
                'sync account',
                'connect broker',
                'broker',
                'upload csv',
            ],
            answer:
                'Para trazer as suas operações para a plataforma, vá até `/add-trades` e selecione o método ou a sua corretora — temos suporte para **+20 corretoras**, além de sincronização direta via **MT5**, **Expert Advisor**, API da **Deriv** ou envio rápido de ficheiro **CSV, HTML ou Excel**.',
            answerEn:
                'To bring your executions into the workspace, open `/add-trades` and pick your connection method or broker — we support **20+ brokers**, direct **MT5** cloud sync, **Expert Advisor**, **Deriv API**, and quick **CSV, HTML, or Excel** uploads.',
            actions: [
                {
                    label: 'Importar Trades (+20 Corretoras)',
                    route: '/add-trades',
                    description: 'Conectar corretora, MT5, Deriv ou importar CSV',
                },
            ],
            actionsEn: [
                {
                    label: 'Import Trades (20+ Brokers)',
                    route: '/add-trades',
                    description: 'Connect broker, MT5, Deriv or upload CSV',
                },
            ],
            suggestions: [
                'Como gerir o meu Diário?',
                'Como fazer backtesting?',
            ],
            suggestionsEn: [
                'How do I manage my Journal?',
                'How do I run backtesting?',
            ],
        },
        {
            id: 'backtesting_replay',
            title: 'Backtesting e Replay Gráfico',
            titleEn: 'Backtesting & Market Replay',
            keywords: [
                'backtest',
                'backetest',
                'backetesting',
                'backtesting',
                'replay',
                'simular',
                'simulacao',
                'estrategia',
                'hipotese',
                'testar estrategia',
                'playbook',
                'market replay',
                'test strategy',
            ],
            answer:
                'Para testar o seu operacional no **Backtesting**, aceda a `/backtesting/strategies` e crie primeiro uma **estratégia**. Em seguida, vá a `/backtesting/sessions` para criar uma **sessão** (escolhendo o ativo e o período histórico) e clique em **Replay** para operar vela a vela sem arriscar capital real.',
            answerEn:
                'To test your setup in **Backtesting**, go to `/backtesting/strategies` and define a **Playbook** first. Next, open `/backtesting/sessions` to spin up a **session** (symbol and historical range) and launch **Replay** to step candle-by-candle without risking live capital.',
            actions: [
                {
                    label: '1. Criar Estratégia',
                    route: '/backtesting/strategies',
                    description: 'Definir setup e regras de teste',
                },
                {
                    label: '2. Criar Sessão & Replay',
                    route: '/backtesting/sessions',
                    description: 'Iniciar simulação gráfica vela a vela',
                },
            ],
            actionsEn: [
                {
                    label: '1. Create Playbook',
                    route: '/backtesting/strategies',
                    description: 'Define setup rules and parameters',
                },
                {
                    label: '2. Create Session & Replay',
                    route: '/backtesting/sessions',
                    description: 'Launch bar-by-bar chart simulation',
                },
            ],
            suggestions: [
                'Como gerir o meu Diário?',
                'Qual é o meu Edge?',
            ],
            suggestionsEn: [
                'How do I manage my Journal?',
                'Where is my Edge?',
            ],
        },
        {
            id: 'journal_notes',
            title: 'Gestão do Diário de Trading',
            titleEn: 'Trading Journal Management',
            keywords: [
                'diario',
                'gerir diario',
                'meu diario',
                'journal',
                'anotar',
                'anotacao',
                'nota diaria',
                'daily note',
                'trade note',
                'registrar nota',
                'print',
                'screenshot',
                'template',
                'mfe',
                'mae',
                'playbook',
                'manage journal',
                'log trades',
            ],
            answer:
                'Para gerir o seu diário de forma completa, aceda a `/journal`: use **Daily Notes** para registar o resumo do dia e o seu check-in emocional (sono, foco e humor), **Trade Notes** para anexar prints e documentar `MFE`/`MAE` de cada entrada, e **General** para manter escritas as regras do seu plano de trading.',
            answerEn:
                'Manage your complete trading desk log at `/journal`: use **Daily Notes** for end-of-day reviews and psych check-ins (sleep, focus, mood), **Trade Notes** to attach chart screenshots and record `MFE`/`MAE` per execution, and **General** for written Playbook rules.',
            actions: [
                {
                    label: 'Abrir Meu Diário',
                    route: '/journal',
                    description: 'Daily Notes, Trade Notes e Playbook',
                },
            ],
            actionsEn: [
                {
                    label: 'Open My Journal',
                    route: '/journal',
                    description: 'Daily Notes, Trade Notes & Playbook',
                },
            ],
            suggestions: [
                'Estou seguindo meu plano?',
                'Como estão minhas operações atuais?',
            ],
            suggestionsEn: [
                'Am I following my plan?',
                'How are my recent trades?',
            ],
        },
        {
            id: 'reports_filters',
            title: 'Relatórios e Métricas',
            titleEn: 'Reports & Telemetry Analytics',
            keywords: [
                'relatorio',
                'reports',
                'exportar pdf',
                'exportar excel',
                'filtrar',
                'filtro',
                'curva de capital',
                'onde vejo drawdown',
                'equity curve',
                'export pdf',
                'export csv',
                'drawdown',
            ],
            answer:
                'Em `/reports`, você analisa a curva de capital, drawdown e o desempenho detalhado por ativo, sessão operacional e dia da semana, podendo filtrar por conta e período no topo da página.',
            answerEn:
                'In `/reports`, analyze your cumulative equity curve, max drawdown, and breakdown by symbol, trading session, and weekday — with account and date range filters pinned at the top.',
            actions: [
                {
                    label: 'Ver Relatórios',
                    route: '/reports',
                    description: 'Estatísticas por ativo, sessão e período',
                },
            ],
            actionsEn: [
                {
                    label: 'Open Reports',
                    route: '/reports',
                    description: 'Telemetry by symbol, session, and date range',
                },
            ],
            suggestions: [
                'Qual é o meu Edge?',
                'Por que estou perdendo?',
            ],
            suggestionsEn: [
                'Where is my Edge?',
                'Why am I losing?',
            ],
        },
        {
            id: 'emotional_management',
            title: 'Gestão Emocional no Diário',
            titleEn: 'Psych & Discipline Logging',
            keywords: [
                'como registrar emocional',
                'check-in emocional',
                'anotar ansiedade',
                'anotar sono',
                'anotar humor',
                'emotional check-in',
                'track sleep',
                'track mood',
                'mindset',
            ],
            answer:
                'Em `/journal`, na aba **Daily Notes**, registe rapidamente o seu nível de sono, foco, energia, humor e estresse do dia para cruzar o seu estado mental com os resultados das operações.',
            answerEn:
                'Open **Daily Notes** in `/journal` to log sleep quality, focus, energy, mood, and stress levels each session so we can correlate state of mind with net execution P&L.',
            actions: [
                {
                    label: 'Fazer Check-in no Diário',
                    route: '/journal',
                },
            ],
            actionsEn: [
                {
                    label: 'Log Psych Check-in',
                    route: '/journal',
                },
            ],
            suggestions: [
                'Estou seguindo meu plano?',
                'Por que estou perdendo?',
            ],
            suggestionsEn: [
                'Am I following my plan?',
                'Why am I losing?',
            ],
        },
        {
            id: 'calendar_accounts_settings',
            title: 'Calendário Económico, Contas e Planos',
            titleEn: 'Economic Calendar, Accounts & Billing',
            keywords: [
                'calendario economico',
                'onde vejo noticia',
                'payroll',
                'fomc',
                'cpi',
                'configurac',
                'trocar conta',
                'arquivar conta',
                'senha',
                '2fa',
                'assinatura',
                'plano',
                'pagamento',
                'leaderboard',
                'network',
                'economic calendar',
                'switch account',
                'settings',
                'subscription',
                'billing',
            ],
            answer:
                'Você pode acompanhar eventos macroeconómicos de impacto em `/calendar`, alternar entre contas no seletor do topo direito e gerir segurança, perfil e assinatura em `/configuration` ou `/payments`.',
            answerEn:
                'Track high-impact macro releases in `/calendar`, switch portfolios in the top-right account switcher, and manage 2FA security, profile, and billing in `/configuration` or `/payments`.',
            actions: [
                {
                    label: 'Calendário Económico',
                    route: '/calendar',
                },
                {
                    label: 'Configurações',
                    route: '/configuration',
                },
            ],
            actionsEn: [
                {
                    label: 'Economic Calendar',
                    route: '/calendar',
                },
                {
                    label: 'Settings',
                    route: '/configuration',
                },
            ],
            suggestions: [
                'Como importar meus trades?',
                'Como estão minhas operações atuais?',
            ],
            suggestionsEn: [
                'How do I import my trades?',
                'How are my recent trades?',
            ],
        },
    ];

    private readonly tradingConcepts: TradingConceptItem[] = [
        {
            key: 'profit_factor',
            title: 'Profit Factor (Fator de Lucro)',
            titleEn: 'Profit Factor',
            answer:
                'O **Profit Factor** é a razão entre o lucro bruto das operações vencedoras e a perda bruta das operações perdedoras (`Soma dos Ganhos / |Soma das Perdas|`). Valores acima de **1.50** indicam vantagem estatística sólida; abaixo de **1.00**, a estratégia perde dinheiro no agregado.',
            answerEn:
                '**Profit Factor** equals gross profits divided by absolute gross losses (`Gross Wins / |Gross Losses|`). Above **1.50** signals a healthy statistical edge; below **1.00**, the system loses money overall.',
            suggestions: ['Qual é o meu Edge?', 'Por que estou perdendo?'],
            suggestionsEn: ['Where is my Edge?', 'Why am I losing?'],
        },
        {
            key: 'payoff_winrate',
            title: 'Payoff vs Win Rate',
            titleEn: 'Payoff Ratio vs Win Rate',
            answer:
                'O **Payoff (Relação Risco/Retorno)** mede o tamanho médio do ganho frente à perda média (`Ganho Médio / Perda Média`), enquanto o **Win Rate** mede a frequência de acertos. Uma estratégia lucrativa equilibra os dois: com Payoff alto (ex.: `2.0x`), até um Win Rate de 40% gera lucro líquido positivo.',
            answerEn:
                '**Payoff Ratio** measures average win relative to average loss (`Avg Win / |Avg Loss|`), while **Win Rate** tracks hit rate percentage. With a `2.0x` payoff, even a **40% win rate** yields positive expectancy.',
            suggestions: ['Qual é o meu Edge?', 'Como melhorar meu Payoff?'],
            suggestionsEn: ['Where is my Edge?', 'How can I improve my Payoff?'],
        },
        {
            key: 'expectancy',
            title: 'Expectativa Matemática',
            titleEn: 'Mathematical Expectancy',
            answer:
                'A **Expectativa Matemática** mostra quanto você ganha ou perde, em média, a cada trade executado (`(Win Rate × Ganho Médio) - (Loss Rate × Perda Média)`). Manter a expectativa positiva é o que garante sustentabilidade no longo prazo mesmo durante sequências normais de perdas.',
            answerEn:
                '**Mathematical Expectancy** measures your average net return per execution (`(Win Rate × Avg Win) - (Loss Rate × |Avg Loss|)`). Positive expectancy ensures long-term compounding across drawdowns.',
            suggestions: ['Como estão minhas operações?', 'Qual é o meu Edge?'],
            suggestionsEn: ['How are my recent trades?', 'Where is my Edge?'],
        },
        {
            key: 'drawdown',
            title: 'Drawdown Máximo',
            titleEn: 'Maximum Drawdown',
            answer:
                'O **Drawdown Máximo** representa a maior queda acumulada da curva de capital entre um topo (pico) e um fundo subsequente antes de nova máxima. Controlar o risco por trade e respeitar limites de perda diários mantém o drawdown recuperável.',
            answerEn:
                '**Maximum Drawdown** tracks the largest peak-to-trough equity drop prior to a new high. Enforcing per-trade risk caps and daily loss limits keeps drawdowns statistically recoverable.',
            suggestions: ['Por que estou perdendo?', 'Estou seguindo meu plano?'],
            suggestionsEn: ['Why am I losing?', 'Am I following my plan?'],
        },
        {
            key: 'mfe_mae',
            title: 'MFE e MAE',
            titleEn: 'MFE & MAE Execution Telemetry',
            answer:
                '**MFE (Maximum Favorable Excursion)** é o máximo de lucro flutuante alcançado antes do fecho do trade, e **MAE (Maximum Adverse Excursion)** é o maior calor negativo suportado durante a operação. Comparar ambos em `/journal` ajuda a calibrar Stop Loss e Take Profit sem achismos.',
            answerEn:
                '**MFE (Maximum Favorable Excursion)** captures peak unrealized profit during a trade, while **MAE (Maximum Adverse Excursion)** measures peak unrealized heat before exit. Tracking both in `/journal` sharpens Stop Loss and Take Profit placement.',
            suggestions: ['Como gerir o meu Diário?', 'Analisar meus últimos trades'],
            suggestionsEn: ['How do I manage my Journal?', 'Analyze my recent trades'],
        },
        {
            key: 'risk_sizing',
            title: 'Dimensionamento de Posição e Risco',
            titleEn: 'Position Sizing & Risk Control',
            answer:
                'O **dimensionamento de posição** define o tamanho do lote com base na distância do Stop Loss e num percentual fixo de capital (ex.: `0.5%` a `1%` por entrada). Assim, diferentes ativos e volatilidades mantêm o risco financeiro constante.',
            answerEn:
                '**Position sizing** derives contract/lot volume from Stop Loss distance and a fixed equity risk budget (e.g. `0.5%–1%` per trade), keeping dollar exposure uniform across volatility regimes.',
            suggestions: ['Estou seguindo meu plano?', 'Como melhorar minha gestão?'],
            suggestionsEn: ['Am I following my plan?', 'How can I improve risk?'],
        },
        {
            key: 'overtrading_discipline',
            title: 'Overtrading e Revenge Trading',
            titleEn: 'Overtrading & Revenge Trading',
            answer:
                '**Overtrading** ocorre quando você aumenta o número de entradas além dos setups do seu plano; **Revenge Trading** é operar por impulso logo após uma perda tentando recuperá-la imediatamente. Ambos deterioram o Payoff e ampliam o Drawdown.',
            answerEn:
                '**Overtrading** means forcing low-quality setups beyond your Playbook quota; **Revenge Trading** is impulsive sizing right after a loss to win it back quickly. Both erode payoff and deepen drawdowns.',
            suggestions: ['Estou fazendo overtrading?', 'Por que estou perdendo?'],
            suggestionsEn: ['Am I overtrading?', 'Why am I losing?'],
        },
        {
            key: 'trading_sessions',
            title: 'Sessões Operacionais (UTC)',
            titleEn: 'Trading Sessions (UTC)',
            answer:
                'No mercado global, **Ásia** (`00h–07h UTC`) costuma ter menor amplitude; **Londres** (`07h–12h UTC`) e **Overlap Londres + NY** (`12h–16h UTC`) concentram maior liquidez e rompimentos direcionais; e **Nova Iorque** (`16h–21h UTC`) acompanha o fechamento americano.',
            answerEn:
                'In UTC time, **Asia** (`00:00–07:00 UTC`) tends to range with lower volume; **London** (`07:00–12:00 UTC`) and the **London–NY Overlap** (`12:00–16:00 UTC`) bring peak liquidity and directional moves; and **New York** (`16:00–21:00 UTC`) reflects US close flows.',
            suggestions: ['Qual é minha melhor sessão?', 'Como estão meus ativos?'],
            suggestionsEn: ['Which is my best session?', 'How are my symbols performing?'],
        },
    ];

    /** Built-in concepts plus the verified glossary, each with its PT/EN aliases. */
    private readonly allConcepts: TradingConceptItem[] = [
        ...this.tradingConcepts.map((c) => ({
            ...c,
            aliases: EXISTING_CONCEPT_ALIASES[c.key] || [],
        })),
        ...TRADING_GLOSSARY.filter(
            (g) => !this.tradingConcepts.some((c) => c.key === g.key)
        ),
    ];

    /** Concept keys for which the semantic router has no hand-written anchors yet. */
    getGlossaryOnlyConcepts(): Array<{ key: string; title: string; titleEn: string }> {
        const builtIn = new Set(this.tradingConcepts.map((c) => c.key));
        return this.allConcepts
            .filter((c) => !builtIn.has(c.key))
            .map((c) => ({ key: c.key, title: c.title, titleEn: c.titleEn }));
    }

    /**
     * Language-independent concept lookup: recognises a definitional question in PT or EN
     * (with small typos) and returns the verified answer in the requested locale.
     */
    matchTradingConcept(
        rawQuestion: string,
        locale: 'pt' | 'en' = 'pt'
    ): (TradingConceptGuide & { matchedAlias: string; fuzzy: boolean }) | null {
        const match = matchGlossaryConcept(
            rawQuestion,
            this.allConcepts.map((c) => ({
                key: c.key,
                aliases: c.aliases || [],
                strictCue: c.strictCue,
            }))
        );
        if (!match) return null;
        const guide = this.getTradingConceptGuideByKey(match.key, locale);
        return guide ? { ...guide, matchedAlias: match.alias, fuzzy: match.fuzzy } : null;
    }

    private normalizeText(input: string): string {
        return String(input || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    private formatTopicGuide(
        topic: KnowledgeTopic,
        locale: 'pt' | 'en'
    ): PlatformGuideMatch {
        const isEn = locale === 'en';
        return {
            topicId: topic.id,
            title: isEn ? topic.titleEn : topic.title,
            answer: isEn ? topic.answerEn : topic.answer,
            actions: isEn ? topic.actionsEn : topic.actions,
            suggestions: isEn ? topic.suggestionsEn : topic.suggestions,
        };
    }

    getTopicGuideById(
        topicId: string,
        locale: 'pt' | 'en' = 'pt'
    ): PlatformGuideMatch | null {
        const cleanId = String(topicId || '').trim();
        if (!cleanId) return null;
        const found = this.topics.find((t) => t.id === cleanId);
        return found ? this.formatTopicGuide(found, locale) : null;
    }

    getTradingConceptGuideByKey(
        conceptKey: string,
        locale: 'pt' | 'en' = 'pt'
    ): TradingConceptGuide | null {
        const cleanKey = String(conceptKey || '').trim();
        if (!cleanKey) return null;
        const found = this.allConcepts.find((c) => c.key === cleanKey);
        if (!found) return null;
        const isEn = locale === 'en';
        return {
            conceptKey: found.key,
            title: isEn ? found.titleEn : found.title,
            answer: isEn ? found.answerEn : found.answer,
            suggestions: isEn ? found.suggestionsEn : found.suggestions,
        };
    }

    getPlatformDocumentsForRag(): PlatformRagDocumentSeed[] {
        const docs: PlatformRagDocumentSeed[] = [];

        for (const topic of this.topics) {
            docs.push({
                sourceId: `guide:${topic.id}:pt`,
                locale: 'pt',
                title: topic.title,
                content: `${topic.title}. ${topic.answer}`,
                routes: topic.actions.map((a) => a.route),
                kind: 'platform_guide',
            });
            docs.push({
                sourceId: `guide:${topic.id}:en`,
                locale: 'en',
                title: topic.titleEn,
                content: `${topic.titleEn}. ${topic.answerEn}`,
                routes: topic.actionsEn.map((a) => a.route),
                kind: 'platform_guide',
            });
        }

        for (const concept of this.allConcepts) {
            docs.push({
                sourceId: `concept:${concept.key}:pt`,
                locale: 'pt',
                title: concept.title,
                content: `${concept.title}. ${concept.answer}`,
                routes: [],
                kind: 'trading_concept',
            });
            docs.push({
                sourceId: `concept:${concept.key}:en`,
                locale: 'en',
                title: concept.titleEn,
                content: `${concept.titleEn}. ${concept.answerEn}`,
                routes: [],
                kind: 'trading_concept',
            });
        }

        return docs;
    }

    matchPlatformQuestion(
        rawQuestion: string,
        locale: 'pt' | 'en' = 'pt'
    ): PlatformGuideMatch | null {
        const q = this.normalizeText(rawQuestion);
        if (!q) return null;

        const isPersonalDataQuery =
            /(minhas operac|meus trades|meu lucro|meu resultado|meu win|minha conta esta|por que estou perdendo|pq perco|qual e o meu edge|estou seguindo meu plano|o que estou errando|como melhorar meus resultados|my trades|my profit|my result|my win|why am i losing|where is my edge|my edge|following my plan|improve my results)/.test(
                q
            ) &&
            !/(como importar|como ilportar|como conectar|como sincronizar|como anotar|como gerir|onde fica|como usar|como fazer back|how to import|how do i import|how to connect|how to sync|how to log|how do i manage|where is|how to backtest|how do i run backtest)/.test(
                q
            );

        if (isPersonalDataQuery) {
            return null;
        }

        const isHowToPattern =
            /(como |onde |qual caminho|passo a passo|ajuda|suporte|tutorial|funciona|importar|ilportar|sincronizar|conectar|anotar|gerir|fazer back|how |where |step by step|help|support|tutorial|import|sync|connect|log|manage|backtest)/.test(
                q
            );

        let bestTopic: KnowledgeTopic | null = null;
        let bestScore = 0;

        for (const topic of this.topics) {
            let score = 0;
            for (const kw of topic.keywords) {
                if (q.includes(kw)) {
                    score += kw.includes(' ') ? 3 : 2;
                }
            }
            if (isHowToPattern && score > 0) {
                score += 2;
            }
            if (score > bestScore) {
                bestScore = score;
                bestTopic = topic;
            }
        }

        if (!bestTopic || bestScore < 2) {
            return null;
        }

        return this.formatTopicGuide(bestTopic, locale);
    }

    /**
     * Extrai automaticamente atalhos de navegação (`AiActionLink[]`) com base nas rotas oficiais citadas na resposta.
     */
    resolveRouteActionsFromText(
        text: string,
        locale: 'pt' | 'en' = 'pt'
    ): AiActionLink[] {
        const isEn = locale === 'en';
        const raw = String(text || '').toLowerCase();
        const actions: AiActionLink[] = [];
        const seen = new Set<string>();

        const pushUnique = (link: AiActionLink) => {
            if (!seen.has(link.route)) {
                seen.add(link.route);
                actions.push(link);
            }
        };

        if (raw.includes('/add-trades') || raw.includes('/add-trade')) {
            pushUnique({
                label: isEn
                    ? 'Import Trades (20+ Brokers)'
                    : 'Importar Trades (+20 Corretoras)',
                route: '/add-trades',
            });
        }
        if (raw.includes('/backtesting/strategies')) {
            pushUnique({
                label: isEn ? 'Create Playbook' : 'Criar Estratégia',
                route: '/backtesting/strategies',
            });
        }
        if (raw.includes('/backtesting')) {
            pushUnique({
                label: isEn ? 'Sessions & Replay' : 'Sessões & Replay',
                route: '/backtesting/sessions',
            });
        }
        if (raw.includes('/journal')) {
            pushUnique({
                label: isEn ? 'Open My Journal' : 'Abrir Meu Diário',
                route: '/journal',
            });
        }
        if (raw.includes('/reports')) {
            pushUnique({
                label: isEn ? 'View Reports' : 'Ver Relatórios',
                route: '/reports',
            });
        }
        if (raw.includes('/trades')) {
            pushUnique({
                label: isEn ? 'Trade History' : 'Histórico de Trades',
                route: '/trades',
            });
        }
        if (raw.includes('/calendar')) {
            pushUnique({
                label: isEn ? 'Economic Calendar' : 'Calendário Económico',
                route: '/calendar',
            });
        }

        return actions.slice(0, 3);
    }

    getPlatformContextSummary(locale: 'pt' | 'en' = 'pt'): string {
        if (locale === 'en') {
            return [
                'Official Torex Journal Workflows & Routes (NEVER invent routes outside this list):',
                '- `/add-trades` (Import Trades): select broker/method (20+ brokers supported), direct MT5 cloud sync (`/add-trades/mt5-sync`), Expert Advisor (`/add-trades/mt5-ea`), Deriv API (`/add-trades/deriv-sync`), or CSV/HTML/Excel upload (`/add-trades/import`).',
                '- `/backtesting` (Backtesting & Replay): 1) create a Playbook at `/backtesting/strategies`, 2) create a session at `/backtesting/sessions` picking asset/date range, and 3) launch **Replay** to trade bar-by-bar.',
                '- `/journal` (Trading Journal): **Daily Notes** (end-of-day routine and psych check-in: sleep, focus, mood, stress), **Trade Notes** (screenshots, trade reviews, and MFE/MAE), and **General** (written Playbook rules).',
                '- `/dashboard`: overview KPIs, cumulative equity curve, and P&L calendar.',
                '- `/trades`: full trade ledger & execution history.',
                '- `/reports`: statistical reports by symbol, session, and weekday.',
                '- `/calendar`: macro Economic Calendar.',
                '- `/configuration` and `/payments`: account settings, 2FA security, and subscription plans.',
            ].join('\n');
        }
        return [
            'Fluxos e Rotas Oficiais do Torex Journal (NUNCA invente rotas fora desta lista):',
            '- `/add-trades` (Importar Trades): selecionar método ou corretora (+20 corretoras suportadas), sincronização direta MT5 (`/add-trades/mt5-sync`), Expert Advisor (`/add-trades/mt5-ea`), API Deriv (`/add-trades/deriv-sync`) ou upload CSV/HTML/Excel (`/add-trades/import`).',
            '- `/backtesting` (Backtesting & Replay): 1º criar uma estratégia em `/backtesting/strategies`, 2º criar uma sessão em `/backtesting/sessions` escolhendo ativo/período, e 3º clicar em **Replay** para operar vela a vela.',
            '- `/journal` (Gestão do Diário): **Daily Notes** (rotina do dia e check-in emocional: sono, foco, humor, estresse), **Trade Notes** (prints, notas por operação e MFE/MAE) e **General** (regras escritas do Playbook/plano).',
            '- `/dashboard`: visão geral de KPIs, curva de capital acumulada e calendário.',
            '- `/trades`: tabela completa do histórico de operações.',
            '- `/reports`: relatórios estatísticos por ativo, sessão e dia da semana.',
            '- `/calendar`: calendário económico de eventos macroeconómicos.',
            '- `/configuration` e `/payments`: gestão de conta, segurança 2FA e planos.',
        ].join('\n');
    }
}
