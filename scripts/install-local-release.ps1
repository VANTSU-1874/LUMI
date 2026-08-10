param(
  [Parameter(Mandatory = $true)]
  [string]$GitPath,
  [Parameter(Mandatory = $true)]
  [string]$PnpmPath,
  [Parameter(Mandatory = $true)]
  [string]$NodePath
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LocalRoot = Join-Path $env:LOCALAPPDATA "ChuyingAI"
$ReleasesRoot = Join-Path $LocalRoot "releases"

foreach ($Executable in @($GitPath, $PnpmPath, $NodePath)) {
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Required executable is missing" }
}
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$NodeInfoJson = & $NodePath -p "JSON.stringify({execPath:process.execPath,version:process.version,modules:process.versions.modules})"
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect Node runtime" }
$NodeInfo = $NodeInfoJson | ConvertFrom-Json
if ($NodeInfo.modules -notmatch "^\d+$") { throw "Unable to resolve Node module ABI" }
$NodeVersion = [Version]([string]$NodeInfo.version).TrimStart("v")
if ($NodeVersion -lt [Version]"20.19.0" -or $NodeVersion -ge [Version]"25.0.0") {
  throw "Node runtime does not satisfy package engines"
}

$Status = @(& $GitPath -C $ProjectRoot status --porcelain)
if ($LASTEXITCODE -ne 0) { throw "git status failed" }
if ($Status.Count -ne 0) { throw "Refusing to install an uncommitted release" }
$Commit = (& $GitPath -C $ProjectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $Commit -notmatch "^[0-9a-f]{40}$") { throw "Unable to resolve release commit" }

New-Item -ItemType Directory -Force -Path $ReleasesRoot | Out-Null
$ReleaseId = "$Commit-node$($NodeInfo.modules)"
$Target = Join-Path $ReleasesRoot $ReleaseId
$RequiredReleaseFiles = @(
  ".next\BUILD_ID",
  ".next\required-server-files.json",
  "node_modules\better-sqlite3\package.json",
  "node_modules\next\dist\bin\next",
  "node_modules\tsx\dist\cli.mjs",
  "third_party\knowledge-v2\NOTICE.md",
  "third_party\knowledge-v2\manifest.json",
  "third_party\knowledge-v2\LICENSE-MIT.txt",
  "third_party\knowledge-v2\LICENSE-APACHE-2.0.txt",
  "third_party\knowledge-v2\LICENSE-PYTORCH-2.11.0.txt",
  "third_party\knowledge-v2\LICENSE-TORCHVISION-0.26.0.txt",
  "scripts\prepare-local-release.ts",
  "scripts\run-agent-harness.ts",
  "scripts\register-local-host-task.ps1",
  "scripts\start-local-host-task.ps1",
  "scripts\start-local-host.ts",
  "scripts\stop-local-host-task.ps1",
  "scripts\verify-local-host.ts"
)
function Find-MissingReleaseFile([string]$BasePath) {
  return $RequiredReleaseFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $BasePath $_) -PathType Leaf)
  } | Select-Object -First 1
}
function Assert-ReleaseRuntimeLinks([string]$BasePath) {
  $BasePrefix = [IO.Path]::GetFullPath($BasePath).TrimEnd("\") + "\"
  foreach ($RuntimeDirectory in @("node_modules\better-sqlite3", "node_modules\next", "node_modules\tsx")) {
    $RuntimeItem = Get-Item -LiteralPath (Join-Path $BasePath $RuntimeDirectory) -Force
    if (-not ($RuntimeItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "Installed runtime directory must use pnpm's isolated link: $RuntimeDirectory"
    }
    $RuntimeTarget = [string]@($RuntimeItem.Target)[0]
    if (-not [IO.Path]::IsPathRooted($RuntimeTarget)) {
      $RuntimeTarget = Join-Path $RuntimeItem.Parent.FullName $RuntimeTarget
    }
    $RuntimeTarget = [IO.Path]::GetFullPath($RuntimeTarget)
    if (-not $RuntimeTarget.StartsWith($BasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Installed runtime link escapes the immutable release: $RuntimeDirectory"
    }
    if (-not (Test-Path -LiteralPath $RuntimeTarget)) { throw "Installed runtime link is broken: $RuntimeDirectory" }
  }
}
if (Test-Path -LiteralPath $Target) {
  $Marker = Join-Path $Target "release.json"
  $IncompleteMarker = Join-Path $Target ".installing"
  if (Test-Path -LiteralPath $IncompleteMarker -PathType Leaf) {
    throw "Existing release installation is incomplete"
  }
  if (-not (Test-Path -LiteralPath $Marker -PathType Leaf)) {
    throw "Existing release has no valid marker"
  } else {
    $Existing = Get-Content -Raw -LiteralPath $Marker | ConvertFrom-Json
    if ($Existing.commit -ne $Commit) { throw "Existing release marker does not match" }
    if ([string]$Existing.nodeAbi -ne [string]$NodeInfo.modules) { throw "Existing release Node ABI does not match" }
    $MissingReleaseFile = Find-MissingReleaseFile $Target
    if ($MissingReleaseFile) { throw "Existing release is incomplete: $MissingReleaseFile" }
    Assert-ReleaseRuntimeLinks $Target
    [pscustomobject]@{ ok = $true; reused = $true; commit = $Commit; releasePath = $Target; nodePath = $NodePath } | ConvertTo-Json -Compress
    return
  }
}

$InstallId = [Guid]::NewGuid().ToString("N")
$Archive = Join-Path $env:TEMP "chuying-$InstallId.tar"
$CreatedTarget = $false
New-Item -ItemType Directory -Path $Target | Out-Null
$CreatedTarget = $true
$IncompleteMarker = Join-Path $Target ".installing"
$IncompleteContent = [ordered]@{
  commit = $Commit
  installId = $InstallId
  processId = $PID
  startedAt = [DateTimeOffset]::UtcNow.ToString("O")
} | ConvertTo-Json
[IO.File]::WriteAllText($IncompleteMarker, $IncompleteContent, [Text.UTF8Encoding]::new($false))
$PreviousPath = $env:PATH
$env:PATH = "$(Split-Path -Parent $NodePath);$PreviousPath"
try {
  $PnpmVersion = (& $PnpmPath --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $PnpmVersion -ne "11.7.0") { throw "pnpm 11.7.0 is required" }
  $PnpmNodeOutput = @(& $PnpmPath exec node -p "process.execPath")
  if ($LASTEXITCODE -ne 0 -or $PnpmNodeOutput.Count -eq 0) { throw "Unable to verify pnpm Node runtime" }
  $PnpmNodePath = [IO.Path]::GetFullPath(([string]$PnpmNodeOutput[-1]).Trim())
  if ($PnpmNodePath -ne [IO.Path]::GetFullPath($NodePath)) { throw "pnpm is not using the requested Node runtime" }
  & $GitPath -C $ProjectRoot archive --format=tar --output=$Archive HEAD
  if ($LASTEXITCODE -ne 0) { throw "git archive failed" }
  & tar.exe -xf $Archive -C $Target
  if ($LASTEXITCODE -ne 0) { throw "release extraction failed" }
  Push-Location $Target
  try {
    # pnpm's isolated Windows layout uses junctions whose targets include the
    # release path. Install and build in the immutable final directory so those
    # links remain valid for Next.js/Turbopack at runtime.
    & $PnpmPath install --frozen-lockfile --prod=false
    if ($LASTEXITCODE -ne 0) { throw "release dependency installation failed" }
    & $NodePath (Join-Path $Target "node_modules\next\dist\bin\next") build
    if ($LASTEXITCODE -ne 0) { throw "release build failed" }
    & $NodePath -e "require('better-sqlite3'); require('next/package.json'); require('tsx/package.json')"
    if ($LASTEXITCODE -ne 0) { throw "release runtime dependency check failed" }
  } finally {
    Pop-Location
  }
  $MarkerContent = [ordered]@{
    commit = $Commit
    createdAt = [DateTimeOffset]::UtcNow.ToString("O")
    source = "git-archive"
    nodeVersion = $NodeInfo.version
    nodeAbi = $NodeInfo.modules
  } | ConvertTo-Json
  $MissingReleaseFile = Find-MissingReleaseFile $Target
  if ($MissingReleaseFile) { throw "Installed release is incomplete: $MissingReleaseFile" }
  Assert-ReleaseRuntimeLinks $Target
  [IO.File]::WriteAllText((Join-Path $Target "release.json"), $MarkerContent, [Text.UTF8Encoding]::new($false))
  Remove-Item -LiteralPath $IncompleteMarker -Force
} finally {
  $env:PATH = $PreviousPath
  if (Test-Path -LiteralPath $Archive) { Remove-Item -LiteralPath $Archive -Force }
  if ($CreatedTarget -and (Test-Path -LiteralPath $IncompleteMarker -PathType Leaf)) {
    try {
      $OwnedIncomplete = Get-Content -Raw -LiteralPath $IncompleteMarker | ConvertFrom-Json
      if ($OwnedIncomplete.commit -eq $Commit -and $OwnedIncomplete.installId -eq $InstallId) {
        Remove-Item -LiteralPath $Target -Recurse -Force
      }
    } catch {
      Write-Warning "Unable to verify or clean the incomplete release owned by this installer"
    }
  }
}

[pscustomobject]@{ ok = $true; reused = $false; commit = $Commit; releasePath = $Target; nodePath = $NodePath } | ConvertTo-Json -Compress
