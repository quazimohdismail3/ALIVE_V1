# scripts/download_stems.ps1 — Windows fallback for download_stems.js
# Use when Node.js fetch fails with ECONNRESET on incompetech.com.
# Run from repo root: powershell -File scripts/download_stems.ps1

$base = Join-Path $PSScriptRoot "..\frontend\public\stems"
$km   = "https://incompetech.com/music/royalty-free/mp3-royaltyfree"
$oga  = "https://opengameart.org/sites/default/files"

$stems = @(
    @{ key="ground";   file="dungeon_drone_cc0.ogg";          url="$oga/dungeon_ambient_1_0.ogg" },
    @{ key="breath";   file="birds_wind_cc0.ogg";             url="$oga/Birds%20and%20Wind%20-%20Ambient_1.ogg" },
    @{ key="breath";   file="fresh_air_ccby.mp3";             url="$km/Fresh%20Air.mp3" },
    @{ key="breath";   file="soaring_ccby.mp3";               url="$km/Soaring.mp3" },
    @{ key="breath";   file="river_flute_ccby.mp3";           url="$km/River%20Flute.mp3" },
    @{ key="breath";   file="dreamer_ccby.mp3";               url="$km/Dreamer.mp3" },
    @{ key="harmonic"; file="ether_vox_ccby.mp3";             url="$km/Ether%20Vox.mp3" },
    @{ key="harmonic"; file="infinite_perspective_ccby.mp3";  url="$km/Infinite%20Perspective.mp3" },
    @{ key="harmonic"; file="mesmerize_ccby.mp3";             url="$km/Mesmerize.mp3" },
    @{ key="harmonic"; file="drone_in_d_ccby.mp3";            url="$km/Drone%20in%20D.mp3" },
    @{ key="harmonic"; file="dream_catcher_ccby.mp3";         url="$km/Dream%20Catcher.mp3" },
    @{ key="spatial";  file="forest_ambience_cc0.mp3";        url="$oga/Forest_Ambience.mp3" },
    @{ key="spatial";  file="magic_forest_ccby.mp3";          url="$km/Magic%20Forest.mp3" },
    @{ key="spatial";  file="garden_music_ccby.mp3";          url="$km/Garden%20Music.mp3" },
    @{ key="spatial";  file="myst_on_moor_ccby.mp3";          url="$km/Myst%20on%20the%20Moor.mp3" },
    @{ key="spatial";  file="nightdreams_ccby.mp3";           url="$km/Nightdreams.mp3" },
    @{ key="morning";  file="morning_ccby.mp3";               url="$km/Morning.mp3" }
)

$wc = New-Object System.Net.WebClient
$wc.Headers.Add("User-Agent", "Mozilla/5.0")
$failed = 0

foreach ($s in $stems) {
    $dir  = Join-Path $base $s.key
    $dest = Join-Path $dir $s.file
    New-Item -ItemType Directory -Force $dir | Out-Null
    if (Test-Path $dest) { Write-Host "SKIP  $($s.key)/$($s.file)"; continue }
    Write-Host "FETCH $($s.key)/$($s.file)"
    try {
        $wc.DownloadFile($s.url, $dest)
        $kb = [math]::Round((Get-Item $dest).Length / 1024)
        Write-Host "OK    $($s.key)/$($s.file) ($kb KB)"
    } catch {
        Write-Host "FAIL  $($s.key)/$($s.file): $($_.Exception.Message)"
        $failed++
    }
    Start-Sleep -Milliseconds 800
}

if ($failed -gt 0) {
    Write-Host "`n$failed stem(s) failed — chord engine fallback will cover missing layers."
} else {
    Write-Host "`nAll stems ready."
}
