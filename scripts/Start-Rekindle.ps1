param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$rekindleRoot = Split-Path -Parent $PSScriptRoot
$rekindleUrl = 'http://127.0.0.1:47831'
$rekindleNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $rekindleNode) { throw 'Rekindle requires Node.js 24 or later. Install Node.js, then run Setup-Rekindle.cmd once.' }
$rekindleVersion = & $rekindleNode --version
if ([int]($rekindleVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Rekindle requires Node.js 24 or later.' }
if (-not (Test-Path -LiteralPath (Join-Path $rekindleRoot 'dist\server\index.js'))) { throw 'The build is missing. Run Setup-Rekindle.cmd first.' }
$rekindleHealthy = $false
try { $rekindleHealth = Invoke-RestMethod -Uri "$rekindleUrl/api/health" -TimeoutSec 2; $rekindleHealthy = $rekindleHealth.ok -eq $true -and $rekindleHealth.version -eq '0.1.0' } catch {}
if (-not $rekindleHealthy) {
  $rekindleData = Join-Path $rekindleRoot 'data'
  New-Item -ItemType Directory -Force -Path $rekindleData | Out-Null
  $rekindleServer = Join-Path $rekindleRoot 'dist\server\index.js'
  $rekindleProcess = Start-Process -FilePath $rekindleNode -ArgumentList ('"' + $rekindleServer + '"') -WorkingDirectory $rekindleRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $rekindleData 'server.stdout.log') -RedirectStandardError (Join-Path $rekindleData 'server.stderr.log')
  Set-Content -LiteralPath (Join-Path $rekindleData 'service.pid') -Value $rekindleProcess.Id
  for ($rekindleTry = 0; $rekindleTry -lt 30; $rekindleTry++) {
    Start-Sleep -Milliseconds 200
    try { $rekindleHealth = Invoke-RestMethod -Uri "$rekindleUrl/api/health" -TimeoutSec 1; if ($rekindleHealth.ok -eq $true) {$rekindleHealthy = $true; break} } catch {}
    if ($rekindleProcess.HasExited) { break }
  }
  if (-not $rekindleHealthy) { throw "Rekindle could not start. See $rekindleData\server.stderr.log. Port 47831 may already be occupied." }
}
if (-not $NoBrowser) {
  $rekindleFirefox = Join-Path $env:ProgramFiles 'Mozilla Firefox\firefox.exe'
  if (Test-Path -LiteralPath $rekindleFirefox) { Start-Process -FilePath $rekindleFirefox -ArgumentList $rekindleUrl }
  else { Start-Process $rekindleUrl }
}
Write-Output "Rekindle is ready at $rekindleUrl"
