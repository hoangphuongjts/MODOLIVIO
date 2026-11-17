# MODOLIVIO Windows packaged EXE smoke: real portable launcher, real Electron renderer.
# The GitHub runner is disposable. Never open a Muse session or use user credentials.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outDir = Join-Path $repoRoot 'ui-smoke'
$exe = Join-Path $repoRoot 'dist-win\MODOLIVIO-Windows-1.3.0-portable.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Portable EXE missing: $exe" }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$shots = @('01-main.png', '02-lam-nhanh.png', '03-tong-quan.png')
$report = Join-Path $outDir 'smoke-report.json'
$runtime = Join-Path $outDir 'process-observation.json'
$stdout = Join-Path $outDir 'startup.stdout.log'
$stderr = Join-Path $outDir 'startup.stderr.log'
foreach ($file in @($report, $runtime, $stdout, $stderr) + @($shots | ForEach-Object { Join-Path $outDir $_ })) {
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}

# The EXE is launched with a fresh CI profile, without any Muse login or cookies.
$env:MODOLIVIO_MUSE_ENGINE = '0'
$env:MODOLIVIO_MUSE_LIVE = '0'
$env:MODOLIVIO_MUSE_ALLOWED_PROFILE_ID = ''
$env:MODOLIVIO_RENDER_PROVIDER = 'seedance'
$env:SMOKE_OUT_DIR = $outDir
$env:SMOKE_USER_DATA_DIR = Join-Path $env:RUNNER_TEMP ('modolivio-ui-user-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $env:SMOKE_USER_DATA_DIR -Force | Out-Null
$env:ELECTRON_ENABLE_LOGGING = '1'
$env:PYTHONIOENCODING = 'utf-8'

$launcher = $null
$parentAlive = $false
$electronAlive = $false
$windowSeen = $false
$observedWindowTitles = @()
$observedPids = @()
try {
  Write-Host "LAUNCH: portable EXE (smoke flag only) $exe"
  $launcher = Start-Process -FilePath $exe -ArgumentList @('--smoke-test') -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(95)
  while ([DateTime]::UtcNow -lt $deadline) {
    $launcher.Refresh()
    if (-not $launcher.HasExited) { $parentAlive = $true }
    foreach ($proc in @(Get-Process -Name 'MODOLIVIO' -ErrorAction SilentlyContinue)) {
      if (-not $proc.HasExited) {
        $electronAlive = $true
        $observedPids += $proc.Id
        if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
          $windowSeen = $true
          $observedWindowTitles += $proc.MainWindowTitle
        }
      }
    }
    if ((Test-Path -LiteralPath $report)) { break }
    if ($launcher.HasExited) { break }
    Start-Sleep -Milliseconds 250
  }
  $exited = $launcher.WaitForExit(25000)
  $exitCode = if ($exited) { $launcher.ExitCode } else { $null }
  $observation = [ordered]@{
    launcherPid = $launcher.Id
    launcherAliveObserved = $parentAlive
    electronProcessObserved = $electronAlive
    nativeWindowObservedByWindows = $windowSeen
    electronPids = @($observedPids | Sort-Object -Unique)
    windowTitles = @($observedWindowTitles | Sort-Object -Unique)
    launcherExited = $exited
    launcherExitCode = $exitCode
    screenshots = @($shots | ForEach-Object { @{ file = $_; exists = (Test-Path -LiteralPath (Join-Path $outDir $_) -PathType Leaf) } })
    reportExists = Test-Path -LiteralPath $report -PathType Leaf
  }
  $observation | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $runtime -Encoding utf8
  Write-Host ('PROCESS_OBSERVATION ' + ($observation | ConvertTo-Json -Compress -Depth 6))
  if (-not $exited) { throw 'Portable launcher did not terminate after smoke capture (25s grace)' }
  if ($exitCode -ne 0) { throw "Portable launcher failed: exit code $exitCode" }
  if (-not $parentAlive) { throw 'Portable launcher was never observed alive' }
  if (-not $electronAlive) { throw 'No extracted MODOLIVIO Electron process was observed' }
  foreach ($file in $shots) { if (-not (Test-Path -LiteralPath (Join-Path $outDir $file) -PathType Leaf)) { throw "Missing renderer PNG $file" } }
  if (-not (Test-Path -LiteralPath $report -PathType Leaf)) { throw 'Packaged Electron did not produce smoke-report.json' }
  python (Join-Path $PSScriptRoot 'verify-ui-smoke.py') --dir $outDir --runtime $runtime
  if ($LASTEXITCODE -ne 0) { throw "Packaged UI screenshot verification failed (exit $LASTEXITCODE)" }
  Write-Host "PASS: packaged EXE, Electron BrowserWindow, 2 trusted mouse clicks, 3 real renderer screenshots: $outDir"
} finally {
  if ($launcher) {
    $launcher.Refresh()
    if (-not $launcher.HasExited) { Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue }
  }
  if (Test-Path -LiteralPath $report) { Write-Host '--- Electron renderer report ---'; Get-Content -LiteralPath $report -TotalCount 200 | ForEach-Object { Write-Host $_ } }
  foreach ($f in @($stdout, $stderr)) {
    if ((Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -gt 0)) {
      Write-Host ("--- " + [IO.Path]::GetFileName($f) + " (tail) ---")
      Get-Content -LiteralPath $f -Tail 30 | ForEach-Object { Write-Host $_ }
    }
  }
  # CI profile is isolated in RUNNER_TEMP, never imported from the user.
  if ($env:SMOKE_USER_DATA_DIR -and (Test-Path $env:SMOKE_USER_DATA_DIR)) { Remove-Item $env:SMOKE_USER_DATA_DIR -Recurse -Force -ErrorAction SilentlyContinue }
}