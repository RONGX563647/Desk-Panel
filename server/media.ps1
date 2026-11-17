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
  $payload = @{ available = $false; title = ''; artist = ''; album = ''; status = 'closed'; source = ''; position = 0; duration = 0 }
  try {
    $session = $manager.GetCurrentSession()
    if ($session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $playback = $session.GetPlaybackInfo()
      $position = 0
      $duration = 0
      try {
        $timeline = $session.GetTimelineProperties()
        $position = [int]$timeline.Position.TotalSeconds
        $duration = [int]$timeline.EndTime.TotalSeconds
      } catch {
        # 部分播放器不提供时间轴
      }
      $payload = @{
        available = $true
        title = "$($props.Title)"
        artist = "$($props.Artist)"
        album = "$($props.AlbumTitle)"
        status = "$($playback.PlaybackStatus)"
        source = "$($session.SourceAppUserModelId)"
        position = $position
        duration = $duration
      }
    }
  } catch {
    $payload = @{ available = $false; title = ''; artist = ''; album = ''; status = 'unavailable'; source = ''; position = 0; duration = 0 }
  }
  $payload | ConvertTo-Json -Compress
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 3000
}
