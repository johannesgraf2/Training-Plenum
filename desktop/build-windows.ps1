# Builds the Windows app: frontend, program folder (PyInstaller) and installer (Inno Setup) in dist/.
# Needs Python 3.12, Node.js and Inno Setup 6. Usage: .\desktop\build-windows.ps1 [-Version 1.2.3]
param([string]$Version = '1.0.0')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$venv = Join-Path $root '.venv-desktop'
$python = Join-Path $venv 'Scripts/python.exe'

function Run([string]$file, [string[]]$arguments) {
    & $file @arguments
    if ($LASTEXITCODE) { throw "$file $arguments failed ($LASTEXITCODE)" }
}

if (-not (Test-Path -LiteralPath $python)) { Run 'python' @('-m', 'venv', $venv) }
Run $python @('-m', 'pip', 'install', '--quiet', '-r', (Join-Path $root 'backend/requirements.txt'), '-r', (Join-Path $root 'desktop/requirements.txt'))

Push-Location (Join-Path $root 'frontend')
try {
    Run 'npm' @('install', '--no-audit', '--no-fund')
    # The app serves the page itself on this address (backend/desktop.py).
    $env:REACT_APP_API_URL = 'http://127.0.0.1:5000'
    Run 'npm' @('run', 'build')
} finally {
    Remove-Item Env:REACT_APP_API_URL -ErrorAction SilentlyContinue
    Pop-Location
}

$dist = Join-Path $root 'dist'
Run $python @('-m', 'PyInstaller', '--noconfirm', '--distpath', $dist, '--workpath', (Join-Path $root '.run/pyinstaller'), (Join-Path $root 'desktop/TrainingPlenum.spec'))

# Starts the built program without a window and checks API and page against a throwaway data folder.
$smokeHome = Join-Path $root '.run/smoke-test'
Remove-Item -LiteralPath $smokeHome -Recurse -Force -ErrorAction SilentlyContinue
$env:TRAINHUB_HOME = $smokeHome
try {
    $process = Start-Process -FilePath (Join-Path $dist 'Training Plenum/Training Plenum.exe') -ArgumentList '--smoke-test' -Wait -PassThru
} finally {
    Remove-Item Env:TRAINHUB_HOME -ErrorAction SilentlyContinue
}
Get-Content -LiteralPath (Join-Path $smokeHome 'training-plenum.log') -ErrorAction SilentlyContinue
if ($process.ExitCode) { throw "Smoke test failed ($($process.ExitCode))" }

$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) { $iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe' }
if (-not (Test-Path -LiteralPath $iscc)) { throw 'Inno Setup 6 missing: https://jrsoftware.org/isdl.php' }
Run $iscc @("/DAppVersion=$Version", (Join-Path $root 'desktop/installer.iss'))
Write-Output "Installer: $(Join-Path $dist "TrainingPlenum-Setup-$Version.exe")"
