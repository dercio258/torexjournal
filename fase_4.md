# Fase 4 — Confiabilidade, Segurança P1, Offline Sync Hardening e Estratégia de Afiliados & Loops Virais

Este documento consolida todas as correções estruturais P1 (segurança, confiabilidade de filas/workers, isolamento multi-conta/sessão e economia de recursos) e a arquitetura completa do programa de Afiliados e Crescimento Viral da Torex Journal.

---

## 1. Automações, Filas, Notificações & Segurança de Sessão

- **Socket.IO Horizontal Scaling (`backend-nest/src/common/adapters/redis-io.adapter.ts` & `main.ts`):**
  - Substituído o adapter padrão em memória pelo `RedisIoAdapter` usando `@socket.io/redis-adapter` + `ioredis` com timeout de conexão e fallback gracioso caso Redis esteja indisponível.
  - Fila RabbitMQ padronizada em `process.env.RABBITMQ_QUEUE || 'platform_notifications'` (removida a fila legada `whatsapp_notifications`).
- **Isolamento de Worker Dedicado (`MT5_DEDICATED_SERVER`):**
  - `AppModule`, `Mt5Module`, `Mt5Service`, `Mt5WorkerService` e `NotificationsCronService` evitam carregar módulos pesados (`AdminModule`, `AiModule`, `TradingViewModule`, `EconomicCalendarModule`) e crons de push/calendário no container dedicado ao Terminal MT5.
  - `behavior-open` configurado com `removeOnFail: true` evitando congelamento por `jobId` duplicado.
