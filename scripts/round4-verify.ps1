# End-to-end verification of the Round 4 settings feature against a running
# dev server. Signs up a throwaway account, authenticates through the
# credentials provider, then walks the verification + statement flows.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\round4-verify.ps1

$ErrorActionPreference = "Continue"
$base = "http://localhost:3000"
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$email = "round4.$stamp@example.com"
$password = "Paper!Trade12345"
$username = "round4$stamp"

$fail = 0
function Check($label, $ok) {
  if ($ok) { Write-Host ("  PASS  " + $label) -ForegroundColor Green }
  else { Write-Host ("  FAIL  " + $label) -ForegroundColor Red; $script:fail++ }
}

function StatusOf($url, $sess) {
  try {
    $r = Invoke-WebRequest -Uri $url -WebSession $sess -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop
    return @{ code = $r.StatusCode; loc = $r.Headers['Location']; body = $r.Content; headers = $r.Headers }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { return @{ code = $resp.StatusCode.value__; loc = $resp.Headers['Location']; body = $null; headers = $resp.Headers } }
    return @{ code = -1; loc = $null; body = $_.Exception.Message; headers = $null }
  }
}

Write-Host "== 1. signup $email"
$signup = Invoke-RestMethod -Uri "$base/api/signup" -Method Post -ContentType "application/json" -Body (@{ username=$username; email=$email; password=$password } | ConvertTo-Json -Compress)
Check "signup returns user id" ($null -ne $signup.user.id)

Write-Host "== 2. credentials login"
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$csrf = Invoke-RestMethod -Uri "$base/api/auth/csrf" -WebSession $sess
$body = "csrfToken=$([uri]::EscapeDataString($csrf.csrfToken))&email=$([uri]::EscapeDataString($email))&password=$([uri]::EscapeDataString($password))&callbackUrl=$([uri]::EscapeDataString("$base/"))&json=true"
$null = Invoke-RestMethod -Uri "$base/api/auth/callback/credentials" -Method Post -ContentType "application/x-www-form-urlencoded" -Body $body -WebSession $sess
$session = Invoke-RestMethod -Uri "$base/api/auth/session" -WebSession $sess
Check "session resolves to signed-in user" ($null -ne $session.user -and $session.user.email -eq $email)

Write-Host "== 3. settings before verification"
$s = StatusOf "$base/settings" $sess
Check "GET /settings 200" ($s.code -eq 200)
Check "shows 'Email Unverified'" ($s.body -match "Email Unverified")
Check 'shows unverified limit $1,000' ($s.body -match '\$1,000')
Check "shows tab 'Account Statements'" ($s.body -match "Account Statements")

Write-Host "== 4. POST verify-email"
$verify = Invoke-RestMethod -Uri "$base/api/user/verify-email" -Method Post -WebSession $sess
Check "delivered=false" ($verify.delivered -eq $false)
Check "reason=NO_MAIL_PROVIDER" ($verify.reason -eq "NO_MAIL_PROVIDER")
Check "returns a token url" ($verify.url -match "/api/user/verify-email\?token=")

Write-Host "== 5. redeem the link"
$g = StatusOf $verify.url $sess
Check "redeem redirects 303 -> /settings?verified=1" ($g.code -eq 303 -and $g.loc -match "verified=1")

Write-Host "== 6. settings after verification"
$s2 = StatusOf "$base/settings?verified=1" $sess
Check "shows 'Email Verified'" ($s2.body -match "Email Verified")
Check 'shows verified limit $50,000' ($s2.body -match '\$50,000')

Write-Host "== 7. re-issue after verification is rejected"
try {
  $null = Invoke-RestMethod -Uri "$base/api/user/verify-email" -Method Post -WebSession $sess -ErrorAction Stop
  Check "second POST -> 409" $false
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Check "second POST -> 409" ($code -eq 409)
}

Write-Host "== 8. CSV statement export"
$csv = StatusOf "$base/api/user/export-statement" $sess
$ctype = if ($csv.headers) { [string]$csv.headers['Content-Type'] } else { '' }
$disp = if ($csv.headers) { [string]$csv.headers['Content-Disposition'] } else { '' }
Check "200" ($csv.code -eq 200)
Check "content-type text/csv" ($ctype -match "text/csv")
Check "attachment disposition" ($disp -match "attachment")
$firstLine = if ($csv.body) { (("" + $csv.body) -split "`n" | Select-Object -First 1) } else { "" }
Check "header row Date,Type,Asset,Amount,Price,Status" ($firstLine.Trim() -eq "Date,Type,Asset,Amount,Price,Status")

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL ROUND4 CHECKS PASSED" -ForegroundColor Green; exit 0 }
else { Write-Host "$fail ROUND4 CHECK(S) FAILED" -ForegroundColor Red; exit 1 }
