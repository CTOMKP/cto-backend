# Test Solscan API with different header formats
# Replace YOUR_API_KEY with your actual Solscan API key

$apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjcmVhdGVkQXQiOjE3NjcwMzk4ODY5MDMsImVtYWlsIjoiYmFudGVyY29wQGdtYWlsLmNvbSIsImFjdGlvbiI6InRva2VuLWFwaSIsImFwaVZlcnNpb24iOiJ2MiIsImlhdCI6MTc2NzAzOTg4Nn0.MHywPv97_xkaaTrhef5B5WsY3kCcOGvIIS3jZUBrat0"
$tokenAddress = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"  # USDC on Solana

Write-Host "Testing Solscan API with 'token' header..." -ForegroundColor Yellow

# Test with 'token' header (should work for V2 API)
$headers = @{
    "token" = $apiKey
    "Accept" = "application/json"
}

$url = "https://pro-api.solscan.io/v2.0/token/holders?address=$tokenAddress&page=1&page_size=1"

try {
    $response = Invoke-WebRequest -Uri $url -Headers $headers -Method Get
    Write-Host "✅ SUCCESS with 'token' header!" -ForegroundColor Green
    Write-Host "Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Cyan
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ FAILED with 'token' header" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body: $responseBody" -ForegroundColor Red
    }
}

Write-Host "`nTesting with 'X-API-KEY' header (for comparison)..." -ForegroundColor Yellow

# Test with 'X-API-KEY' header (should fail for V2 API)
$headers2 = @{
    "X-API-KEY" = $apiKey
    "Accept" = "application/json"
}

try {
    $response2 = Invoke-WebRequest -Uri $url -Headers $headers2 -Method Get
    Write-Host "✅ SUCCESS with 'X-API-KEY' header!" -ForegroundColor Green
    Write-Host "Status Code: $($response2.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "❌ FAILED with 'X-API-KEY' header (expected)" -ForegroundColor Yellow
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
}

