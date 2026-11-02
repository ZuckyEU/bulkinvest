# Seeds ledger rows for a throwaway user, exports the statement CSV, and
# asserts the row mapping and the crypto double-count guard.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\round4-statement-fixture.ps1

$ErrorActionPreference = "Continue"
$base = "http://localhost:3000"
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$email = "stmt.$stamp@example.com"
$password = "Paper!Trade12345"
$username = "stmt$stamp"

$fail = 0
function Check($label, $ok) {
  if ($ok) { Write-Host ("  PASS  " + $label) -ForegroundColor Green }
  else { Write-Host ("  FAIL  " + $label) -ForegroundColor Red; $script:fail++ }
}

Write-Host "== signup + seed"
$null = Invoke-RestMethod -Uri "$base/api/signup" -Method Post -ContentType "application/json" -Body (@{ username=$username; email=$email; password=$password } | ConvertTo-Json -Compress)
node .\scripts\seed-statement-fixture.cjs $email $stamp
Check "seed exited 0" ($LASTEXITCODE -eq 0)

Write-Host "== login"
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$csrf = Invoke-RestMethod -Uri "$base/api/auth/csrf" -WebSession $sess
$body = "csrfToken=$([uri]::EscapeDataString($csrf.csrfToken))&email=$([uri]::EscapeDataString($email))&password=$([uri]::EscapeDataString($password))&callbackUrl=$([uri]::EscapeDataString("$base/"))&json=true"
$null = Invoke-RestMethod -Uri "$base/api/auth/callback/credentials" -Method Post -ContentType "application/x-www-form-urlencoded" -Body $body -WebSession $sess
$session = Invoke-RestMethod -Uri "$base/api/auth/session" -WebSession $sess
Check "signed in" ($null -ne $session.user)

Write-Host "== export CSV"
$csv = Invoke-WebRequest -Uri "$base/api/user/export-statement" -WebSession $sess -UseBasicParsing
Check "200" ($csv.StatusCode -eq 200)

$lines = ($csv.Content -split "`r?`n") | Where-Object { $_ -ne "" }
Check "header row" ($lines[0].Trim() -eq "Date,Type,Asset,Amount,Price,Status")

$rows = @()
for ($i = 1; $i -lt $lines.Count; $i++) {
  $c = $lines[$i].Split(",")
  $rows += [pscustomobject]@{ Date=$c[0]; Type=$c[1]; Asset=$c[2]; Amount=$c[3]; Price=$c[4]; Status=$c[5] }
}
Write-Host ("  rows: " + $rows.Count)
$rows | Format-Table -AutoSize | Out-String | Write-Host

function RowOf($type, $asset) { $rows | Where-Object { $_.Type -eq $type -and $_.Asset -eq $asset } }

# Deposits: $100 (settled, once), $250 (pending), $500 (settled, once despite null transactionId).
$dep = $rows | Where-Object { $_.Type -eq "DEPOSIT" }
Check "exactly 3 deposit rows" ($dep.Count -eq 3)
Check "deposit #100 appears once" ((@($dep | Where-Object { $_.Amount -eq "100" }).Count) -eq 1)
Check "deposit #250 appears once" ((@($dep | Where-Object { $_.Amount -eq "250" }).Count) -eq 1)
Check "deposit #500 appears once (reference dedup)" ((@($dep | Where-Object { $_.Amount -eq "500" }).Count) -eq 1)
Check "deposit total 850 (no double count)" ((($dep | Measure-Object -Property Amount -Sum).Sum) -eq 850)

# Withdrawal.
$w = RowOf "WITHDRAWAL" "USDT"
Check "withdrawal row present" ($null -ne $w)
Check "withdrawal amount 40" ($w.Amount -eq "40")
Check "withdrawal status PENDING" ($w.Status -eq "PENDING")

# Filled trade.
$a = RowOf "BUY" "AAPL"
Check "AAPL row present" ($null -ne $a)
Check "AAPL notional 300" ($a.Amount -eq "300")
Check "AAPL price 150" ($a.Price -eq "150")
Check "AAPL status FILLED" ($a.Status -eq "FILLED")

# Queued trade: no fabricated $0.00 cells.
$t = RowOf "BUY" "TSLA"
Check "TSLA row present" ($null -ne $t)
Check "TSLA amount blank (not 0.00)" ($t.Amount -eq "")
Check "TSLA price blank (not 0.00)" ($t.Price -eq "")
Check "TSLA status RECORDED" ($t.Status -eq "RECORDED")

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL STATEMENT FIXTURE CHECKS PASSED" -ForegroundColor Green; exit 0 }
else { Write-Host "$fail STATEMENT FIXTURE CHECK(S) FAILED" -ForegroundColor Red; exit 1 }