- **Timezone & Pool PostgreSQL & Email & ML:**
  - `checkPendingJournals` corrigido para limites UTC consistentes (`setUTCDate` / `setUTCHours`).
  - Pool PostgreSQL configurado explicitamente (`DB_POOL_MAX ?? 25`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`).
  - `EmailService.resetTransporter()` protegido por cooldown de 15s e `.close()` diferido em 10s para não derrubar envios paralelos.
  - `BehaviorRetrainScheduler` com `maxBuffer: 16MB` e fallback HTTP remoto para `QUANT_ENGINE_URL` (`/api/ml/behavior/retrain`).
- **Autenticação, Loopback, Idempotência, Uploads & Privacidade:**
  - `isLoopbackRequest` (`security.config.ts`) valida exclusivamente o IP real do socket (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), eliminando bypass via header `Host: localhost`.
  - `OptionalJwtAuthGuard` revalida sessão ativa na tabela `sessions` e `users.is_blocked = false`.
  - `AuthService`: tokens de refresh assinados com expiração de 30 dias (`rt2.<expBase36>.<hex>`); desativação de 2FA exige senha **e** código TOTP/OTP válidos com rate-limit Redis (`5 / 900s`).
  - `NetworkGateway` e `NetworkService`: revalidação de sessão/plano/rate-limit (20 msg/60s) em cada evento WebSocket; posts com `visibility: 'private'` bloqueados em broadcasts, trending, curtidas, comentários e contagens públicas.
  - `IdempotencyInterceptor`: escopo anônimo isolado por hash do IP (`anon:<sha256>`) e sufixo por query string.
  - `AnalyticsService`: `metaCapiAccessToken` cifrado com `CryptoUtil` (`enc:v1:...`) e bloqueio de disparo Meta CAPI anônimo quando `!context?.userId`.
  - `FastifyFileInterceptor`: verificação streaming de tamanho por chunk (`413` antes de `Buffer.concat`) e validação estrita `allowedImageOnly: true` nos uploads do Diário e Backtest.

---

## 2. Trading Core, Brokers, ClickHouse, IA & Ranking Multi-Moeda

- **Isolamento MT5 & Roteamento TCP (`mt5-server` & `mt5-tcp.server.ts`):**
  - Diretórios de instância isolados por UUID da conta (`instances/acc_<account_uuid>`), remoção de fallbacks de `mt5.initialize()` / `mt5.login()` sem credenciais em falha de autenticação e remoção da isenção insegura por caminho `"program files"` em `_kill_stuck_terminals`.
  - `Mt5WorkerService` prioriza contas conectadas no mapa de login, evita atribuição prematura antes de `SYNCING_DATA`/`SUCCESS`, remove fallback para contas `DEMO` de clientes em `getSharedDemoFeedAccount` e oculta identificadores internos de não-proprietários.
  - `Mt5TcpServer` mantém índice secundário `accountToSocketId` mapeando `account.id` e `mt5Id` para `socketId`, resolvendo comandos do controller para o cliente correto.
- **Deriv WebSocket Reconnect:** `DerivClient.setReconnectUrlResolver` solicita novo URL autenticado via `getOtpWebSocketUrl` ao reconectar após queda ou expiração de OTP.
- **TradingView Replay Guard:** `TradingViewController` impõe limite estrito `earliestTs` para `PlanTier.FREE` sobre `?from=`, `?to=` e `?cursorTo=`.
- **Normalização Multi-Moeda USD (`DashboardService` & `LeaderboardService`):** Conversão consistente para USD (`USC`/`CENT` = `0.01`, `MZN` = `1/65`, `EUR` = `1.08`, `GBP` = `1.27`) e priorização de contas Reais/Prop sobre `DEMO` em visão consolidada.
- **Torex AI & Admin & ClickHouse:**
  - Memória `GLOBAL_SAFE` (`AiSemanticMemoryService`) protegida contra quarentena por voto único (requer quórum `>= 2` votos negativos ou queda de confiança).
  - `AdminIntelligenceService`: cache em memória de 30s com deduplicação in-flight e lotes controlados de queries.
  - `ClickHouseService`: limite de buffer de ticks (`5000` entradas) e substituição de `ALTER TABLE UPDATE` por padrão idempotente em `ReplacingMergeTree`.

---

## 3. Estratégia de Afiliados & Loops Virais

- **Regra 1 — Convite 1 Amigo Verificado:** libera **+50 créditos extras de IA por dia durante 30 dias** (`users.referral_ai_bonus_until` aplicado em `PlanPermissionService`).
- **Regra 2 — Marco de 3 Amigos Verificados:** recompensa de **\$10.00 USD** em créditos para ativar os próximos planos (`referralCreditsUsd` ou retido em `referralPendingCreditsUsd`):
  - **Garantia Anti-Fraude:** se o afiliado ainda não possuir assinatura paga ativa não-trial, os \$10.00 ficam retidos em `referralPendingCreditsUsd` e são liberados automaticamente em `unlockPendingCreditsOnPaidPlan()` assim que o afiliado ativar qualquer plano pago.
- **Resgate no Checkout (`Checkout.tsx` & `/subscription/redeem-credits`):**
  - Resgate 1-clique com 100% de créditos quando o saldo cobre o plano, ou desconto parcial via `useReferralCredits` no fluxo M-Pesa / e-Mola / Cartão, com atualização imediata de perfil (`refreshProfile()`) e polling limitado a 40 tentativas (2 min).
- **Loops Virais & Social Paywall:**
  - **Cards Partilháveis (`ShareablePerformanceCard.tsx`):** botão `"Partilhar Card"` em `Reports.tsx` e `Trades.tsx` (incluindo banner `"Aha!"` quando lucro líquido é positivo) gerando card `"Analisado na Torex · @username"` com link `?ref=CODE`.
  - **Social Paywall (`TorexAi.tsx`):** alerta contextual quando créditos restam `<= 20` ou `dailyLimit === 0` oferecendo `+50 créditos IA/dia` via convite de amigo.
  - **Desafio Mensal no Leaderboard (`Leaderboard.tsx` & `LeaderboardService.getMyRank`):** acompanha pré-requisitos (`>= 1` conta de corretora conectada e `>= 1` amigo convidado verificado via `challengeStatus`) para torneios e prêmios futuros, e injeta `?ref=` nos links partilhados.

---

## 4. Offline Sync, Proteção de Cache, XSS & Memória Frontend

- **Isolamento de Sessão & Conta (`AuthContext.tsx`, `AccountContext.tsx`, `Mt5EaSyncPage.tsx`):**
  - Limpeza completa de `torex_accounts_cache` no logout e troca de utilizador; descarte de respostas obsoletas em `refreshAccounts` quando o JWT muda em voo; remoção de token sintético `ea-...` e do modal falso de trial para assinantes `PRO`/`PREMIUM` (`Dashboard.tsx`, `DashboardEn.tsx`).
- **Sanitização HTML & Relatórios (`sanitizeHtml.ts`, `NoteWorkspaceEditor.tsx`, `documentExporter.ts`):**
  - Pré-limpeza com `DOMPurify` em ambiente browser mantendo parser determinístico Node para testes; sanitização de `text/html` colado e templates salvos; `escapeHtml` aplicado aos KPIs exportados.
- **Offline Outbox & Cofre Replay (`backtestSessionSnapshot.ts`, `historicalBatchCache.ts`, `syncEngine.ts`, `offlineDb.ts`, `api.ts`):**
  - Chaves de snapshot no `localStorage` e AES-GCM no `IndexedDB` particionadas por `userScope`.
  - Códigos `402`, `409` e `413` marcados como erros permanentes na outbox; Web Locks API (`torex_backtest_outbox_flush`) evitando corridas multi-aba; captura de `x-account-id` no momento do enqueue; proteção em `api.get` contra sobrescrita de dados locais quando existe mutação pendente na outbox.
- **Prevenção de Vazamentos de Memória & Listeners (`useReplaySessionStore.ts`, `useSessionSyncController.ts`, `BacktestReplaySessionPage.tsx`, `TorexAi.tsx`):**
  - Pilha Undo/Redo reduzida para `MAX_HISTORY_STACK = 25` sem imagens `data:image/` em base64 e limpa ao desmontar (`clearSessionMemory()`); remoção de disparo duplicado de rede no `flushLocal` de `useSessionSyncController`; aborto explícito de `SpeechRecognition` ao sair de `TorexAi.tsx`.

---

## 5. Matriz de Verificação

- [x] Backend TypeScript Check (`backend-nest/node_modules/.bin/tsc.cmd -p backend-nest/tsconfig.json --noEmit`)
- [x] Backend Jest Suites (Fases 1–4 + IA + Brokers + Segurança & Afiliados)
- [x] Frontend Unit Tests (`npm --prefix client run test:unit`)
- [x] Frontend Production Build (`npm --prefix client run build`)
