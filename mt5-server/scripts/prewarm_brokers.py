r"""
Pré-aquecimento automático em lote do cache `servers.dat` do MetaTrader 5 em qualquer VPS Windows.

Uso (na pasta mt5-server):
  .\venv\Scripts\python.exe scripts\prewarm_brokers.py
  .\venv\Scripts\python.exe scripts\prewarm_brokers.py Exness "Goat Funded" Deriv FTMO

O script abre uma instância portátil temporária do MT5, consulta automaticamente todas as corretoras
no diretório oficial da MetaQuotes via Win32 e salva o arquivo completo em:
  - data/master_servers.dat (sincronizado automaticamente para todas as contas em instances/acc_*)
  - %APPDATA%\MetaQuotes\Terminal\<HASH_PRINCIPAL>\config\servers.dat
"""

import argparse
import shutil
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import psutil
from loguru import logger
from config.settings import settings
from core.broker_discovery import (
    DEFAULT_PREWARM_BROKERS,
    auto_discover_brokers_in_mt5,
    build_broker_search_queries,
)
from core.process_manager import MT5ProcessManager


def _warn_if_worker_running() -> None:
    """Avisa se main.py estiver rodando em paralelo na VPS (pode disputar RAM/CPU numa VPS de 2GB)."""
    try:
        for p in psutil.process_iter(["pid", "name", "cmdline"]):
            name = (p.info.get("name") or "").lower()
            if "python" not in name:
                continue
            cmd = " ".join(p.info.get("cmdline") or []).lower()
            if "main.py" in cmd and "prewarm" not in cmd:
                logger.warning(
                    f"[PREWARM] Detectado worker main.py em execução (PID={p.info['pid']}). "
                    "Em VPS de 2 GB RAM, recomenda-se pausar o main.py temporariamente durante o pré-aquecimento "
                    "para evitar competição de memória/CPU com o MT5."
                )
                break
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(
        description="Pré-aquece data/master_servers.dat do MT5 consultando corretoras no diretório oficial MetaQuotes."
    )
    parser.add_argument(
        "brokers",
        nargs="*",
        help="Corretoras/servidores específicos (vazio = lista padrão de 42+ corretoras/prop firms).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="Timeout máximo em segundos aguardando a janela do MT5 abrir (padrão: 120s).",
    )
    parser.add_argument(
        "--query-timeout",
        type=float,
        default=5.0,
        help="Timeout por corretora em segundos (padrão: 5.0s; 1ª corretora usa mínimo de 10s).",
    )
    args = parser.parse_args()

    raw_args = [a.strip() for a in (args.brokers or []) if a and a.strip()]
    if raw_args:
        queries = []
        seen = set()
        for arg in raw_args:
            for q in build_broker_search_queries(arg):
                if q.lower() not in seen:
                    seen.add(q.lower())
                    queries.append(q)
    else:
        queries = list(DEFAULT_PREWARM_BROKERS)

    _warn_if_worker_running()

    pm = MT5ProcessManager()
    base_exe = Path(settings.mt5_default_path).resolve()
    if not base_exe.is_file():
        logger.error(f"Executável MT5 não encontrado em {base_exe}. Ajuste MT5_DEFAULT_PATH no .env.")
        sys.exit(1)

    prewarm_dir = (Path(settings.instances_dir).resolve() / "_prewarm_servers").resolve()
    prewarm_cfg = prewarm_dir / "config"
    prewarm_cfg.mkdir(parents=True, exist_ok=True)
    prewarm_exe = prewarm_dir / "terminal64.exe"
    if not prewarm_exe.exists() or prewarm_exe.stat().st_size != base_exe.stat().st_size:
        shutil.copy2(str(base_exe), str(prewarm_exe))

    master_dst = Path(settings.data_dir).resolve() / "master_servers.dat"
    best_existing = pm.find_best_servers_dat(base_dir=base_exe.parent, exclude_dir=prewarm_dir)
    if best_existing and best_existing.is_file():
        dst = prewarm_cfg / "servers.dat"
        if not dst.exists() or best_existing.stat().st_size > dst.stat().st_size:
            shutil.copy2(str(best_existing), str(dst))
        # Já garante a cópia do maior servers.dat atual em data/master_servers.dat
        master_dst.parent.mkdir(parents=True, exist_ok=True)
        if not master_dst.exists() or best_existing.stat().st_size > master_dst.stat().st_size:
            shutil.copy2(str(best_existing), str(master_dst))
            logger.info(
                f"Cache existente promovido previamente ({round(best_existing.stat().st_size / 1024, 1)} KB) -> {master_dst}"
            )

    logger.info(f"Iniciando pré-aquecimento de {len(queries)} corretoras/prop firms para {master_dst}...")

    res = auto_discover_brokers_in_mt5(
        terminal_exe=str(prewarm_exe),
        queries=queries,
        portable=True,
        master_servers_dst=master_dst,
        main_mt5_exe=str(base_exe),
        per_query_timeout_sec=args.query_timeout,
        stop_on_first_growth=False,
        boot_timeout_sec=args.timeout,
        kill_other_terminals=True,
    )

    logger.info(
        f"Pré-aquecimento concluído: servers.dat {round(res['bytes_before']/1024, 1)} KB -> "
        f"{round(res['bytes_after']/1024, 1)} KB | Corretoras adicionadas: {len(res['matched_queries'])}"
    )
    if res.get("error"):
        logger.error(f"Aviso/Erro: {res['error']}")
        sys.exit(1)


if __name__ == "__main__":
    main()
