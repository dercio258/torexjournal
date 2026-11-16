# Plano de Implementação — Landing Page `/en` & Dashboard EN (`en-index.md`)

Este documento define a arquitetura visual e técnica da **Landing Page em Inglês (`/en`)** e da **Página Dashboard com terminologia de mercado (`/en/dashboard`)** do **Torex Journal**, mantendo a página em Português intacta em **`/`** e **`/pt`** e preservando todas as demais páginas do sistema.

> [!NOTE]
> **Escopo Implementado (Fases 1 & 2):**
> 1. **Navbar institucional (`/en`)** (`LandingEnNavbar`) + **Cinematic Orbital Earth-Horizon + Replay Candlesticks Hero** (`HeroEnSection` + `EarthHorizonBackground` com `klinecharts`).
> 2. **3 Cards Horizontais Responsivos abaixo do Hero (`CorePillarsEnSection`)**: **TOREX AI**, **TRAINING** e **JOURNAL**, responsivos para telemóvel (`1` coluna), tablet (`2` colunas com 3º centralizado) e desktop (`3` colunas horizontais).
> 3. **Layout Responsivo dos KPIs de Topo em `/dashboard`**: Agrupados na mesma linha horizontal no desktop (`lg:grid-cols-4`) e em grelha `2x2` duas colunas em dispositivos móveis (`grid-cols-2`).
> 4. **Página `DashboardEn` (`/en/dashboard` e `/dashboard-en`)**: Mesma estrutura de `Dashboard.tsx` com terminologia global de mercado (`Win Rate`, `Profit Factor`, `Avg Win / Loss`, `Net P&L`, `Torex Edge Score`, `Cumulative Net P&L`, `Daily Net P&L`, `Recent Trades`, `Market & Session Breakdown`) estritamente restrita ao Dashboard.

---

## 1. Módulos Horizontais Abaixo do Hero (`/en`)

| Card | Badge | Headline | Ilustração UI Integrada |
| :--- | :--- | :--- | :--- |
| **1** | `TOREX AI` | **Meet Torex AI.** / *Your Trading Intelligence Coach.* | Balão de pergunta do trader + diagnóstico de setup *London Breakout* (`1.82` -> `2.18 Profit Factor`) + mini-gráfico `R-Multiple vs Profit Factor` (`Actual` vs `Projected`) |
| **2** | `TRAINING` | **Validate Strategies.** / *Realistic Market Replay.* | Gráfico de velas OHLC de Replay + escala de preços + boleta flutuante `Place Order` (`BUY`/`SELL`, `Stop Loss`, `Lot Size`, `Stop Price`) |
| **3** | `JOURNAL` | **Precision Journaling.** / *Consistent Decisions.* | Calendário mensal de P&L + card sobreposto `Account Performance` (`Net P&L`, `Profit Factor`, `Win Rate` + curva de capital) |

---

## 2. Mapa de Ficheiros

| Ficheiro | Responsabilidade |
| :--- | :--- |
| [`client/src/components/landing-en/EarthHorizonBackground.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/EarthHorizonBackground.tsx) | Horizonte orbital 3D discreto + velas reais de Backtesting Replay (`klinecharts`) |
| [`client/src/components/landing-en/HeroEnSection.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/HeroEnSection.tsx) | Headline, subheadline e CTA `Start Trading Smarter` |
| [`client/src/components/landing-en/CorePillarsEnSection.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/CorePillarsEnSection.tsx) | 3 cards horizontais responsivos (`TOREX AI`, `TRAINING`, `JOURNAL`) |
| [`client/src/components/landing-en/BrokerIntegrationsEnSection.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/BrokerIntegrationsEnSection.tsx) | Secção alinhada à esquerda `80+ Trading Platform Integrations` com carrossel infinito de ícones e nomes (MT5, Deriv, Prop Firms, Corretoras e `add-trades`) |
| [`client/src/components/landing-en/AiDecodeDashboardEnSection.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/AiDecodeDashboardEnSection.tsx) | Secção `Stop journaling in the dark. Let AI decode your trades.` à esquerda + `50%` visível de `dashboard.svg` à direita com mock flutuante da IA (`DM`, `+$22,642.60` e telemetria técnica) |
| [`client/src/components/landing-en/AllInOneSuiteEnSection.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/AllInOneSuiteEnSection.tsx) | Secção `ALL-IN-ONE TRADING SUITE` (`Built for your entire trading workflow.`) com botões interativos e pré-visualizações de proporção uniforme (`1356 × 520`) em `client/public/suite/` |
| [`client/src/components/landing-en/AiBacktestingScrollEnSection.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/AiBacktestingScrollEnSection.tsx) | Secção `AI-POWERED BACKTESTING` (`Transform Historical Data Into Trading Intelligence.`) com efeito sticky de scroll-reveal que sobrepõe `backtesting-showcase.png` sobre a headline |
| [`client/src/components/landing-en/torexAiLandingMocks.ts`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/torexAiLandingMocks.ts) | Contratos e mocks locais da secção Torex AI Messenger, 4 sinais de Pattern Detection e 3 Autonomous Trading Agents |
| [`client/src/components/landing-en/TorexAiAgentsEnSection.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/TorexAiAgentsEnSection.tsx) | Secção interativa Torex AI Messenger, Pattern Detection sincronizada e 3 Autonomous Trading Agents + Conversion Strip |
| [`client/src/components/landing-en/TorexAdvantageIcons.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/TorexAdvantageIcons.tsx) | Sistema de 10 ícones SVG customizados dual-layer + `VerifiedShieldIcon` com `useId()` único e nós de telemetria |
| [`client/src/components/landing-en/TorexAdvantageEnSection.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/TorexAdvantageEnSection.tsx) | Secção `INSTITUTIONAL ARCHITECTURE` borderless (coluna editorial sticky à esquerda + grelha de 10 pilares sem caixas à direita) |
| [`client/src/components/landing-en/LandingEnNavbar.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/LandingEnNavbar.tsx) | Navegação de `/en` (`Product`, `Tutorials`, `Company`, `Help Center`, `GET STARTED`) |
| [`client/src/pages/LandingEn.tsx`](file:///e:/TRADING%20COSSA/client/src/pages/LandingEn.tsx) | Container dedicado da rota `/en` |
| [`client/src/pages/Dashboard.tsx`](file:///e:/TRADING%20COSSA/client/src/pages/Dashboard.tsx) | KPIs de topo em `grid-cols-2 lg:grid-cols-4` (`2x2` mobile / `1x4` horizontal desktop) + delegação automática para `DashboardEn` em `/en/dashboard` |
| [`client/src/pages/DashboardEn.tsx`](file:///e:/TRADING%20COSSA/client/src/pages/DashboardEn.tsx) | Página Dashboard dedicada com termos de mercado (`Win Rate`, `Profit Factor`, `Avg Win / Loss`, `Net P&L`, `Torex Edge Score`) |
