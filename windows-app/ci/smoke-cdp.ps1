$ErrorActionPreference = 'Stop'
# Launch a fresh, disposable Chrome user-data-dir, never the user's logged-in profile.
# CI browser only loads about:blank. It does not navigate to muse.ai.
if (-not $env:CHROME_BIN -or -not (Test-Path $env:CHROME_BIN)) { throw 'CHROME_BIN not found' }
$userDir = Join-Path $env:RUNNER_TEMP ("modolivio-cdp-" + [guid]::NewGuid().ToString('N'))
New-Item -Path $userDir -ItemType Directory | Out-Null
$chrome = $null
try {
  $ports = 19750..19759
  foreach ($port in $ports) {
    # An already occupied port cannot be adopted: only test a Chrome we spawn ourselves.
    $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listener) { continue }
    $args = @(
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1', "--remote-debugging-port=$port",
      "--user-data-dir=$userDir", 'about:blank'
    )
    $chrome = Start-Process -FilePath $env:CHROME_BIN -ArgumentList $args -PassThru -WindowStyle Hidden
    $ok = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 500
      if ($chrome.HasExited) { break }
      try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1
        if ($status.Browser -match 'Chrome') { $ok = $true; break }
      } catch { }
    }
    if ($ok) {
      if ($chrome.HasExited) { throw 'Chrome exited before CDP smoke finished' }
      Write-Host "CDP PASS port=$port process=$($chrome.Id) browser=$($status.Browser) no-Muse-session"
      return
    }
    if ($chrome -and -not $chrome.HasExited) { Stop-Process -Id $chrome.Id -Force }
    $chrome = $null
  }
  throw 'No isolated Chrome CDP instance responded within ports 19750-19759'
} finally {
  if ($chrome -and -not $chrome.HasExited) { Stop-Process -Id $chrome.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item $userDir -Recurse -Force -ErrorAction SilentlyContinue
}
