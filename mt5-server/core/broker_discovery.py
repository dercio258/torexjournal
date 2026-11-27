"""
Descoberta e registro automático de corretoras/servidores no cache `servers.dat` do MetaTrader 5.

No MT5, `mt5.initialize(server=...)` falha silenciosamente com `(-10005, 'IPC timeout')` sempre que o
servidor da corretora ainda não foi registrado em `config/servers.dat`. Como a MetaQuotes não expõe
flag CLI para baixar servidores, este módulo automatiza a busca nativa do próprio terminal
(`File -> Open an Account` via `WM_COMMAND 32919`, independente do idioma da GUI) para registrar
qualquer corretora sob demanda e promover o `servers.dat` enriquecido para `data/master_servers.dat`.
"""

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import psutil
from loguru import logger

# IDs fixos Win32 do terminal64.exe (independentes de idioma EN/PT/ES/RU)
WM_CLOSE = 0x0010
WM_COMMAND = 0x0111
WM_SETTEXT = 0x000C
BM_CLICK = 0x00F5
LVM_GETITEMCOUNT = 0x1004
BN_CLICKED = 0
SW_SHOWNOACTIVATE = 4
SW_SHOW = 5

CMD_OPEN_ACCOUNT = 32919
CTRL_SEARCH_EDIT = 10814
CTRL_FIND_BTN = 10815
CTRL_LISTVIEW = 10729

# Mapeamento explícito de prefixos de servidor -> nome da empresa no diretório MetaQuotes
KNOWN_BROKER_DIRECTORY_QUERIES: Dict[str, List[str]] = {
    "exness": ["Exness"],
    "exnesske": ["Exness"],
    "exnessza": ["Exness"],
    "exnesseu": ["Exness"],
    "exnessuk": ["Exness"],
    "deriv": ["Deriv"],
    "goatfunded": ["Goat Funded", "GoatFunded"],
    "goatfundedtrader": ["Goat Funded", "GoatFundedTrader"],
    "fivepercentonline": ["Five Percent Online", "Five Percent", "5ers"],
    "ftmo": ["FTMO"],
    "fundednext": ["FundedNext", "Funded Next"],
    "fundingpips": ["Funding Pips", "FundingPips"],
    "alphacapitalgroup": ["Alpha Capital Group", "ACG Markets"],
    "acgmarkets": ["ACG Markets", "Alpha Capital Group"],
    "maven": ["Maven Trading", "Maven"],
    "maventrade": ["Maven Trading", "MavenTrade"],
    "e8markets": ["E8 Markets", "E8 Funding"],
    "e8funding": ["E8 Funding", "E8 Markets"],
    "blueguardian": ["Blue Guardian", "BlueGuardian"],
    "fxify": ["FXIFY"],
    "fundedtradingplus": ["Funded Trading Plus"],
    "fttrading": ["FT Trading", "Funded Trading Plus"],
    "fortraders": ["For Traders", "ForTraders"],
    "fundingtraders": ["Funding Traders"],
    "fundingtradersgroup": ["Funding Traders"],
    "thefundedtrader": ["The Funded Trader"],
    "dnafunded": ["DNA Funded"],
    "oandaproptrader": ["OANDA"],
    "xmglobal": ["XM Global", "XM"],
    "xm.com": ["XM", "XM Global"],
    "xmmena": ["XM", "XM MENA"],
    "hfmarketsglobal": ["HF Markets", "HFM"],
    "hfmarketssv": ["HF Markets", "HFM"],
    "hfmarketssa": ["HF Markets", "HFM"],
    "hfmarketske": ["HF Markets", "HFM"],
    "icmarketssc": ["IC Markets", "Raw Trading"],
    "icmarketseu": ["IC Markets"],
    "icmarketsau": ["IC Markets"],
    "pepperstone": ["Pepperstone"],
    "vantageinternational": ["Vantage International", "Vantage"],
    "justmarkets": ["JustMarkets", "Just Markets"],
    "fbs": ["FBS"],
    "octafx": ["OctaFX", "Octa"],
    "octamarkets": ["Octa Markets", "Octa"],
    "tickmill": ["Tickmill"],
    "tickmilluk": ["Tickmill"],
    "roboforex": ["RoboForex"],
    "eightcap": ["Eightcap"],
    "fxgt": ["FXGT"],
    "puprime": ["PU Prime"],
    "dooprime": ["Doo Prime"],
    "dprimevu": ["Doo Prime", "DPrime"],
    "fusionmarkets": ["Fusion Markets"],
    "forextimefxtm": ["ForexTime", "FXTM"],
    "startrader": ["STARTRADER"],
    "startraderfinancial": ["STARTRADER"],
    "monetamarkets": ["Moneta Markets"],
    "activtrades": ["ActivTrades"],
    "activtradescorp": ["ActivTrades"],
    "equitibrokeragesc": ["Equiti"],
    "equitigroupltd": ["Equiti"],
    "mexatlantic": ["MEX Atlantic", "MultiBank"],
    "mexgroup": ["MEX Group", "MultiBank"],
    "atfx": ["ATFX"],
    "atfxgm": ["ATFX"],
    "alpari": ["Alpari"],
    "amarkets": ["AMarkets"],
    "infinoxlimited": ["Infinox"],
    "swissquote": ["Swissquote"],
    "swissquotebankeu": ["Swissquote"],
    "darwinex": ["Darwinex"],
    "globalprime": ["Global Prime"],
    "gomarkets": ["GO Markets"],
    "cptmarkets": ["CPT Markets"],
    "cptmarketsuklimited": ["CPT Markets"],
    "scopemarkets": ["Scope Markets"],
    "capitalpointtrading": ["Capital Point Trading"],
    "libertex": ["Libertex"],
    "instaforex": ["InstaForex"],
    "freshforex": ["FreshForex"],
    "nordfx": ["NordFX"],
    "cmtrading": ["CMTrading"],
    "bdswissglobal": ["BDSwiss"],
    "cfifinancial": ["CFI Financial"],
    "valetaxintl": ["Valetax"],
    "btgpactual": ["BTG Pactual"],
    "xpinvestimentos": ["XP Investimentos"],
}

