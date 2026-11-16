/**
 * Verified trading glossary (PT + EN).
 *
 * One entry per concept, keyed by a language-neutral `key`. The same concept is
 * recognised whatever language the question is written in, and the answer is
 * served in the language of the question. Definitions are fixed text reviewed in
 * code review, so the same question always gets the same base answer.
 */

export interface GlossaryConcept {
    key: string;
    title: string;
    titleEn: string;
    /** Normalised (lowercase, no accents) names and synonyms in PT and EN. */
    aliases: string[];
    /** Only match on strict "what is" cues: the term is also a platform feature ("como funciona o backtest" is a how-to). */
    strictCue?: boolean;
    answer: string;
    answerEn: string;
    suggestions: string[];
    suggestionsEn: string[];
}

/** Aliases for the concepts already defined in AiKnowledgeBaseService. */
export const EXISTING_CONCEPT_ALIASES: Record<string, string[]> = {
    profit_factor: ['profit factor', 'fator de lucro', 'factor de lucro'],
    payoff_winrate: ['payoff', 'payoff ratio', 'win rate', 'winrate', 'taxa de acerto', 'taxa de vitoria'],
    expectancy: ['expectancy', 'expectativa matematica', 'esperanca matematica', 'expectativa do trade'],
    drawdown: ['drawdown', 'drawdown maximo', 'max drawdown', 'maximum drawdown', 'rebaixamento'],
    mfe_mae: ['mfe', 'mae', 'mfe e mae', 'mfe and mae', 'maximum favorable excursion', 'maximum adverse excursion'],
    risk_sizing: ['position sizing', 'dimensionamento de posicao', 'tamanho da posicao', 'gestao de risco', 'risk management', 'gerenciamento de risco'],
    overtrading_discipline: ['overtrading', 'revenge trading', 'trading de vinganca', 'operar por vinganca'],
    trading_sessions: ['sessoes de trading', 'sessoes operacionais', 'trading sessions', 'sessao de londres', 'sessao de nova iorque', 'london session', 'new york session'],
};

const S_PT_STYLE = ['Qual é o meu melhor estilo?', 'Como estão minhas operações?'];
const S_EN_STYLE = ['Which style suits me best?', 'How are my recent trades?'];
const S_PT_RISK = ['Estou seguindo meu plano?', 'Por que estou perdendo?'];
const S_EN_RISK = ['Am I following my plan?', 'Why am I losing?'];
const S_PT_PSY = ['Tenho alertas de comportamento?', 'Estou seguindo meu plano?'];
const S_EN_PSY = ['Do I have behaviour alerts?', 'Am I following my plan?'];
const S_PT_TECH = ['Qual é o meu Edge?', 'Como fazer backtesting?'];
const S_EN_TECH = ['Where is my Edge?', 'How do I run backtesting?'];

