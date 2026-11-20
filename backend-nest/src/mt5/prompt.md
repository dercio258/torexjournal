# Arquitetura de Load Balancer, Gestão de Ciclo de Vida e Monitoramento Contínuo MT5

Este documento descreve a arquitetura oficial implementada no backend NestJS (`mt5/`) e no motor Windows Python (`mt5-server/`) para distribuir contas MT5 entre múltiplos servidores Windows com isolamento, alta disponibilidade e gestão automática de recursos.

---

## 1. Algoritmo Pair-Stride ($K=2$) de Balanceamento de Carga

Configurável via variável de ambiente `MT5_LB_STRIDE=2` (padrão: `2`), o `Mt5ClusterBalancerService` (`backend-nest/src/mt5/worker/mt5-cluster-balancer.service.ts`) distribui as conexões em pares determinísticos entre os Workers/VPS saudáveis:

- Contas **1 e 2** -> **VPS Windows 1** (`worker-01`)
- Contas **3 e 4** -> **VPS Windows 2** (`worker-02`)
- Contas **5 e 6** -> **VPS Windows 1** (`worker-01`) *(ou VPS 3 se presente, voltando em ciclos de 2)*
- Contas **7 e 8** -> **VPS Windows 2** (`worker-02`)

### Regras de Elegibilidade & Proteção de Hardware
Um Worker só recebe novas contas quando satisfaz simultaneamente:
1. `isOnline === true` (`último heartbeat < 45s`).
2. `!isDraining` (não marcado para manutenção via Admin API).
3. `assignedAccountsCount < capacity` (teto configurável por VPS via `MAX_ACCOUNTS`).
4. Folga de hardware: `cpuPercent < 90%`, `memoryPercent < 88%` e `memoryAvailableMb >= 200 MB`.
5. **Auto-cura de Pares:** quando uma conta desconecta numa VPS, o próximo utilizador preenche primeiro o par incompleto daquela VPS antes de avançar para o próximo ciclo.

---

## 2. Roteamento Direcionado, Lease Epoch & Anti Split-Brain

- **Afinidade Persistente (`AccountEntity.assignedWorkerId`):** toda tarefa de conexão, sincronização ou desconexão carrega `targetWorkerId` e `mt5LeaseEpoch`.
- **Isolamento de Polling (`GET /api/v1/mt5-worker/tasks`):** cada worker envia `X-Worker-Id` e recebe **exclusivamente** tarefas destinadas ao seu próprio nó (`!task.targetWorkerId || task.targetWorkerId === req.workerId`), eliminando disputas e roubos de fila entre VPSs.
- **Fencing Token em Syncs (`syncAccountMetrics`):** se um worker antigo que perdeu a posse da conta tentar enviar dados, o backend responde `409/rejected` com `{ message: "STALE_WORKER_LEASE", evict: true }`, e o próximo `/heartbeat` envia `evictLogins: [...]` para o `mt5-server` encerrar e remover o terminal local imediatamente (`_evict_account_by_login`).

---

## 3. Ciclo de Vida de Contas Sem Saldo (7 Dias + Aviso 24h + Manter Ativa)

Para otimizar memória RAM nos servidores sem interromper contas em uso:

1. **Monitoramento Contínuo (`zeroBalanceSince`):** quando uma conta conectada fica com saldo `0`, equity `0` e `0` posições abertas, inicia-se o contador `zero_balance_since`. Qualquer depósito ou saldo positivo limpa os marcadores instantaneamente.
2. **Aos 7 Dias Sem Saldo (`inactivityWarnedAt`):**
   - Agenda desconexão suave para **`+24 horas`** (`inactivity_disconnect_at`).
   - Dispara **Web Push** (`sendIdleAccountShutdownWarning`) e cria **notificação no painel**.
   - **Regra Obrigatória de Copy:** todas as notificações ao utilizador usam linguagem clara e humana (*"A conta X está sem saldo movimentado há 7 dias. Deseja manter a sincronização automática conectada?"*), **nunca** expondo termos internos como *servidor Windows*, *VPS*, *worker*, *login MT5*, *terminal64* ou *IPC*.
3. **Botão no Dashboard (`IdleAccountWarningBanner.tsx` -> `POST /api/mt5/cloud/keep-alive`):**
   - Exibe contagem regressiva em horas e botão **"Manter Sincronização Ativa"**, estendendo a permanência por mais 7 dias sem reiniciar a ligação.
4. **Expiração das 24 Horas:** se não houver saldo positivo nem confirmação do trader, o backend envia `STOP_ACCOUNT` ao worker proprietário, marca a conta como `COLD` (`isConnected = false`) e liberta totalmente a memória do terminal.

### Hibernação Local na VPS (`mt5-server`)
- Durante ciclos de verificação sob alta carga (`RAM >= 70%` ou `> 4` contas no mesmo worker), terminais ociosos com saldo `$0` e `0` posições são pausados após o check periódico e reabertos sob demanda quando necessário.

---

## 4. Monitoramento Contínuo, Supervisor Multi-Slot & Endpoints Admin

- **Supervisor Multi-Slot (`mt5-server/cluster_supervisor.py`):** definir `MT5_WORKER_SLOTS=2` (ou `N`) na VPS Windows inicia múltiplos sub-workers isolados com `DATA_DIR` próprios, multiplicando o paralelismo IPC com reinício automático em falhas.
- **Auto-Failover (Watchdog `@Interval(30_000)`):** se uma VPS deixar de responder por `> 90s`, o watchdog incrementa `mt5LeaseEpoch`, seleciona outro nó saudável, descriptografa a credencial protegida (`mt5_encrypted_pass` em AES-256-GCM) e reabre as contas no nó reserva sem pedir nova senha ao trader.
- **Endpoints Admin (`AdminAuthGuard`):**
  - `GET /api/admin/mt5-cluster/overview` — estado da frota, pares por worker, CPU/RAM/Disco, distribuição `HOT/WARM/COLD` e desconexões pendentes.
  - `POST /api/admin/mt5-cluster/workers/:workerId/drain` — ativa/desativa manutenção sem downtime migrando contas para outros workers.
  - `POST /api/admin/mt5-cluster/rebalance` — redistribui contas ociosas/estáveis respeitando o stride `K=2`.
