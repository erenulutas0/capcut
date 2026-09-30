# Samples the private memory of a browser process tree, once per interval.
#
# Why outside the browser: Chromium rounds `performance.memory` for privacy, so
# it cannot show what an export really costs, and it does not see the encode
# worker at all. The operating system can.
#
# Output: one line per sample
#   <unix ms> <total private bytes> <largest single process private bytes> <process count> <by type>
#
# <by type> (ADR-029) splits the total by Chromium process type, read from the
# `--type=` switch of each command line (none = the browser process itself;
# utility processes by their `--utility-sub-type=` service name):
#   browser:123,renderer:456,gpu-process:789,utility/network.mojom.NetworkService:12
# The renderer that hosts the page and its workers is the largest `renderer`;
# `renderer-max:` gives that one alone. Older readers ignore the fifth column.

param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [int]$IntervalMs = 400
)

$ErrorActionPreference = 'SilentlyContinue'

# Command lines only for processes not seen before (the query is slower).
$typeOf = @{}
function Get-ChromiumType([int]$id) {
  if ($typeOf.ContainsKey($id)) { return $typeOf[$id] }
  $line = (Get-CimInstance Win32_Process -Filter "ProcessId = $id" -Property CommandLine).CommandLine
  $type = 'browser'
  if ($line -match '--type=([^ "]+)') { $type = $Matches[1] }
  if ($type -eq 'utility' -and $line -match '--utility-sub-type=([^ "]+)') { $type = "utility/$($Matches[1])" }
  $typeOf[$id] = $type
  return $type
}

while ($true) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId
  $children = @{}
  foreach ($p in $all) {
    $parent = [int]$p.ParentProcessId
    if (-not $children.ContainsKey($parent)) { $children[$parent] = New-Object System.Collections.ArrayList }
    [void]$children[$parent].Add([int]$p.ProcessId)
  }

  $tree = New-Object System.Collections.ArrayList
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($RootPid)
  while ($queue.Count -gt 0) {
    $id = $queue.Dequeue()
    [void]$tree.Add($id)
    if ($children.ContainsKey($id)) {
      foreach ($c in $children[$id]) { $queue.Enqueue($c) }
    }
  }

  $procs = Get-Process -Id $tree
  if (-not $procs) { break }

  $total = [int64]0
  $largest = [int64]0
  $byType = [ordered]@{}
  $rendererMax = [int64]0
  foreach ($proc in $procs) {
    $private = [int64]$proc.PrivateMemorySize64
    $total += $private
    if ($private -gt $largest) { $largest = $private }
    $type = Get-ChromiumType $proc.Id
    if (-not $byType.Contains($type)) { $byType[$type] = [int64]0 }
    $byType[$type] += $private
    if ($type -eq 'renderer' -and $private -gt $rendererMax) { $rendererMax = $private }
  }
  $parts = @()
  foreach ($key in $byType.Keys) { $parts += "${key}:$($byType[$key])" }
  $parts += "renderer-max:$rendererMax"

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  [Console]::Out.WriteLine("$now $total $largest $($procs.Count) $($parts -join ',')")
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds $IntervalMs
}
