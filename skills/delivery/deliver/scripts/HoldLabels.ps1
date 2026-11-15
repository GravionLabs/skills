# Shared by Get-ObjectiveStatus.ps1 and Invoke-DeliverLoop.ps1 (dot-sourced): which labels keep a PBI out of a delivery.
# One list, one function, so the status rule and the loop's eligibility cannot drift apart (#604).
# The claim (assignee) is not a label: the status checks it for foreign claims, the loop works under its own claim.
$script:HoldLabels = @('release-test', 'needs-decision', 'needs-refinement', 'interactive')

# Reason of the first hold label in $Labels, $null when none holds the PBI.
function Get-HoldReason([string[]]$Labels) {
  foreach ($l in $script:HoldLabels) {
    if ($Labels -contains $l) { if ($l -eq 'release-test') { return 'release test' } else { return $l } }
  }
  return $null
}
