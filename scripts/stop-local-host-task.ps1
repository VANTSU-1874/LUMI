param(
  [Parameter(Mandatory = $true)]
  [string]$ReleasePath,
  [string]$TaskName = "ChuyingAI-LocalHost",
  [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
if (-not [IO.Path]::IsPathRooted($ReleasePath)) { throw "Release path is invalid" }
$ReleasePath = [IO.Path]::GetFullPath($ReleasePath).TrimEnd("\")
if ($ReleasePath.Length -lt 12) {
  throw "Release path is invalid"
}

function Get-ServiceProcesses {
  @(Get-CimInstance Win32_Process | Where-Object {
    $Command = [string]$_.CommandLine
    $Command.IndexOf($ReleasePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and (
      $Command -match "(?i)start-local-host(?:-task)?\.(?:ts|ps1)" -or
      $Command -match "(?i)next(?:\\|/)dist(?:\\|/)bin(?:\\|/)next.+start --hostname 127\.0\.0\.1 --port 3000"
    )
  })
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$Deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
do {
  $Processes = @(Get-ServiceProcesses)
  foreach ($Process in $Processes) {
    Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $Listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(3000, 3100) })
  if ($Processes.Count -eq 0 -and $Listeners.Count -eq 0) { break }
  Start-Sleep -Milliseconds 250
} while ([DateTimeOffset]::UtcNow -lt $Deadline)

$Remaining = @(Get-ServiceProcesses)
$Listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in @(3000, 3100) })
if ($Remaining.Count -or $Listeners.Count) { throw "LOCAL_HOST_STOP_TIMEOUT_OR_PORT_IN_USE" }
[pscustomobject]@{ ok = $true; taskName = $TaskName; releasePath = $ReleasePath } | ConvertTo-Json -Compress
