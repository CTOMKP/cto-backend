# PowerShell script to clean up both local and Railway databases

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  Database Cleanup - Local + Railway" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Clean local database
Write-Host "🏠 Step 1: Cleaning LOCAL database..." -ForegroundColor Yellow
Write-Host ""
node cleanup-database.js

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Local cleanup failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n" + "=" * 60
Write-Host ""

# 2. Clean Railway database
Write-Host "☁️  Step 2: Cleaning RAILWAY database..." -ForegroundColor Yellow
Write-Host ""

# Check if DATABASE_URL is set (should point to Railway in production)
if (-not $env:DATABASE_URL) {
    Write-Host "⚠️  DATABASE_URL not set in environment" -ForegroundColor Yellow
    Write-Host "Please set it first:" -ForegroundColor Yellow
    Write-Host '  $env:DATABASE_URL="your_railway_database_url"' -ForegroundColor Cyan
    Write-Host ""
    $confirm = Read-Host "Do you want to enter it now? (y/n)"
    
    if ($confirm -eq "y") {
        $railwayUrl = Read-Host "Enter Railway DATABASE_URL"
        $env:RAILWAY_DATABASE_URL = $railwayUrl
        node cleanup-railway-database.js
    } else {
        Write-Host "Skipping Railway cleanup" -ForegroundColor Yellow
    }
} else {
    # Use existing DATABASE_URL (assuming it points to Railway)
    $env:RAILWAY_DATABASE_URL = $env:DATABASE_URL
    node cleanup-railway-database.js
}

Write-Host "`n" + "=" * 60
Write-Host "✅ All database cleanup complete!" -ForegroundColor Green
Write-Host "=" * 60

