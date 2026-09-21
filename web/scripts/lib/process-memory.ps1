# Samples the private memory of a browser process tree, once per interval.
#
# Why outside the browser: Chromium rounds `performance.memory` for privacy, so
# it cannot show what an export really costs, and it does not see the encode
# worker at all. The operating system can.
#
# Output: one line per sample
#   <unix ms> <total private bytes> <largest single process private bytes> <process count>

param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [int]$IntervalMs = 400
)

$ErrorActionPreference = 'SilentlyContinue'

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
  foreach ($proc in $procs) {
    $private = [int64]$proc.PrivateMemorySize64
    $total += $private
    if ($private -gt $largest) { $largest = $private }
  }

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  [Console]::Out.WriteLine("$now $total $largest $($procs.Count)")
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds $IntervalMs
}
