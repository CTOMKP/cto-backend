# PowerShell script to read Privy logs
$logFile = Join-Path $PSScriptRoot "privy-sync-logs.txt"

if (Test-Path $logFile) {
    Write-Host "=== PRIVY SYNC LOGS ===" -ForegroundColor Green
    Write-Host ""
    Get-Content $logFile -Tail 50
    Write-Host ""
    Write-Host "=== END OF LOGS ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "To watch logs in real-time, run:" -ForegroundColor Yellow
    Write-Host "Get-Content privy-sync-logs.txt -Wait -Tail 20" -ForegroundColor Cyan
} else {
    Write-Host "No log file found. Logs will be created when someone logs in via Privy." -ForegroundColor Yellow
    Write-Host "Log file location: $logFile" -ForegroundColor Yellow
}

