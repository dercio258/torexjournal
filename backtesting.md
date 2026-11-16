# Plano de Melhorias — Suite `/backtesting` e Terminal de Replay

Documento técnico e de produto para evolução visual, simplificação de fluxos, reorganização de rotas, refatoração do Terminal de Replay e modernização da arquitetura de comunicação/APIs da plataforma **Torex / Trading Cossa**.

> **Alinhamento com o repositório:** As recomendações visuais seguem os tokens semânticos (`--ds-*` / `bg-canvas`, `bg-surface`, `border-line`, `text-fg`, `tabular-nums`) já iniciados em [primitives.tsx](file:///e:/TRADING%20COSSA/client/src/components/backtesting/primitives.tsx) e documentados em [dahboardrefactor.md](file:///e:/TRADING%20COSSA/dahboardrefactor.md). As evoluções de dados históricos complementam o guia em [backeteste.md](file:///e:/TRADING%20COSSA/backeteste.md).

---

## Sumário Executivo

A suite atual de backtesting é funcionalmente rica, mas cresceu organicamente em **múltiplas camadas sobrepostas**:

1. **Redundância funcional e visual no Hub (`/backtesting`)**: 5 abas no cabeçalho que repetem listagens (`StrategiesPage` já mostra as sessões inline de cada estratégia; `SessionDetailPage` duplica partes de `StrategyJournalPage`), além de vazar jargão interno de infraestrutura (`IDB 0.0k · Redis`, `IDB·Cloud`) para o trader.
2. **Atrito na criação de sessões (`NewSessionPage`)**: exige formulário de 4 etapas e **bloqueia a navegação** enquanto executa até ~30–35 chamadas sequenciais de pré-carregamento de velas.
3. **Rotas inconsistentes e acoplamento ao shell global**: `/backtesting` redireciona para `strategies` enquanto `/backtesting/*` cai em `sessions`; `/backtest` e `/backtesting` coexistem em paralelo; e `MainLayout` oculta sidebar/header verificando manualmente `location.pathname.includes('/replay/')` e ouvindo eventos globais `window`.
4. **Monolitos críticos difíceis de manter**: [KLineChartProTerminal.tsx](file:///e:/TRADING%20COSSA/client/src/components/KLineChartProTerminal.tsx) tem **4.617 linhas**; [TradeReplaySetupModal.tsx](file:///e:/TRADING%20COSSA/client/src/components/backtesting/TradeReplaySetupModal.tsx) tem **1.700 linhas**; [historicalBatchCache.ts](file:///e:/TRADING%20COSSA/client/src/services/historicalBatchCache.ts) tem **1.680 linhas** misturando IndexedDB, AES-GCM, outbox, upload de imagens e sync de corretora.
5. **Bugs e gargalos de comunicação/APIs**:
   - Filtro de `accountId` anulado por `OR` em `DashboardService.getBacktestHistory`, retornando JSONB completo (`config` com desenhos/ordens) de até 100 sessões na listagem.
   - Criação de `new TradingView.Client()` WebSocket por requisição HTTP e desalinhamento de `PlanGuard` entre rotas (`FREE` vs `BASIC` vs `PRO`).
   - Tempestade de auto-sync a cada 600ms durante o playback e a cada 15s mesmo com o usuário parado, com falso status `'saved'` após `setTimeout(..., 320)`.
   - Divergência de contrato Zod (`'CANCELLED'` vs `'CLOSED'`) e erro de Rules of Hooks em `NewSessionPage.tsx`.

---

## 1. Diagnóstico Detalhado (Problemas Verificados no Código)

### 1.1. Bugs e Riscos Imediatos (P0)

| Categoria | Arquivo / Símbolo | Problema Verificado | Impacto |
| :--- | :--- | :--- | :--- |
| **React Hooks** | [NewSessionPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/NewSessionPage.tsx#L98-L143) | `if (!strategy) return ...` ocorre antes de `useState` (`touched` na L137) e `useMemo`. | Crash do React se a estratégia não existir ao montar ou for removida durante a renderização. |
| **Render Side-Effect** | [BacktestReplaySessionPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/BacktestReplaySessionPage.tsx#L38-L96) | `useMemo` cria sessão e executa `saveBacktestSessions(...)` (efeito colateral em `localStorage`) durante o render. | Comportamento imprevisível em React StrictMode / concorrente. |
| **Contrato Quebrado** | [backtestContracts.ts](file:///e:/TRADING%20COSSA/client/src/schemas/backtestContracts.ts) vs [types.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/types.ts#L15) | `OrderStatusSchema` define `'CANCELLED'`, mas o motor ([engine.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/engine.ts)), `SessionDetailPage` e `StrategyJournalPage` usam `'CLOSED'`. | Sanitização pode descartar ou corromper ordens pendentes canceladas. |
| **Cut-Candle Incompleto** | [KLineChartProTerminal.tsx](file:///e:/TRADING%20COSSA/client/src/components/KLineChartProTerminal.tsx#L4189-L4202) | O corte de candle (`cutCandleMode`) chama `df.setReplayMode` e `setLatestBar`, mas não executa `recomputeOrders` como `onFeedCandle`. | Ordens abertas/pendentes ficam desatualizadas ao cortar o gráfico para trás ou para frente até o próximo passo. |
| **Query SQL Bugada + Overfetch** | [dashboard.service.ts](file:///e:/TRADING%20COSSA/backend-nest/src/dashboard/dashboard.service.ts#L4250-L4262) | `getBacktestHistory` monta `whereClause` com `OR` contendo `{ userId }` puro e sem `select` reduzido. | Ignora filtro de `accountId` e trafega `config` JSONB inteiro (desenhos/estilos/ordens) para até 100 sessões de uma só vez. |
| **Falso "Saved" & Auto-Sync Excessivo** | [KLineChartProTerminal.tsx](file:///e:/TRADING%20COSSA/client/src/components/KLineChartProTerminal.tsx#L3628-L3719) | Debounce de 600ms depende de `latestBar?.timestamp`, `floatingPnl`, `simBalance`, `stats`; simula `'saved'` com `setTimeout(..., 320)` sem esperar resposta; timer de 15s dispara sync mesmo em pausa/aba inativa. | Sobrecarga contínua de PBKDF2 + rede + Postgres/Redis e sensação falsa de dados salvos em falha de rede. |
| **Prefetch Bloqueante Serial** | [NewSessionPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/NewSessionPage.tsx#L186) e [mt5-worker.service.ts](file:///e:/TRADING%20COSSA/backend-nest/src/mt5/worker/mt5-worker.service.ts#L1741-L1767) | Cliente aguarda `prefetchSessionWithDemoAccount` (que faz loop serial de até `5 símbolos × 7 timeframes = 35` buscas TradingView) e depois executa outro loop sequencial de batches no browser. | Criação de sessão lenta, sujeita a timeout de requisição HTTP. |
| **Desalinhamento de Planos** | [tradingview.controller.ts](file:///e:/TRADING%20COSSA/backend-nest/src/tradingview/tradingview.controller.ts), [market-data.controller.ts](file:///e:/TRADING%20COSSA/backend-nest/src/market-data/market-data.controller.ts), [mt5.controller.ts](file:///e:/TRADING%20COSSA/backend-nest/src/mt5/mt5.controller.ts) | `TradingViewController` é `FREE` (mas `getCandlesBatch` clampa `Math.max(500, maxBars)` burlando o limite de 350 do plano FREE), OANDA exige `BASIC`, e `MT5 Demo Prefetch` exige `PRO`. | Usuários `FREE`/`BASIC` recebem erros `403` silenciosos durante criação de sessão ou troca de fonte. |
| **Proxy Silencioso `XAUUSD → PAXGUSDT`** | [klineDatafeed.ts](file:///e:/TRADING%20COSSA/client/src/services/klineDatafeed.ts) | Fallback direto client-side na API pública da Binance mapeia `XAUUSD` para `PAXGUSDT`. | Diferenças de cotação, spread e horário de mercado cripto 24/7 vs ouro spot forex distorcem backtests sem aviso visual claro. |
| **Re-render Destrutivo em Multi-Chart** | [KLineChartProTerminal.tsx](file:///e:/TRADING%20COSSA/client/src/components/KLineChartProTerminal.tsx#L1717-L1763) | `latestBar?.timestamp` está nas dependências do efeito que espelha desenhos nas janelas auxiliares; além disso L1650 injeta indicador `'EMA'` fixo em todo painel auxiliar. | A cada candle durante o replay, remove e recria todos os overlays de todas as sub-janelas, derrubando FPS. |

### 1.2. Código Legado / Duplicações Identificadas

- [BacktestComponents.tsx](file:///e:/TRADING%20COSSA/client/src/components/backtest/BacktestComponents.tsx) (182 linhas): sem importações ativas no projeto — candidato imediato à remoção.
- `STRATEGY_SIM` em [dashboard.service.ts](file:///e:/TRADING%20COSSA/backend-nest/src/dashboard/dashboard.service.ts#L3277-L3366): algoritmo determinístico simplista `((i * 37 + 13) % 100) < winRateTarget`, redundante frente ao motor Monte Carlo real de [HypothesesPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/HypothesesPage.tsx).
- `TradeReplaySetupModal.tsx` (1.700 linhas): concentra lógica própria de criação de estratégia, sessão e prefetch que já existe em `NewSessionPage` e `backtestWorkspaceStore.ts`.
- Duplicação de payload V1 + V2 no snapshot ([backtestSessionSnapshot.ts](file:///e:/TRADING%20COSSA/client/src/services/backtestSessionSnapshot.ts)): persiste simultaneamente `drawings` (V2) e `drawnItems` + `drawingStylesById` + `overlayGeometries` (V1).

---

## 2. Plano Visual, Design & Descomplicação de `/backtesting`

### 2.1. Princípios de Redesign (Estética Institucional Limpa)

1. **Zero jargão de infraestrutura na UI do trader**:
   - Remover badges `IDB 0.0k · Redis`, `IDB·Cloud`, `Local IDB`, `IDB·Redis` e `v{revision}` de [BacktestingLayout.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/BacktestingLayout.tsx) e [TopToolbarLayer.tsx](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/layers/TopToolbarLayer.tsx).
   - Substituir por um indicador discreto de 1 estado semântico:
     - Ponto verde + `"Sincronizado"` (tooltip: última hora de sync)
     - Spinner sutil + `"Salvando alterações..."`
     - Ponto âmbar + `"Offline · 3 pendentes"` (com ação manual "Tentar sincronizar")
2. **Hierarquia visual orientada à ação primária**:
   - No Hub (`/backtesting`), o objetivo principal do trader é **retomar um replay em 1 clique** ou **iniciar uma nova sessão rápida** — e não navegar por 5 submenus antes de ver um gráfico.
3. **Alinhamento estrito de tokens e densidade**:
   - Manter a sobriedade tipográfica e o uso de `tabular-nums` para todas métricas, PnL, R-multiples, datas e contadores (`primitives.tsx` + `--ds-*`).
   - Padronizar KPIs com no máximo **4–5 métricas principais** visíveis por padrão e métricas secundárias em painel expansível ("Ver estatísticas quantitativas avançadas"), reduzindo poluição visual no `SessionDetailPage` (atualmente 8 `KpiCard`s simultâneos) e no `BacktestDashboardPage` (1.346 linhas com 9+ blocos empilhados).

### 2.2. Descomplicação da Arquitetura de Informação do Hub

Atualmente temos 5 abas no `SubHeader` (`Playbooks`, `Sessões`, `Dashboard`, `Diário`, `Hipóteses`), sendo que `Playbooks` já lista sessões inline e `Sessões` repete a mesma lista fora do agrupamento.

**Proposta de consolidação em 4 visões coesas + Ação "Continuar último replay":**

1. **Workspace / Sessões (`/backtesting/sessions` — página inicial canônica)**
   - **Banner compacto "Retomar última sessão"** (se houver sessão `ACTIVE`): Ativo, TF, Progresso (`42 trades · +3.8R · Saldo atual`), botão direto **Continuar Replay**.
   - **Seção Playbooks em Strip/Tabs horizontais** (filtro rápido por estratégia com contador de sessões + Win Rate + Expectancy + botão rápido *"Gerenciar Playbooks"* abrindo drawer/rota `/strategies`), seguida da **lista/grade limpa de Sessões**.
   - Elimina ter de escolher entre "aba Estratégias" ou "aba Sessões" para achar um replay.
2. **Playbooks (`/backtesting/strategies`)**
   - Foco real em **Gestão do Playbook** (regras de entrada/saída, checklist pré-trade, ativos permitidos, timeframe padrão, meta de risco, notas da estratégia e métricas agregadas apenas daquela estratégia), sem duplicar a tabela completa de sessões quando filtrado.
3. **Analytics (`/backtesting/analytics`)**
   - Unificar os melhores widgets de [BacktestDashboardPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/BacktestDashboardPage.tsx) com **filtros globais no topo** (Estratégia, Ativo, Período, Sessão) e **layout em 2 camadas**:
     - *Camada 1 (Essencial)*: KPIs de Edge (Win Rate, Profit Factor, Expectancy em R, Max DD%) + Curva de Equity / R acumulado + Calendário mensal / Desempenho por Horário.
     - *Camada 2 (Comportamental & Distribuição)*: Radar comportamental, Distribuição de R, Underwater Drawdown, Tabela por Par.
4. **Diário (`/backtesting/journal`) & Simulador (`/backtesting/hypotheses`)**
   - **Diário**: manter como hub unificado com busca textual, filtro por tag/emoção/setup e navegação entre Sessões e Trades sem duplicar botões quebrados. Em `SessionDetailPage`, transformar o mini-diário em preview resumido com botão "Abrir no Editor Completo" ou manter um único editor reutilizado via componente comum.
   - **Hipóteses**: separar visualmente com clareza:
     - *What-If na Conta Real* (re-simulação determinística dos trades importados do MT5/Deriv — eventualmente interligável também a `/analytics` ou `/reports`);
     - *Projeção Monte Carlo* (simulação probabilística conectada diretamente aos parâmetros reais de qualquer Estratégia/Sessão selecionada — botão **"Puxar métricas do Playbook X"** para preencher Win Rate, RR e trades automaticamente!).

### 2.3. Fluxo de Criação em 1 Clique (Substituindo o Peso de `NewSessionPage`)

Em vez de forçar uma página inteira de 4 passos numerados toda vez que o usuário clica em `+ Nova sessão`:

- **Modo Rápido (Drawer/Modal por padrão — 3 campos visíveis)**:
  1. Playbook / Estratégia (já pré-seleciona pares, timeframe, saldo, risco%, spread e comissão do playbook)
  2. Par + Timeframe + Janela de Data (presets rápidos: `Últimos 30 dias`, `Últimos 3 meses`, `Último ano`, `Personalizado`)
  3. CTA primário: **Iniciar Replay Agora** (navega imediatamente sem bloquear em prefetch!).
- **Seção recolhível "Ajustes Avançados"** (capital inicial customizado, risco%, comissão/spread, fonte de dados, modo Prop Firm).
- Manter `/backtesting/sessions/new` apenas como alias compatível que abre o criador completo/focado para deep-links, corrigindo imediatamente o bug de hooks.
- **Unificação com `TradeDetails` ([TradeReplaySetupModal.tsx](file:///e:/TRADING%20COSSA/client/src/components/backtesting/TradeReplaySetupModal.tsx))**: substituir o modal gigante de 1.700 linhas por um wrapper enxuto em torno do mesmo `SessionQuickCreateDrawer` + serviço unificado de criação/importação de trade.

---

## 3. Nova Arquitetura de Rotas (`/backtesting` & Replay)

### 3.1. Diagnóstico das Rotas Atuais ([App.tsx](file:///e:/TRADING%20COSSA/client/src/App.tsx#L368-L381))

- `/backtesting` redireciona para `/backtesting/strategies`, enquanto `/backtesting/*` cai em `/backtesting/sessions` (comportamento contraditório).
- Coexistem `/backtest` e `/backtest/replay/:sessionId` junto com `/backtesting` e `/backtesting/replay/:sessionId`.
- `MainLayout.tsx` (L17, L44, L104) detecta o terminal por `location.pathname.includes('/replay/')` e escuta `window.addEventListener('cossa:backtest-fullscreen', ...)`, misturando lógica de chrome global dentro do layout autenticado genérico.
- Rotas de detalhe de estratégia não têm URL própria (`/backtesting/strategies/:strategyId`), dificultando compartilhamento e histórico do navegador.

### 3.2. Mapa de Rotas Canônico Proposto

```text
/backtesting                          -> <Navigate to="/backtesting/sessions" replace />
/backtesting/sessions                 -> SessionsWorkspacePage (Retomar + Filtros + Lista/Grid + Quick Launch)
/backtesting/sessions/new             -> SessionsWorkspacePage com Drawer aberto (ou página dedicada limpa)
/backtesting/sessions/:sessionId      -> SessionDetailPage (?tab=overview|trades|journal)
/backtesting/strategies               -> StrategiesPage (Playbooks CRUD + métricas agregadas)
/backtesting/strategies/:strategyId   -> StrategyDetailPage (?tab=overview|sessions|journal)
/backtesting/analytics                -> BacktestDashboardPage (alias de redirect vindo de /backtesting/dashboard)
/backtesting/journal                  -> StrategyJournalPage (?strategy=&session=&trade=&scope=)
/backtesting/hypotheses               -> HypothesesPage (?view=what-if|monte-carlo|saved)

/backtesting/replay/:sessionId        -> ReplayShellLayout (fora do chrome Header/Sidebar padrão)
                                         Query params suportados: ?symbol=&tf=&ts=&tradeId=&panel=
```

### 3.3. Regras de Roteamento e Shell

1. **Isolar `ReplayShellLayout` em `App.tsx`**: criar uma rota irmã dedicada dentro de `AuthenticatedAppShell` (ou ao lado de `MainLayout`) exclusivamente para `/backtesting/replay/:sessionId`, com `Sidebar` sob demanda via drawer próprio ou botão voltar explícito — eliminando `location.pathname.includes('/replay/')` e o custom event `cossa:backtest-fullscreen` de `MainLayout.tsx`.
2. **Alinhar redirects legados**:
   - `/backtest` → `/backtesting/sessions` (`replace`)
   - `/backtest/replay/:sessionId` → `/backtesting/replay/:sessionId` preservando `location.search` (`replace`)
   - `/backtesting/dashboard` → `/backtesting/analytics` (`replace`)
   - `/backtesting/*` → `/backtesting/sessions` (`replace`)
3. **Deep-Linking bidirecional real para Replay**:
   - Clicar em "Abrir no Replay" em qualquer trade de [SessionDetailPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/SessionDetailPage.tsx), [StrategyJournalPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/StrategyJournalPage.tsx) ou [TradeDetails.tsx](file:///e:/TRADING%20COSSA/client/src/pages/TradeDetails.tsx) navega com `?tradeId=...&ts=...&tf=...`, posicionando o gráfico exatamente no candle daquela execução com zoom adequado e painel de revisão aberto.

---

## 4. Análise e Redesign do Terminal de Replay

### 4.1. UX/UI do Terminal (`KLineChartProTerminal` e suas 7 Layers)

1. **TopToolbarLayer (874 linhas) mais limpa e ergonômica**:
   - Agrupar controles secundários (Reset simulação, Atalhos de teclado, Debug/Dados de origem, Tema) num único menu **"⋯ Mais / Preferências"** para liberar espaço em telas 1280px–1440px.
   - Remover badges técnicos (`IDB·Redis`, `v12`) e deixar o indicador discreto de estado de sincronização + fonte de dados ativa com selo claro de confiabilidade (ex: `Dados Reais · TradingView`, `Broker · MT5 Demo`, ou alerta amarelo claro se estiver usando dados sintéticos/proxy).
   - Em modo multi-gráfico (`1x2`, `1+2`, `2x2`), exibir seletor visual claro de qual painel (`P1`, `P2`...) recebe a troca de timeframe, sincronização de crosshair e desenhos.
2. **FloatingReplayBarLayer (433 linhas) responsiva e ancorável**:
   - **Bug visual atual**: posição inicial fixa `{ x: 84, y: 52 }` e clamp estático `[8..1200] × [8..800]` fazem a barra cobrir a legenda OHLCV ou ficar fora da tela ao redimensionar a janela.
   - **Melhoria**:
     - Novo botão de modo **Ancorada (Dock inferior central sobre o eixo de tempo)** vs **Flutuante (Arrastável)**, usando `ResizeObserver` do container pai para clamping relativo (`0..containerWidth - barWidth`).
     - Incluir **Timeline Scrub Bar interativa** com marcadores de trades executados (pontos verdes/vermelhos) diretamente na barra de replay, permitindo clicar/arrastar no tempo além do botão de corte (`Scissors`).
3. **Execução Visual de Ordens & Ticket (`RightSidePanelLayer` 761 linhas)**:
   - **Order Preview no Gráfico**: antes de clicar em `BUY` ou `SELL`, renderizar preview interativo diretamente no canvas com linhas arrastáveis de **Entry**, **Stop Loss** e **Take Profit** mostrando em tempo real risco em `$`, risco em `%`, tamanho do lote calculado e `R:R`.
   - **Quick-Tagging Pós-Trade Inline**: assim que um trade é fechado (TP, SL ou Manual), exibir card compacto no canto ou aba rápida no `RightSidePanelLayer` para marcar *Setup*, *Rating (1–5)* e *Estado emocional* em 3 segundos, gravando direto nos campos já existentes de `ReplayOrder` (`setup`, `rating`, `psychCheck`).
   - **Captura de Tela Limpa (Antes / Depois)**: botão de captura no trade salvo já anexa a imagem ao `order.journalImages` como `BEFORE` ou `AFTER` com upload assíncrono imediato (sem base64 no estado persistido).
4. **BottomDockLayer (620 linhas)**:
   - Adicionar ações rápidas por linha na aba de Posições Abertas: editar SL/TP inline numérico, Break-Even (`BE`), Parcial (`25% / 50% / 75%`), Fechar tudo (`Close All`), e **Exportar CSV / Relatório da Sessão**.
   - Corrigir a altura do painel expandido com drag handle redimensionável verticalmente (`min 160px`, `max 50%` da viewport).

### 4.2. Decomposição Técnica do Monolito `KLineChartProTerminal.tsx` (4.617 → ~350 linhas)

Dividir responsabilidades em módulos testáveis dentro de `client/src/components/kline-replay/`:

```text
components/kline-replay/
├── KLineReplayWorkspace.tsx         (Orquestrador visual < 350 linhas)
├── engine/
│   ├── engine.ts                    (Motor puro otimizado + MFE/MAE incremental)
│   └── contracts.ts                 (Alinhado ao Zod schema único)
├── hooks/
│   ├── useReplayPlayback.ts         (Play/Pause/Step/Cut-candle chamando engine sempre!)
│   ├── useMultiPaneCharts.ts        (Init/dispose panes, aux sync sem recriar overlays por tick)
│   ├── useOrderExecution.ts         (Lote, preview visual, BE, parciais, atalhos Alt+B/S)
│   ├── useDrawingManager.ts         (Overlay V2 único, undo/redo, estilos, geometrias)
│   ├── useIndicatorsManager.ts      (Add/remove/params por painel sem 'EMA' hardcoded)
│   ├── useSessionSyncController.ts  (Diff sync real, ACK de revision, practice timer ativo)
│   └── useReplayKeyboardShortcuts.ts
├── workers/
│   └── quantAnalytics.worker.ts     (Cálculo QuantMathEngine + Monte Carlo off-main-thread)
└── layers/                          (Layers visuais recebendo apenas props/actions enxutas)
```

### 4.3. Evolução do Motor de Execução (`engine.ts`)

1. **Recálculo Incremental em Step-Forward**:
   - Hoje `recomputeOrders` percorre histórico para ordens a cada passo (`O(orders × candles)`).
   - Otimização: no step-forward, avaliar apenas a nova barra contra ordens com status `PENDING` ou `OPEN`; reservar o recálculo completo para `rewind`, `cutCandle` atrás ou alteração retroativa.
2. **Preenchimento Real de `MFE` e `MAE` em Tempo Real**:
   - `ReplayOrder` já define `mfe?: number | null` e `mae?: number | null` em `types.ts`, mas eles não são atualizados barra a barra. Atualizar máxima excursion favorável e adversa (em R e em preço) a cada candle enquanto a ordem está `OPEN`.
3. **Correção do Cut-Candle + Preservação de Overlays**:
   - Unificar `stepForward`, `stepBackward`, `jumpToRatio`, `jumpToTimestamp` e `cutCandleMode` sob uma única função `seekReplayToIndex(targetIdx)` que sempre:
     1. Atualiza `datafeed`,
     2. Executa `recomputeOrders(..., { rewind: nextTs < prevTs })`,
     3. Atualiza `latestBar` e legend,
     4. Sincroniza painéis auxiliares sem destruir overlays intactos.
4. **Alinhamento de Contratos**:
   - Corrigir `OrderStatusSchema` em `backtestContracts.ts` para aceitar `'CLOSED'` como canônico (mantendo migração silenciosa caso algum JSON legado tenha `'CANCELLED'`).

---

## 5. Comunicação, Dados & Arquitetura de APIs

### 5.1. Separação de Entidades no PostgreSQL (Fim da God-Table `backtest_sessions`)

Atualmente [backtest-session.entity.ts](file:///e:/TRADING%20COSSA/backend-nest/src/dashboard/backtest-session.entity.ts) armazena tudo numa única tabela `backtest_sessions` diferenciada por `mode`. Propomos normalizar para 4 tabelas dedicadas:

1. **`backtest_strategies`**: regras do playbook, ativos padrão, timeframe, custos padrão, checklist, metas e timestamps.
2. **`backtest_sessions`**: apenas metadados e métricas indexáveis (`id`, `userId`, `strategyId`, `accountId`, `name`, `primarySymbol`, `timeframe`, `fromDate`, `toDate`, `initialBalance`, `currentBalance`, `netPnl`, `winRate`, `profitFactor`, `expectancy`, `maxDrawdownPct`, `tradesCount`, `practiceSeconds`, `status`, `revision`, `updatedAt`).
3. **`backtest_session_blobs`** (ou `backtest_session_states` separado 1:1 com compressão opcional): `orders` (ou tabela `backtest_orders` se houver necessidade futura de queries SQL cross-session), `drawingsV2`, `workspacePrefs`, `journalContent`, `replayTimestamp`. Assim `GET /sessions` **nunca toca em JSONB pesado**.
4. **`backtest_hypotheses`**: simulações What-If e projeções Monte Carlo guardadas, tirando ruído da tabela de sessões.

### 5.2. APIs de Sessão & Sincronização (Substituindo Polling + Snapshot Monolítico)

| Fluxo Atual | Novo Contrato Proposto | Benefício |
| :--- | :--- | :--- |
| `GET /dashboard/backtest/history` (OR bugado + até 100 JSONBs completos) | `GET /api/v2/backtest/sessions?accountId=&strategyId=&status=&page=1&limit=20` | Query indexada com `AND` correto no `accountId`, resposta paginada < 15KB e carregamento instantâneo do Hub. |
| `GET /dashboard/backtest/session/:id` sempre baixa tudo | `GET /api/v2/backtest/sessions/:id?knownRevision=N` | Retorna `304 Not Modified` (ou `{ unchanged: true }`) se a versão em cache local/IDB já estiver igual ao Redis/Postgres. |
| `POST /dashboard/backtest/session-sync` enviando JSONB completo a cada 600ms e 15s + falso `saved` | `PATCH /api/v2/backtest/sessions/:id/sync` com **baseRevision** e payload diferencial (`dirtyOrders`, `drawingsV2`, `workspacePrefs`, `deltaPracticeSeconds`) | Concorrência otimista real (`409 Conflict` se outra aba/dispositivo avançou a revisão), `practiceSeconds` contado apenas quando aba visível e usuário ativo, e confirmação real de ACK antes de exibir `"Sincronizado"`. |
| `flushSessionBeforeUnload` via `keepalive` com limite 56KB (quebra se houver imagem/muitas ordens) | Screenshots enviados via `POST /screenshot` no momento da captura (nunca base64 no estado) + snapshot V2 enxuto **sem espelho V1** (`drawnItems`/`drawingStylesById`/`overlayGeometries` removidos da wire payload) | Payloads finais caem ~60–75% e cabem com folga no `sendBeacon` / `keepalive`. |

### 5.3. Pipeline de Dados Históricos & Prefetch Assíncrono via WebSocket

#### Problema Atual
1. `NewSessionPage` trava na submissão aguardando `POST /mt5/market-feed-demo/prefetch-session` e 30 chamadas seriais.
2. `TradingViewService.getCandles` cria `new TradingView.Client()` WebSocket novo a cada requisição não cacheada (8s timeout), sem coalescência de chamadas concorrentes.
3. `klineDatafeed.ts` faz fallback direto no browser para `api.binance.com` e `wss://stream.binance.com` + usa `PAXGUSDT` no lugar de `XAUUSD`.
4. `OandaService` ([oanda.service.ts](file:///e:/TRADING%20COSSA/backend-nest/src/market-data/oanda.service.ts)) só atende URL `api-fxtrade`, não possui cache Redis próprio e quebra o mapeamento em índices/cripto (`NAS100`, `US30`, `GER40`, `BTCUSD` com regra simplista de 6 letras).

#### Arquitetura Alvo (`/api/market-data/v2` + `Mt5Gateway`)

1. **Criação de Sessão Não-Bloqueante**:
   - `POST /api/v2/backtest/sessions` cria a sessão em `< 50ms` e dispara um job assíncrono em background no backend.
   - O frontend navega **imediatamente** para `/backtesting/replay/:sessionId` e começa carregando o primeiro lote da janela ativa (`1 lote × timeframe principal`) enquanto o backend pré-carrega os demais lotes em paralelo controlado (`concurrency = 3–4`).
   - Progresso emitido em tempo real pelo **Socket.IO (`Mt5Gateway`)** existente (`event: backtest:prefetch:progress`) em vez de polling ou tela congelada.
2. **Pool + Single-Flight no `TradingViewService`**:
   - Implementar *in-flight request deduplication* (mapa `symbol:tf:cursor` → `Promise`) para evitar abrir múltiplas conexões WebSocket idênticas quando 3 gráficos auxiliares carregam juntos.
   - Manter Pool de clientes TradingView reutilizáveis com reconexão automática e circuit breaker, em vez de `new Client()` + `end()` por HTTP call.
3. **Gateway Unificado de Candles (`MarketDataRouterService`)**:
   - Único endpoint backend `GET /api/v2/market-data/candles` com fallback transparente configurável por classe de ativo:
     - **Forex & Metais**: MT5 Broker → OANDA (tabela explícita de símbolos + cache Redis) → TradingView.
     - **Cripto**: Binance via **proxy/cache backend** (eliminando dependência direta de CORS/geo-block no cliente) → TradingView.
     - **Índices (`US30`, `NAS100`, `SPX500`, `GER40`)**: tabela de mapeamento explícito (`OANDA_SYMBOL_MAP`, `TV_SYMBOL_MAP`), removendo de vez o fallback silencioso `XAUUSD → PAXGUSDT` (ou exibindo aviso explícito apenas se o usuário ativar modo sintético/proxy).
   - Corrigir a política de planos (`PlanGuard`) de ponta a ponta:
     - `TradingViewController`: respeitar exatamente `REPLAY_LIMITS` por tier (remover o `Math.max(500, maxBars)` que furava o limite `350` do FREE) ou unificar limites claros por plano em todos os feeds.
     - Liberar fonte básica (ex: 1 janela padrão / TradingView ou Demo Cache) para todos usuários com acesso à página `/backtesting`, evitando que `BASIC` tome `403` silencioso no `MT5_BACKEND` prefetch (`PRO`).
4. **Criptografia Local & Hidratação Sem Congelamentos (`historicalBatchCache.ts`)**:
   - Substituir o cálculo repetido de `PBKDF2-SHA256` com **50.000 iterações** em cada leitura/gravação de sessão por uma chave derivada **1 vez por login/sessão do app** mantida em memória (`CryptoKey` WebCrypto).
   - Substituir `Promise.race(..., 1200ms)` em `BacktestReplaySessionPage.tsx` por **hidratação em duas fases explícitas**:
     1. Montagem instantânea (<50ms) usando IDB/localStorage + banner discreto `"Verificando última revisão na nuvem..."`.
     2. Ao chegar a resposta do backend: se `server.revision > local.revision` e o usuário ainda não interagiu, aplica silenciosamente; se já interagiu, mostra modal simples *"Há alterações mais recentes de outro dispositivo — Atualizar ou Manter atual?"*.

### 5.4. Integrações de Ecossistema (Alto Valor para o Produto)

1. **Integração Replay ↔ Torex AI (`/torex-ai`)**:
   - Botão **"Analisar Sessão com Torex AI"** em `SessionDetailPage` e no final do Replay: envia resumo estatístico (R médio, horários de erro, aderência ao plano `psychCheck`, taxa por ativo e por direção) para gerar feedback acionável de melhoria do setup.
2. **Ponte Bidirecional Trade Real ↔ Replay (`TradeDetails`)**:
   - Centralizar num serviço único (`createReplaySessionFromTrades`) tanto o botão `Importar trades da conta` (`AccountImportButton`) quanto "Revisar este trade no Replay" (`TradeDetails`), preservando marcações reais de entrada/SL/TP/saída e abrindo com 1 clique via deep-link `/backtesting/replay/:sessionId?tradeId=...`.
3. **Alinhamento What-If ↔ Monte Carlo (`HypothesesPage`)**:
   - Remover o loop falso `((i * 37 + 13) % 100)` de `STRATEGY_SIM` no backend; conectar `Projection` (Monte Carlo) diretamente às métricas reais dos Playbooks e Sessões salvas.

---

## 6. Roadmap de Execução Priorizado

### Fase 1 — Quick Wins, Correções de Bugs & Limpeza Visual
- [x] Corrigir violação de Rules of Hooks em [NewSessionPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/NewSessionPage.tsx) (mover hooks acima do early return).
- [x] Remover side-effect (`saveBacktestSessions`) de dentro de `useMemo` em [BacktestReplaySessionPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/BacktestReplaySessionPage.tsx).
- [x] Unificar `OrderStatusSchema` (`'CLOSED'`, normalizando `'CANCELLED' -> 'CLOSED'`) em [backtestContracts.ts](file:///e:/TRADING%20COSSA/client/src/schemas/backtestContracts.ts) e preservar campos de journal/MFE/MAE/SL/parciais.
- [x] Fazer `cutCandleMode`, `handleStepBackward`, `handleJumpToRatio` e `handleJumpToTimestamp` invocarem `recomputeOrders(..., { rewind: true })` determinístico em [KLineChartProTerminal.tsx](file:///e:/TRADING%20COSSA/client/src/components/KLineChartProTerminal.tsx).
- [x] Corrigir filtro `OR` no `getBacktestHistory` do [dashboard.service.ts](file:///e:/TRADING%20COSSA/backend-nest/src/dashboard/dashboard.service.ts) para respeitar estritamente `accountId` + adicionar suporte a `?slim=1` removendo JSONB de desenhos/capturas mantendo `orders` e `results`.
- [x] Remover badges de infraestrutura (`IDB · Redis`, `v{revision}`) da UI visível em [BacktestingLayout.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/BacktestingLayout.tsx) e [TopToolbarLayer.tsx](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/layers/TopToolbarLayer.tsx) (detalhes técnicos movidos para `title` tooltip), trocando o falso `setTimeout(..., 320)` pelo retorno booleano real do sync + estado `offline_queued`.
- [x] Corrigir bounds responsivos do [FloatingReplayBarLayer.tsx](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/layers/FloatingReplayBarLayer.tsx) (`ResizeObserver` + `window.resize`) e adicionar barra ancorada no rodapé (`docked` com padrão `<1366px`).
- [x] Remover arquivo morto `BacktestComponents.tsx`.

### Fase 2 — Reorganização de Rotas, Simplificação UX & Performance do Replay
- [x] Padronizar rotas em [App.tsx](file:///e:/TRADING%20COSSA/client/src/App.tsx) e [backtesting/index.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/index.tsx) (`/backtesting/sessions` padrão, `/backtesting/analytics` canônico com redirect de `/dashboard`, redirect de `/backtest/replay/:sessionId`, deep-link `?symbol=&tf=&ts=&tradeId=` + atalho direto por trade e card *"Continuar último replay"* em [SessionsPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/backtesting/SessionsPage.tsx)).
- [x] Implementar [QuickSessionModal.tsx](file:///e:/TRADING%20COSSA/client/src/components/backtesting/QuickSessionModal.tsx) com presets (`15D / 30D / 90D / YTD`) e prefetch não-bloqueante ao entrar no Replay.
- [x] Quebrar [KLineChartProTerminal.tsx](file:///e:/TRADING%20COSSA/client/src/components/KLineChartProTerminal.tsx) em hooks modulares ([useReplayPlayback.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/hooks/useReplayPlayback.ts), [useMultiPaneCharts.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/hooks/useMultiPaneCharts.ts), [useOrderExecution.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/hooks/useOrderExecution.ts), [useDrawingManager.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/hooks/useDrawingManager.ts), [useSessionSyncController.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/hooks/useSessionSyncController.ts)) e utilitário [drawingOverlayUtils.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/hooks/drawingOverlayUtils.ts).
- [x] Otimizar gráficos auxiliares em [KLineChartProTerminal.tsx](file:///e:/TRADING%20COSSA/client/src/components/KLineChartProTerminal.tsx) (não recriar overlays em todo tick do replay, remover `'EMA'` hardcoded) e adicionar fast-path incremental `prevUptoTs` em [engine.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/engine.ts).
- [x] Adicionar Order Preview arrastável no gráfico (Entry/SL/TP via overlay `replayOrderPreviewLine` em [registerCustomOverlays.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/overlays/registerCustomOverlays.ts) e matemática em [orderPreviewMath.ts](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/orderPreviewMath.ts), com toggle em [RightSidePanelLayer.tsx](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/layers/RightSidePanelLayer.tsx)) e Quick-Tagging pós-trade inline ([PostTradeQuickTagCard.tsx](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/layers/PostTradeQuickTagCard.tsx) e histórico em [BottomDockLayer.tsx](file:///e:/TRADING%20COSSA/client/src/components/kline-replay/layers/BottomDockLayer.tsx)).
- [x] Substituir timer cego de 15s por contador ativo com visibilidade/atividade (flush a cada 60s), eliminar tempestade de sync durante autoplay por assinatura de ordens (`ordersPersistSignature`) e otimizar `PBKDF2` em [historicalBatchCache.ts](file:///e:/TRADING%20COSSA/client/src/services/historicalBatchCache.ts) com cache LRU de Promises por `sessionId`.

### Fase 3 — Reestruturação de Dados, API v2 & Pipeline de Mercado
- [x] Migrar `backtest_sessions` JSONB para tabelas normalizadas (`backtest_strategies`, `backtest_session_blobs`, `backtest_hypotheses` em [backtest-normalized.entity.ts](file:///e:/TRADING%20COSSA/backend-nest/src/dashboard/backtest-normalized.entity.ts)), com DDL/backfill em [1778000000000-NormalizeBacktestTables.ts](file:///e:/TRADING%20COSSA/backend-nest/src/migrations/1778000000000-NormalizeBacktestTables.ts) e [database-index-bootstrap.service.ts](file:///e:/TRADING%20COSSA/backend-nest/src/common/database/database-index-bootstrap.service.ts), split/hidratação e dual-write retrocompatível em [dashboard.service.ts](file:///e:/TRADING%20COSSA/backend-nest/src/dashboard/dashboard.service.ts) e rotas em [dashboard.controller.ts](file:///e:/TRADING%20COSSA/backend-nest/src/dashboard/dashboard.controller.ts).
- [x] Adicionar busca condicional via `?knownRevision=` (`{ unchanged: true }`) no endpoint `GET /dashboard/backtest/session/:sessionId` e `?slim=1` no histórico sem perder desenhos/capturas locais ao mesclar em [backtestWorkspaceStore.ts](file:///e:/TRADING%20COSSA/client/src/services/backtestWorkspaceStore.ts) e [BacktestReplaySessionPage.tsx](file:///e:/TRADING%20COSSA/client/src/pages/BacktestReplaySessionPage.tsx).
- [x] Implementar single-flight request coalescing no [TradingViewService](file:///e:/TRADING%20COSSA/backend-nest/src/tradingview/tradingview.service.ts), corrigir clamp de `maxBars` no [TradingViewController](file:///e:/TRADING%20COSSA/backend-nest/src/tradingview/tradingview.controller.ts), remover fallback `XAUUSD -> PAXGUSDT` no [klineDatafeed.ts](file:///e:/TRADING%20COSSA/client/src/services/klineDatafeed.ts), expandir mapeamento + `OANDA_ENV`/`OANDA_BASE_URL` no [OandaService](file:///e:/TRADING%20COSSA/backend-nest/src/market-data/oanda.service.ts) e liberar prefetch demo em `PlanTier.BASIC` no [Mt5Controller](file:///e:/TRADING%20COSSA/backend-nest/src/mt5/mt5.controller.ts).
- [x] Converter prefetch HTTP em execução assíncrona em background (`queued: true`, concorrência `3`) no [Mt5WorkerService](file:///e:/TRADING%20COSSA/backend-nest/src/mt5/worker/mt5-worker.service.ts). *(Telemetria em tempo real via Socket.IO `Mt5Gateway` ainda opcional/futura.)*
- [x] Substituir `STRATEGY_SIM` periódico (`(i * 37 + 13) % 100`) por PRNG Mulberry32 determinístico com variância de R-múltiplo em [dashboard.service.ts](file:///e:/TRADING%20COSSA/backend-nest/src/dashboard/dashboard.service.ts). *(Botão de análise direta com `/torex-ai` fica para fase futura.)*

### Fase 4 — Testes Automatizados & Verificação de Build
- [x] Testes unitários do frontend (`cd client && npm run test:unit` via [run-unit-tests.mjs](file:///e:/TRADING%20COSSA/client/scripts/run-unit-tests.mjs)): `11/11` aprovados em [backtestContracts.spec.ts](file:///e:/TRADING%20COSSA/client/tests/backtestContracts.spec.ts), [engine.spec.ts](file:///e:/TRADING%20COSSA/client/tests/engine.spec.ts) e [orderPreviewAndTagging.spec.ts](file:///e:/TRADING%20COSSA/client/tests/orderPreviewAndTagging.spec.ts).
- [x] Testes unitários do backend (`cd backend-nest && npx jest src/dashboard/backtest.spec.ts src/tradingview/tradingview.service.spec.ts`): `2/2` suítes e `10/10` testes aprovados em [backtest.spec.ts](file:///e:/TRADING%20COSSA/backend-nest/src/dashboard/backtest.spec.ts) e [tradingview.service.spec.ts](file:///e:/TRADING%20COSSA/backend-nest/src/tradingview/tradingview.service.spec.ts).
- [x] Verificação estática e builds de produção (`client`: `npx tsc --noEmit` + `npx vite build`; `backend-nest`: `npm run build`), todos concluídos com `exit 0`.

---

## 7. Critérios de Aceitação & Métricas Alvo

- **Tempo até abrir Replay após criar sessão**: cair de espera bloqueante multi-request (>10–30s) para **< 500ms** (navegação imediata + streaming progressivo dos lotes).
- **Payload da listagem de sessões (`/sessions` / `/history`)**: reduzir de múltiplos MB (JSONB completo) para **< 20KB** por página (20 sessões).
- **Manutenibilidade do Terminal**: `KLineReplayWorkspace.tsx` abaixo de **400 linhas**, com lógica crítica (`engine`, `contracts`, `sync`) coberta por testes unitários.
- **Consistência de sincronização**: zero perdas silenciosas de estado no `beforeunload` (sem base64 no estado e envio diferencial < 56KB) e zero falsos positivos de `"Sincronizado"` quando offline ou em erro HTTP.
- **Confiabilidade de rotas**: zero redirecionamentos contraditórios entre `/backtesting` e `/backtesting/*`, com suporte completo a deep-link de trade/timestamp diretamente no Replay.
