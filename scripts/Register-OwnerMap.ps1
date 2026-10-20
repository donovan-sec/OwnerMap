<#
.SYNOPSIS
    Create or update the OwnerMap app registration with read-only delegated permissions.

.DESCRIPTION
    Registers one single-tenant Microsoft Entra app named OwnerMap (or updates the
    existing one). Sets the Single-page application redirect URI list to the URLs
    you pass, and sets Microsoft Graph delegated permissions to exactly eight
    read-only scopes.

    The person running the script signs in with Application.ReadWrite.All so the
    registration can be created. That permission is not added to OwnerMap.

    The script does not grant admin consent, does not create a client secret, and
    does not change users, groups, licenses, or policies.

    Run -WhatIf to print the plan. -WhatIf does not sign in and does not need the
    Microsoft Graph modules.

.PARAMETER DisplayName
    App registration display name. Default is OwnerMap. Re-running with the same
    name updates that registration. If more than one app already uses the name,
    the script stops.

.PARAMETER RedirectUri
    One or more exact page URLs. Pass a single URL, or several, for example
    the localhost page and an internal hostname:
    http://localhost:8080/ownermap.html
    and https://ownermap.contoso.local/ownermap.html.
    The script replaces the Single-page application redirect list with this set.
    Pass every URL you want to keep. http is accepted only for localhost.

.PARAMETER ClientId
    Application (client) ID of an existing registration to update. If it does not
    exist, the script stops instead of creating a second app.

.EXAMPLE
    .\scripts\Register-OwnerMap.ps1 -RedirectUri 'http://localhost:8080/ownermap.html' -WhatIf

.EXAMPLE
    .\scripts\Register-OwnerMap.ps1 -RedirectUri 'https://ownermap.contoso.local/ownermap.html'

.EXAMPLE
    .\scripts\Register-OwnerMap.ps1 -RedirectUri 'http://localhost:8080/ownermap.html','https://ownermap.contoso.local/ownermap.html'

.NOTES
    Requires Windows PowerShell 5.1 or PowerShell 7, and the modules
    Microsoft.Graph.Authentication and Microsoft.Graph.Applications (v2).
    Docs: docs/SETUP.md
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter()]
    [string]$DisplayName = 'OwnerMap',

    [Parameter(Mandatory = $true)]
    [string[]]$RedirectUri,

    [Parameter()]
    [string]$ClientId
)

$ErrorActionPreference = 'Stop'

$GraphAppId = '00000003-0000-0000-c000-000000000000'

# OWNERMAP_SCOPES_START
$OwnerMapScopes = @(
    'User.Read',
    'Group.Read.All',
    'GroupMember.Read.All',
    'User.Read.All',
    'Directory.Read.All',
    'Application.Read.All',
    'AuditLog.Read.All',
    'Policy.Read.All'
)
# OWNERMAP_SCOPES_END

function Test-ExactContains {
    param(
        [string[]]$List,
        [string]$Value
    )
    foreach ($item in @($List)) {
        if ([string]$item -ceq $Value) { return $true }
    }
    return $false
}

function Get-ObjectProperty {
    param(
        $Object,
        [string]$Name
    )
    if (-not $Object) { return $null }
    $pascal = $Name.Substring(0, 1).ToUpper() + $Name.Substring(1)
    $names = @($Object.PSObject.Properties.Name)
    if ($names -contains $pascal) { return $Object.$pascal }
    if ($names -contains $Name) { return $Object.$Name }
    return $null
}

function Get-PlatformRedirectUris {
    param($Platform)
    $uris = Get-ObjectProperty -Object $Platform -Name 'redirectUris'
    if (-not $uris) { return @() }
    return @($uris | Where-Object { $_ })
}

