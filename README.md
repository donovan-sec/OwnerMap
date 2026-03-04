# OwnerMap

**Map group ownership across Microsoft Entra ID — no install required.**

OwnerMap is a single-file browser tool that enumerates all your Entra ID (Azure AD) groups, resolves their owners and members via Microsoft Graph, and surfaces every group with no assigned owner — the #1 compliance gap during SOX, ISO 27001, and NIST 800-53 audits.

Open the HTML file. Connect. Get answers.

![OwnerMap Screenshot](docs/screenshot.png)

---

## On-Premises AD Coverage

OwnerMap queries **Microsoft Graph**, not your on-premises Active Directory directly.

**What this means in practice:**

| Scenario | Coverage |
|---|---|
| Cloud-only Entra ID | ✅ Full coverage |
| Hybrid — on-prem AD synced via Entra Connect | ✅ Synced groups appear in results, flagged with the `On-Prem` badge |
| On-prem AD groups **not** synced to Entra | ❌ Not visible — Graph has no record of them |
| Pure on-prem AD, no Entra ID | ❌ Not supported in this version |

If your environment has unsynced or pure on-prem groups, the safest approach is to cross-reference the OwnerMap export against a `Get-ADGroup -Filter *` dump from a domain controller. A local PowerShell relay to bridge that gap is on the roadmap.

> **Auditor note:** The `onPremisesSyncEnabled` flag on each group tells you whether it originated on-prem. If this field is populated, the group is mastered in your on-prem AD and Entra Connect is keeping it in sync. Owner assignments made in OwnerMap (once write-back ships) will need to be reflected in on-prem AD as well in hybrid environments.

---

## Why This Exists

When your helpdesk implements an access request process, they need to know *who approves* each entitlement. In most environments, AD/Entra group ownership is never assigned systematically — it's the forgotten first step. OwnerMap gives you a complete picture in minutes so you can assign owners before your auditor asks.

---

## Features

- **Zero install** — single `.html` file, runs in any modern browser
- **OS agnostic** — works on macOS, Windows, Linux
- **Two auth modes** — sign in as the current user (delegated) or use an app registration (client credentials)
- **Full enumeration** — paginates through tenants with thousands of groups, fetches owners and members concurrently with automatic throttle/retry handling
- **SOX risk flagging** — groups with no owner are immediately marked `HIGH` risk with red callouts
- **Owner coverage stat** — see your percentage of groups with assigned owners at a glance
- **Interactive UI** — filter by No Owner / Security / M365 / On-Prem, search by name/description/owner, sort any column, expand rows to see full member lists
- **CSV export** — full dump of all groups, owners, and members for offline review or ticket generation

---

## Quickstart

### 1. Download

```bash
git clone https://github.com/YOUR_USERNAME/ownermap.git
```

Or just download `ownermap.html` directly.

### 2. Register an App in Entra ID

Go to **Entra ID → App registrations → New registration**

- Name: `OwnerMap` (or anything)
- Redirect URI: `Web` → `http://localhost` (for delegated mode)

#### Required API Permissions

| Permission | Type | Purpose |
|---|---|---|
| `Group.Read.All` | Delegated or Application | Read all groups |
| `GroupMember.Read.All` | Delegated or Application | Read group members |
| `User.Read.All` | Delegated or Application | Resolve user display names and UPNs |
| `Directory.Read.All` | Delegated or Application | Read on-prem sync attributes |

For **Current User mode** (recommended): grant as **Delegated** permissions.  
For **App Registration mode**: grant as **Application** permissions and click **Grant admin consent**.

### 3. Open the Tool

Open `ownermap.html` in your browser. Enter your **Tenant ID** and **Client ID**, choose your auth mode, and click **Connect & Enumerate Groups**.

---

## Auth Modes

### Current User (Recommended)

Uses MSAL.js popup sign-in. The signed-in user's permissions apply. Best for individual auditors and compliance teams.

**Requirements:**
- App registration with Delegated permissions
- Your account must have sufficient directory read access (Global Reader or equivalent)

### App Registration (Unattended / Automation)

Uses client credentials (client ID + secret). Best for scheduled audits or service accounts.

**Requirements:**
- App registration with Application permissions + admin consent
- Keep client secrets out of shared machines — the secret lives in browser session memory

> **Security note:** Never commit client secrets. If you automate this, use a secrets manager or Azure Key Vault to inject the secret at runtime.

---

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

---

## Group Types

| Badge | Meaning |
|---|---|
| `Security` | Security group — controls access to resources |
| `M365` | Microsoft 365 unified group (Teams, SharePoint, etc.) |
| `Dist` | Distribution list |
| `On-Prem` | Synced from on-premises Active Directory via Entra Connect |
| `Cloud` | Cloud-only group |

---

## Compliance Use Cases

- **SOX IT General Controls** — identify who approves access to financially significant systems
- **Access Review Prep** — enumerate all entitlements before a quarterly UAR
- **Joiner/Mover/Leaver** — find groups with no owner to prevent orphaned memberships
- **Zero Trust Readiness** — baseline all group memberships before implementing PIM/JIT access

---

## Roadmap

- [ ] Owner write-back — assign owners directly from the UI (PATCH to Graph)
- [ ] Stale member detection — flag users with no sign-in in 90+ days
- [ ] App Registration & Service Principal audit tab
- [ ] On-prem AD support via local PowerShell relay
- [ ] Scheduled export / email digest mode
- [ ] SCIM / CSV import for bulk owner assignment

---

## Contributing

PRs welcome. Please open an issue first for anything beyond bug fixes.

---

## License

MIT — free to use, modify, and distribute. Attribution appreciated.

---

*Built by [HexStrike](https://hexstrike.com) — cybersecurity consulting for the real world.*
