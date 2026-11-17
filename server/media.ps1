param([int]$ParentPid = 0)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($operation, $resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ($managerType::RequestAsync()) ($managerType)

while ($true) {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit }
  $payload = @{ available = $false; title = ''; artist = ''; album = ''; status = 'closed'; source = '' }
  try {
    $session = $manager.GetCurrentSession()
    if ($session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $playback = $session.GetPlaybackInfo()
      $payload = @{
        available = $true
        title = "$($props.Title)"
        artist = "$($props.Artist)"
        album = "$($props.AlbumTitle)"
        status = "$($playback.PlaybackStatus)"
        source = "$($session.SourceAppUserModelId)"
      }
    }
  } catch {
    $payload = @{ available = $false; title = ''; artist = ''; album = ''; status = 'unavailable'; source = '' }
  }
  $payload | ConvertTo-Json -Compress
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 3000
}
