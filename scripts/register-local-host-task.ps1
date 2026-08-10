param(
  [Parameter(Mandatory = $true)]
  [string]$ReleasePath,
  [Parameter(Mandatory = $true)]
  [string]$NodePath,
  [switch]$Start
)

$ErrorActionPreference = "Stop"
$TaskName = "ChuyingAI-LocalHost"
$ReleasePath = (Resolve-Path -LiteralPath $ReleasePath).Path
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$StartScript = Join-Path $ReleasePath "scripts\start-local-host-task.ps1"
$ReleaseMarker = Join-Path $ReleasePath "release.json"
$IncompleteReleaseMarker = Join-Path $ReleasePath ".installing"
$TsxCli = Join-Path $ReleasePath "node_modules\tsx\dist\cli.mjs"
$StopScript = Join-Path $ReleasePath "scripts\stop-local-host-task.ps1"

function Wait-ForPortsToClose([int]$TimeoutSeconds = 30) {
  $Deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $Listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalPort -in @(3000, 3100) })
    if ($Listeners.Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTimeOffset]::UtcNow -lt $Deadline)
  throw "Local service ports did not close"
}

function Wait-ForHealth([int]$TimeoutSeconds = 60) {
  $Deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $Health = Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/health" -TimeoutSec 2
      if (
        $Health.status -eq "ok" `
        -and $Health.database.available -eq $true `
        -and $Health.competitionReady -eq $true
      ) { return }
    } catch {
      # The newly registered service is still starting.
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTimeOffset]::UtcNow -lt $Deadline)
  throw "Registered service did not become healthy"
}

foreach ($RequiredFile in @($StartScript, $StopScript, $ReleaseMarker, $TsxCli, $NodePath)) {
  if (-not (Test-Path -LiteralPath $RequiredFile -PathType Leaf)) { throw "Release runtime file is missing" }
}
if (Test-Path -LiteralPath $IncompleteReleaseMarker) { throw "Release installation is incomplete" }
if ($ReleasePath -match "(?i)[\\/]\.worktrees[\\/]" -or $ReleasePath -match "(?i)[\\/]\.cache[\\/]codex-runtimes[\\/]") {
  throw "Scheduled task must use an installed release"
}
if ($NodePath -match "(?i)[\\/]\.cache[\\/]codex-runtimes[\\/]") {
  throw "Scheduled task must use a stable system Node runtime"
}

$Marker = Get-Content -Raw -LiteralPath $ReleaseMarker | ConvertFrom-Json
if ($Marker.commit -notmatch "^[0-9a-f]{40}$" -or [string]$Marker.nodeAbi -notmatch "^\d+$") {
  throw "Release marker is invalid"
}
$NodeInfo = (& $NodePath -p "JSON.stringify({version:process.version,modules:process.versions.modules})") | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect Node runtime" }
$NodeVersion = [Version]([string]$NodeInfo.version).TrimStart("v")
if ($NodeVersion -lt [Version]"20.19.0" -or $NodeVersion -ge [Version]"25.0.0") {
  throw "Node runtime does not satisfy package engines"
}
if ([string]$Marker.nodeAbi -ne [string]$NodeInfo.modules) {
  throw "Release Node ABI does not match the scheduled runtime"
}
$ReleaseId = "$($Marker.commit)-node$($Marker.nodeAbi)"
$ExpectedReleasePath = Join-Path (Join-Path $env:LOCALAPPDATA "ChuyingAI\releases") $ReleaseId
if ([IO.Path]::GetFullPath($ReleasePath).TrimEnd("\") -ne [IO.Path]::GetFullPath($ExpectedReleasePath).TrimEnd("\")) {
  throw "Release path does not match its commit marker"
}

$PowerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$ActionArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`" -NodePath `"$NodePath`""
$Action = New-ScheduledTaskAction -Execute $PowerShellPath -Argument $ActionArguments -WorkingDirectory $ReleasePath
$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$ExistingXml = if ($ExistingTask) { Export-ScheduledTask -TaskName $TaskName } else { $null }
try {
  if ($ExistingTask) {
    & $StopScript -ReleasePath $ExistingTask.Actions.WorkingDirectory -TaskName $TaskName | Out-Null
  }
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Description "触映课程智能体本机服务" `
    -Force | Out-Null

  if ($Start) {
    Start-ScheduledTask -TaskName $TaskName
    Wait-ForHealth
  }
} catch {
  & $StopScript -ReleasePath $ReleasePath -TaskName $TaskName | Out-Null
  Wait-ForPortsToClose
  if ($ExistingXml) {
    Register-ScheduledTask -TaskName $TaskName -Xml $ExistingXml -Force | Out-Null
  } else {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  throw
}

[pscustomobject]@{
  ok = $true
  taskName = $TaskName
  releasePath = $ReleasePath
  commit = $Marker.commit
  started = [bool]$Start
} | ConvertTo-Json -Compress
