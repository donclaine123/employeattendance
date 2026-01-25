$migrationsDir = "d:\THESIS 1\employeattendance\supabase\migrations"
$outputFile = "d:\THESIS 1\employeattendance\server\postgres\rpc.sql"

# Get all RPC migration files (files containing "_rpc_" in their name)
$files = Get-ChildItem -Path $migrationsDir -Filter "*_rpc_*.sql" | Sort-Object Name

if ($files.Count -eq 0) {
    Write-Host "No RPC migration files found in $migrationsDir" -ForegroundColor Red
    exit
}

Write-Host "Found $($files.Count) RPC files. Consolidating..." -ForegroundColor Cyan

# Create/Empty the output file
$header = "-- Consolidated RPC Functions`n-- Generated on $(Get-Date)`n`n"
Set-Content -Path $outputFile -Value $header -Encoding UTF8

# Read each file and append to output
foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
    
    # Append content with a separator
    $separator = "`n`n-- ==========================================`n-- From: $($file.Name)`n-- ==========================================`n`n"
    Add-Content -Path $outputFile -Value $separator -Encoding UTF8
    Add-Content -Path $outputFile -Value $content -Encoding UTF8
    
    Write-Host "Added: $($file.Name)" -ForegroundColor Green
}

Write-Host "`nSuccessfully created consolidated file at:" -ForegroundColor Yellow
Write-Host $outputFile -ForegroundColor White