export const TRADING_GLOSSARY: GlossaryConcept[] = [
    // ---------------------------------------------------------------- styles
    {
        key: 'scalping',
        title: 'Scalping',
        titleEn: 'Scalping',
        aliases: ['scalping', 'scalp', 'scalper', 'escalpelamento'],
        answer:
            'O **Scalping** é um estilo de trading de muito curto prazo: o trader abre e fecha posições em segundos ou poucos minutos, procurando ganhos pequenos e repetidos. Como cada ganho é pequeno, **spread, comissões e slippage** pesam muito no resultado, e o estilo exige execução rápida, stops curtos e disciplina rígida para não cair em overtrading.',
        answerEn:
            '**Scalping** is a very short-term trading style: positions are opened and closed within seconds or a few minutes, aiming for small, repeated gains. Because each gain is small, **spread, commissions and slippage** weigh heavily on results, so it demands fast execution, tight stops and strict discipline to avoid overtrading.',
        suggestions: S_PT_STYLE,
        suggestionsEn: S_EN_STYLE,
    },
    {
        key: 'day_trading',
        title: 'Day Trading',
        titleEn: 'Day Trading',
        aliases: ['day trading', 'day trade', 'daytrade', 'daytrading', 'operacoes intradiarias', 'intraday', 'intradiario'],
        answer:
            'O **Day Trading** consiste em abrir e fechar todas as posições no mesmo dia, sem levar exposição para a noite. Opera movimentos de minutos a horas, normalmente nas sessões de maior liquidez, e evita o risco de gaps entre sessões.',
        answerEn:
            '**Day Trading** means opening and closing every position within the same day, carrying no overnight exposure. It targets moves lasting minutes to hours, usually in the most liquid sessions, and avoids gap risk between sessions.',
        suggestions: ['Qual é minha melhor sessão?', 'Como estão minhas operações?'],
        suggestionsEn: ['Which is my best session?', 'How are my recent trades?'],
    },
    {
        key: 'swing_trading',
        title: 'Swing Trading',
        titleEn: 'Swing Trading',
        aliases: ['swing trading', 'swing trade', 'swing', 'swing trader'],
        answer:
            'O **Swing Trading** procura capturar oscilações de preço que duram de alguns dias a algumas semanas. Usa stops mais largos e menos operações do que o day trading, e aceita manter posições abertas durante a noite e o fim de semana.',
        answerEn:
            '**Swing Trading** aims to capture price swings lasting from a few days to a few weeks. It uses wider stops and fewer trades than day trading, and accepts holding positions overnight and over weekends.',
        suggestions: S_PT_STYLE,
        suggestionsEn: S_EN_STYLE,
    },
    {
        key: 'position_trading',
        title: 'Position Trading',
        titleEn: 'Position Trading',
        aliases: ['position trading', 'position trader', 'trading de posicao'],
        answer:
            'O **Position Trading** mantém posições durante semanas ou meses, seguindo tendências de fundo. Dá mais peso à análise de contexto (macro, tendência no gráfico diário ou semanal) e menos ao ruído intradiário.',
        answerEn:
            '**Position Trading** holds positions for weeks or months, following long-term trends. It relies more on context (macro, daily or weekly trend) and less on intraday noise.',
        suggestions: S_PT_STYLE,
        suggestionsEn: S_EN_STYLE,
    },
    // ---------------------------------------------------------------- orders and risk
    {
        key: 'stop_loss',
        title: 'Stop Loss',
        titleEn: 'Stop Loss',
        aliases: ['stop loss', 'stoploss', 'stop', 'sl', 'ordem de stop', 'stop de perda'],
        answer:
            'O **Stop Loss** é uma ordem que fecha a posição automaticamente num preço definido para limitar a perda. Deve ficar onde a ideia do trade deixa de ser válida, e o tamanho do lote deve ser calculado a partir dessa distância para que a perda máxima fique dentro do risco planeado.',
        answerEn:
            'A **Stop Loss** is an order that automatically closes a position at a set price to cap the loss. It belongs where the trade idea is invalidated, and position size should be derived from that distance so the maximum loss stays within the planned risk.',
        suggestions: S_PT_RISK,
        suggestionsEn: S_EN_RISK,
    },
    {
        key: 'take_profit',
        title: 'Take Profit',
        titleEn: 'Take Profit',
        aliases: ['take profit', 'takeprofit', 'tp', 'alvo de lucro', 'objetivo de lucro'],
        answer:
            'O **Take Profit** é uma ordem que fecha a posição automaticamente quando o preço atinge o alvo de lucro. Definido junto com o Stop Loss, fixa a relação risco/retorno do trade antes da entrada.',
        answerEn:
            '**Take Profit** is an order that automatically closes a position when price reaches the profit target. Set together with the Stop Loss, it fixes the trade risk/reward before entry.',
        suggestions: ['Como melhorar meu Payoff?', 'Qual é o meu Edge?'],
        suggestionsEn: ['How can I improve my Payoff?', 'Where is my Edge?'],
    },
    {
        key: 'trailing_stop',
        title: 'Trailing Stop',
        titleEn: 'Trailing Stop',
        aliases: ['trailing stop', 'stop movel', 'stop dinamico'],
        answer:
            'O **Trailing Stop** é um stop que acompanha o preço a uma distância fixa quando o trade anda a favor, e não recua quando o preço volta. Protege lucro já conquistado sem fixar um alvo de saída.',
        answerEn:
            'A **Trailing Stop** follows price at a fixed distance as the trade moves in your favour and never moves back when price retraces. It locks in open profit without a fixed exit target.',
        suggestions: S_PT_RISK,
        suggestionsEn: S_EN_RISK,
    },
    {
        key: 'risk_reward',
        title: 'Relação Risco/Retorno',
        titleEn: 'Risk/Reward Ratio',
        aliases: ['risco retorno', 'risco/retorno', 'relacao risco retorno', 'risk reward', 'risk/reward', 'risk to reward', 'rr'],
        answer:
            'A **relação risco/retorno** compara quanto se arrisca (distância até ao Stop Loss) com quanto se pretende ganhar (distância até ao Take Profit). Um trade de `1:2` arrisca 1 para ganhar 2; com essa relação, acertar mais de 34% dos trades já é suficiente para ter expectativa positiva, antes de custos.',
        answerEn:
            'The **risk/reward ratio** compares how much you risk (distance to Stop Loss) with how much you aim to make (distance to Take Profit). A `1:2` trade risks 1 to make 2; at that ratio, winning more than 34% of trades is enough for positive expectancy, before costs.',
        suggestions: ['Como melhorar meu Payoff?', 'Qual é o meu Edge?'],
        suggestionsEn: ['How can I improve my Payoff?', 'Where is my Edge?'],
    },
    {
        key: 'r_multiple',
        title: 'Múltiplo de R',
        titleEn: 'R-Multiple',
        aliases: ['r multiple', 'r-multiple', 'multiplo de r', 'multiplos de r', 'r multiplo'],
        answer:
            'O **R** é o valor arriscado num trade (entrada até ao Stop Loss). O **múltiplo de R** exprime o resultado nessa unidade: ganhar o dobro do risco é `+2R`, perder o stop inteiro é `-1R`. Medir em R permite comparar trades de tamanhos e ativos diferentes.',
        answerEn:
            '**R** is the amount risked on a trade (entry to Stop Loss). The **R-multiple** expresses the result in that unit: making twice the risk is `+2R`, losing the full stop is `-1R`. Measuring in R makes trades of different sizes and assets comparable.',
        suggestions: ['Qual é o meu Edge?', 'Como estão minhas operações?'],
        suggestionsEn: ['Where is my Edge?', 'How are my recent trades?'],
    },
    {
        key: 'risk_of_ruin',
        title: 'Risco de Ruína',
        titleEn: 'Risk of Ruin',
        aliases: ['risco de ruina', 'risk of ruin', 'ruina'],
        answer:
            'O **Risco de Ruína** é a probabilidade de a conta cair até um nível de que não consegue recuperar. Cresce depressa quando o risco por trade sobe ou a expectativa é baixa; arriscar uma fração pequena do capital por trade (ex.: `0.5%` a `1%`) mantém-no perto de zero numa estratégia com expectativa positiva.',
        answerEn:
            '**Risk of Ruin** is the probability that the account falls to a level it cannot recover from. It rises quickly as risk per trade grows or expectancy shrinks; risking a small fraction of capital per trade (e.g. `0.5%–1%`) keeps it near zero for a positive-expectancy strategy.',
        suggestions: S_PT_RISK,
        suggestionsEn: S_EN_RISK,
    },
    {
        key: 'lot_size',
        title: 'Lote',
        titleEn: 'Lot Size',
        aliases: ['lote', 'lotes', 'lot', 'lot size', 'tamanho do lote', 'micro lote', 'mini lote', 'lote padrao', 'standard lot'],
        answer:
            'O **lote** é a unidade de volume de uma ordem. No Forex, `1.00` lote padrão equivale a 100 000 unidades da moeda base, `0.10` é um mini lote e `0.01` um micro lote. O lote certo resulta do risco em dinheiro dividido pelo valor do stop em pips vezes o valor do pip.',
        answerEn:
            'A **lot** is the volume unit of an order. In Forex, a `1.00` standard lot equals 100,000 units of the base currency, `0.10` is a mini lot and `0.01` a micro lot. The right lot size is the money at risk divided by the stop in pips times the pip value.',
        suggestions: S_PT_RISK,
        suggestionsEn: S_EN_RISK,
    },
    {
        key: 'pip',
        title: 'Pip',
        titleEn: 'Pip',
        aliases: ['pip', 'pips', 'pipette'],
        answer:
            'O **pip** é a menor variação padrão de preço num par de moedas: `0.0001` na maioria dos pares e `0.01` nos pares com iene. O valor de um pip em dinheiro depende do tamanho do lote: num lote padrão de EURUSD vale cerca de 10 USD.',
        answerEn:
            'A **pip** is the standard smallest price move in a currency pair: `0.0001` for most pairs and `0.01` for yen pairs. Its money value depends on lot size: on a standard EURUSD lot it is about 10 USD.',
        suggestions: ['Qual é o meu melhor ativo?', 'Como estão minhas operações?'],
        suggestionsEn: ['Which is my best symbol?', 'How are my recent trades?'],
    },
    {
        key: 'spread',
        title: 'Spread',
        titleEn: 'Spread',
        aliases: ['spread', 'spreads', 'diferencial de compra e venda', 'bid ask'],
        answer:
            'O **spread** é a diferença entre o preço de compra (ask) e o de venda (bid). É um custo pago em cada trade e aumenta em momentos de baixa liquidez ou notícias; em estilos de curto prazo, como o scalping, pode consumir grande parte do lucro.',
        answerEn:
            'The **spread** is the difference between the buy (ask) and sell (bid) price. It is a cost paid on every trade and widens in low liquidity or around news; in short-term styles such as scalping it can eat a large share of the profit.',
        suggestions: ['Qual é minha melhor sessão?', 'Qual é o meu Edge?'],
        suggestionsEn: ['Which is my best session?', 'Where is my Edge?'],
    },
    {
        key: 'slippage',
        title: 'Slippage',
        titleEn: 'Slippage',
        aliases: ['slippage', 'derrapagem', 'deslizamento'],
        answer:
            'O **slippage** é a diferença entre o preço pedido e o preço a que a ordem é realmente executada. Acontece com movimentos rápidos e pouca liquidez, sobretudo em notícias, e pode afetar tanto a entrada como o Stop Loss.',
        answerEn:
            '**Slippage** is the difference between the requested price and the price at which the order actually fills. It happens in fast markets and thin liquidity, especially around news, and can affect both entries and Stop Losses.',
        suggestions: ['Como estão minhas operações?', 'Qual é minha melhor sessão?'],
        suggestionsEn: ['How are my recent trades?', 'Which is my best session?'],
    },
    {
        key: 'leverage',
        title: 'Alavancagem',
        titleEn: 'Leverage',
        aliases: ['alavancagem', 'leverage', 'alavancado', 'leveraged'],
        answer:
            'A **alavancagem** permite controlar uma posição maior do que o capital depositado (ex.: `1:100` controla 100 000 com 1 000 de margem). Amplia ganhos e perdas na mesma proporção, por isso o risco deve ser definido pelo Stop Loss e pelo tamanho do lote, não pela alavancagem disponível.',
        answerEn:
            '**Leverage** lets you control a position larger than the deposited capital (e.g. `1:100` controls 100,000 with 1,000 of margin). It amplifies gains and losses equally, so risk should be set by the Stop Loss and lot size, not by the leverage available.',
        suggestions: S_PT_RISK,
        suggestionsEn: S_EN_RISK,
    },
    {
        key: 'margin',
        title: 'Margem e Margin Call',
        titleEn: 'Margin and Margin Call',
        aliases: ['margem', 'margin', 'margin call', 'chamada de margem', 'stop out', 'nivel de margem', 'margin level'],
        answer:
            'A **margem** é o capital que a corretora reserva para manter uma posição alavancada aberta. Quando as perdas reduzem o capital livre abaixo do nível exigido, ocorre a **margin call** e, se continuar a cair, o **stop out**, que fecha posições automaticamente.',
        answerEn:
            '**Margin** is the capital the broker sets aside to keep a leveraged position open. When losses push free equity below the required level a **margin call** occurs and, if it keeps falling, a **stop out** closes positions automatically.',
        suggestions: S_PT_RISK,
        suggestionsEn: S_EN_RISK,
    },
    // ---------------------------------------------------------------- market concepts
    {
        key: 'liquidity',
        title: 'Liquidez',
        titleEn: 'Liquidity',
        aliases: ['liquidez', 'liquidity', 'mercado liquido'],
        answer:
            'A **liquidez** mede a facilidade de comprar ou vender sem mover muito o preço. Mercados e sessões mais líquidos (ex.: overlap Londres + Nova Iorque) têm spreads menores e menos slippage.',
        answerEn:
            '**Liquidity** measures how easily you can buy or sell without moving price much. More liquid markets and sessions (e.g. the London + New York overlap) have tighter spreads and less slippage.',
        suggestions: ['Qual é minha melhor sessão?', 'Qual é o meu melhor ativo?'],
        suggestionsEn: ['Which is my best session?', 'Which is my best symbol?'],
    },
    {
        key: 'volatility',
        title: 'Volatilidade',
        titleEn: 'Volatility',
        aliases: ['volatilidade', 'volatility', 'volatil', 'atr', 'average true range'],
        answer:
            'A **volatilidade** é a amplitude típica das variações de preço num período. Uma medida comum é o **ATR** (Average True Range); com volatilidade alta, stops e alvos precisam de ser mais largos e o lote menor para manter o mesmo risco.',
        answerEn:
            '**Volatility** is the typical size of price moves over a period. A common measure is **ATR** (Average True Range); when volatility is high, stops and targets need to be wider and size smaller to keep the same risk.',
        suggestions: S_PT_RISK,
        suggestionsEn: S_EN_RISK,
    },
    {
        key: 'support_resistance',
        title: 'Suporte e Resistência',
        titleEn: 'Support and Resistance',
        aliases: ['suporte e resistencia', 'resistencia', 'support and resistance', 'resistance', 'zona de suporte', 'support level'],
        answer:
            '**Suporte** é uma zona de preço onde a procura tende a travar quedas; **resistência** é uma zona onde a oferta tende a travar subidas. Quando uma destas zonas é rompida com convicção, costuma inverter o papel (resistência rompida passa a suporte).',
        answerEn:
            '**Support** is a price zone where demand tends to stop declines; **resistance** is a zone where supply tends to stop rallies. When one is broken decisively it often flips role (broken resistance becomes support).',
        suggestions: S_PT_TECH,
        suggestionsEn: S_EN_TECH,
    },
    {
        key: 'trend',
        title: 'Tendência',
        titleEn: 'Trend',
        aliases: ['tendencia', 'trend', 'tendencia de alta', 'tendencia de baixa', 'uptrend', 'downtrend', 'trend following', 'seguimento de tendencia'],
        answer:
            'Uma **tendência** de alta é uma sequência de topos e fundos cada vez mais altos; uma de baixa, de topos e fundos cada vez mais baixos. Operar a favor da tendência dominante tende a dar trades com melhor relação risco/retorno do que operar contra ela.',
        answerEn:
            'An **uptrend** is a sequence of higher highs and higher lows; a **downtrend** is lower highs and lower lows. Trading with the dominant trend tends to give better risk/reward than trading against it.',
        suggestions: S_PT_TECH,
        suggestionsEn: S_EN_TECH,
    },
    {
        key: 'breakout',
        title: 'Breakout (Rompimento)',
        titleEn: 'Breakout',
        aliases: ['breakout', 'rompimento', 'rompimentos', 'false breakout', 'falso rompimento', 'fakeout'],
        answer:
            'Um **breakout** acontece quando o preço sai de uma zona de consolidação, suporte ou resistência com força. Muitos rompimentos falham (**falsos rompimentos**), por isso é comum esperar fecho de vela além da zona ou um reteste antes de entrar.',
        answerEn:
            'A **breakout** happens when price leaves a range, support or resistance with momentum. Many breakouts fail (**false breakouts**), so traders often wait for a candle close beyond the zone or a retest before entering.',
        suggestions: S_PT_TECH,
        suggestionsEn: S_EN_TECH,
    },
    {
        key: 'pullback',
        title: 'Pullback',
        titleEn: 'Pullback',
        aliases: ['pullback', 'pull back', 'retracao', 'retracement', 'correcao'],
        answer:
            'Um **pullback** é um recuo temporário do preço contra a tendência principal antes de ela continuar. Entrar no pullback, em vez de perseguir o preço, permite um stop mais curto e melhor relação risco/retorno.',
        answerEn:
            'A **pullback** is a temporary move against the main trend before it resumes. Entering on the pullback instead of chasing price allows a tighter stop and better risk/reward.',
        suggestions: S_PT_TECH,
        suggestionsEn: S_EN_TECH,
    },
    {
        key: 'market_structure',
        title: 'Estrutura de Mercado (BOS e CHoCH)',
        titleEn: 'Market Structure (BOS and CHoCH)',
        aliases: ['estrutura de mercado', 'market structure', 'bos', 'break of structure', 'quebra de estrutura', 'choch', 'change of character', 'mudanca de caracter'],
        answer:
            'A **estrutura de mercado** é a sequência de topos e fundos que define a tendência. Um **BOS** (Break of Structure) rompe o último topo ou fundo a favor da tendência e confirma-a; um **CHoCH** (Change of Character) rompe contra ela e é o primeiro sinal de possível inversão.',
        answerEn:
            '**Market structure** is the sequence of highs and lows that defines the trend. A **BOS** (Break of Structure) breaks the last swing in the trend direction and confirms it; a **CHoCH** (Change of Character) breaks against it and is the first sign of a possible reversal.',
        suggestions: S_PT_TECH,
        suggestionsEn: S_EN_TECH,
    },
    {
        key: 'order_block',
        title: 'Order Block',
        titleEn: 'Order Block',
        aliases: ['order block', 'order blocks', 'ob', 'bloco de ordens'],
        answer:
            'Um **Order Block** é a última vela contrária antes de um movimento forte que quebra estrutura; é lida como a zona onde grandes participantes acumularam ordens. Quando o preço regressa a essa zona, muitos traders procuram aí entradas a favor do movimento original.',
        answerEn:
            'An **Order Block** is the last opposite candle before a strong move that breaks structure, read as the zone where large participants built orders. When price returns to it, many traders look for entries in the direction of the original move.',
        suggestions: S_PT_TECH,
        suggestionsEn: S_EN_TECH,
    },
    {
        key: 'liquidity_sweep',
        title: 'Liquidity Sweep (Varrimento de Liquidez)',
        titleEn: 'Liquidity Sweep',
        aliases: ['liquidity sweep', 'sweep', 'stop hunt', 'caca de stops', 'varrimento de liquidez', 'varredura de liquidez', 'liquidity grab'],
        answer:
            'Um **liquidity sweep** é um movimento rápido que ultrapassa um topo ou fundo óbvio, ativa os stops acumulados ali e depois inverte. Entrar só depois da confirmação da inversão evita ser o stop varrido.',
        answerEn:
            'A **liquidity sweep** is a quick move beyond an obvious high or low that triggers the stops resting there and then reverses. Entering only after the reversal is confirmed avoids being the stop that gets swept.',
        suggestions: S_PT_TECH,
        suggestionsEn: S_EN_TECH,
    },
    {
        key: 'fair_value_gap',
        title: 'Fair Value Gap (FVG)',
        titleEn: 'Fair Value Gap (FVG)',
        aliases: ['fair value gap', 'fvg', 'imbalance', 'desequilibrio', 'gap de valor justo'],
        answer:
            'Um **Fair Value Gap** é um desequilíbrio de três velas em que o pavio da primeira e o da terceira não se tocam, deixando uma zona por onde o preço passou só num sentido. O preço tende a regressar para preencher parte dessa zona, que muitos traders usam como área de entrada.',
        answerEn:
            'A **Fair Value Gap** is a three-candle imbalance where the wicks of the first and third candles do not overlap, leaving a zone traded in one direction only. Price often returns to fill part of it, and many traders use it as an entry area.',
        suggestions: S_PT_TECH,
        suggestionsEn: S_EN_TECH,
    },
    {
        key: 'candlestick',
        title: 'Candlestick (Vela)',
        titleEn: 'Candlestick',
        aliases: ['candlestick', 'candle', 'vela', 'velas japonesas', 'candles'],
        answer:
            'Um **candlestick** mostra num período a abertura, o máximo, o mínimo e o fecho do preço. O corpo vai da abertura ao fecho e os pavios marcam os extremos; o tamanho e a posição de corpo e pavios mostram quem dominou o período, compradores ou vendedores.',
        answerEn:
            'A **candlestick** shows the open, high, low and close for a period. The body spans open to close and the wicks mark the extremes; their size and position show who controlled the period, buyers or sellers.',
        suggestions: S_PT_TECH,
        suggestionsEn: S_EN_TECH,
    },
    // ---------------------------------------------------------------- psychology and process
    {
        key: 'fomo',
        title: 'FOMO',
        titleEn: 'FOMO',
        aliases: ['fomo', 'fear of missing out', 'medo de ficar de fora', 'medo de perder a oportunidade'],
        answer:
            '**FOMO** (Fear Of Missing Out) é entrar num trade por medo de perder o movimento, sem que o setup do plano esteja confirmado. Costuma dar entradas tardias, stops mal colocados e pior relação risco/retorno; a solução é só operar setups definidos por escrito no plano.',
        answerEn:
            '**FOMO** (Fear Of Missing Out) is entering a trade out of fear of missing the move, without the planned setup being confirmed. It leads to late entries, poor stop placement and worse risk/reward; the fix is to trade only setups written in your plan.',
        suggestions: S_PT_PSY,
        suggestionsEn: S_EN_PSY,
    },
    {
        key: 'tilt',
        title: 'Tilt',
        titleEn: 'Tilt',
        aliases: ['tilt', 'tiltado', 'estar em tilt', 'on tilt'],
        answer:
            '**Tilt** é um estado emocional, normalmente depois de perdas seguidas, em que o trader deixa de seguir o plano: aumenta o lote, entra fora do setup ou remove stops. Um limite de perda diário e uma pausa obrigatória depois de 2 ou 3 perdas seguidas são as defesas mais eficazes.',
        answerEn:
            '**Tilt** is an emotional state, usually after consecutive losses, in which the trader stops following the plan: sizing up, entering off-setup or removing stops. A daily loss limit and a mandatory break after 2 or 3 losses in a row are the most effective defences.',
        suggestions: S_PT_PSY,
        suggestionsEn: S_EN_PSY,
    },
    {
        key: 'trading_plan',
        title: 'Plano de Trading',
        titleEn: 'Trading Plan',
        aliases: ['plano de trading', 'trading plan', 'playbook', 'plano operacional', 'plano de operacoes'],
        answer:
            'O **plano de trading** é o conjunto de regras escritas que define o que operar, quando, com que setup, quanto arriscar por trade e quando parar no dia. Serve para decidir antes do mercado abrir, e o diário serve para medir se as regras foram cumpridas.',
        answerEn:
            'A **trading plan** is the written set of rules defining what to trade, when, with which setup, how much to risk per trade and when to stop for the day. It moves decisions before the market opens, and the journal measures whether the rules were followed.',
        suggestions: ['Estou seguindo meu plano?', 'Como gerir o meu Diário?'],
        suggestionsEn: ['Am I following my plan?', 'How do I manage my Journal?'],
    },
    {
        key: 'backtesting',
        title: 'Backtesting',
        titleEn: 'Backtesting',
        aliases: ['backtesting', 'backtest', 'back test', 'teste historico', 'teste retroativo'],
        strictCue: true,
        answer:
            'O **backtesting** testa uma estratégia em dados históricos para estimar win rate, payoff, drawdown e expectativa antes de arriscar dinheiro. Só é útil se as regras forem fixas e não forem ajustadas depois de ver o resultado, o que causaria **overfitting**.',
        answerEn:
            '**Backtesting** runs a strategy on historical data to estimate win rate, payoff, drawdown and expectancy before risking money. It is only useful if the rules are fixed and not tuned after seeing the results, which would cause **overfitting**.',
        suggestions: ['Como fazer backtesting?', 'Qual é o meu Edge?'],
        suggestionsEn: ['How do I run backtesting?', 'Where is my Edge?'],
    },
    {
        key: 'trading_journal',
        title: 'Diário de Trading',
        titleEn: 'Trading Journal',
        aliases: ['diario de trading', 'trading journal', 'diario de operacoes'],
        strictCue: true,
        answer:
            'O **diário de trading** regista cada operação com o setup, o motivo da entrada, o estado emocional e o resultado. É a base para encontrar padrões, como o ativo ou a sessão em que se perde mais, e para medir a disciplina face ao plano.',
        answerEn:
            'A **trading journal** records each trade with its setup, entry reason, emotional state and result. It is the basis for finding patterns, such as the symbol or session where you lose most, and for measuring discipline against the plan.',
        suggestions: ['Como gerir o meu Diário?', 'Estou seguindo meu plano?'],
        suggestionsEn: ['How do I manage my Journal?', 'Am I following my plan?'],
    },
    {
        key: 'edge',
        title: 'Edge (Vantagem Estatística)',
        titleEn: 'Trading Edge',
        aliases: ['edge', 'vantagem estatistica', 'trading edge'],
        answer:
            'O **Edge** é a vantagem estatística de uma estratégia: a combinação de win rate e payoff que, repetida em muitos trades, dá expectativa positiva depois de custos. Só se confirma com amostra suficiente (normalmente 50 a 100 trades ou mais com as mesmas regras).',
        answerEn:
            'An **Edge** is a strategy statistical advantage: the mix of win rate and payoff that, repeated over many trades, gives positive expectancy after costs. It is only confirmed with enough sample size (usually 50 to 100+ trades under the same rules).',
        suggestions: ['Qual é o meu Edge?', 'Por que estou perdendo?'],
        suggestionsEn: ['Where is my Edge?', 'Why am I losing?'],
    },
    {
        key: 'sharpe_ratio',
        title: 'Sharpe Ratio',
        titleEn: 'Sharpe Ratio',
        aliases: ['sharpe', 'sharpe ratio', 'indice de sharpe', 'racio de sharpe'],
        answer:
            'O **Sharpe Ratio** mede o retorno obtido por unidade de volatilidade: (retorno médio menos a taxa sem risco) a dividir pelo desvio padrão dos retornos. Valores acima de `1` indicam retorno consistente face ao risco; acima de `2` é considerado muito bom.',
        answerEn:
            'The **Sharpe Ratio** measures return per unit of volatility: (average return minus the risk-free rate) divided by the standard deviation of returns. Above `1` indicates consistent return for the risk taken; above `2` is considered very good.',
        suggestions: ['Qual é o meu Edge?', 'Como estão minhas operações?'],
        suggestionsEn: ['Where is my Edge?', 'How are my recent trades?'],
    },
];

