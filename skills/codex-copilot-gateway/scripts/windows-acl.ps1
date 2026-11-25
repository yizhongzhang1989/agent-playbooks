param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Check', 'CreateDirectory')]
    [string] $Action,
    [Parameter(Mandatory = $true)]
    [string] $Path
)

$ErrorActionPreference = 'Stop'
# A Node child of PowerShell 7 can inherit an incompatible PSModulePath.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')

if ($Action -eq 'CreateDirectory') {
    if (Test-Path -LiteralPath $Path) {
        throw 'Private directory already exists; inspect it rather than changing its ACL.'
    }
    New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($user)
    $security.SetAccessRuleProtection($true, $false)
    foreach ($identity in @($user, $system)) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'
        )
        $security.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $security
}

$item = Get-Item -LiteralPath $Path -Force
if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw 'Private paths must not be reparse points.'
}
$acl = Get-Acl -LiteralPath $Path
$allowed = @($user.Value, $system.Value)
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
$grants = @($rules | Where-Object { $_.AccessControlType -eq 'Allow' })
$unexpected = @($grants | Where-Object { $_.IdentityReference.Value -notin $allowed })
if ($owner -in $allowed -and $grants.Count -gt 0 -and $unexpected.Count -eq 0) {
    'private'
} else {
    'unsafe'
}
