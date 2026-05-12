# Pushes every KEY=VALUE in workspace-root .env into the linked Vercel
# project as a Production env var. Overwrites existing values.
#
# Usage:
#   pnpm sync:env
#   # or:
#   pwsh scripts/sync-env-to-vercel.ps1
#
# Requires:
#   - Vercel CLI installed and logged in (`vercel login`)
#   - Project linked (`.vercel/repo.json` or `.vercel/project.json`)
#
# After running, redeploy on Vercel to pick up the new values:
#   pnpm deploy:prod      (or push a commit, or click Redeploy)

[CmdletBinding()]
param(
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env"),
  [string]$ProjectDir = (Join-Path $PSScriptRoot "..\apps\web"),
  [string[]]$Environments = @('production')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $EnvFile)) {
  Write-Error "Env file not found: $EnvFile"
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
    $key, $value = $line -split '=', 2
    $key = $key.Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
      Write-Host "skip $key (empty value)" -ForegroundColor DarkGray
      continue
    }
    foreach ($envName in $Environments) {
      # Remove existing silently (ignore failure if it doesn't exist).
      & vercel env rm $key $envName --yes 2>&1 | Out-Null
      # Add the new value via stdin so the secret doesn't appear in argv.
      $value | & vercel env add $key $envName 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ $key  ($envName)" -ForegroundColor Green
      } else {
        Write-Host "✗ $key  ($envName) — vercel env add failed" -ForegroundColor Red
      }
    }
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Done. Redeploy to apply changes:" -ForegroundColor Cyan
Write-Host "  pnpm deploy:prod      # or push a commit / click Redeploy" -ForegroundColor DarkGray
