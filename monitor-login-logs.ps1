# Monitor Privy Login/Sync Logs
# This script watches the privy-sync-logs.txt file for login-related logs

Write-Host "🔍 Monitoring Privy Login/Sync Logs..." -ForegroundColor Green
Write-Host "📁 Log file: privy-sync-logs.txt" -ForegroundColor Yellow
Write-Host "⏹️  Press Ctrl+C to stop monitoring" -ForegroundColor Red
Write-Host ""

# Check if log file exists
if (-not (Test-Path "privy-sync-logs.txt")) {
    Write-Host "⚠️  Log file doesn't exist yet. It will be created when first login attempt is made." -ForegroundColor Yellow
    Write-Host "🔄 Waiting for log file to be created..." -ForegroundColor Cyan
}

# Monitor the log file
try {
    if (Test-Path "privy-sync-logs.txt") {
        Get-Content "privy-sync-logs.txt" -Wait -Tail 0 | ForEach-Object {
            $timestamp = Get-Date -Format "HH:mm:ss"
            Write-Host "[$timestamp] $_" -ForegroundColor White
        }
    } else {
        # Wait for file to be created
        while (-not (Test-Path "privy-sync-logs.txt")) {
            Start-Sleep -Seconds 1
        }
        Write-Host "✅ Log file created! Starting to monitor..." -ForegroundColor Green
        Get-Content "privy-sync-logs.txt" -Wait -Tail 0 | ForEach-Object {
            $timestamp = Get-Date -Format "HH:mm:ss"
            Write-Host "[$timestamp] $_" -ForegroundColor White
        }
    }
} catch {
    Write-Host "❌ Error monitoring logs: $($_.Exception.Message)" -ForegroundColor Red
}