function Test-OwnerMapRedirectUri {
    param([string]$Uri)
    $parsed = $null
    if (-not [Uri]::TryCreate($Uri, [UriKind]::Absolute, [ref]$parsed)) {
        throw "Redirect URI is not an absolute URL: $Uri"
    }
    $hostName = $parsed.Host
    $isLocal = ($hostName -eq 'localhost') -or ($hostName -eq '127.0.0.1') -or ($hostName -eq '[::1]')
    if ($parsed.Scheme -eq 'http') {
        if (-not $isLocal) {
            throw "http is only allowed for localhost. Use https for: $Uri"
        }
    }
    elseif ($parsed.Scheme -ne 'https') {
        throw "Redirect URI must be http (localhost only) or https: $Uri"
    }
    if ($parsed.Query -or $parsed.Fragment) {
        throw "Redirect URI must not include a query string or a hash. Register the page URL only: $Uri"
    }
    if ($Uri.EndsWith('/')) {
        Write-Warning "This redirect URI has a trailing slash. The address bar must match it exactly, including the slash: $Uri"
    }
    if ($parsed.AbsolutePath -notmatch 'ownermap\.html$') {
        Write-Warning "This redirect URI does not end with ownermap.html. Register the page URL, not the site root: $Uri"
    }
}

function Write-OwnerMapPlan {
    param([string[]]$Uris)
    $uriLines = ($Uris | ForEach-Object { "    $_" }) -join [Environment]::NewLine
    $scopeLines = ($OwnerMapScopes | ForEach-Object { "    $_" }) -join [Environment]::NewLine
    Write-Host @"
OwnerMap registration plan
--------------------------
This script is about to:
- Sign you in with the delegated permission Application.ReadWrite.All.
  That permission belongs to you, the person running the script, so you can
  create the app registration. It is not added to OwnerMap.
- Create or update one single-tenant app registration named '$DisplayName'.
- Set the Single-page application redirect URI list to exactly:
$uriLines
- Set Microsoft Graph delegated permissions to exactly these eight read-only scopes:
$scopeLines
- Print the client ID, the tenant ID, and an admin consent URL.

This script will not:
- Grant admin consent.
- Add a permission with Write in the name to OwnerMap.
- Add an application permission (an app role) to OwnerMap.
- Create a client secret or a certificate.
- Change users, groups, licenses, Conditional Access, or any other directory data.
- Sign in to the hygiene check page.

Re-running this script with the same arguments updates the same registration.
Pass every redirect URI you want to keep. This command replaces the
Single-page application redirect list with the URIs above.
"@
}

function Assert-GraphModules {
    $required = @('Microsoft.Graph.Authentication', 'Microsoft.Graph.Applications')
    $missing = @()
    foreach ($moduleName in $required) {
        if (-not (Get-Module -ListAvailable -Name $moduleName)) {
            $missing += $moduleName
        }
    }
    if ($missing.Count -eq 0) { return }
    $names = $missing -join ', '
    Write-Host @"
Missing PowerShell module(s): $names

Install them for the current user, then run this script again:

    Install-Module Microsoft.Graph.Authentication -Scope CurrentUser
    Install-Module Microsoft.Graph.Applications -Scope CurrentUser

If PowerShell says the repository is untrusted, that PSGallery prompt is expected the first time. Answer Yes to install these two modules.
"@
    throw "Missing PowerShell module(s): $names"
}

function Get-OwnerMapApplications {
    param(
        [string]$Filter
    )
    return @(Get-MgApplication -Filter $Filter -All -ErrorAction Stop | Where-Object { $_ })
}