# Lista curada de corretoras/prop firms populares para pré-aquecimento em lote (`scripts/prewarm_brokers.py`)
DEFAULT_PREWARM_BROKERS: List[str] = [
    "Exness",
    "Deriv",
    "Goat Funded",
    "FTMO",
    "FundedNext",
    "Funding Pips",
    "Five Percent Online",
    "XM Global",
    "HF Markets",
    "IC Markets",
    "Pepperstone",
    "Vantage International",
    "JustMarkets",
    "FBS",
    "Octa Markets",
    "Tickmill",
    "RoboForex",
    "Eightcap",
    "FXGT",
    "PU Prime",
    "Doo Prime",
    "Fusion Markets",
    "STARTRADER",
    "Moneta Markets",
    "ActivTrades",
    "Equiti",
    "ATFX",
    "Alpari",
    "AMarkets",
    "Infinox",
    "Swissquote",
    "Darwinex",
    "Global Prime",
    "GO Markets",
    "Alpha Capital Group",
    "Blue Guardian",
    "Maven Trading",
    "E8 Markets",
    "FXIFY",
    "Funded Trading Plus",
    "BTG Pactual",
    "XP Investimentos",
]


def _split_camel_case(token: str) -> str:
    """Converte 'GoatFunded' -> 'Goat Funded', 'ICMarketsSC' -> 'IC Markets SC'."""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", token)
    spaced = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", spaced)
    spaced = re.sub(r"[_\-.]+", " ", spaced)
    return re.sub(r"\s+", " ", spaced).strip()


