# View Recent Privy Login/Sync Logs
# This script shows the last 20 lines of login logs

Write-Host "📋 Recent Privy Login/Sync Logs" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""

if (Test-Path "privy-sync-logs.txt") {
    $logContent = Get-Content "privy-sync-logs.txt" -Tail 20
    if ($logContent) {
        $logContent | ForEach-Object {
            Write-Host $_ -ForegroundColor White
        }
    } else {
        Write-Host "📝 Log file is empty" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ Log file 'privy-sync-logs.txt' not found" -ForegroundColor Red
    Write-Host "💡 The log file will be created when you attempt to login" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "💡 To monitor logs in real-time, run: .\monitor-login-logs.ps1" -ForegroundColor Cyan