function Resolve-GraphDelegatedScopeIds {
    $servicePrincipals = @(
        Get-MgServicePrincipal -Filter "appId eq '$GraphAppId'" -Property 'id,appId,oauth2PermissionScopes' -All -ErrorAction Stop |
            Where-Object { $_ }
    )
    if ($servicePrincipals.Count -lt 1) {
        throw 'The Microsoft Graph service principal was not found in this tenant. OwnerMap cannot look up permission ids until Microsoft Graph is present.'
    }
    $published = @(Get-ObjectProperty -Object $servicePrincipals[0] -Name 'oauth2PermissionScopes')
    if ($published.Count -lt 1) {
        throw 'Microsoft Graph returned no delegated permission list. Re-run the script. If it still fails, the signed-in account cannot read service principal details.'
    }

    $ids = @{}
    foreach ($scopeName in $OwnerMapScopes) {
        if ($scopeName -match 'Write') {
            throw "Refusing to run: '$scopeName' is not a read-only scope. OwnerMap must not request a write permission."
        }
        $found = $null
        foreach ($item in $published) {
            $value = [string](Get-ObjectProperty -Object $item -Name 'value')
            if ($value -ceq $scopeName) {
                $found = $item
                break
            }
        }
        if (-not $found) {
            throw "Microsoft Graph does not publish the delegated scope '$scopeName' in this tenant. No change was left half-applied if this is the first run; if you were updating, the app was not changed yet."
        }
        $ids[$scopeName] = [string](Get-ObjectProperty -Object $found -Name 'id')
    }
    return $ids
}

function New-OwnerMapBody {
    param(
        $Existing,
        [hashtable]$ScopeIds
    )
    $resourceAccess = New-Object System.Collections.Generic.List[object]
    foreach ($scopeName in $OwnerMapScopes) {
        $resourceAccess.Add(@{
            id   = [string]$ScopeIds[$scopeName]
            type = 'Scope'
        })
    }

    $body = @{
        displayName     = $DisplayName
        signInAudience  = 'AzureADMyOrg'
        spa             = @{
            redirectUris = @($RedirectUri)
        }
        requiredResourceAccess = @(
            @{
                resourceAppId  = $GraphAppId
                resourceAccess = $resourceAccess
            }
        )
    }

    if (-not $Existing) { return $body }

    foreach ($platformName in @('web', 'publicClient')) {
        $platform = Get-ObjectProperty -Object $Existing -Name $platformName
        $current = @(Get-PlatformRedirectUris -Platform $platform)
        if ($current.Count -eq 0) { continue }
        $kept = New-Object System.Collections.Generic.List[string]
        $removed = 0
        foreach ($currentUri in $current) {
            if (Test-ExactContains -List $RedirectUri -Value ([string]$currentUri)) {
                $removed++
            }
            else {
                $kept.Add([string]$currentUri)
            }
        }
        if ($removed -lt 1) { continue }
        Write-Warning "Moving $removed redirect URI(s) off the $platformName platform so they can live on Single-page application. The same URL cannot be registered on two platforms."
        if ($platformName -eq 'web') {
            $webBody = @{ redirectUris = $kept }
            $logoutUrl = Get-ObjectProperty -Object $platform -Name 'logoutUrl'
            $homePageUrl = Get-ObjectProperty -Object $platform -Name 'homePageUrl'
            if ($logoutUrl) { $webBody.logoutUrl = [string]$logoutUrl }
            if ($homePageUrl) { $webBody.homePageUrl = [string]$homePageUrl }
            $implicit = Get-ObjectProperty -Object $platform -Name 'implicitGrantSettings'
            if ($implicit) {
                $enableAccess = Get-ObjectProperty -Object $implicit -Name 'enableAccessTokenIssuance'
                $enableId = Get-ObjectProperty -Object $implicit -Name 'enableIdTokenIssuance'
                $webBody.implicitGrantSettings = @{
                    enableAccessTokenIssuance = [bool]$enableAccess
                    enableIdTokenIssuance     = [bool]$enableId
                }
            }
            $body.web = $webBody
        }
        else {
            $body.publicClient = @{ redirectUris = $kept }
        }
    }

    return $body
}

