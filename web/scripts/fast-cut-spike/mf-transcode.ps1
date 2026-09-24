<#
  Fast-cut spike (ADR-027): decode a file with Windows' own Media Foundation
  pipeline — the MP4 source and H.264 decoder that "Media Player" and
  "Films & TV" use — by transcoding it with Windows.Media.Transcoding to a
  high-bitrate MP4. The result is then checked with ffmpeg (barcodes): if the
  Windows decoder mishandled the parameter-set switch at a seam, the frames
  there would be wrong or missing.

  This is a headless stand-in for watching the file in the Windows player,
  not the player itself. Windows PowerShell 5.1 (WinRT projection).

    powershell -NoProfile -ExecutionPolicy Bypass -File mf-transcode.ps1 -In a.mp4 -Out b.mp4 [-Software]
#>
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [switch]$Software
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$methods = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTaskOp = $methods | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$asTaskProgress = $methods | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1'
} | Select-Object -First 1

function Await($op, [Type]$type) {
  $task = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  return $task.Result
}
function AwaitProgress($op) {
  $task = $asTaskProgress.MakeGenericMethod([double]).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType = WindowsRuntime] | Out-Null

$source = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $In).Path)) ([Windows.Storage.StorageFile])
$outDir = Split-Path -Parent ([System.IO.Path]::GetFullPath($Out))
$folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($outDir)) ([Windows.Storage.StorageFolder])
$target = Await ($folder.CreateFileAsync((Split-Path -Leaf $Out), [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])

$profile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateMp4([Windows.Media.MediaProperties.VideoEncodingQuality]::HD1080p)
$profile.Video.Bitrate = 40000000
$transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder
$transcoder.HardwareAccelerationEnabled = -not $Software
$prepared = Await ($transcoder.PrepareFileTranscodeAsync($source, $target, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
if (-not $prepared.CanTranscode) {
  Write-Output "CANNOT_TRANSCODE $($prepared.FailureReason)"
  exit 1
}
AwaitProgress ($prepared.TranscodeAsync())
Write-Output "OK $Out"
