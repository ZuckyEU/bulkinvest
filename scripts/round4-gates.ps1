<#
  Round 4 gate: apply the verification migration, regenerate the Prisma client,
  then typecheck / lint / build / unit-test the Settings work.

  Writes a log next to this script so results survive even when stdout is not
  captured by the calling harness.

  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\round4-gates.ps1
#>
param()
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "_round4.log"

function Step([string]$name, [scriptblock]$body) {
  Add-Content -Path $log -Value "" -Encoding utf8
  Add-Content -Path $log -Value "===== $name =====" -Encoding utf8
  try {
    & $body 2>&1 | ForEach-Object { "$_" } | Add-Content -Path $log -Encoding utf8
    Add-Content -Path $log -Value "[$name] exit=$LASTEXITCODE" -Encoding utf8
  } catch {
    Add-Content -Path $log -Value "[$name] THREW: $($_.Exception.Message)" -Encoding utf8
  }
}

Set-Content -Path $log -Value "round4 gates started $(Get-Date -Format o)" -Encoding utf8
Push-Location $root
try {
  # 1. Schema must reach the client before anything can typecheck.
  Step "prisma migrate deploy" { npx prisma migrate deploy }
  Step "prisma generate" { npx prisma generate }

  # 2. Gates.
  Step "tsc --noEmit" { npx tsc --noEmit }
  Step "next lint" { npx next lint }
  Step "next build" { npx next build }

  # 3. CSV unit tests (stages statement.ts with Prisma stubbed).
  Step "stmttest" { powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "stmttest\run.ps1") }

  # 4. Quick environment facts for the report.
  Step "node/npm" { node --version; npm --version }
  Step "git-status" { git status --short }
} finally {
  Pop-Location
  Add-Content -Path $log -Value "" -Encoding utf8
  Add-Content -Path $log -Value "round4 gates finished $(Get-Date -Format o)" -Encoding utf8
}