function Assert-OwnerMapSaved {
    param(
        $Saved,
        [hashtable]$ScopeIds
    )
    $entries = @(Get-ObjectProperty -Object $Saved -Name 'requiredResourceAccess')
    if ($entries.Count -ne 1) {
        throw "Expected exactly one API on the registration (Microsoft Graph). Found $($entries.Count). Open API permissions and remove anything else, then run the script again."
    }
    $resourceAppId = [string](Get-ObjectProperty -Object $entries[0] -Name 'resourceAppId')
    if ($resourceAppId -ne $GraphAppId) {
        throw "The registration lists an API other than Microsoft Graph ($resourceAppId). OwnerMap only uses Microsoft Graph delegated permissions."
    }
    $access = @(Get-ObjectProperty -Object $entries[0] -Name 'resourceAccess')
    $expectedIds = @{}
    foreach ($scopeName in $OwnerMapScopes) {
        $expectedIds[$ScopeIds[$scopeName].ToLower()] = $scopeName
    }
    if ($access.Count -ne $OwnerMapScopes.Count) {
        throw "Expected $($OwnerMapScopes.Count) delegated permissions and found $($access.Count). Run the script again. If it still fails, remove extra permissions in the portal and retry."
    }
    foreach ($item in $access) {
        $typeName = [string](Get-ObjectProperty -Object $item -Name 'type')
        $permId = ([string](Get-ObjectProperty -Object $item -Name 'id')).ToLower()
        if ($typeName -ne 'Scope') {
            throw "The registration contains an application permission (type '$typeName'). OwnerMap uses delegated permissions only. Remove it in API permissions and run the script again."
        }
        if (-not $expectedIds.ContainsKey($permId)) {
            throw "The registration contains a Graph permission outside the eight read-only scopes (id $permId). Remove it and run the script again."
        }
    }

    $spa = Get-ObjectProperty -Object $Saved -Name 'spa'
    $savedUris = @(Get-PlatformRedirectUris -Platform $spa)
    $missingUri = @()
    foreach ($uri in $RedirectUri) {
        if (-not (Test-ExactContains -List $savedUris -Value $uri)) {
            $missingUri += $uri
        }
    }
    if ($missingUri.Count -gt 0) {
        $joined = $missingUri -join ', '
        Write-Warning "Microsoft saved the app, but these redirect URIs were not listed on the Single-page application platform afterward: $joined"
    }
}

$cleanUris = New-Object System.Collections.Generic.List[string]
foreach ($uri in @($RedirectUri)) {
    if ([string]::IsNullOrWhiteSpace($uri)) {
        throw 'A redirect URI was blank. Pass the exact ownermap.html URL.'
    }
    $trimmed = $uri.Trim()
    Test-OwnerMapRedirectUri -Uri $trimmed
    if (Test-ExactContains -List $cleanUris.ToArray() -Value $trimmed) {
        throw "The same redirect URI was passed more than once: $trimmed"
    }
    $cleanUris.Add($trimmed)
}
if ($cleanUris.Count -lt 1) {
    throw 'Pass at least one -RedirectUri. It must be the exact URL of ownermap.html.'
}
$RedirectUri = $cleanUris.ToArray()

if ([string]::IsNullOrWhiteSpace($DisplayName)) {
    throw 'DisplayName cannot be blank.'
}
$DisplayName = $DisplayName.Trim()

if ($ClientId) {
    $ClientId = $ClientId.Trim()
    if ($ClientId -notmatch '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
        throw "ClientId must be an application (client) ID GUID. Received: $ClientId"
    }
}

foreach ($scopeName in $OwnerMapScopes) {
    if ($scopeName -match 'Write') {
        throw "Refusing to run: the built-in scope list contains '$scopeName'. OwnerMap must stay read-only."
    }
}

Write-OwnerMapPlan -Uris $RedirectUri
if ($WhatIfPreference) {
    Write-Host 'WhatIf: no sign-in was attempted and no app was changed.'
    return
}

Assert-GraphModules
$target = "app registration '$DisplayName'"
if ($ClientId) { $target = "$target ($ClientId)" }
if (-not $PSCmdlet.ShouldProcess($target, 'Create or update the OwnerMap registration with eight read-only delegated Graph permissions')) {
    return
}

Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
Import-Module Microsoft.Graph.Applications -ErrorAction Stop

