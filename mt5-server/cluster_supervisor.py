import os
import sys
import time
import signal
import subprocess
from pathlib import Path
from typing import Dict

BASE_DIR = Path(__file__).resolve().parent


def _resolve_python() -> str:
    venv_py = BASE_DIR / "venv" / "Scripts" / "python.exe"
    if venv_py.exists():
        return str(venv_py)
    return sys.executable


def main():
    """
    Supervisor Multi-Slot para Windows VPS:
    Permite rodar N sub-workers isolados na mesma máquina (ex.: MT5_WORKER_SLOTS=2)
    multiplicando a vazão de IPC com MetaTrader5 mantendo isolamento de DATA_DIR e WORKER_ID.
    """
    slots = max(1, int(os.environ.get("MT5_WORKER_SLOTS", "1") or "1"))
    base_worker_id = (os.environ.get("WORKER_ID") or "win-worker-01").strip()
    base_data_dir = Path(os.environ.get("DATA_DIR") or (BASE_DIR / "data")).resolve()
    python_exe = _resolve_python()
    main_script = str(BASE_DIR / "main.py")

    children: Dict[str, subprocess.Popen] = {}
    restarts: Dict[str, int] = {}
    running = True

    def _spawn(slot_index: int) -> subprocess.Popen:
        slot_id = base_worker_id if slots == 1 else f"{base_worker_id}-s{slot_index + 1}"
        slot_data = base_data_dir if slots == 1 else (base_data_dir / slot_id)
        slot_data.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["WORKER_ID"] = slot_id
        env["DATA_DIR"] = str(slot_data)
        print(f"[SUPERVISOR] Iniciando sub-worker {slot_id} (DATA_DIR={slot_data})")
        return subprocess.Popen([python_exe, main_script], cwd=str(BASE_DIR), env=env)

    def _shutdown(sig, frame):
        nonlocal running
        print(f"[SUPERVISOR] Encerrando cluster local ({sig})...")
        running = False
        for wid, proc in children.items():
            if proc.poll() is None:
                proc.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    for idx in range(slots):
        wid = base_worker_id if slots == 1 else f"{base_worker_id}-s{idx + 1}"
        children[wid] = _spawn(idx)
        restarts[wid] = 0

    while running:
        time.sleep(3)
        for idx in range(slots):
            wid = base_worker_id if slots == 1 else f"{base_worker_id}-s{idx + 1}"
            proc = children.get(wid)
            if proc and proc.poll() is not None:
                restarts[wid] = restarts.get(wid, 0) + 1
                backoff = min(30, 2 * restarts[wid])
                print(f"[SUPERVISOR] Sub-worker {wid} encerrou (code={proc.returncode}). Reiniciando em {backoff}s...")
                time.sleep(backoff)
                if running:
                    children[wid] = _spawn(idx)


if __name__ == "__main__":
    main()