def build_broker_search_queries(server_or_broker: str) -> List[str]:
    """
    Gera consultas de busca ordenadas para o diretório MetaQuotes a partir de um nome de servidor MT5
    (ex.: 'GoatFunded-Server2' -> ['Goat Funded', 'GoatFunded', 'GoatFunded-Server2']).
    """
    raw = (server_or_broker or "").strip()
    if not raw:
        return []

    prefix = raw.split("-")[0].strip() if "-" in raw else raw
    prefix_key = re.sub(r"[^a-z0-9.]", "", prefix.lower())

    queries: List[str] = []
    seen = set()

    def _add(q: str):
        clean = re.sub(r"\s+", " ", (q or "").strip())
        if len(clean) < 2:
            return
        low = clean.lower()
        if low not in seen:
            seen.add(low)
            queries.append(clean)

    # 1. Alias conhecido no catálogo MetaQuotes
    if prefix_key in KNOWN_BROKER_DIRECTORY_QUERIES:
        for q in KNOWN_BROKER_DIRECTORY_QUERIES[prefix_key]:
            _add(q)

    # 2. CamelCase separado (ex.: 'BlueGuardian' -> 'Blue Guardian', 'GoatFunded' -> 'Goat Funded')
    camel = _split_camel_case(prefix)
    if camel:
        _add(camel)
        # Se terminar com sufixo societário/regional (Ltd, Limited, SC, EU, AU, KE, ZA, UK, Global, Intl, Group)
        stripped = re.sub(
            r"\b(limited|ltd|corp|group|global|intl|international|financial|brokerage|online|uk|eu|au|sc|ke|za|sv|sa|vu|gm|mena)\b$",
            "",
            camel,
            flags=re.IGNORECASE,
        ).strip()
        if len(stripped) >= 3 and stripped.lower() != camel.lower():
            _add(stripped)

    # 3. Prefixo bruto (ex.: 'Exness', 'GoatFunded')
    _add(prefix)

    # 4. Nome completo do servidor (fallback caso o diretório aceite o nome literal)
    if raw.lower() != prefix.lower():
        _add(raw)

    return queries[:4]


def _resolve_servers_dat_path(terminal_exe: Path, portable: bool) -> Path:
    if portable:
        cfg_dir = terminal_exe.parent / "config"
        cfg_dir.mkdir(parents=True, exist_ok=True)
        return cfg_dir / "servers.dat"

    import hashlib

    appdata = os.environ.get("APPDATA")
    if appdata:
        norm = str(terminal_exe.parent.resolve()).rstrip("\\/").upper()
        h = hashlib.md5(norm.encode("utf-16-le")).hexdigest().upper()
        cfg_dir = Path(appdata) / "MetaQuotes" / "Terminal" / h / "config"
        cfg_dir.mkdir(parents=True, exist_ok=True)
        return cfg_dir / "servers.dat"
    return terminal_exe.parent / "config" / "servers.dat"


def _promote_servers_dat(src_servers_dat: Path, master_dst: Optional[Path] = None, main_mt5_exe: Optional[str] = None) -> None:
    """
    Promove o servers.dat enriquecido para data/master_servers.dat (e para o AppData do MT5 principal),
    sempre preservando o maior arquivo para que todas as instâncias futuras já nasçam com a corretora.
    """
    if not src_servers_dat.is_file():
        return
    src_size = src_servers_dat.stat().st_size
    if src_size <= 0:
        return

    targets: List[Path] = []
    if master_dst is not None:
        targets.append(Path(master_dst).resolve())
    if main_mt5_exe:
        try:
            main_srv = _resolve_servers_dat_path(Path(main_mt5_exe).resolve(), portable=False)
            targets.append(main_srv)
        except Exception:
            pass

    src_norm = os.path.normcase(os.path.abspath(str(src_servers_dat.resolve())))
    for dst in targets:
        try:
            dst_norm = os.path.normcase(os.path.abspath(str(dst)))
            if dst_norm == src_norm:
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            if not dst.exists() or src_size >= dst.stat().st_size:
                shutil.copy2(str(src_servers_dat), str(dst))
                logger.info(
                    f"[AUTO-DISCOVERY] Cache servers.dat promovido ({round(src_size / 1024, 1)} KB) -> {dst}"
                )
        except Exception as e:
            logger.debug(f"[AUTO-DISCOVERY] Não foi possível promover servers.dat para {dst}: {e}")


