param(
    [switch]$InstallStartupTask = $false
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  TorexJournal MT5 Server - Setup Automatico para VPS" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Garante arquivo .env
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "[OK] Arquivo .env criado a partir de .env.example." -ForegroundColor Green
    }
} else {
    Write-Host "[OK] Arquivo .env encontrado." -ForegroundColor Green
}

# 2. Verifica instalacao do MetaTrader 5 (terminal64.exe) e limpa LiveUpdate pendente
$mt5Candidates = @(
    "C:\Program Files\MetaTrader 5\terminal64.exe",
    "C:\MT5\terminal64.exe",
    "C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe"
)
$foundMt5 = $null
foreach ($candidate in $mt5Candidates) {
    if (Test-Path $candidate) {
        $foundMt5 = $candidate
        break
    }
}

if ($foundMt5) {
    $verInfo = (Get-Item $foundMt5).VersionInfo
    Write-Host "[OK] MetaTrader 5 detectado em: $foundMt5 (Versao: $($verInfo.ProductVersion))" -ForegroundColor Green
} else {
    Write-Host "[AVISO] terminal64.exe nao encontrado nos caminhos padrao. Verifique MT5_DEFAULT_PATH no arquivo .env." -ForegroundColor Yellow
}

# Limpa pasta liveupdate no AppData que trava o IPC com prompt de UAC
$mqRoot = Join-Path $env:APPDATA "MetaQuotes\Terminal"
if (Test-Path $mqRoot) {
    Get-ChildItem -Path $mqRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $luDir = Join-Path $_.FullName "liveupdate"
        if (Test-Path $luDir) {
            Remove-Item -Path $luDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "[OK] Removida atualizacao pendente bloqueante em: $luDir" -ForegroundColor Green
        }
    }
}

# 3. Cria venv (com --system-site-packages para aproveitar pacotes globais caso offline)
if (-not (Test-Path "venv\Scripts\python.exe")) {
    Write-Host "[1/3] Criando ambiente virtual Python (venv)..." -ForegroundColor Yellow
    python -m venv --system-site-packages venv
} else {
    # Garante include-system-site-packages = true no pyvenv.cfg
    $cfgPath = "venv\pyvenv.cfg"
    if (Test-Path $cfgPath) {
        (Get-Content $cfgPath) -replace "include-system-site-packages\s*=\s*false", "include-system-site-packages = true" | Set-Content $cfgPath
    }
    Write-Host "[1/3] Ambiente virtual Python (venv) configurado." -ForegroundColor Green
}

# 4. Verifica/instala dependencias do requirements.txt
Write-Host "[2/3] Verificando bibliotecas (loguru, MetaTrader5, pydantic, psutil, requests)..." -ForegroundColor Yellow
& ".\venv\Scripts\python.exe" -c "import loguru, MetaTrader5, pydantic, pydantic_settings, psutil, requests" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Todas as dependencias ja estao instaladas e prontas no venv!" -ForegroundColor Green
} else {
    Write-Host "[INFO] Instalando pacotes ausentes via pip..." -ForegroundColor Yellow
    & ".\venv\Scripts\python.exe" -m pip install -r requirements.txt --retries 5 --timeout 30
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERRO] Falha ao instalar dependencias via pip. Verifique a conexao com a internet." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

# 5. Executa suite de testes unitarios e de validacao
Write-Host "[3/3] Executando testes unitarios e de validacao..." -ForegroundColor Yellow
& ".\venv\Scripts\python.exe" "tests\test_mt5_server.py"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERRO] Falha nos testes de validacao!" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 6. Opcional: Registra tarefa agendada do Windows para iniciar automaticamente no logon (Sessao GUI)
if ($InstallStartupTask) {
    $taskName = "TorexJournal-MT5-Worker"
    $batPath = Join-Path $PSScriptRoot "start_worker.bat"
    Write-Host "[TASK] Registrando tarefa agendada '$taskName' para iniciar no logon..." -ForegroundColor Yellow
    $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batPath`"" -WorkingDirectory $PSScriptRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host "[OK] Tarefa agendada '$taskName' registrada com sucesso!" -ForegroundColor Green
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "  [SUCESSO] Ambiente pronto e validado!" -ForegroundColor Green
Write-Host "  Para iniciar o servidor agora:" -ForegroundColor White
Write-Host "    .\start_worker.bat   ou   python main.py" -ForegroundColor Cyan
Write-Host "  Para registrar inicio automatico no Windows Server:" -ForegroundColor White
Write-Host "    powershell -ExecutionPolicy Bypass -File .\setup_vps.ps1 -InstallStartupTask" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Green
