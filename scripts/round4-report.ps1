<#
  Compact gate report for the Round 4 Settings work.

  The calling harness does not capture stdout, so the outcome is encoded in the
  process exit code instead. It runs the gates in order and stops at the first
  failure, which is also the order they must be fixed in.

    0  everything passed (migrate, generate, tsc, lint, build, unit tests)
    1  prisma migrate failed
    2  prisma generate failed
    3  tsc --noEmit failed
    4  next lint failed
    5  next build failed
    6  statement unit tests failed

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\round4-report.ps1
#>
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
  npx prisma migrate deploy *> $null
  if ($LASTEXITCODE -ne 0) { exit 1 }

  npx prisma generate *> $null
  if ($LASTEXITCODE -ne 0) { exit 2 }

  npx tsc --noEmit *> $null
  if ($LASTEXITCODE -ne 0) { exit 3 }

  npx next lint *> $null
  if ($LASTEXITCODE -ne 0) { exit 4 }

  npx next build *> $null
  if ($LASTEXITCODE -ne 0) { exit 5 }

  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "stmttest\run.ps1") *> $null
  if ($LASTEXITCODE -ne 0) { exit 6 }

  exit 0
} finally {
  Pop-Location
}
