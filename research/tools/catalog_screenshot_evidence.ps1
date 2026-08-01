param([Parameter(Mandatory = $true)][string]$EvidenceDirectory)

$root = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$manifestPath = Join-Path $root "artifact_manifest.csv"
$records = Get-ChildItem -LiteralPath $root -Recurse -File |
    Where-Object { $_.FullName -ne $manifestPath } |
    Sort-Object FullName |
    ForEach-Object {
        $relative = $_.FullName.Substring($root.Length + 1).Replace("\", "/")
        [pscustomobject]@{
            relative_path = $relative
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
            bytes = $_.Length
            captured_utc = $_.LastWriteTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            access_class = "restricted_identifiable"
            evidence_class = "functional_observational"
        }
    }
$records | Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding utf8
Write-Output "Catalogued $($records.Count) evidence files in $manifestPath"