def _read_recent_mt5_log_lines(mt5_data_dir: Path, max_lines: int = 8) -> List[str]:
    """Lê as últimas linhas do log mais recente do terminal MT5 (UTF-16-LE) para diagnóstico de timeout."""
    try:
        logs_dir = mt5_data_dir / "logs"
        if not logs_dir.is_dir():
            return []
        log_files = sorted(logs_dir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not log_files:
            return []
        raw = log_files[0].read_bytes()
        text = raw.decode("utf-16-le", errors="ignore") if b"\x00" in raw[:200] else raw.decode("utf-8", errors="ignore")
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        return lines[-max_lines:]
    except Exception:
        return []


def auto_discover_brokers_in_mt5(
    terminal_exe: str,
    queries: List[str],
    portable: bool = True,
    master_servers_dst: Optional[Path] = None,
    main_mt5_exe: Optional[str] = None,
    per_query_timeout_sec: float = 6.5,
    stop_on_first_growth: bool = True,
    boot_timeout_sec: float = 120.0,
    kill_other_terminals: bool = False,
) -> Dict[str, Any]:
    """
    Automatiza o diálogo nativo `File -> Open an Account` (`WM_COMMAND 32919`) no Windows para baixar
    os servidores da(s) corretora(s) no `servers.dat` sem intervenção manual.

    Retorna dicionário com telemetria:
      {discovered, bytes_before, bytes_after, matched_queries, servers_dat_path, error}
    """
    result: Dict[str, Any] = {
        "discovered": False,
        "bytes_before": 0,
        "bytes_after": 0,
        "matched_queries": [],
        "servers_dat_path": None,
        "error": None,
    }

    if sys.platform != "win32":
        result["error"] = "Auto-discovery Win32 suportado apenas no Windows."
        return result

    clean_queries = [q.strip() for q in (queries or []) if q and q.strip()]
    if not clean_queries:
        result["error"] = "Nenhuma consulta de corretora informada."
        return result

    exe_path = Path(terminal_exe).resolve()
    if not exe_path.is_file():
        result["error"] = f"Executável MT5 não encontrado: {exe_path}"
        return result

    srv_dat = _resolve_servers_dat_path(exe_path, portable=portable)
    mt5_data_dir = srv_dat.parent.parent
    result["servers_dat_path"] = str(srv_dat)
    bytes_before = srv_dat.stat().st_size if srv_dat.is_file() else 0
    result["bytes_before"] = bytes_before
    result["bytes_after"] = bytes_before

    # Garante desde já que master_servers.dat reflita pelo menos o cache já existente
    if bytes_before > 0:
        _promote_servers_dat(srv_dat, master_dst=master_servers_dst, main_mt5_exe=main_mt5_exe)

    # Remove pasta liveupdate pendente que pode congelar a inicialização da GUI do MT5
    try:
        lu_dir = mt5_data_dir / "liveupdate"
        if lu_dir.is_dir():
            shutil.rmtree(lu_dir, ignore_errors=True)
            logger.info(f"[AUTO-DISCOVERY] Pasta liveupdate removida antes do boot: {lu_dir}")
    except Exception:
        pass

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    norm_exe = os.path.normcase(os.path.abspath(str(exe_path)))

    def _collect_matching_pids(root_pid: int) -> set:
        pids = {root_pid}
        for p in psutil.process_iter(["pid", "name", "exe"]):
            try:
                if "terminal64" in (p.info.get("name") or "").lower():
                    p_exe = p.info.get("exe") or ""
                    if p_exe and os.path.normcase(os.path.abspath(p_exe)) == norm_exe:
                        pids.add(p.info["pid"])
            except Exception:
                pass
        return pids

    def _find_windows(target_pids: set) -> List[Tuple[int, bool, str, str]]:
        wins: List[Tuple[int, bool, str, str]] = []

        def _cb(hwnd, _):
            try:
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value in target_pids:
                    vis = bool(user32.IsWindowVisible(hwnd))
                    cbuf = ctypes.create_unicode_buffer(128)
                    tbuf = ctypes.create_unicode_buffer(256)
                    user32.GetClassNameW(hwnd, cbuf, 128)
                    user32.GetWindowTextW(hwnd, tbuf, 256)
                    cls = cbuf.value or ""
                    title = tbuf.value or ""
                    if vis or "MetaTrader" in cls or cls == "#32770":
                        wins.append((hwnd, vis, cls, title))
            except Exception:
                pass
            return True

        user32.EnumWindows(WNDENUMPROC(_cb), 0)
        return wins

    def _find_child_by_id(parent_hwnd: int, ctrl_id: int) -> Optional[int]:
        found: List[Optional[int]] = [None]

        def _cb(ch, _):
            try:
                if user32.GetDlgCtrlID(ch) == ctrl_id:
                    found[0] = ch
                    return False
            except Exception:
                pass
            return True

        user32.EnumChildWindows(parent_hwnd, WNDENUMPROC(_cb), 0)
        return found[0]

    # Encerra qualquer instância prévia deste executável (e, em VPS <= 4GB ou quando solicitado,
    # outros terminal64.exe concorrentes para liberar RAM/CPU e evitar conflito na porta MCP 22346)
    try:
        vm = psutil.virtual_memory()
        total_ram_mb = round(vm.total / (1024 * 1024), 1)
    except Exception:
        total_ram_mb = 8192.0
    should_reclaim_others = kill_other_terminals or total_ram_mb <= 4096.0

    killed_pids: List[int] = []
    for p in psutil.process_iter(["pid", "name", "exe"]):
        try:
            if "terminal64" in (p.info.get("name") or "").lower():
                p_exe = p.info.get("exe") or ""
                p_norm = os.path.normcase(os.path.abspath(p_exe)) if p_exe else ""
                is_same = bool(p_norm and p_norm == norm_exe)
                is_isolated_other = should_reclaim_others and (
                    kill_other_terminals or ("instances" in p_norm and "acc_" in p_norm)
                )
                if is_same or is_isolated_other:
                    p.kill()
                    killed_pids.append(p.info["pid"])
        except Exception:
            pass
    if killed_pids:
        logger.info(
            f"[AUTO-DISCOVERY] Encerrados {len(killed_pids)} processo(s) terminal64.exe concorrente(s) "
            f"(PIDs={killed_pids}) antes da descoberta."
        )
    time.sleep(1.5)

    cmd = [str(exe_path), "/portable"] if portable else [str(exe_path)]
    logger.info(
        f"[AUTO-DISCOVERY] Iniciando registro automático de corretora no MT5 "
        f"(consultas={len(clean_queries)}: {clean_queries[:6]}{'...' if len(clean_queries) > 6 else ''} | "
        f"servers.dat atual={round(bytes_before / 1024, 1)} KB | timeout boot={int(boot_timeout_sec)}s)..."
    )

    proc = subprocess.Popen(
        cmd,
        cwd=str(exe_path.parent),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    main_hwnd: Optional[int] = None
    hidden_main_hwnd: Optional[int] = None
    hidden_main_since: Optional[float] = None
    dlg_hwnd: Optional[int] = None
    try:
        # 1. Aguarda janela principal do MT5 aparecer (até boot_timeout_sec; no 1º boot portátil o MT5 extrai ~453 arquivos MQL5)
        boot_start = time.time()
        boot_deadline = boot_start + max(30.0, float(boot_timeout_sec))
        last_progress_log = boot_start
        last_wins_snapshot: List[Tuple[int, bool, str, str]] = []

        while time.time() < boot_deadline:
            target_pids = _collect_matching_pids(proc.pid)
            if proc.poll() is not None and len(target_pids) <= 1:
                # Verifica rapidamente se não houve relaunch em outro PID
                recheck_pids = {pid for pid in target_pids if pid != proc.pid}
                if not recheck_pids:
                    result["error"] = f"terminal64.exe encerrou prematuramente (code={proc.returncode})."
                    return result

            wins = _find_windows(target_pids)
            last_wins_snapshot = wins
            other_modal = False
            for hw, vis, cls, _title in wins:
                if "MetaTrader" in cls:
                    if vis:
                        main_hwnd = hw
                    else:
                        hidden_main_hwnd = hw
                        if hidden_main_since is None:
                            hidden_main_since = time.time()
                elif vis and cls == "#32770":
                    if _find_child_by_id(hw, CTRL_SEARCH_EDIT):
                        dlg_hwnd = hw
                    else:
                        other_modal = True
                        user32.PostMessageW(hw, WM_CLOSE, 0, 0)

            # Se a janela principal existe oculta há mais de 12s, tenta despertá-la suavemente sem roubar foco
            if not main_hwnd and hidden_main_hwnd and hidden_main_since and (time.time() - hidden_main_since) >= 12.0:
                try:
                    user32.ShowWindow(hidden_main_hwnd, SW_SHOWNOACTIVATE)
                except Exception:
                    pass

            if main_hwnd and (dlg_hwnd or not other_modal):
                break
            if dlg_hwnd and (main_hwnd or hidden_main_hwnd):
                main_hwnd = main_hwnd or hidden_main_hwnd
                break

            now = time.time()
            if now - last_progress_log >= 10.0:
                last_progress_log = now
                elapsed = int(now - boot_start)
                try:
                    ram_free_mb = round(psutil.virtual_memory().available / (1024 * 1024), 1)
                except Exception:
                    ram_free_mb = -1.0
                mql5_dir = mt5_data_dir / "MQL5"
                mql5_count = sum(1 for _ in mql5_dir.rglob("*") if _.is_file()) if mql5_dir.is_dir() else 0
                win_summary = [(vis, cls, title[:35]) for _, vis, cls, title in wins[:4]]
                logger.info(
                    f"[AUTO-DISCOVERY] Aguardando MT5 inicializar... ({elapsed}s/{int(boot_timeout_sec)}s | "
                    f"PIDs={sorted(target_pids)} | RAM livre={ram_free_mb} MB | MQL5={mql5_count} arq | janelas={win_summary})"
                )

            time.sleep(0.5)

        if not main_hwnd and hidden_main_hwnd:
            logger.warning(
                "[AUTO-DISCOVERY] Janela principal do MT5 permaneceu oculta; forçando SW_SHOW para tentar abrir diálogo..."
            )
            try:
                user32.ShowWindow(hidden_main_hwnd, SW_SHOW)
                time.sleep(1.0)
            except Exception:
                pass
            main_hwnd = hidden_main_hwnd

        if not main_hwnd and not dlg_hwnd:
            recent_logs = _read_recent_mt5_log_lines(mt5_data_dir, max_lines=6)
            try:
                ram_free_mb = round(psutil.virtual_memory().available / (1024 * 1024), 1)
            except Exception:
                ram_free_mb = -1.0
            logger.warning(
                f"[AUTO-DISCOVERY] Diagnóstico de timeout de janela MT5: RAM livre={ram_free_mb} MB | "
                f"janelas={[(vis, cls, title[:40]) for _, vis, cls, title in last_wins_snapshot[:6]]} | "
                f"últimos logs MT5={recent_logs}"
            )
            result["error"] = (
                f"Janela principal do MT5 não ficou visível em {int(boot_timeout_sec)}s para auto-descoberta "
                f"(RAM livre: {ram_free_mb} MB)."
            )
            return result

        # 2. Abre diálogo 'File -> Open an Account' (WM_COMMAND 32919) se ainda não estiver aberto
        if not dlg_hwnd and main_hwnd:
            user32.PostMessageW(main_hwnd, WM_COMMAND, CMD_OPEN_ACCOUNT, 0)
            dlg_deadline = time.time() + 15.0
            while time.time() < dlg_deadline:
                target_pids = _collect_matching_pids(proc.pid)
                for hw, vis, cls, _title in _find_windows(target_pids):
                    if vis and cls == "#32770" and _find_child_by_id(hw, CTRL_SEARCH_EDIT):
                        dlg_hwnd = hw
                        break
                if dlg_hwnd:
                    break
                time.sleep(0.3)

        if not dlg_hwnd:
            result["error"] = "Não foi possível abrir o diálogo 'Open an Account' (WM_COMMAND 32919)."
            return result

        # Pequena folga para o MT5 concluir a inicialização da rede/controles do diálogo
        time.sleep(1.5)

        # 3. Executa as buscas no diretório oficial MetaQuotes
        for idx, query in enumerate(clean_queries):
            edit_hw = _find_child_by_id(dlg_hwnd, CTRL_SEARCH_EDIT)
            find_hw = _find_child_by_id(dlg_hwnd, CTRL_FIND_BTN)
            list_hw = _find_child_by_id(dlg_hwnd, CTRL_LISTVIEW)
            if not (edit_hw and find_hw and list_hw):
                break

            before_cnt = int(user32.SendMessageW(list_hw, LVM_GETITEMCOUNT, 0, 0) or 0)
            before_sz = srv_dat.stat().st_size if srv_dat.is_file() else 0

            user32.SendMessageW(edit_hw, WM_SETTEXT, 0, ctypes.c_wchar_p(query))
            time.sleep(0.2)

            parent_page = user32.GetParent(find_hw)
            if parent_page:
                user32.PostMessageW(parent_page, WM_COMMAND, (BN_CLICKED << 16) | CTRL_FIND_BTN, find_hw)
            else:
                user32.SendMessageW(find_hw, BM_CLICK, 0, 0)

            # A primeira consulta pode levar mais tempo devido ao handshake TLS frio com o diretório MetaQuotes
            eff_timeout = max(float(per_query_timeout_sec), 10.0) if idx == 0 else float(per_query_timeout_sec)
            q_start = time.time()
            matched = False
            while time.time() - q_start < eff_timeout:
                cur_cnt = int(user32.SendMessageW(list_hw, LVM_GETITEMCOUNT, 0, 0) or 0)
                cur_sz = srv_dat.stat().st_size if srv_dat.is_file() else 0
                if cur_cnt > before_cnt or cur_sz > before_sz:
                    # Aguarda estabilizar a gravação dos servidores da corretora no servers.dat
                    time.sleep(1.5)
                    matched = True
                    break
                time.sleep(0.4)

            cur_cnt_final = int(user32.SendMessageW(list_hw, LVM_GETITEMCOUNT, 0, 0) or 0)
            cur_sz_final = srv_dat.stat().st_size if srv_dat.is_file() else 0
            logger.info(
                f"[AUTO-DISCOVERY] [{idx + 1}/{len(clean_queries)}] Consulta '{query}' ({time.time() - q_start:.1f}s): "
                f"itens={before_cnt}->{cur_cnt_final} | servers.dat={round(before_sz / 1024, 1)}->{round(cur_sz_final / 1024, 1)} KB"
            )
            if matched:
                result["matched_queries"].append(query)
                if stop_on_first_growth:
                    break

        # 4. Fecha o diálogo e encerra o MT5 de forma limpa (WM_CLOSE) para forçar flush do servers.dat em disco!
        user32.PostMessageW(dlg_hwnd, WM_CLOSE, 0, 0)
        time.sleep(1.0)
        if main_hwnd:
            user32.PostMessageW(main_hwnd, WM_CLOSE, 0, 0)
        try:
            proc.wait(timeout=20)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        time.sleep(1.0)

        bytes_after = srv_dat.stat().st_size if srv_dat.is_file() else bytes_before
        result["bytes_after"] = bytes_after
        result["discovered"] = bool(bytes_after > bytes_before or len(result["matched_queries"]) > 0)

        if bytes_after > bytes_before:
            logger.success(
                f"[AUTO-DISCOVERY] servers.dat atualizado automaticamente: "
                f"{round(bytes_before / 1024, 1)} KB -> {round(bytes_after / 1024, 1)} KB "
                f"(+{round((bytes_after - bytes_before) / 1024, 1)} KB)!"
            )
            _promote_servers_dat(srv_dat, master_dst=master_servers_dst, main_mt5_exe=main_mt5_exe)

        return result
    except Exception as e:
        result["error"] = str(e)
        logger.warning(f"[AUTO-DISCOVERY] Falha durante registro automático de corretora: {e}")
        return result
    finally:
        if proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass
        for pid in list(_collect_matching_pids(proc.pid)):
            try:
                psutil.Process(pid).kill()
            except Exception:
                pass
        if srv_dat.is_file():
            try:
                result["bytes_after"] = srv_dat.stat().st_size
            except Exception:
                pass