// ---------------------------------------------------------------------------
// Concept detection
// ---------------------------------------------------------------------------

export function normalizeForGlossary(input: string): string {
    return String(input || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9/\s-]/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Phrases that ask what something is (PT + EN), placed before the term. */
const DEFINITION_CUES_BEFORE = [
    'o que e', 'o que sao', 'o que significa', 'o que quer dizer', 'que e', 'oque e', 'oq e', 'o q e',
    'significado de', 'significado do', 'significado da', 'definicao de', 'define', 'defina',
    'explica', 'explique', 'explica me', 'explicar', 'me explica', 'podes explicar', 'pode explicar',
    'como funciona', 'como funcionam', 'quero saber o que e', 'quero entender',
    'what is', 'what s', 'whats', 'what are', 'what does', 'meaning of', 'definition of',
    'explain', 'how does', 'how do', 'tell me about', 'fala me sobre', 'fala sobre',
];
/** Cues that ask for a definition, not for how to use a platform feature. */
const STRICT_DEFINITION_CUES = new Set([
    'o que e', 'o que sao', 'o que significa', 'o que quer dizer', 'que e', 'oque e', 'oq e', 'o q e',
    'significado de', 'significado do', 'significado da', 'definicao de', 'define', 'defina',
    'what is', 'what s', 'whats', 'what are', 'meaning of', 'definition of',
]);
/** Phrases that follow the term ("scalping, o que é?"). */
const DEFINITION_CUES_AFTER = [
    'o que e', 'significa', 'funciona como', 'como funciona', 'quer dizer', 'means', 'meaning', 'mean', 'is what',
];
const FILLERS = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'do', 'da', 'de', 'the', 'an', 'termo', 'conceito', 'term', 'concept', 'chamado', 'called']);

