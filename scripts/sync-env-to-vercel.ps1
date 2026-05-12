# Pushes every KEY=VALUE in workspace-root .env into the linked Vercel
# project as a Production env var. Overwrites existing values.
#
# Usage:
#   pnpm sync:env
#   # or directly:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-env-to-vercel.ps1
#
# Requires:
#   - Vercel CLI installed and logged in (`vercel login`)
#   - Project linked at workspace root (`.vercel/repo.json`)
#
# After running, redeploy on Vercel to apply the new values.

[CmdletBinding()]
param(
  [string]$EnvFile,
  [string]$ProjectDir,
  [string[]]$Environments = @('production')
)

# Don't auto-stop on native stderr; we check $LASTEXITCODE explicitly.
$ErrorActionPreference = 'Continue'

# Resolve script-relative paths.
$here = if ($PSScriptRoot) { $PSScriptRoot } elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { (Get-Location).Path }
if (-not $EnvFile)    { $EnvFile    = Join-Path $here '..\.env' }
if (-not $ProjectDir) { $ProjectDir = Join-Path $here '..\apps\web' }

if (-not (Test-Path $EnvFile)) {
  Write-Host "Env file not found: $EnvFile" -ForegroundColor Red
  exit 1
}

$envLines = Get-Content $EnvFile | Where-Object {
  $_ -match '^\s*[A-Z][A-Z0-9_]*=' -and $_ -notmatch '^\s*#'
}

if ($envLines.Count -eq 0) {
  Write-Host "No env vars found in $EnvFile" -ForegroundColor Yellow
  exit 0
}

Push-Location $ProjectDir
try {
  foreach ($line in $envLines) {
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)
    if ([string]::IsNullOrWhiteSpace($value)) {
      Write-Host "skip $key (empty value)" -ForegroundColor DarkGray
      continue
    }
    foreach ($envName in $Environments) {
      # Remove existing var silently. Failure here is fine — it may not exist.
      $null = & vercel env rm $key $envName --yes 2>$null
      # Reset exit code so the add step's check is meaningful.
      $global:LASTEXITCODE = 0

      # Add the new value, piping it via stdin so the secret never appears
      # in command-line history.
      $null = $value | & vercel env add $key $envName 2>$null

      if ($LASTEXITCODE -eq 0) {
        Write-Host ("[OK] {0,-25} ({1})" -f $key, $envName) -ForegroundColor Green
      } else {
        Write-Host ("[FAIL] {0,-25} ({1}) - vercel env add exited $LASTEXITCODE" -f $key, $envName) -ForegroundColor Red
      }
    }
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Done. Redeploy to apply changes:" -ForegroundColor Cyan
Write-Host "  pnpm deploy:prod    # or git push / Vercel UI Redeploy" -ForegroundColor DarkGray
