# Spec & Master Prompt Técnico — Secção **Torex AI Messenger, Pattern Detection & Autonomous Agents** (`mock-ai.md`)

> **Objetivo:** Integrar na Landing Page do **Torex Journal** (`/en` em `LandingEn.tsx` e adaptável a `/` / `/pt` em `Landing.tsx`) uma secção interativa de **alta conversão** composta por:
> 1. **Torex AI Messenger Mock** (baseado na UI e contratos reais de `TorexAi.tsx` e `torexAiFallback.ts`);
> 2. **Pattern Detection Telemetry Feed** (4 sinais comportamentais e de *edge* sincronizados com o Messenger);
> 3. **Torex AI Agents Desk** (3 agentes especializados — *Habit*, *Risk Management* e *Sentiment/Mindset* — com mini-conversas clicáveis e feedback de estado em tempo real).

---

## 1. Mapeamento da Secção de Referência para a Identidade Torex Journal

| Elemento da Referência | Adaptação Obrigatória para Identidade **TOREX JOURNAL** | Referência Real no Codebase |
| :--- | :--- | :--- |
| Paleta / Canvas | Fundo `#02040A` (`LandingEn`), superfícies `#070B14`, `#0B101D`, `bg-surface` (`#111319`), bordas `border-white/[0.08]` / `border-line` | [`client/src/index.css`](file:///e:/TRADING%20COSSA/client/src/index.css), [`client/tailwind.config.js`](file:///e:/TRADING%20COSSA/client/tailwind.config.js) |
| Cor de Destaque Primária | Esmeralda **Torex** (`#10B981` / `accent` / `#34D399` `accent-fg`) + gradiente assinatura `from-emerald-300 via-accent-fg to-sky-400` | [`AiDecodeDashboardEnSection.tsx`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/AiDecodeDashboardEnSection.tsx#L36) |
| Marca / Avatar IA | `BRAND.logoUrl` (emblema circular do Touro com `border-accent/45 bg-surface` e badge `Sparkles`) — **proibido** usar "Zella" ou qualquer referência externa | [`client/src/constants/brand.ts`](file:///e:/TRADING%20COSSA/client/src/constants/brand.ts) |
| Bolha do Usuário (Messenger) | `bg-emerald-600 text-white border border-emerald-500/40 rounded-2xl rounded-tr-sm` + avatar de iniciais (`TR` / `DM`) | [`TorexAi.tsx`](file:///e:/TRADING%20COSSA/client/src/pages/TorexAi.tsx#L1400-L1430) |
| Bolha do Torex AI | `bg-[#0C1220]/95` ou `bg-surface border border-white/[0.08]` + `rounded-2xl rounded-tl-sm`, métricas em `font-mono tabular-nums`, action links (`ArrowUpRight`) e pílulas de continuação | [`TorexAi.tsx`](file:///e:/TRADING%20COSSA/client/src/pages/TorexAi.tsx#L1456-L1517) |
| Contexto de Mercado | **MT5 / Deriv / Prop Firms (FTMO, E8, FundedNext)**, **XAU/USD**, **NAS100**, **EUR/USD**, **R-Multiple**, **Profit Factor**, **Daily DD**, **Torex Edge Score**, `/journal`, `/backtesting`, `/trades`, `/add-trades` | [`contentEn.ts`](file:///e:/TRADING%20COSSA/client/src/components/landing-en/contentEn.ts), [`torexAiFallback.ts`](file:///e:/TRADING%20COSSA/client/src/components/ai/torexAiFallback.ts) |
| Composer Inferior | Pill input `rounded-full bg-surface border border-line` com placeholder `"Ask Torex AI anything about your trading..."`, ícone `Mic` e botão circular `bg-accent text-accent-on` (`SendHorizontal`) | [`TorexAi.tsx`](file:///e:/TRADING%20COSSA/client/src/pages/TorexAi.tsx#L1562-L1616) |

---

## 2. Arquitetura de Ficheiros & Integração na Landing Page

| Ficheiro | Ação | Responsabilidade |
| :--- | :--- | :--- |
| `client/src/components/landing-en/torexAiLandingMocks.ts` | **Criar** | Tipagens estritas (alinhadas a `ClientAiMessage`, `ClientAiActionLink`, `ClientAiMetricCard`), 4 cenários completos de conversa multi-turno, 4 sinais de *Pattern Detection* ligados aos cenários e dados dos 3 Agentes + estados interativos |
| `client/src/components/landing-en/TorexAiAgentsEnSection.tsx` | **Criar** | Componente principal contendo: **Bloco 1 (Bento 12 cols: 7 cols Messenger Interativo + 5 cols Pattern Detection)** e **Bloco 2 (Header + 3 Cards de Agentes Interativos + Strip de Conversão CTA)** |
| `client/src/components/landing-en/contentEn.ts` | **Atualizar** | Adicionar objeto `EN_TOREX_AI_AGENTS` com copy, eyebrows, headlines, badges e CTAs (mantendo separação apresentação vs. conteúdo) |
| `client/src/pages/LandingEn.tsx` | **Atualizar** | Inserir `<TorexAiAgentsEnSection />` imediatamente após `<AiBacktestingScrollEnSection />` (ou entre `<AiDecodeDashboardEnSection />` e `<AllInOneSuiteEnSection />` — ver nota de funil na Secção 5) |
| `client/src/pages/Landing.tsx` *(opcional PT)* | **Estender** | Reutilizar o mesmo motor de componentes parametrizado por `locale: 'pt' | 'en'` caso se deseje expor a secção também na rota `/` |

---

## 3. Master Prompt Técnico (Copiar e Executar para Implementação)

```markdown
Atue como Staff Frontend Engineer & Conversion UX Architect no repositório `e:\TRADING COSSA`.
Sua missão é implementar a secção interativa **Torex AI Messenger, Pattern Detection & Autonomous Agents** na Landing Page (`/en`, com suporte limpo a `locale` para futura reutilização em `/`), seguindo rigorosamente o design system e os contratos reais do Torex Journal.

### 1. LEITURA PRÉVIA OBRIGATÓRIA (NÃO PULAR)
Antes de escrever código, leia estes ficheiros existentes para respeitar tokens, tipografia, estrutura de chat e padrões de animação:
1. `client/src/index.css` e `client/tailwind.config.js` (tokens semânticos v2: `canvas`, `surface`, `surface-2`, `fg`, `fg-muted`, `fg-subtle`, `line`, `accent`, `accent-fg`, `accent-on`, `danger`, `data-1`, `data-radar`, `shadow-glow`, `font-mono tabular-nums`).
2. `client/src/constants/brand.ts` (`BRAND.logoUrl`, `BRAND.name`).
3. `client/src/pages/TorexAi.tsx` (linhas 105-250 e 1222-1623: anatomia exata do header do messenger, bolha do usuário `bg-emerald-600`, bolha do assistente com avatar circular `BRAND.logoUrl`, `ClientAiActionLink`, `suggestions`, staged spinner com pontos de progresso, typewriter streaming e composer pill com `Mic` + `SendHorizontal`).
4. `client/src/components/ai/torexAiFallback.ts` (`ClientAiMessage`, `ClientAiMetricCard`, `ClientAiActionLink`).
5. `client/src/pages/LandingEn.tsx`, `client/src/components/landing-en/contentEn.ts`, `client/src/components/landing-en/AiDecodeDashboardEnSection.tsx` e `client/src/components/landing-en/AiBacktestingScrollEnSection.tsx`.

### 2. IDENTIDADE VISUAL & PROIBIÇÕES
- **Fundo & Superfícies:** `#02040A` base da landing, cards principais em `#070B14` / `#090E1A` com `border-white/[0.09]`, inner chat stage em `#050810` com `border-white/[0.06]` e radius `rounded-2xl` / `rounded-3xl`.
- **Acento Principal:** Esmeralda Torex (`#10B981` / `accent` / `emerald-400`) combinada com gradientes subtis esmeralda→sky (`from-emerald-300 via-accent-fg to-sky-400`) e glows contidos (`radial-gradient`).
- **PROIBIDO:** Qualquer menção a "Zella", "TradeZella", roxo genérico dominante fora do badge `BEHAVIOR`, ou textos "lorem ipsum". Toda a terminologia deve refletir a infraestrutura Torex: **MT5 Auto-Sync**, **Deriv**, **Prop Firm Guardrails (FTMO / FundedNext)**, **XAU/USD**, **NAS100**, **London Sweep**, **NY Breakout**, **Torex Edge Score**, rotas `/journal`, `/trades`, `/backtesting`, `/add-trades`, `/register`.
- **Tipografia Numérica:** Todo valor monetário (`+$22,642.60`, `-$420`, `-$6,420`), porcentagem (`73%`, `62%`, `-2.1%`), R-multiple (`+2.46R`, `-1R`) e contador deve usar `font-mono tabular-nums`.

### 3. ARQUITETURA DO COMPONENTE (`TorexAiAgentsEnSection.tsx` + `torexAiLandingMocks.ts`)

Construa 2 sub-blocos coesos dentro de `<section id="torex-ai-agents" className="relative z-20 mx-auto w-full max-w-7xl px-4 pb-28 pt-10 sm:px-6 lg:px-8">`:

#### BLOCO A — BENTO DE INTELIGÊNCIA CONVERSACIONAL & TELEMETRIA (Grid 12 Colunas: `lg:grid-cols-12 gap-6`)

##### A1. Card Esquerdo (`lg:col-span-7`) — `CONVERSATION · TOREX AI MESSENGER`
- **Eyebrow:** `TOREX AI MESSENGER` (uppercase, `tracking-[0.09em]`, `text-accent-fg` com ícone `Sparkles`).
- **Headline:** `Get answers from your own data.`
- **Subheadline:** `Grounded in the 1,000+ MT5, Deriv & Prop Firm trades you've actually taken — not generic playbook advice from a forum thread.`
- **Palco do Messenger (Mock Fiel ao `TorexAi.tsx`):**
  - **Top Chrome Bar (estilo `TorexAi.tsx` + `AiDecodeDashboardEnSection`):**
    - Esquerda: avatar circular `BRAND.logoUrl` + `TOREX AI` (`text-[11px] font-bold text-accent-fg`) + subtítulo `Your Personal Coach` + dot verde pulsante `Live Sync`.
    - Direita: Pill de conta ativa (`Sparkles` + `FTMO 100K · MT5 · 1,248 trades`) + Pill de créditos (`Zap` + `Unlimited · Pro`).
  - **Seletor Rápido de Cenários (4 Tabs/Pills no topo da conversa):**
    Permite ao visitante alternar instantaneamente entre 4 conversas reais sem recarregar a página:
    1. `Revenge Leak` (Default — espelho da referência)
    2. `Best Edge (XAU/NAS)`
    3. `Prop Firm DD`
    4. `Plan Audit`
  - **Área de Mensagens (`min-h-[340px] max-h-[390px] overflow-y-auto`):**
    - **Bolha do Trader (User):** alinhada à direita, `bg-emerald-600 text-white border border-emerald-500/40 rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-xs font-medium` + avatar circular `TR` (`border-emerald-500/60 bg-surface-2 text-accent-fg`).
    - **Bolha do Torex AI (Assistant):** alinhada à esquerda, avatar `BRAND.logoUrl` (`w-7 h-7 rounded-full border border-accent/45 bg-surface`) + card `bg-[#0B111E] border border-emerald-500/20 rounded-2xl rounded-tl-sm p-3.5` contendo:
      - Texto com negritos destacados e inline metrics (`tabular-nums`);
      - **Linha de Metadados / Grounding Footer** em `font-mono text-[10px] text-slate-400 border-t border-white/[0.06] pt-2 mt-2` (ex: `Based on 23 trades · Mon–Fri · MT5 Account #88412`);
      - **Mini Metric Strip (opcional por turno):** 2–3 badges compactos (`Avg Revenge Loss: -$420`, `Rule Impact: -38% DD`);
      - **Action Links clicáveis (estilo `TorexAi.tsx`):** chips `bg-accent/10 hover:bg-accent/20 border-accent/35 text-accent-fg` que redirecionam para `/register?from=ai-mock` (para visitantes não logados) ou exibem preview tooltip;
      - **Follow-up Suggestion Pills:** ao clicar numa sugestão (ex: `"What should I do about it?"`), se o turno ainda não apareceu ou se o usuário clicar em "Simulate Next Question", executa o **Staged Spinner** de 2 etapas (`Querying 1,248 executions...` → `Synthesizing Edge Coach...` com 2 barras de progresso animadas idênticas ao `TorexAi.tsx#L1522-L1555`) e revela a resposta com **typewriter streaming** rápido (`~18ms` por chunk, respeitando `prefers-reduced-motion`).
  - **Composer Inferior Interativo:**
    - Form `rounded-full bg-[#0A0F1A] border border-white/[0.10] focus-within:border-accent/50 px-3.5 py-2 flex items-center gap-2`.
    - Input real editável com placeholder `"Ask Torex AI anything about your trading..."`.
    - Ao submeter qualquer pergunta customizada no input (ou clicar num prompt rápido), não falha nem chama backend: roda o **Staged Spinner** (650ms) e responde com uma análise determinística inteligente de demonstração + CTA elegante `"Connect your live MT5 or Deriv account to query your real trades →"` apontando para `/register`.
    - Botão `Mic` decorativo/interativo (mostra micro-tooltip `"Voice dictation available inside Torex AI"`) + botão `SendHorizontal` em `bg-accent text-accent-on`.

##### A2. Card Direito (`lg:col-span-5`) — `PATTERN DETECTION`
- **Eyebrow:** `PATTERN DETECTION`
- **Headline:** `See patterns you can't see.`
- **Subheadline:** `The leaks hiding in 1,000+ trades that no spreadsheet will ever surface.`
- **Lista de 4 Sinais Interativos (Cross-Linked com o Messenger):**
  Cada item é um `<button type="button">` estilizado como card (`rounded-xl border bg-[#0A0F1B]/90 p-3.5 text-left transition-all`) com:
  - Ícone em tile `w-9 h-9 rounded-lg border` com cor semântica dedicada:
    1. **TIME-OF-DAY** (`Clock`, tom azul `bg-blue-500/15 border-blue-400/30 text-blue-400`): `"You lose 62% of trades placed after 14:30 UTC (NY Afternoon)."` — badge `- $2,890`
    2. **BEHAVIOR** (`Flame` / `AlertTriangle`, tom violeta `bg-violet-500/15 border-violet-400/30 text-violet-400`): `"Revenge trades within 3m of a stop-out cost $6,420 last quarter."` — badge `73% of DD`
    3. **EDGE** (`Crosshair` / `TrendingUp`, tom âmbar `bg-amber-500/15 border-amber-400/30 text-amber-400`): `"Strongest setup: Opening-Range Breakouts on NAS100 & XAU/USD."` — badge `+2.46R avg`
    4. **STREAK** (`Zap` / `CheckCircle2`, tom esmeralda `bg-emerald-500/15 border-emerald-400/30 text-emerald-400`): `"8 winners in a row on London-NY Overlap Tuesday sessions."` — badge `74.2% WR`
  - **Interatividade de Alta Conversão:** Ao clicar em qualquer um dos 4 cards de Pattern Detection, o card recebe highlight ativo (`border-accent/45 shadow-[0_0_24px_rgba(16,185,129,0.14)]`) e **sincroniza o Messenger à esquerda** para o cenário correspondente com micro-indicação `"Loaded into Torex AI Messenger"`.
  - **Rodapé do Card:** Micro-estatística de prova (`Scanned across 1,248 synced executions · Updated 2s ago`) + link sutil `Uncover your own leaks →` (`/register`).

---

#### BLOCO B — `TOREX AI AGENTS`: EQUIPA AUTÔNOMA DE TRADING (`mt-20 sm:mt-24`)

- **Header Centralizado:**
  - Eyebrow: `AUTONOMOUS TRADING AGENTS` (ou `AGENTS`)
  - Headline (`text-3xl sm:text-5xl font-extrabold tracking-tight`):
    - Linha 1 (branco): `Build a team of agents`
    - Linha 2 (gradiente Torex `bg-gradient-to-r from-emerald-300 via-accent-fg to-sky-400 bg-clip-text text-transparent`): `that work for you.`
  - Subheadline: `Spin up specialized Torex agents that watch the parts of your trading you can't. Habits. Risk. Mindset. Connected directly to your MT5, Deriv & Journal.`

- **Grid 3 Colunas Responsivo (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12`):**

  1. **Card 1 — `HABIT AGENT` | Badge Top-Right: `RITUALS.V2` | Cor de Ícone: Sky/Cyan (`#0EA5E9`)**
     - Headline: `Builds the rituals that keep you in the seat.`
     - Copy: `Watches your routines — pre-market bias, post-trade journaling in /journal, end-of-day review — and nudges you the moment discipline slips.`
     - **Mini-Messenger Embutido:**
       - Msg Agente 1: `"You skipped your pre-market plan 3 of the last 5 sessions."`
       - Msg Agente 2: `"Want me to lock execution tags until you log a plan tomorrow?"`
       - **Botão-Bolha Interativo do Trader (Estado inicial → Estado Ativo):**
         - Inicial (clicável): `"Yes, lock me out until 08:45."` (com badge sutil `Click to trigger`)
         - Ao clicar: muda para estado confirmado `bg-emerald-500/15 border-emerald-400/40 text-emerald-300` + resposta instantânea do agente `"Guardrail armed: Pre-market checklist required before 08:45 UTC."`
     - Footer Status: Dot pulsante + `AGENT · ACTIVE` (muda para `GUARDRAIL · ARMED` quando clicado).

  2. **Card 2 — `RISK MANAGEMENT AGENT` | Badge Top-Right: `GUARDRAILS` | Cor de Ícone: Indigo/Blue (`#3987E5`)**
     - Headline: `Sits between you and your next bad decision.`
     - Copy: `Tracks daily DD, lot size, R-multiple and consecutive losses across your Prop Firm & live accounts in real time. Warns you before the rule break, not after.`
     - **Mini-Messenger Embutido:**
       - Msg Agente 1: `"You're at -2.1% Daily DD — next -1R loss breaches your 3.0% Prop Firm cap."`
       - Msg Agente 2: `"Recommend halving position size (0.5x lot) or stopping for today."`
       - **Botão-Bolha Interativo do Trader:**
         - Inicial (clicável): `"Halve size for the rest of the session."`
         - Ao clicar: confirmação instantânea `"Lot cap set to 0.5x · Max risk/trade $250 enforced."`
     - Footer Status: Dot pulsante + `AGENT · ACTIVE` → `RISK CAP · 0.5X ENFORCED`.

  3. **Card 3 — `SENTIMENT AGENT` | Badge Top-Right: `MINDSET` | Cor de Ícone: Violet (`#8B5CF6`)**
     - Headline: `Reads your tone. Catches tilt before it costs you.`
     - Copy: `Cross-references your journal notes, order-click cadence and post-loss frequency to detect frustration, FOMO and over-confidence — and steps in.`
     - **Mini-Messenger Embutido:**
       - Msg Agente 1: `"Your last 3 journal entries and 90s order cadence match your tilt signature."`
       - Msg Agente 2: `"15-min cool-down recommended. Want me to start the timer?"`
       - **Botão-Bolha Interativo do Trader:**
         - Inicial (clicável): `"Start the timer."`
         - Ao clicar: inicia um **timer regressivo real** (`14:59`, `14:58`...) via `setInterval` limpo no `useEffect`, exibindo `"Cool-down running · 14:58 remaining"`.
     - Footer Status: Dot pulsante + `AGENT · ACTIVE` → `COOL-DOWN · RUNNING`.

- **Barra Final de Conversão (Conversion Anchor Bar abaixo dos 3 cards):**
  - Card horizontal `rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-[#07111A] via-[#0A1320] to-[#07111A] p-6 sm:p-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6`:
  - Esquerda:
    - Eyebrow/Tag: `READY IN 60 SECONDS · NO CREDIT CARD REQUIRED`
    - Título: `Deploy Torex AI & your 3 Guardian Agents on your real trade history.`
    - Prova rápida em 3 bullets horizontais (`MT5 & Deriv Auto-Sync`, `Prop Firm DD Protection`, `Grounded in Your Actual R-Multiples`).
  - Direita:
    - CTA Primário (`Link to="/register"`): `Start Free with Torex AI` (`bg-accent text-accent-on rounded-full px-7 py-3.5 font-extrabold shadow-glow`)
    - CTA Secundário (`Link to="/pricing"`): `Compare Plans`

### 4. REQUISITOS TÉCNICOS DE QUALIDADE & PERFORMANCE
- **Zero dependências novas:** usar apenas `react`, `react-router-dom`, `framer-motion` (`useReducedMotion`, `motion.div` com `viewport={{ once: true, amount: 0.15 }}`), `lucide-react`, e `cn` (`../../lib/cn`).
- **Acessibilidade (a11y):** `role="tablist"` / `role="tab"` / `aria-selected` nos seletores de cenário; `aria-live="polite"` na área de mensagens do chat mock e nas respostas dos agentes; contraste mínimo WCAG AA; foco visível `focus-visible:ring-2 focus-visible:ring-accent/60`.
- **Segurança & Isolamento:** Componente 100% client-side, zero chamadas de API autenticadas na landing pública (não disparar `api.get('/dashboard/trades')` ou `/ai/*` sem sessão!).
- **Limpeza de Timers:** Limpar todos `setTimeout` e `setInterval` (typewriter, staged spinner, cooldown timer) no `useEffect` cleanup para evitar memory leaks.
- **Verificação Pós-Implementação:** Rodar `cd client && npx tsc --noEmit && npm run build` e validar layout em desktop (`1440px`), tablet (`768px`) e mobile (`375px`).
```

---

## 4. Biblioteca Completa de Mocks de Conversas (Prontos para `torexAiLandingMocks.ts`)

Abaixo estão os **4 diálogos multi-turno** estruturados exatamente segundo o schema do Torex AI (`ClientAiMessage`, `ClientAiMetricCard`, `ClientAiActionLink`), prontos para serem copiados no arquivo de dados do mock.

### Cenário 1: `revenge-leak` — *Revenge Trading & Tilt Recovery* (Default)
- **Tab Label:** `Revenge Leak`
- **Linked Pattern ID:** `behavior`
- **Account Context:** `FTMO 100K · MT5 #88412 · 1,248 trades`
- **Turno 1 (User):**
  > `"Why did I lose money last week?"`
- **Turno 2 (Torex AI):**
  - **Content:**
    > `"You took **4 revenge trades** within **3 minutes** of a stop-out on **XAU/USD** and **NAS100**. Each averaged **-$420**. That's **73% of last week's losses**, all from the same post-loss behavior pattern."`
  - **Grounding Meta:** `Based on 23 trades · Mon – Fri · NY Session`
  - **Metrics:**
    - `{ label: 'Revenge Cost', value: '-$1,680', tone: 'negative', subtext: '4 trades < 3m post-SL' }`
    - `{ label: 'Share of Loss', value: '73%', tone: 'negative', subtext: 'of weekly drawdown' }`
    - `{ label: 'Plan Trades P&L', value: '+$1,140', tone: 'positive', subtext: '19 disciplined trades' }`
  - **Actions:**
    - `{ label: 'Review 4 Revenge Trades', route: '/register?intent=trades-revenge' }`
- **Turno 3 (User — visível por padrão ou acionável pelo follow-up pill):**
  > `"What should I do about it?"`
- **Turno 4 (Torex AI):**
  - **Content:**
    > `"Set a **15-min cool-down rule** after any **-1R** loss and enable the **Risk Management Agent** daily cap at **-2.5%**. Torex traders with similar post-loss cadence who added this rule cut their monthly drawdown by **38% on average**."`
  - **Grounding Meta:** `Recommended Guardrail · Risk Agent + Journal Rule`
  - **Actions:**
    - `{ label: 'Activate 15m Cool-Down Rule', route: '/register?intent=risk-agent' }`
    - `{ label: 'Open Daily Journal', route: '/register?intent=journal' }`
  - **Suggestions:**
    - `"Which setup gives me the highest Profit Factor?"`
    - `"Audit my FTMO Phase 2 drawdown risk"`

### Cenário 2: `best-edge` — *Edge Discovery & Session Filtering*
- **Tab Label:** `Best Edge`
- **Linked Pattern ID:** `edge` / `time-of-day`
- **Account Context:** `IC Markets Live · MT5 #41902 · 842 trades`
- **Turno 1 (User):**
  > `"Which setup holds my highest edge and when am I leaking?"`
- **Turno 2 (Torex AI):**
  - **Content:**
    > `"Your **London Liquidity Sweep** and **NY Opening-Range Breakout (NQ)** generate **118% of your net profit** (**+2.46R avg**, **2.34 Profit Factor**). However, entries placed after **14:30 UTC** lose **62% of the time** and leaked **-$2,890** this month."`
  - **Grounding Meta:** `Based on 148 tagged setups · Last 90 days`
  - **Metrics:**
    - `{ label: 'Top Setup PF', value: '2.34', tone: 'positive', subtext: 'London Sweep + NQ ORB' }`
    - `{ label: 'Avg Winner', value: '+2.46R', tone: 'positive', subtext: '68.4% session WR' }`
    - `{ label: 'Post-14:30 UTC', value: '-$2,890', tone: 'negative', subtext: '62% loss rate' }`
  - **Actions:**
    - `{ label: 'Inspect Edge Matrix', route: '/register?intent=analytics' }`
- **Turno 3 (User):**
  > `"What happens if I cut all trades after 14:30 UTC?"`
- **Turno 4 (Torex AI):**
  - **Content:**
    > `"Simulated expectancy jumps from **+0.41R** to **+0.89R per trade**, lifting your 90-day Net P&L from **+$19,752** to **+$22,642** with **24% lower equity volatility**."`
  - **Grounding Meta:** `Counterfactual Replay · 148 → 109 trades`
  - **Actions:**
    - `{ label: 'Replay London–NY Window', route: '/register?intent=backtesting' }`
  - **Suggestions:**
    - `"Why did I lose money last week?"`
    - `"Check my Tuesday winning streak"`

### Cenário 3: `prop-firm` — *Prop Firm Drawdown & Lot Sizing*
- **Tab Label:** `Prop Firm DD`
- **Linked Pattern ID:** `streak`
- **Account Context:** `FTMO 100K Challenge · Phase 2 · Day 11`
- **Turno 1 (User):**
  > `"Am I on pace to pass my 100K challenge without hitting daily DD?"`
- **Turno 2 (Torex AI):**
  - **Content:**
    > `"Current equity is **+$3,840 (+3.84%)** toward your **5% (+$5,000)** target. Your **Tuesday AM session** is on an **8-trade win streak**, but Friday lot sizing jumped **1.8x** above plan — raising daily DD breach risk to **19%**."`
  - **Grounding Meta:** `Prop Firm Telemetry · Max Daily Loss: 5.0%`
  - **Metrics:**
    - `{ label: 'Target Progress', value: '76.8%', tone: 'positive', subtext: '+$3,840 / +$5,000' }`
    - `{ label: 'Max Lot Drift', value: '1.8x', tone: 'negative', subtext: 'Friday afternoon spike' }`
    - `{ label: 'Win Streak', value: '8 in a row', tone: 'positive', subtext: 'Tuesday 08:30–11:00' }`
  - **Actions:**
    - `{ label: 'Lock 0.5% Risk Guardrail', route: '/register?intent=prop-guardrail' }`
- **Turno 3 (User):**
  > `"Calculate safe lot size to finish the last +1.16% safely."`
- **Turno 4 (Torex AI):**
  - **Content:**
    > `"Cap risk at **0.40% ($400) per setup** exclusively during **08:00–12:30 UTC**. At your current **+2.1R** expectancy, **2 A+ setups** complete the challenge with **<1.2% peak drawdown probability**."`
  - **Grounding Meta:** `Monte Carlo Guardrail · 1,000 runs`
  - **Suggestions:**
    - `"Review my pre-market ritual score"`
    - `"Why did I lose money last week?"`

### Cenário 4: `plan-audit` — *Journal Plan Compliance & MFE/MAE*
- **Tab Label:** `Plan Audit`
- **Linked Pattern ID:** `time-of-day`
- **Account Context:** `Deriv Synthetic + FX · 410 trades`
- **Turno 1 (User):**
  > `"Am I following my trading plan and leaving money on the table?"`
- **Turno 2 (Torex AI):**
  - **Content:**
    > `"Plan adherence is **81%**, but **MFE/MAE analysis** shows you exit **XAU/USD** winners early at **+1.3R** when your average **MFE reaches +2.9R**. Meanwhile, pre-market plan skips on **3 of 5 days** correlate with **-64% lower Win Rate**."`
  - **Grounding Meta:** `Journal & MFE/MAE Correlation · 64 trades`
  - **Metrics:**
    - `{ label: 'Plan Compliance', value: '81%', tone: 'neutral', subtext: '3 skipped prep days' }`
    - `{ label: 'Captured vs MFE', value: '1.3R / 2.9R', tone: 'negative', subtext: 'Early exit leak' }`
  - **Actions:**
    - `{ label: 'Open Trade Notes & MFE', route: '/register?intent=journal-mfe' }`
  - **Suggestions:**
    - `"Enable Habit Agent pre-market lock"`
    - `"Which setup holds my highest edge?"`

---

## 5. Engenharia de Alta Conversão (CRO) — Onde Posicionar & Como Converter

### Posicionamento Recomendado no Fluxo de `LandingEn.tsx`
Ordem ideal de narrativa psicológica na `/en`:
1. `HeroEnSection` (Promessa central: *Master Your Trading. Command Your Edge.*)
2. `CorePillarsEnSection` (Os 3 pilares: Torex AI, Training, Journal)
3. `BrokerIntegrationsEnSection` (Confiança técnica: *80+ Integrations* — MT5, Deriv, Prop Firms)
4. `AiDecodeDashboardEnSection` (Prova visual macro: *50% Dashboard + Floating Insight*)
5. `AllInOneSuiteEnSection` (Tour pelas abas do workspace)
6. `AiBacktestingScrollEnSection` (Clímax visual com scroll-reveal do Replay Simulator)
7. **`TorexAiAgentsEnSection` ← NOVA SECÇÃO AQUI** *(Aprofundamento prático & prova interativa: o visitante conversa com os dados, descobre os leaks ocultos e aciona os 3 Agentes que protegem seu capital)*
8. *(Próximo passo sugerido)* `Pricing / Final Conversion CTA + Footer`

### 5 Gatilhos de Alta Conversão Embutidos no Design
1. **Especificidade Quantitativa Real:** Em vez de *"AI helps you trade better"*, os mocks exibem métricas concretas (`4 revenge trades < 3m`, `-$420 avg`, `73% of weekly loss`, `62% loss rate after 14:30 UTC`, `+2.46R`, `-38% drawdown`). Isso gera credibilidade imediata junto de traders experientes.
2. **Interatividade Sem Fricção ("Try Before Signup"):** O visitante pode trocar cenários, clicar nos 4 cards de *Pattern Detection*, escrever uma pergunta no input real do **Torex AI Messenger** e clicar nos botões de resposta dos **3 Agentes** (vendo o timer de cool-down rodar ou o bloqueio de risco armar em tempo real). O usuário sente o produto funcionando antes de criar conta.
3. **Micro-Compromisso nos Agentes:** Clicar em `"Yes, lock me out until 08:45"`, `"Halve size for the rest of the session"` ou `"Start the timer"` faz o visitante *experienciar o alívio* de ter guardrails automáticos — aumentando dramaticamente o clique no CTA seguinte (`Deploy Torex AI & your 3 Guardian Agents`).
4. **Cross-Linking Inteligente Pattern → Chat:** Clicar num padrão de perda à direita (`BEHAVIOR: Revenge trades cost $6,420`) atualiza o chat à esquerda instantaneamente, demonstrando conexão real entre telemetria e diagnóstico conversacional.
5. **Dual-Intent CTAs Contextuais:** Todo turno de resposta no Messenger termina com action pills com cara de produto real (`/journal`, `/trades`, `/backtesting`) que levam ao `/register?intent=...`, capturando intenção segmentada (seja o trader interessado em *Revenge Control*, *Prop Firm DD* ou *Backtesting*).

---

## 6. Estrutura de Dados TypeScript Sugerida (`torexAiLandingMocks.ts`)

```ts
import type { ClientAiActionLink, ClientAiMetricCard } from '../ai/torexAiFallback';

export type MockScenarioId = 'revenge-leak' | 'best-edge' | 'prop-firm' | 'plan-audit';
export type PatternSignalId = 'time-of-day' | 'behavior' | 'edge' | 'streak';
export type AgentCardId = 'habit' | 'risk' | 'sentiment';

export interface MockChatTurn {
    id: string;
    role: 'user' | 'assistant';
    content: string; // suporta **bold** e tokens inline em font-mono
    groundingMeta?: string;
    metrics?: ClientAiMetricCard[];
    actions?: ClientAiActionLink[];
    suggestions?: string[];
}

export interface MockConversationScenario {
    id: MockScenarioId;
    tabLabel: string;
    linkedPatternId: PatternSignalId;
    accountLabel: string;
    turns: MockChatTurn[];
}

export interface PatternSignalItem {
    id: PatternSignalId;
    category: 'TIME-OF-DAY' | 'BEHAVIOR' | 'EDGE' | 'STREAK';
    tone: 'blue' | 'violet' | 'amber' | 'emerald';
    headline: string;
    metricBadge: string;
    linkedScenarioId: MockScenarioId;
}

export interface AutonomousAgentMock {
    id: AgentCardId;
    eyebrow: string;
    badge: string;
    tone: 'sky' | 'blue' | 'violet';
    title: string;
    description: string;
    agentMessages: [string, string];
    userTriggerLabel: string;
    confirmedReply: string;
    idleStatusLabel: string;
    armedStatusLabel: string;
    hasCountdownTimer?: boolean;
}
```

---

## 7. Checklist de Aceite & QA Técnico

- [ ] **Identidade Torex 100% consistente:** Avatar circular com `BRAND.logoUrl`, paleta `#02040A` / `#070B14` / `emerald-400` / `accent`, zero menções a marcas terceiras.
- [ ] **Fidelidade ao `TorexAi.tsx`:** Bolha do usuário verde esmeralda à direita com avatar de iniciais; bolha da IA à esquerda com avatar Torex, `**bold**` renderizado, `ClientAiMetricCard`s, `ClientAiActionLink`s com `ArrowUpRight`, `suggestions` clicáveis, staged spinner com pontos progressivos e input pill inferior funcional.
- [ ] **Sincronização Pattern Detection ↔ Messenger:** Clicar em qualquer um dos 4 cards de `Pattern Detection` seleciona o cenário correspondente no Messenger com feedback visual claro.
- [ ] **Interatividade dos 3 Agentes:** Cada card de agente responde ao clique na bolha do usuário (ex.: Habit arma bloqueio, Risk ativa `0.5x LOT CAP`, Sentiment inicia cronómetro regressivo `14:59` ao vivo).
- [ ] **Prompt Customizado no Input:** Enviar texto livre no composer do Messenger executa o staged spinner + resposta simulada contextual com CTA para `/register`.
- [ ] **Acessibilidade & Reduced Motion:** `useReducedMotion()` desativa animações de entrada/typewriter quando o usuário prefere movimento reduzido; `aria-live="polite"` no chat; `tab` semantics corretas.
- [ ] **Build Limpo:** `cd client && npx tsc --noEmit && npm run build` passa com zero erros e zero warnings novos.
