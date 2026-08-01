param(
  [string]$NodePath,
  [string]$PnpmPath
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogRoot = Join-Path $env:LOCALAPPDATA "ChuyingAI\logs"
$StdoutLog = Join-Path $LogRoot "service.out.log"
$StderrLog = Join-Path $LogRoot "service.err.log"
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

foreach ($LogPath in @($StdoutLog, $StderrLog)) {
  if ((Test-Path -LiteralPath $LogPath) -and (Get-Item -LiteralPath $LogPath).Length -gt 5MB) {
    Move-Item -LiteralPath $LogPath -Destination "$LogPath.previous" -Force
  }
}

Set-Location -LiteralPath $ProjectRoot
if ($NodePath) {
  $TsxCli = Join-Path $ProjectRoot "node_modules\tsx\dist\cli.mjs"
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node executable is missing" }
  if (-not (Test-Path -LiteralPath $TsxCli -PathType Leaf)) { throw "Local tsx runtime is missing" }
  & $NodePath $TsxCli (Join-Path $ProjectRoot "scripts\start-local-host.ts") 1>> $StdoutLog 2>> $StderrLog
} elseif ($PnpmPath) {
  # Transitional fallback for an older task registration. New registrations use NodePath.
  & $PnpmPath local-host:start 1>> $StdoutLog 2>> $StderrLog
} else {
  throw "NodePath is required"
}
exit $LASTEXITCODE
