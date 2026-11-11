#requires -Version 5.1
<#
  Despliegue de producción de Simon Twin.
  Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1
  Pensado para ejecutarse desde el runner de GitHub Actions (self-hosted) o a mano.
#>
param(
  [string]$DeployRoot = 'C:\Users\Santiago\Documents\simon',
  [string]$Branch = 'main',
  [switch]$SkipPull
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$logDir = Join-Path $DeployRoot 'deploy-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $logDir "deploy-$stamp.log"

function Log([string]$msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Fail([string]$msg) {
  Log "ERROR: $msg"
  Send-Telegram "<b>[DESPLIEGUE FALLIDO]</b>`nSimon Twin`n$msg`nLog: $logFile" 'bad'
  Write-StepSummary "### Despliegue fallido`n$msg`n`nLog: ``$logFile``"
  exit 1
}

function Write-StepSummary([string]$md) {
  if ($env:GITHUB_STEP_SUMMARY) {
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $md -Encoding UTF8
  }
}

function Send-Telegram([string]$text, [string]$kind = 'ok') {
  try {
    $token = $env:TELEGRAM_BOT_TOKEN
    $chat = $env:TELEGRAM_CHAT_ID
    $secretFile = 'C:\Users\Santiago\secrets\telegram.json'
    if ((!$token -or !$chat) -and (Test-Path $secretFile)) {
      $s = Get-Content $secretFile -Raw | ConvertFrom-Json
      if (!$token) { $token = $s.bot_token }
      if (!$chat) { $chat = $s.chat_id }
    }
    if (!$token -or !$chat) { return }
    $body = @{ chat_id = $chat; text = $text; parse_mode = 'HTML'; disable_web_page_preview = $true } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/sendMessage" -Method Post `
      -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 20 | Out-Null
  } catch {
    Log "Aviso: no se pudo enviar Telegram ($($_.Exception.Message))"
  }
}

function Invoke-Curl([string]$url, [string[]]$extra = @()) {
  $cargs = @('-sk', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '15') + $extra + @($url)
  return (& curl.exe @cargs 2>$null)
}

Log "=== Despliegue Simon Twin ($stamp) ==="

# ---------------------------------------------------------------------------
# 0. Candado para evitar dos despliegues simultáneos
# ---------------------------------------------------------------------------
$lockPath = Join-Path $logDir '.deploy.lock'
try {
  $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $lock.SetLength(0)
} catch {
  Fail "Ya hay un despliegue en curso (existe $lockPath). Si es un bloqueo viejo, bórralo."
}

try {
  # -------------------------------------------------------------------------
  # 1. Traer la versión publicada
  # -------------------------------------------------------------------------
  if (-not (Test-Path (Join-Path $DeployRoot '.git'))) { Fail "No existe el repo en $DeployRoot" }
  Set-Location $DeployRoot

  if (-not $SkipPull) {
    Log "git fetch origin $Branch"
    & git fetch --prune origin $Branch 2>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { Fail "git fetch falló ($LASTEXITCODE)" }

    Log "git reset --hard origin/$Branch"
    & git reset --hard "origin/$Branch" 2>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { Fail "git reset falló ($LASTEXITCODE)" }
  }

  $commit = (& git rev-parse --short HEAD 2>$null).Trim()
  $subject = (& git log -1 --pretty=%s 2>$null).Trim()
  Log "Commit desplegado: $commit — $subject"

  if (-not (Test-Path (Join-Path $DeployRoot '.env'))) { Fail "Falta $DeployRoot\.env (no se versiona)." }

  # -------------------------------------------------------------------------
  # 2. Construir y levantar
  # -------------------------------------------------------------------------
  Log "docker compose build backend web"
  & docker compose build backend web 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -ne 0) { Fail "docker compose build falló ($LASTEXITCODE)" }

  # Compose no siempre recrea el contenedor cuando se reconstruye la misma etiqueta:
  # comparamos la imagen en ejecución con la recién construida y forzamos solo si difiere.
  $stale = @()
  foreach ($svc in @('backend', 'web')) {
    $cid = (& docker compose ps -q $svc 2>$null | Select-Object -First 1)
    if (-not $cid) { $stale += $svc; continue }
    $runningImg = ((& docker inspect $cid --format '{{.Image}}' 2>$null) | Select-Object -First 1)
    $tag = ((& docker inspect $cid --format '{{.Config.Image}}' 2>$null) | Select-Object -First 1)
    $builtImg = if ($tag) { ((& docker image inspect $tag --format '{{.Id}}' 2>$null) | Select-Object -First 1) } else { $null }
    if ($runningImg -and $builtImg -and ($runningImg.Trim() -eq $builtImg.Trim())) {
      Log "Servicio ${svc}: ya ejecuta la imagen recién construida."
    } else {
      Log "Servicio ${svc}: imagen desactualizada, se recreará el contenedor."
      $stale += $svc
    }
  }

  Log "docker compose up -d"
  & docker compose up -d 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -ne 0) { Fail "docker compose up falló ($LASTEXITCODE)" }

  if ($stale.Count -gt 0) {
    Log ("docker compose up -d --force-recreate --no-deps " + ($stale -join ' '))
    & docker compose up -d --force-recreate --no-deps @stale 2>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { Fail "No se pudieron recrear los servicios: $($stale -join ', ') ($LASTEXITCODE)" }
  }

  # -------------------------------------------------------------------------
  # 3. Esperar a que los servicios estén listos
  # -------------------------------------------------------------------------
  Log "Esperando backend y web (máx. 180 s)…"
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    $running = (& docker compose ps -q backend web 2>$null | Measure-Object).Count
    $health = (& curl.exe -s --max-time 5 http://127.0.0.1:8000/health 2>$null)
    if ($running -ge 2 -and $health -match '"db"\s*:\s*true' -and $health -match '"mqtt"\s*:\s*true' -and $health -match '"redis"\s*:\s*true') {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 3
  }
  if (-not $ready) { Fail "El backend no reportó salud completa a tiempo." }
  Log "Backend saludable: $health"

  # -------------------------------------------------------------------------
  # 4. Verificaciones funcionales
  # -------------------------------------------------------------------------
  $checks = @()

  $root = Invoke-Curl 'https://simon.zeusr2.duckdns.org/' @('--resolve', 'simon.zeusr2.duckdns.org:443:127.0.0.1')
  $checks += @{ name = 'Simon /'; ok = ($root -eq '200'); detail = $root }

  $config = Invoke-Curl 'https://simon.zeusr2.duckdns.org/config' @('--resolve', 'simon.zeusr2.duckdns.org:443:127.0.0.1')
  $checks += @{ name = 'Simon /config'; ok = ($config -eq '200'); detail = $config }

  $devices = Invoke-Curl 'https://simon.zeusr2.duckdns.org/api/devices' @('--resolve', 'simon.zeusr2.duckdns.org:443:127.0.0.1')
  $checks += @{ name = 'Simon /api/devices'; ok = ($devices -eq '200'); detail = $devices }

  $tplRaw = (& curl.exe -sk --max-time 15 'https://simon.zeusr2.duckdns.org/api/notebook-templates' --resolve 'simon.zeusr2.duckdns.org:443:127.0.0.1' 2>$null) -join ''
  $tplOk = ($tplRaw -match '"knn"' -and $tplRaw -match 'regresion')
  $checks += @{ name = 'Plantillas (knn + regresión)'; ok = $tplOk; detail = $(if ($tplOk) { 'ok' } else { 'faltan plantillas' }) }

  $ws = Invoke-Curl 'https://simon.zeusr2.duckdns.org/mqtt-ws' @(
    '--http1.1', '-H', 'Connection: Upgrade', '-H', 'Upgrade: websocket',
    '-H', 'Sec-WebSocket-Version: 13', '-H', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    '-H', 'Sec-WebSocket-Protocol: mqtt', '--resolve', 'simon.zeusr2.duckdns.org:443:127.0.0.1')
  $checks += @{ name = 'MQTT WebSocket (101)'; ok = ($ws -eq '101'); detail = $ws }

  $webId = (& docker compose ps -q web 2>$null | Select-Object -First 1)
  if ($webId) {
    $bundle = (& docker exec $webId sh -c "grep -l 'Modelos disponibles' /usr/share/nginx/html/assets/*.js 2>/dev/null | head -1" 2>$null)
    $checks += @{ name = 'Bundle web (Modelos sin API key)'; ok = [bool]$bundle; detail = $(if ($bundle) { 'ok' } else { 'no encontrado' }) }
  } else {
    $checks += @{ name = 'Contenedor web'; ok = $false; detail = 'no encontrado' }
  }

  # Imagen en ejecución == imagen construida (evita desplegar código viejo por caché de compose)
  $imgOk = $true
  $imgDetail = @()
  foreach ($svc in @('backend', 'web')) {
    $cid = (& docker compose ps -q $svc 2>$null | Select-Object -First 1)
    if (-not $cid) { $imgOk = $false; $imgDetail += "$svc=sin-contenedor"; continue }
    $runningImg = ((& docker inspect $cid --format '{{.Image}}' 2>$null) | Select-Object -First 1)
    $tag = ((& docker inspect $cid --format '{{.Config.Image}}' 2>$null) | Select-Object -First 1)
    $builtImg = ((& docker image inspect $tag --format '{{.Id}}' 2>$null) | Select-Object -First 1)
    if ($runningImg -and $builtImg -and ($runningImg.Trim() -eq $builtImg.Trim())) {
      $imgDetail += "$svc=al-dia"
    } else {
      $imgOk = $false
      $imgDetail += "$svc=desactualizado"
    }
  }
  $checks += @{ name = 'Imágenes al día (backend/web)'; ok = $imgOk; detail = ($imgDetail -join ' ') }

  $failed = @($checks | Where-Object { -not $_.ok })
  foreach ($c in $checks) { Log ("CHECK {0} [{1}] {2}" -f $c.name, $c.detail, $(if ($c.ok) { 'OK' } else { 'FALLO' })) }

  # -------------------------------------------------------------------------
  # 5. Resumen
  # -------------------------------------------------------------------------
  $okCount = @($checks | Where-Object { $_.ok }).Count
  if ($failed.Count -gt 0) {
    $msg = "Verificaciones fallidas: " + (($failed | ForEach-Object { "$($_.name) [$($_.detail)]" }) -join ', ')
    Fail $msg
  }

  Log "Despliegue correcto: $okCount/$($checks.Count) verificaciones OK."
  $summary = @"
### Despliegue correcto ✅
- **Commit:** ``$commit`` — $subject
- **Checks:** $okCount/$($checks.Count) OK
- **Log:** ``$logFile``

| Verificación | Resultado |
|---|---|
$((($checks | ForEach-Object { "| $($_.name) | $($_.detail) |" }) -join "`n"))
"@
  Write-StepSummary $summary
  Send-Telegram "<b>[DESPLIEGUE OK]</b>`nSimon Twin`nCommit: <code>$commit</code>`n$subject`nChecks: $okCount/$($checks.Count) OK`nhttps://simon.zeusr2.duckdns.org/config"
  exit 0
}
finally {
  if ($lock) { $lock.Dispose() }
  Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
}
