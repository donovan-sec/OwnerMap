# OwnerMap

**Map group ownership across Microsoft Entra ID — no install required.**

OwnerMap is a single-file browser tool that enumerates all your Entra ID (Azure AD) groups, resolves their owners and members via Microsoft Graph, and surfaces every group with no assigned owner — the #1 compliance gap during SOX, ISO 27001, and NIST 800-53 audits.

Open the HTML file. Connect. Get answers.

![OwnerMap](docs/ownermap-icon.png)

## Why This Exists

When your helpdesk implements an access request process, they need to know *who approves* each entitlement. In most environments, AD/Entra group ownership is never assigned systematically — it's the forgotten first step. OwnerMap gives you a complete picture in minutes so you can assign owners before your auditor asks.

## Features

- **Zero install** — single `.html` file, runs in any modern browser
- **OS agnostic** — works on macOS, Windows, Linux
- **Two auth modes** — sign in as the current user (delegated) or use an app registration (client credentials)
- **Full enumeration** — paginates through tenants with thousands of groups, fetches owners and members concurrently with automatic throttle/retry handling
- **SOX risk flagging** — groups with no owner are immediately marked `HIGH` risk with red callouts
- **Owner coverage stat** — see your percentage of groups with assigned owners at a glance
- **Interactive UI** — filter by No Owner / Security / M365 / On-Prem, search by name/description/owner, sort any column, expand rows to see full member lists
- **CSV export** — full dump of all groups, owners, and members for offline review or ticket generation

## Step 1 — Register an App in Entra ID

This is a one-time setup. OwnerMap uses Microsoft Graph and requires an app registration so Microsoft knows what application is making the request.

Go to **Entra ID → App registrations → New registration**

- **Name:** `OwnerMap` (or anything descriptive)
- **Supported account types:** Single tenant
- **Redirect URI:** Leave blank for now — you will add this after choosing how to serve the file (see Step 2)

### Required API Permissions

Go to **API permissions → Add a permission → Microsoft Graph** and add the following:

| Permission | Type | Purpose |
|---|---|---|
| `Group.Read.All` | Delegated | Read all groups |
| `GroupMember.Read.All` | Delegated | Read group members |
| `User.Read.All` | Delegated | Resolve user display names and UPNs |
| `Directory.Read.All` | Delegated | Read on-prem sync attributes |

Click **Grant admin consent** after adding all four.

## Step 2 — Choose How to Serve OwnerMap

OwnerMap uses Microsoft's MSAL.js library to handle sign-in. MSAL requires a **redirect URI** — the exact URL where the app is served — to be registered in your Entra app registration. This is a security requirement by Microsoft, not OwnerMap.

> **The redirect URI must exactly match the URL you use to open the file.** Even a trailing slash difference will cause a sign-in error.

Choose the serving method that fits your situation:

### Option A — SharePoint (Recommended for Internal Teams)

Best for sharing with helpdesk staff, auditors, or anyone in your org who shouldn't need any setup.

**Steps:**
1. Upload `ownermap.html` to a SharePoint document library
2. Open the file in SharePoint and copy the full URL from your browser address bar, for example:
   ```
   https://yourcompany.sharepoint.com/sites/IT/Shared%20Documents/ownermap.html
   ```
3. Go to your app registration → **Authentication → Add a platform → Web**
4. Paste that exact URL as the Redirect URI and click Save
5. Share the SharePoint link with your team — they click it, sign in with their Microsoft account, and the tool runs

### Option B — GitHub Pages (Recommended for Public / Cross-Org Use)

Best for making the tool available outside your org, sharing with external auditors, or keeping a stable public URL.

**Steps:**
1. Fork this repo or push it to your own GitHub account
2. Go to **Settings → Pages → Source:** `main` branch, `/ (root)` folder, click Save
3. GitHub will give you a URL like:
   ```
   https://yourusername.github.io/OwnerMap/ownermap.html
   ```
4. Go to your app registration → **Authentication → Add a platform → Web**
5. Paste that GitHub Pages URL as the Redirect URI and click Save
6. Anyone can now open that URL, sign in, and run the tool

### Option C — Local Python Web Server (Technical Users / One-Off Audits)

Best for running a quick audit on your own machine without uploading the file anywhere.

**Steps:**
1. Download `ownermap.html` to a local folder
2. Open a terminal in that folder and run:

   **macOS / Linux:**
   ```bash
   python3 -m http.server 8080
   ```

   **Windows:**
   ```powershell
   python -m http.server 8080
   ```

3. Open `http://localhost:8080/ownermap.html` in your browser
4. Go to your app registration → **Authentication → Add a platform → Web**
5. Add `http://localhost:8080/ownermap.html` as the Redirect URI and click Save

