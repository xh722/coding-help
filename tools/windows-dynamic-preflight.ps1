[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SamplePath,
    [string]$CaseRoot = "C:\IR\interviewcoder-dynamic",
    [string]$ExpectedSha256 = "37843b027f36c67153bf16fae40d94fc3542d765a5a41cb67e7fc39755a96f39"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SamplePath -PathType Leaf)) {
    throw "SamplePath does not exist: $SamplePath"
}

New-Item -ItemType Directory -Force -Path $CaseRoot | Out-Null
$sample = Get-Item -LiteralPath $SamplePath
$hash = Get-FileHash -LiteralPath $SamplePath -Algorithm SHA256
$actualHash = $hash.Hash.ToLowerInvariant()
if ($ExpectedSha256 -and $actualHash -ne $ExpectedSha256.ToLowerInvariant()) {
    throw "Sample SHA256 does not match the expected authorized fixture; dynamic execution was not started."
}
$timestamp = (Get-Date).ToUniversalTime().ToString("o")

[pscustomobject]@{
    samplePath = $sample.FullName
    sampleName = $sample.Name
    size = $sample.Length
    sha256 = $actualHash
    expectedSha256 = $ExpectedSha256.ToLowerInvariant()
    collectedAtUtc = $timestamp
    executionStarted = $false
    note = "Static preflight only; the sample was not started."
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $CaseRoot "sample-manifest.json") -Encoding UTF8

Get-CimInstance Win32_OperatingSystem |
    Select-Object Caption, Version, BuildNumber, OSArchitecture, Locale, LastBootUpTime |
    Out-File -LiteralPath (Join-Path $CaseRoot "os.txt") -Encoding UTF8

Get-Process |
    Sort-Object ProcessName |
    Select-Object Id, ProcessName, Path, CPU, StartTime |
    Export-Csv -LiteralPath (Join-Path $CaseRoot "processes-before.csv") -NoTypeInformation -Encoding UTF8

Get-ChildItem Env: |
    Sort-Object Name |
    Select-Object Name, Value |
    Export-Csv -LiteralPath (Join-Path $CaseRoot "environment.csv") -NoTypeInformation -Encoding UTF8

Get-ScheduledTask |
    Select-Object TaskName, TaskPath, State |
    Export-Csv -LiteralPath (Join-Path $CaseRoot "tasks-before.csv") -NoTypeInformation -Encoding UTF8

$registryOutput = Join-Path $CaseRoot "registry-before.txt"
& reg.exe query HKCU\Software /s /f interviewcoder /k 2>$null |
    Set-Content -LiteralPath $registryOutput -Encoding UTF8

Write-Output "Preflight collected in $CaseRoot"
Write-Output "SHA256: $actualHash"
Write-Output "executionStarted: false"