/** Possessive or first-person cues right before the term mean "my drawdown", i.e. analytics, not a definition. */
const PERSONAL_BEFORE_TERM = /\b(meu|minha|meus|minhas|my|mine|estou|estou a|am i|i am|tenho|do i|faco|fiz|fazendo)\s+(?:\S+\s+){0,2}$/;

const PERSONAL_TOKENS = new Set(['meu', 'minha', 'meus', 'minhas', 'my', 'mine', 'our', 'nosso', 'nossa']);

export interface GlossaryMatch {
    key: string;
    alias: string;
    fuzzy: boolean;
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
        }
        prev = cur;
    }
    return prev[b.length];
}

function maxTypos(alias: string): number {
    if (alias.length >= 9) return 2;
    if (alias.length >= 6) return 1;
    return 0;
}

/**
 * Finds the glossary concept a definitional question is about.
 * Returns null when the text is not asking what a term is, or when the term is
 * used as a personal metric ("qual é o meu drawdown").
 */
export function matchGlossaryConcept(
    rawText: string,
    concepts: Array<{ key: string; aliases: string[]; strictCue?: boolean }>
): GlossaryMatch | null {
    const text = normalizeForGlossary(rawText);
    if (!text || text.length > 220) return null;
    const padded = ` ${text} `;
    const tokens = text.split(' ');

    const aliasIndex: Array<{ key: string; alias: string; strict: boolean }> = [];
    for (const c of concepts) {
        for (const a of c.aliases) {
            const alias = normalizeForGlossary(a);
            if (alias) aliasIndex.push({ key: c.key, alias, strict: Boolean(c.strictCue) });
        }
    }
    // Longer aliases first so "revenge trading" wins over "trading", "stop loss" over "stop".
    aliasIndex.sort((x, y) => y.alias.length - x.alias.length);

    const isBareTerm = (candidate: string) => {
        const rest = candidate.split(' ').filter((t) => !FILLERS.has(t)).join(' ');
        return rest;
    };

    // 1) The whole message is just the term ("scalping?", "o scalping").
    const bare = isBareTerm(text);
    for (const { key, alias, strict } of aliasIndex) {
        if (!strict && bare === alias && alias.length >= 3) return { key, alias, fuzzy: false };
    }

    // 2) Cue + term, exact match.
    for (const { key, alias, strict } of aliasIndex) {
        const at = padded.indexOf(` ${alias} `);
        if (at < 0) continue;
        const before = padded.slice(0, at + 1);
        const after = padded.slice(at + alias.length + 1);
        if (PERSONAL_BEFORE_TERM.test(before.trimEnd() + ' ')) continue;
        const beforeWords = before
            .trim()
            .split(' ')
            .filter(Boolean);
        while (beforeWords.length && FILLERS.has(beforeWords[beforeWords.length - 1])) beforeWords.pop();
        const beforeTail = ` ${beforeWords.join(' ')} `;
        const cueBefore = DEFINITION_CUES_BEFORE.some(
            (cue) => (!strict || STRICT_DEFINITION_CUES.has(cue)) && beforeTail.endsWith(` ${cue} `)
        );
        const afterHead = ` ${after.trim()} `;
        const cueAfter = !strict && DEFINITION_CUES_AFTER.some((cue) => afterHead.startsWith(` ${cue} `));
        if (cueBefore || cueAfter) return { key, alias, fuzzy: false };
    }

    // 3) Cue + term with a typo ("o que e scalpin").
    for (let i = 0; i < tokens.length; i++) {
        const prefix = ` ${tokens.slice(0, i).filter((t, idx, arr) => !(idx === arr.length - 1 && FILLERS.has(t))).join(' ')} `;
        const matchedCue = DEFINITION_CUES_BEFORE.find((cue) => prefix.endsWith(` ${cue} `));
        if (!matchedCue) continue;
        const strictOk = STRICT_DEFINITION_CUES.has(matchedCue);
        if (PERSONAL_BEFORE_TERM.test(prefix.trimEnd() + ' ')) continue;
        for (const span of [3, 2, 1]) {
            const candidate = tokens.slice(i, i + span).join(' ');
            if (!candidate) continue;
            if (candidate.split(' ').some((t) => PERSONAL_TOKENS.has(t))) continue;
            let best: { key: string; alias: string; d: number } | null = null;
            for (const { key, alias, strict } of aliasIndex) {
                const allowed = maxTypos(alias);
                if ((strict && !strictOk) || !allowed || alias.split(' ').length !== span) continue;
                const d = levenshtein(candidate, alias);
                if (d <= allowed && (!best || d < best.d)) best = { key, alias, d };
            }
            if (best) return { key: best.key, alias: best.alias, fuzzy: true };
        }
    }

    return null;
}
