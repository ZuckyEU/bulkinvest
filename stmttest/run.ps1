<#
  Unit tests for the statement CSV renderer and account limits.

  The statement module imports Prisma for `buildStatement`, which is covered
  live against the database rather than here — these tests target the pure
  formatting logic. So the module is staged with its Prisma import swapped for
  a stub, compiled standalone (file arguments to tsc ignore the app tsconfig,
  so the strict settings there don't apply to this throwaway harness), and run.

  Usage:  powershell -File stmttest\run.ps1
#>
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$test = $PSScriptRoot

Write-Host "== Staging" -ForegroundColor Cyan

$statement = Get-Content (Join-Path $root "src\lib\statement.ts") -Raw
$import = 'import { prisma } from "@/lib/prisma";'
if (-not $statement.Contains($import)) {
  throw "statement.ts no longer starts with the expected prisma import; update run.ps1."
}
$statement = $statement.Replace($import, "const prisma: any = {};`nexport { prisma };")
Set-Content -Path (Join-Path $test "statement.ts") -Value $statement -NoNewline

Copy-Item (Join-Path $root "src\lib\account-limits.ts") (Join-Path $test "account-limits.ts") -Force

Write-Host "== Compiling" -ForegroundColor Cyan

Push-Location $root
try {
  $sources = @(
    (Join-Path $test "statement.ts"),
    (Join-Path $test "account-limits.ts"),
    (Join-Path $test "prisma-stub.ts")
  )
  npx tsc @sources `
    --target ES2020 `
    --module commonjs `
    --moduleResolution node `
    --esModuleInterop `
    --skipLibCheck `
    --outDir $test
  if ($LASTEXITCODE -ne 0) {
    throw "tsc failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Host "== Running" -ForegroundColor Cyan
node (Join-Path $test "statement.test.cjs")
exit $LASTEXITCODE
