# Fase 3 (Médio Prazo) — Brokers (MT5/Deriv), Core de IA, Economia de Tokens & Offline Sync / Replay

> Especificação estruturada e plano técnico consolidado para estabilização de integrações de corretoras, confiabilidade do Torex AI, economia de tokens estilo Caveman, notificações em background e resiliência de sincronização offline/replay.

---

## 1. Pilar Brokers & Importação de Relatórios

### 1.1 MT5 TCP Server (`backend-nest/src/mt5-tcp.server.ts`)
- **Parser Protobuf Wire-Format Completo:**
  - Substituída a leitura simplista de 1 byte por decodificador Base-128 **Varint** (`readProtobufVarint`), suportando payloads JSON de qualquer dimensão (>127 bytes e >100 KB sem corrupção).
  - Adicionado `skipProtobufField` (wire types `0` Varint, `1` 64-bit, `2` Length-delimited, `5` 32-bit) para navegar sequencialmente até `fieldNum = 2+` (corrigindo a falha onde `MARKET DATA` retornava `null` após `fieldNum = 1`).
- **Roteamento Unificado para Redis Streams:**
  - `msgId = 3` (`stream:mt5_market_data`): agora inclui `token`, `userId`, `accountId` e `symbol` de forma consistente.
  - `msgId = 4` (`stream:mt5_trade_data`): normaliza objeto único para `[trade]` e publica `userId`, `accountId` e `token`.

### 1.2 Deriv Client & Multi-Conta (`deriv.client.ts`, `deriv.service.ts`, `deriv.controller.ts`)
- **Multi-Conta Isolada por `${userId}:${derivAccountId}` (`connKey`):**
  - Clientes WebSocket (`clients`), subscrições RxJS (`subscriptions`), mapeamentos (`accountIds`) e fila de enriquecimento usam `connKey`, permitindo múltiplas contas Deriv simultâneas (Real + Demo) sem sobrescrita ou desconexão cruzada.
  - Endpoints `GET /integrations/deriv/status`, `POST /integrations/deriv/sync` e `DELETE /integrations/deriv/disconnect` aceitam `?accountId` / header `x-account-id`.
- **Reconexão Resiliente (`DerivClient`):**
  - URL OTP de uso único volta automaticamente ao gateway padrão (`wss://ws.binaryws.com/websockets/v3`) em reconexões.
  - Backoff exponencial com jitter (até 30s) + watchdog de inatividade (`75s`) contra sockets *half-open* + limpeza determinística de timers no `disconnect()`.

### 1.3 Parser de Relatórios & Segurança (`backend-nest/src/import/report-parser.service.ts`)
- **Proteção Anti-Zip-Bomb (.xlsx e .pdf):**
  - Limites rígidos de entradas ZIP (`MAX_ZIP_ENTRIES = 64`), tamanho máximo por entrada (`15 MB`), volume total acumulado (`25 MB`), taxa máxima de compressão (`120x`), streams PDF (`200`) e proteção contra *path traversal* (`..` / `/`).
  - Passagem obrigatória de `maxOutputLength` para `zlib.inflateRawSync` e `zlib.inflateSync` com propagação imediata de erros Zip-Bomb.
- **Normalização Segura de Tickers (`normalizeBrokerSymbol`):**
  - Remove apenas sufixos explícitos de corretoras (`.ecn`, `_pro`, `.x`, `XAUUSDm` para pares/metais de 6 letras), preservando intactos tickers legítimos terminados em `M` ou `PRO` (`IBM`, `XOM`, `3M`, `US30M`, `PLATINUM`, `ETHEREUM`, `GPRO`).

---

## 2. Pilar Core de IA (Gemini 2.5, Segurança de Chave, Créditos & Escopo)

- **Modelos Válidos & Segurança de API Key:**
  - Atualizado para `gemini-2.5-flash` e `gemini-2.5-flash-lite` em `AiLlmProviderService`, `AiService` e `PushCopyAiService`.
  - Eliminado `?key=` da query string; todas as chamadas HTTP enviam a chave exclusivamente via header `x-goog-api-key`.
- **Reserva Atómica de Créditos (`AiCreditsService` & `TorexAiChatService`):**
  - Implementado `reserveCredits(userId, holdAmount)` (`UPDATE ... WHERE credits_remaining > 0 RETURNING ...`) no início do processamento para impedir corrida paralela, e `settleReservedCredits(userId, reserved, finalCost)` para liquidar diferença ou reembolsar integralmente em `BLOCK_GUARDRAIL`, `CLARIFY_USER`, `ZERO_DATA`, cache hit ou falha do provedor LLM.
- **Escopo por Conta na Memória Semântica (`AiSemanticMemoryService`):**
  - Normalização `normalizeAccountScope` e isolamento estrito por `(owner_scope = userId, account_id)` nas consultas SQL (`COALESCE(account_id, '__ALL__')`) e filtros em memória + novo método `upsertUserPrivateMemory`, impedindo vazamento de respostas privadas entre Conta A, Conta B e consolidado.