$connected = $false
try {
    Connect-MgGraph -Scopes 'Application.ReadWrite.All' -ErrorAction Stop | Out-Null
    $connected = $true

    $existing = $null
    if ($ClientId) {
        $byId = @(Get-OwnerMapApplications -Filter "appId eq '$ClientId'")
        if ($byId.Count -lt 1) {
            throw "No app registration with client ID $ClientId was found in this tenant. The script did not create a new app. Remove -ClientId if you meant to create '$DisplayName'."
        }
        if ($byId.Count -gt 1) {
            throw "More than one app registration matched client ID $ClientId. The script stopped without making changes."
        }
        $existing = $byId[0]
    }
    else {
        $escapedName = $DisplayName.Replace("'", "''")
        $byName = @(Get-OwnerMapApplications -Filter "displayName eq '$escapedName'")
        if ($byName.Count -gt 1) {
            $listed = @()
            foreach ($app in $byName) {
                $listed += ('{0} (client ID {1})' -f (Get-ObjectProperty -Object $app -Name 'displayName'), (Get-ObjectProperty -Object $app -Name 'appId'))
            }
            $joined = $listed -join [Environment]::NewLine
            Write-Host @"
More than one app registration is named '$DisplayName'. The script stopped without making changes.
Pass -ClientId with the application (client) ID of the one you want to update:

$joined
"@
            throw "More than one app registration is named '$DisplayName'."
        }
        if ($byName.Count -eq 1) { $existing = $byName[0] }
    }

    if ($existing) {
        $existingId = [string](Get-ObjectProperty -Object $existing -Name 'id')
        $existing = Get-MgApplication -ApplicationId $existingId -Property 'id,appId,displayName,signInAudience,spa,web,publicClient,requiredResourceAccess' -ErrorAction Stop
        $existingClientId = [string](Get-ObjectProperty -Object $existing -Name 'appId')
        Write-Host "Updating existing registration '$DisplayName' (client ID $existingClientId)."
        Write-Host 'Its Microsoft Graph permissions will be set to exactly the eight read-only delegated scopes.'
    }
    else {
        Write-Host "Creating a new registration named '$DisplayName'."
    }

    $scopeIds = Resolve-GraphDelegatedScopeIds
    $body = New-OwnerMapBody -Existing $existing -ScopeIds $scopeIds

    if ($existing) {
        $objectId = [string](Get-ObjectProperty -Object $existing -Name 'id')
        Update-MgApplication -ApplicationId $objectId -BodyParameter $body -ErrorAction Stop
        $saved = Get-MgApplication -ApplicationId $objectId -Property 'id,appId,spa,requiredResourceAccess' -ErrorAction Stop
    }
    else {
        $created = New-MgApplication -BodyParameter $body -ErrorAction Stop
        $objectId = [string](Get-ObjectProperty -Object $created -Name 'id')
        $saved = Get-MgApplication -ApplicationId $objectId -Property 'id,appId,spa,requiredResourceAccess' -ErrorAction Stop
    }

    Assert-OwnerMapSaved -Saved $saved -ScopeIds $scopeIds

    $savedClientId = [string](Get-ObjectProperty -Object $saved -Name 'appId')
    $context = Get-MgContext
    $tenantId = [string]$context.TenantId
    $consentUrl = 'https://login.microsoftonline.com/{0}/adminconsent?client_id={1}' -f $tenantId, $savedClientId

    Write-Host ''
    Write-Host "Display name:       $DisplayName"
    Write-Host "Client ID:          $savedClientId"
    Write-Host "Directory tenant ID: $tenantId"
    Write-Host "Admin consent URL:  $consentUrl"
    Write-Host ''
    Write-Host 'The script did not grant admin consent. Open the URL above as a Cloud Application Administrator (or another role listed in docs/SETUP.md), review the eight read-only permissions, and accept.'
    Write-Host 'Then open ownermap.html at the redirect URI you registered and paste the tenant ID and client ID.'

    [pscustomobject]@{
        DisplayName     = $DisplayName
        ClientId        = $savedClientId
        TenantId        = $tenantId
        AdminConsentUrl = $consentUrl
        RedirectUris    = @($RedirectUri)
    }
}
finally {
    if ($connected) {
        Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
    }
}
