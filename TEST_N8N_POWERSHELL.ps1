# PowerShell script to test n8n webhook
# Run this in PowerShell: .\TEST_N8N_POWERSHELL.ps1

$body = @{
    contractAddress = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
    chain = "solana"
    tokenInfo = @{
        name = "BONK"
        symbol = "BONK"
        image = "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I"
        decimals = 5
    }
    security = @{
        isMintable = $false
        isFreezable = $false
        lpLockPercentage = 99
        totalSupply = 100000000000
        circulatingSupply = 100000000000
        lpLocks = @()
    }
    holders = @{
        count = 100000
        topHolders = @(
            @{
                address = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
                balance = 1000000
                percentage = 0.1
            }
        )
    }
    developer = @{
        creatorAddress = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
        creatorBalance = 0
        creatorStatus = "creator_sold"
        top10HolderRate = 0.2
        twitterCreateTokenCount = 0
    }
    trading = @{
        price = 0.00001
        priceChange24h = 5.5
        volume24h = 1000000
        buys24h = 500
        sells24h = 300
        liquidity = 500000
        holderCount = 100000
    }
    tokenAge = 365
    topTraders = @()
} | ConvertTo-Json -Depth 10

$headers = @{
    "Content-Type" = "application/json"
}

Write-Host "Testing n8n webhook..." -ForegroundColor Yellow
Write-Host "URL: https://n8n.ctomarketplace.com/webhook/vetting/submit" -ForegroundColor Cyan
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "https://n8n.ctomarketplace.com/webhook/vetting/submit" `
        -Method Post `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop

    Write-Host "✅ SUCCESS! Webhook responded:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10
    Write-Host ""
    Write-Host "Check n8n dashboard for execution: https://n8n.ctomarketplace.com" -ForegroundColor Cyan
} catch {
    Write-Host "❌ ERROR: Webhook failed" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "Error Message: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body: $responseBody" -ForegroundColor Red
    }
}

