$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pythonPath = Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
$buildPath = Join-Path $projectRoot 'frontend/build'
$runPath = Join-Path $projectRoot '.run'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Python environment missing. Follow README.md setup first.' }
if (-not (Test-Path -LiteralPath (Join-Path $buildPath 'index.html'))) { throw 'Frontend build missing. Run npm run build in frontend first.' }
New-Item -ItemType Directory -Path $runPath -Force | Out-Null
if (-not (Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue)) {
    $backendProcess = Start-Process -FilePath $pythonPath -ArgumentList 'app.py' -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runPath 'backend.log') -RedirectStandardError (Join-Path $runPath 'backend.error.log') -PassThru
    $backendProcess.Id | Set-Content (Join-Path $runPath 'backend.pid')
}
if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
    $frontendProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'http.server', '3000', '--bind', '127.0.0.1') -WorkingDirectory $buildPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runPath 'frontend.log') -RedirectStandardError (Join-Path $runPath 'frontend.error.log') -PassThru
    $frontendProcess.Id | Set-Content (Join-Path $runPath 'frontend.pid')
}
Write-Output 'TrainHub: http://localhost:3000 (logs and process IDs in .run)'