> **Note:** The server must be running every time you use the tool. Stop it with `Ctrl+C` when done.

### Redirect URI Quick Reference

| Serving Method | Redirect URI to Register |
|---|---|
| SharePoint | `https://yourcompany.sharepoint.com/sites/IT/Shared%20Documents/ownermap.html` |
| GitHub Pages | `https://yourusername.github.io/OwnerMap/ownermap.html` |
| Local Python server | `http://localhost:8080/ownermap.html` |

You can register multiple redirect URIs in the same app registration if you use more than one method.

## Step 3 — Open the Tool

Open OwnerMap using whichever URL matches the redirect URI you registered. Enter your **Tenant ID** and **Client ID** from the app registration, select **Current User**, and click **Sign In with Microsoft**.

Your Tenant ID and Client ID are found in **Entra ID → App registrations → OwnerMap → Overview**.

## Auth Modes

### Current User (Recommended)

Uses MSAL.js popup sign-in. The signed-in user's own permissions apply — no secrets required. If the user is already signed into Microsoft 365 in their browser, authentication happens silently with no popup at all.

**Requirements:**
- App registration with Delegated permissions (see Step 1)
- Redirect URI registered for the URL you are serving from (see Step 2)
- User must have Global Reader role or equivalent directory read access

### App Registration (Unattended / Service Account)

Uses a client ID and client secret directly. No interactive sign-in. Best for scheduled audits or environments where you cannot use delegated auth.

**Requirements:**
- App registration with **Application** permissions (not Delegated) and admin consent
- A client secret generated under **Certificates & secrets**

> **Security note:** Never commit client secrets to a repository. The secret lives in browser session memory — use this mode on secured, trusted workstations only.

## Output

### Dashboard Stats
| Stat | Description |
|---|---|
| Total Groups | All groups enumerated from Entra ID |
| Missing Owner | Groups with zero owners assigned — your SOX gap list |
| Security Groups | Entitlement-bearing groups (highest audit priority) |
| Total Members | Sum of all memberships across all groups |
| Owner Coverage % | Percentage of groups with at least one assigned owner |

### Group Details (expand any row)
- Owner list with display name and UPN
- Full member list with type icons (user / group / service principal)
- SOX risk rating per group

### CSV Export
Columns: `Group Name, Description, Type, Source, Owner Count, Owners (UPN), Member Count, Members (Display Name + UPN), SOX Risk`

## Group Types

| Badge | Meaning |
|---|---|
| `Security` | Security group — controls access to resources |
| `M365` | Microsoft 365 unified group (Teams, SharePoint, etc.) |
| `Dist` | Distribution list |
| `On-Prem` | Synced from on-premises Active Directory via Entra Connect |
| `Cloud` | Cloud-only group |

## On-Premises AD Coverage

OwnerMap queries **Microsoft Graph**, not your on-premises Active Directory directly.

| Scenario | Coverage |
|---|---|
| Cloud-only Entra ID | ✅ Full coverage |
| Hybrid — on-prem AD synced via Entra Connect | ✅ Synced groups appear in results, flagged with the `On-Prem` badge |
| On-prem AD groups **not** synced to Entra | ❌ Not visible — Graph has no record of them |
| Pure on-prem AD, no Entra ID | ❌ Not supported in this version |

If your environment has unsynced or pure on-prem groups, cross-reference the OwnerMap export against a `Get-ADGroup -Filter *` dump from a domain controller. A local PowerShell relay to bridge that gap is on the roadmap.

> **Auditor note:** The `onPremisesSyncEnabled` flag on each group tells you whether it originated on-prem. If this field is populated, the group is mastered in your on-prem AD and Entra Connect is keeping it in sync.

## Compliance Use Cases

- **SOX IT General Controls** — identify who approves access to financially significant systems
- **Access Review Prep** — enumerate all entitlements before a quarterly UAR
- **Joiner/Mover/Leaver** — find groups with no owner to prevent orphaned memberships
- **Zero Trust Readiness** — baseline all group memberships before implementing PIM/JIT access

## Roadmap

- [ ] Owner write-back — assign owners directly from the UI (PATCH to Graph)
- [ ] Stale member detection — flag users with no sign-in in 90+ days
- [ ] App Registration & Service Principal audit tab
- [ ] On-prem AD support via local PowerShell relay
- [ ] Scheduled export / email digest mode
- [ ] SCIM / CSV import for bulk owner assignment

## Contributing

PRs welcome. Please open an issue first for anything beyond bug fixes.

## License

MIT — free to use, modify, and distribute. Attribution appreciated.

