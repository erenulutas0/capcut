# Fills the browser's native "Save as" dialog without sending keystrokes (so
# nothing can land in another window): UI Automation finds the dialog that
# belongs to the given browser process tree, then window messages set the
# file name field (WM_SETTEXT) and press Save (BM_CLICK). With -ConfirmReplace
# it also answers "Yes" to Windows' "already exists, replace?" task dialog
# (TDM_CLICK_BUTTON with IDYES).
#
# Used only by scripts/measure-save-picker.mjs (ADR-026 measurements).
param(
  [Parameter(Mandatory = $true)][int]$BrowserPid,
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$TimeoutSec = 30,
  [switch]$ConfirmReplace
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ClipWin32 {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$WM_SETTEXT = 0x000C
$BM_CLICK = 0x00F5
$TDM_CLICK_BUTTON = 0x0466
$IDYES = 6

function Get-Tree([int]$rootPid) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($rootPid)
  $grew = $true
  while ($grew) {
    $grew = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
        [void]$ids.Add([int]$p.ProcessId)
        $grew = $true
      }
    }
  }
  return $ids
}

# Every '#32770' dialog owned by a window of the browser's process tree.
function Find-Dialogs($ids) {
  $dialogClass = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, '#32770')
  $found = @()
  foreach ($window in $AE::RootElement.FindAll($Scope::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    if (-not $ids.Contains([int]$window.Current.ProcessId)) { continue }
    if ($window.Current.ClassName -eq '#32770') { $found += $window }
    foreach ($inner in $window.FindAll($Scope::Children, $dialogClass)) { $found += $inner }
  }
  return $found
}

function Find-Control($element, [string]$className, [string]$id) {
  $byClass = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, $className)
  $byId = New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $id)
  return $element.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.AndCondition($byClass, $byId)))
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$ids = Get-Tree $BrowserPid
$dialog = $null
$edit = $null
while (-not $edit -and (Get-Date) -lt $deadline) {
  foreach ($candidate in (Find-Dialogs $ids)) {
    $field = Find-Control $candidate 'Edit' '1001'
    if ($field) { $dialog = $candidate; $edit = $field; break }
  }
  if (-not $edit) { Start-Sleep -Milliseconds 200; $ids = Get-Tree $BrowserPid }
}
if (-not $edit) { Write-Output 'NO_SAVE_DIALOG'; exit 2 }
Write-Output ("DIALOG " + $dialog.Current.Name)
$saveDialogHandle = $dialog.Current.NativeWindowHandle

[void][ClipWin32]::SendMessage([IntPtr]$edit.Current.NativeWindowHandle, $WM_SETTEXT, [IntPtr]::Zero, $Path)
$save = Find-Control $dialog 'Button' '1'
if (-not $save) { Write-Output 'NO_SAVE_BUTTON'; exit 4 }
[void][ClipWin32]::PostMessage([IntPtr]$save.Current.NativeWindowHandle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output 'SAVE_PRESSED'

if ($ConfirmReplace) {
  $confirm = $null
  while (-not $confirm -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
    foreach ($candidate in (Find-Dialogs $ids)) {
      if ($candidate.Current.NativeWindowHandle -ne $saveDialogHandle) { $confirm = $candidate; break }
    }
    if (-not $confirm) {
      # The question can also be a child of the save dialog itself.
      $inner = $dialog.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, '#32770')))
      if ($inner) { $confirm = $inner }
    }
  }
  if (-not $confirm) { Write-Output 'NO_REPLACE_QUESTION'; exit 5 }
  Write-Output ("QUESTION " + $confirm.Current.Name)
  [void][ClipWin32]::PostMessage([IntPtr]$confirm.Current.NativeWindowHandle, $TDM_CLICK_BUTTON, [IntPtr]$IDYES, [IntPtr]::Zero)
  Write-Output 'REPLACE_CONFIRMED'
}
exit 0