---

## 3. Pilar Economia de Tokens (Caveman Engine)

- **Compressor `backend-nest/src/ai/ai-caveman-compressor.ts` (baseado em [`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman.git)):**
  - Compactação telegráfica de prompts do sistema (`AiPromptSystemService` e `AiRouterService`), minificação de payloads JSON SQL/RAG (`cavemanCompactPayload` removendo nulos, vazios, sentinelas verbosas e indentação) e compressão de histórico conversacional (`cavemanCompressHistory`), **preservando 100% dos números, moedas, percentagens, tickers e rotas** para validação matemática em `checkNumericGrounding`.
  - Telemetria `cavemanTokensSaved` registada na metadata da resposta em `AiChatMessageEntity`.

---

## 4. Pilar Experiência Torex AI, Fallback Estrito & Web Push em Background

- **Fim da Resposta Genérica Precoce:**
  - Correção dos modelos Gemini 404 que derrubavam a chamada LLM em ~120ms para o template determinístico genérico.
  - Ampliação da classificação analítica em `inspectAndClassifyInput` + 1 retry automático em oscilação transitória de rede no Gemini Analyst; fallback determinístico/suporte fica restrito apenas a cenários sem provedor configurado ou após falha real de comunicação.
- **Resposta Executiva Estruturada:**
  - Prompt instrui formato claro em 3 blocos (**Diagnóstico Direto** + **2 a 3 Bullets Estruturados** + **Próximo Passo**) acompanhado de **KPI Metric Cards** auditados (`P&L Líquido`, `Win Rate`, `Payoff / Profit Factor`, `Cobertura Diário`) gerados em `buildStructuredMetricCards`.
- **Spinner Orbital na Logo Torex + Transcritor em Tempo Real (`client/src/pages/TorexAi.tsx`):**
  - Logo oficial da Torex com duplo anel orbital rotativo durante o processamento.
  - Componente **Transcritor** exibindo leitura progressiva palavra a palavra da questão do utilizador com realce automático de sinais detetados (conta ativa, ticker, janela temporal e foco analítico).
- **Web Push ao Sair da Tela (`away` Presence Tracking):**
  - `TorexAi.tsx` reporta visibilidade/saída de rota via `?visible=0|1` no polling e `POST /ai/chat/jobs/:jobId/presence` (incluindo `fetch(..., { keepalive: true })` ao desmontar).
  - `TorexAiChatService` emite evento `ai.reply.ready_away` se o job terminar com o utilizador fora da tela, e `PushProducerService` dispara uma Web Push **Zero-Sensitive-Data** com deep-link direto para `/torex-ai/${sessionId}?from=push_ai_reply`.

---

## 5. Pilar Offline Sync & Replay Terminal (Eliminação de Leaks)

- **Replay Sync (`client/src/services/historicalBatchCache.ts`):**
  - Normalização de `accountId`, header `x-account-id`, leitura resiliente de `/dashboard/trades` (suportando array direto, cache offline `{ items }` e `{ data/trades }`) e limite máximo `MAX_SESSION_SYNC_ATTEMPTS = 8` na outbox.
- **Sync Engine Hardening (`client/src/services/syncEngine.ts` & `client/src/api.ts`):**
  - Sincronização multi-aba coordenada via Web Locks API (`navigator.locks.request('torex_offline_sync_lock', { ifAvailable: true })`).
  - Preservação explícita de `x-account-id` em uploads de mídia e mutações enfileiradas (sem herança acidental do `localStorage` no interceptor quando `_isSyncEngineRequest` está ativo) e teto `MAX_SYNC_RETRY_ATTEMPTS = 8`.
- **Eliminação de Leaks no Terminal Replay (`klineDatafeed.ts`, `KLineChartProTerminal.tsx`, `useMultiPaneCharts.ts`, `backtestContracts.ts`):**
  - Método `CustomKLineDatafeed.dispose()` abortando loops de prefetch, fechando WebSocket Binance com limpeza de handlers (`onopen/onmessage/onerror/onclose = null`) e libertando cache OHLCV.
  - Cancelamento explícito de `requestAnimationFrame` (`rafCrosshairRef`, `resizeRaf`, `auxResizeRaf`) e timers (`screenshotCloseTimerRef`) ao desmontar.
  - Alinhamento de contratos Zod (`mfe`/`mae` `null` preservado) e atualização da suíte `client/tests/backtestContracts.spec.ts`.

---

## 6. Matriz de Verificação

- [x] Backend `tsc --noEmit` (`npx tsc -p backend-nest/tsconfig.json --noEmit`)
- [x] Backend Jest (Fase 3 + IA Orchestration + Learning Security + Growth/PWA)
- [x] Frontend Unit Tests (`npm --prefix client run test:unit`)
- [x] Frontend Production Build (`npm --prefix client run build`)
