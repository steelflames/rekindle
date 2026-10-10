$ErrorActionPreference = 'Stop'
$rekindleRoot = Split-Path -Parent $PSScriptRoot
$rekindlePidFile = Join-Path $rekindleRoot 'data\service.pid'
if (-not (Test-Path -LiteralPath $rekindlePidFile)) { Write-Output 'No launcher-owned service PID is recorded.'; exit }
$rekindlePid = [int](Get-Content -LiteralPath $rekindlePidFile -Raw).Trim()
$rekindleProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $rekindlePid"
$rekindleServerPath = Join-Path $rekindleRoot 'dist\server\index.js'
if ($rekindleProcess -and $rekindleProcess.Name -eq 'node.exe' -and $rekindleProcess.CommandLine.Contains($rekindleServerPath)) { Stop-Process -Id $rekindlePid; Write-Output 'Rekindle stopped. Local data retained.' }
else { Write-Output 'The recorded process no longer belongs to this Rekindle launcher. Nothing was stopped.' }
