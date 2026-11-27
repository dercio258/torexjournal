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

import shutil
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from loguru import logger
from config.settings import settings
from core.broker_discovery import (
    DEFAULT_PREWARM_BROKERS,
    auto_discover_brokers_in_mt5,
    build_broker_search_queries,
)
from core.process_manager import MT5ProcessManager


def main():
    raw_args = [a.strip() for a in sys.argv[1:] if a and a.strip()]
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

    best_existing = pm.find_best_servers_dat(base_dir=base_exe.parent, exclude_dir=prewarm_dir)
    if best_existing and best_existing.is_file():
        dst = prewarm_cfg / "servers.dat"
        if not dst.exists() or best_existing.stat().st_size > dst.stat().st_size:
            shutil.copy2(str(best_existing), str(dst))

    master_dst = Path(settings.data_dir).resolve() / "master_servers.dat"
    logger.info(f"Iniciando pré-aquecimento de {len(queries)} corretoras/prop firms para {master_dst}...")

    res = auto_discover_brokers_in_mt5(
        terminal_exe=str(prewarm_exe),
        queries=queries,
        portable=True,
        master_servers_dst=master_dst,
        main_mt5_exe=str(base_exe),
        per_query_timeout_sec=5.5,
        stop_on_first_growth=False,
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
