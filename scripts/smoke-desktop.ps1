$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $root 'desktop-verify\win-unpacked\Qling Cross-border Insight.exe'
$resultPath = Join-Path $env:TEMP ("qling-desktop-smoke-{0}.json" -f [guid]::NewGuid())
if (-not (Test-Path -LiteralPath $executable)) { throw "Desktop executable not found: $executable" }
try {
  $env:QLING_DESKTOP_SMOKE_PATH = $resultPath
  $process = Start-Process -FilePath $executable -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(20000)) { $process.Kill(); throw 'Desktop smoke test timed out after 20 seconds' }
  if (-not (Test-Path -LiteralPath $resultPath)) { throw "Desktop exited without a smoke result (exit $($process.ExitCode))" }
  $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if (-not $result.loaded) { throw "Desktop failed to load: $($result.error)" }
  if ($result.url -notlike 'file://*index.html*') { throw "Unexpected desktop URL: $($result.url)" }
  $result | ConvertTo-Json -Compress
} finally {
  Remove-Item Env:QLING_DESKTOP_SMOKE_PATH -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue
}
