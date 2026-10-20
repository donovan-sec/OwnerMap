# Set up OwnerMap in your tenant

This guide is for the IT person at a small business who has to register OwnerMap once, then hand the page to whoever runs the hygiene check. You do this yourself in your own Microsoft Entra tenant. OwnerMap is a free static page. There is no paid setup service, and there is nothing to buy from this project to finish the steps below.

When you are done you will have:

- One single-tenant app registration (the usual name is `OwnerMap`).
- The page URL registered as a **Single-page application** redirect URI.
- Eight **delegated** Microsoft Graph permissions, all read-only.
- Tenant-wide admin consent for those permissions.
- A browser page where someone with a directory reader role can sign in and run the check.

OwnerMap never changes users, groups, licenses, or policies. Do not add a permission whose name contains `Write`. Do not create an application password. Skip **Certificates & secrets**.

The short version on the project front page is [the README setup section](../README.md). This page is the one to follow the first time.

## Who needs which role

Two different jobs get mixed together. Registering the app is one job. Granting tenant-wide admin consent is another. The same person can do both when they hold a role that covers both rows. A person who can only register the app still has to send the consent link to someone in the consent row.

Microsoft documents these roles on the following pages. They were checked against the live articles on 20 October 2026. If a portal label does not match this table, trust the current article and send that page with your request.

- [Grant tenant-wide admin consent to an application](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent) (prerequisites)
- [Least privileged roles by task](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-by-task) (application registration, and "Consent to any delegated permissions")
- [Delegate application management](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-app-roles) (who can register apps when the default is turned off)
- [Microsoft Entra built-in roles](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference) (Application Developer, Cloud Application Administrator, Application Administrator, Global Administrator)

| Job | Who can do it |
|---|---|
| Register the OwnerMap app, or run `scripts/Register-OwnerMap.ps1` | Any user in the tenant, while **Users can register applications** is **Yes**. That is the default. When that setting is **No**, Microsoft lists **Application Developer** as the least privileged role, and also **Cloud Application Administrator** and **Application Administrator**. **Global Administrator** can register apps as well, because that role can manage all aspects of Microsoft Entra ID. |
| Grant tenant-wide admin consent for OwnerMap's Microsoft Graph **delegated** permissions | **Cloud Application Administrator** is the least privileged built-in role Microsoft lists for consenting to delegated permissions. **Application Administrator**, **AI Administrator**, and **Privileged Role Administrator** can also grant it. So can a custom directory role that includes granting permissions to applications, for the permissions this app requests. **Global Administrator** can grant this consent as well. **Application Developer** can register the app and can consent only on their own behalf. That is not tenant-wide admin consent. |
| Run the hygiene check later | **Global Reader** is enough to read the directory. The person signs in on the page with their own work account. They do not need to be allowed to register apps. |

OwnerMap asks only for delegated permissions (the app acts as the signed-in person). Microsoft Graph **application** permissions, also called app roles, are a higher bar: Microsoft lists **Privileged Role Administrator** for consent to Microsoft Graph application permissions, and notes that some tenants still need a Global Administrator for that. Do not add those. OwnerMap does not use them, and this guide does not ask you to grant them.

> **Screenshot placeholder**
>
> Replace this box with a picture from your own admin center if you need to show a colleague which setting is on.
>
> **Where to click:** Entra admin center, **Identity > Users > User settings**.
>
> **What the picture should show:** **Users can register applications** set to Yes or No. If it is No, the person who runs the script needs Application Developer, Cloud Application Administrator, Application Administrator, or Global Administrator.

## Pick the page address first

The redirect URI is the exact address of `ownermap.html` in the browser. You need that URL before you register the app. The script asks you to pass it. The portal asks you to paste it.

The address must match character for character: `https` or `http`, the host, the folder, and `ownermap.html`. A trailing slash is a different URI. A query string such as `?demo=1` is not part of the registered URI.

### GitHub Pages (a stable link for the team)

1. Fork this repository, or push a copy to your own GitHub account.
2. In that GitHub repo, open **Settings > Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Set the branch to `main` and the folder to `/ (root)`. Save.
4. Wait until GitHub shows a site URL. The page you register is that URL plus the file name.

Example: `https://yourusername.github.io/OwnerMap/ownermap.html`

> **Screenshot placeholder**
>
> Replace this box with a picture from your own GitHub repository settings.
>
> **Where to click:** the repository **Settings > Pages**.
>
> **What the picture should show:** Source set to Deploy from a branch, branch `main`, folder `/ (root)`, and the site URL GitHub displays at the top.

### A local server (a one-off check on your machine)

From the folder that contains `ownermap.html`:

```bash
python3 -m http.server 8080
```

On Windows, if `python3` is not recognized:

```bat
py -m http.server 8080
```

Open `http://localhost:8080/ownermap.html`. Leave that window running while you sign in. Stop it later with Ctrl+C.

`http://` is valid only for `localhost`. A page you host for other people needs `https://`.

| How you open it | Redirect URI to register |
|---|---|
| GitHub Pages | `https://yourusername.github.io/OwnerMap/ownermap.html` |
| Local Python server | `http://localhost:8080/ownermap.html` |

## Recommended path: PowerShell

Use this when the person registering the app can run PowerShell and sign in to the tenant. The manual portal steps further down are the alternative when they cannot.

The script file is [`scripts/Register-OwnerMap.ps1`](../scripts/Register-OwnerMap.ps1).

### What it will do, before it changes anything

Read this before you sign in. The script prints the same plan, and `-WhatIf` prints it without signing in.

It will:

- Sign you in with the delegated permission `Application.ReadWrite.All`. That permission is for **you**, so you can create the registration. It is **not** added to OwnerMap.
- Create one single-tenant app, or update the existing app with the same display name (default `OwnerMap`). If several apps already share that name, it stops and asks you to pass `-ClientId`.
- Set the platform to **Single-page application** and set the redirect URI list to exactly the URLs you passed. If one of those URLs was previously saved under **Web** or a public client, it moves that URL onto the single-page platform. The same URL cannot sit on two platforms.
- Set Microsoft Graph permissions to exactly these eight **delegated** scopes, and drop extra Microsoft Graph permissions from this app on update:
  - `User.Read`
  - `Group.Read.All`
  - `GroupMember.Read.All`
  - `User.Read.All`
  - `Directory.Read.All`
  - `Application.Read.All`
  - `AuditLog.Read.All`
  - `Policy.Read.All`
- Print the application (client) ID, the directory (tenant) ID, and an admin consent URL.

It will not:

- Grant admin consent. You still do that in the next section, or you send the URL to someone who can.
- Add any permission with `Write` in the name to OwnerMap.
- Add an application permission (an app role).
- Create a client secret or a certificate.
- Change users, groups, licenses, Conditional Access, or anything else in the directory.
- Open the hygiene check or sign in as the person who will run the report.

Running it again with the same name and the same URLs updates the same registration. It does not create a second app. Pass every redirect URI you still want. The redirect list is replaced by what you pass this time.

### Install the two modules

Use Windows PowerShell 5.1 or PowerShell 7. Run:

```powershell
Install-Module Microsoft.Graph.Authentication -Scope CurrentUser
Install-Module Microsoft.Graph.Applications -Scope CurrentUser
```

If PowerShell says PSGallery is untrusted, that first-time prompt is expected. Answer Yes to install these two modules.

You do not need to install the whole `Microsoft.Graph` meta-module.

### Preview, then run

Open PowerShell in the OwnerMap folder (the folder that contains `scripts` and `ownermap.html`). If the script will not start because of execution policy, allow it for this window only:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Preview without signing in:

```powershell
.\scripts\Register-OwnerMap.ps1 -RedirectUri 'http://localhost:8080/ownermap.html' -WhatIf
```

Create or update the app. PowerShell prints the plan, asks you to confirm, and then opens a sign-in window. The sign-in account must be allowed to register applications (see the role table). The confirmation is there because the script changes an app registration.

Local page:

```powershell
.\scripts\Register-OwnerMap.ps1 -RedirectUri 'http://localhost:8080/ownermap.html'
```

GitHub Pages:

```powershell
.\scripts\Register-OwnerMap.ps1 -RedirectUri 'https://yourusername.github.io/OwnerMap/ownermap.html'
```

Both addresses on one registration:

```powershell
.\scripts\Register-OwnerMap.ps1 -RedirectUri 'http://localhost:8080/ownermap.html','https://yourusername.github.io/OwnerMap/ownermap.html'
```

Update a specific app instead of searching by name:

```powershell
.\scripts\Register-OwnerMap.ps1 -ClientId 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' -RedirectUri 'https://yourusername.github.io/OwnerMap/ownermap.html'
```

Copy the **Client ID**, **Directory tenant ID**, and **Admin consent URL** from the output. The script then signs you out of Microsoft Graph PowerShell.

## Grant admin consent

The registration lists the eight permissions. They do nothing for other users until an admin grants tenant-wide consent.

1. Sign in as someone from the consent row of the role table. Cloud Application Administrator is the least privileged built-in role for this delegated consent.
2. Open the admin consent URL the script printed. It looks like this, with your ids filled in:

```text
https://login.microsoftonline.com/{tenant-id}/adminconsent?client_id={client-id}
```

3. Read the list. You should see the eight delegated permissions and nothing that says `Write`. Accept.

Or use the portal: **Identity > Applications > App registrations > OwnerMap > API permissions > Grant admin consent for your organization**. Confirm the status column says **Granted for** your organization on each of the eight rows.

> **Screenshot placeholder**
>
> Replace this box with a picture from your own admin center after consent is granted.
>
> **Where to click:** App registrations > OwnerMap > API permissions.
>
> **What the picture should show:** Eight Microsoft Graph **delegated** permissions (`User.Read`, `Group.Read.All`, `GroupMember.Read.All`, `User.Read.All`, `Directory.Read.All`, `Application.Read.All`, `AuditLog.Read.All`, `Policy.Read.All`), each with admin consent granted. No application permissions. No permission with `Write` in the name.

`AuditLog.Read.All` and `Policy.Read.All` are optional at run time. Consent to them anyway. If the tenant has no Entra ID P1, those two checks explain themselves and the rest of the report still runs.

### If you are not allowed to grant consent

Register the app if you can (the script, or the portal steps). Then email the consent URL to someone in the consent row. Do not send them your password, and do not send a token.

**Subject:** Please grant admin consent for OwnerMap (read-only)

**Body:**

```text
I registered a single-tenant app called OwnerMap so we can run a read-only
Microsoft 365 hygiene check in the browser. It does not change users, groups,
licenses, or policies, and it does not use an application password.

Please open this URL while signed in as a Cloud Application Administrator,
Application Administrator, AI Administrator, Privileged Role Administrator,
or Global Administrator:

https://login.microsoftonline.com/{tenant-id}/adminconsent?client_id={client-id}

Accept only these eight Microsoft Graph delegated permissions:
User.Read, Group.Read.All, GroupMember.Read.All, User.Read.All,
Directory.Read.All, Application.Read.All, AuditLog.Read.All, Policy.Read.All.

Please do not add a permission with Write in the name, and do not create a
client secret.

The Application (client) ID is: {client-id}
The Directory (tenant) ID is: {tenant-id}
```

If your tenant already uses **Admin consent requests** (**Identity > Applications > Enterprise applications > Consent and permissions > Admin consent settings**), the blocked person can submit a request there instead. The reviewer still has to hold one of the consent roles above. The email works either way.

> **Screenshot placeholder**
>
> Replace this box with a picture of the consent window your admin sees. Do not include the address bar if it contains a code.
>
> **Where to click:** the admin consent URL, signed in as a role from the consent row.
>
> **What the picture should show:** OwnerMap asking for the eight delegated Microsoft Graph permissions, and the Accept button. No write permissions on the list.

## Alternative: register the app in the portal

Use this when you cannot run the PowerShell script. The result should match what the script creates. The platform is **Single-page application**. A **Web** platform causes sign-in errors `AADSTS9002326` and `AADSTS9002325`, because this page uses the browser sign-in flow with PKCE.

1. Open the [Entra admin center](https://entra.microsoft.com) as someone who is allowed to register applications.
2. Go to **Identity > Applications > App registrations > New registration**.
3. Name: `OwnerMap`.
4. Supported account types: **Accounts in this organizational directory only**.
5. Redirect URI: choose **Single-page application (SPA)**, and paste the exact `ownermap.html` URL from the hosting section. Register.
6. On **Overview**, copy **Application (client) ID** and **Directory (tenant) ID**.
7. Open **Authentication**. Confirm the URL is listed under **Single-page application**, not under **Web**. Leave implicit grant and hybrid flows unchecked. Do not create a secret under **Certificates & secrets**.
8. Open **API permissions > Add a permission > Microsoft Graph > Delegated permissions**. Add the eight scopes listed above. Do not open **Application permissions**.
9. Choose **Grant admin consent**, or send the consent request in the previous section.

> **Screenshot placeholder**
>
> Replace this box with a picture from your own admin center.
>
> **Where to click:** App registrations > New registration.
>
> **What the picture should show:** Name `OwnerMap`, accounts in this organizational directory only, and the redirect platform set to **Single-page application** with the full `ownermap.html` URL.

> **Screenshot placeholder**
>
> Replace this box with a picture from your own admin center.
>
> **Where to click:** the new app's **Overview**.
>
> **What the picture should show:** Application (client) ID and Directory (tenant) ID. Those two values are what the sign-in page asks for.

> **Screenshot placeholder**
>
> Replace this box with a picture from your own admin center.
>
> **Where to click:** the app's **Authentication** page.
>
> **What the picture should show:** The page URL under **Single-page application**. The **Web** section should not contain that same URL.

To add a second URL later (localhost and GitHub Pages), open **Authentication** and add another **Single-page application** URI, or run the script again and pass both URLs.

## First run

1. Open the URL you registered. It must be the `ownermap.html` address, not a different folder and not `file://`.
2. Paste the **Directory (tenant) ID** and the **Application (client) ID**.
3. Choose **Sign in and run the check**. If you are already signed in to Microsoft 365, the prompt may be short. Use a work account from this tenant.
4. **Preview with sample data** loads a fictional company and does not contact Microsoft. You can use it to learn the report before consent is finished. On a local server the preview address is `http://localhost:8080/ownermap.html?demo=1`. Do not register the `?demo=1` part as the redirect URI.

The sign-in screen looks like this:

![OwnerMap sign-in screen](screenshots/01-sign-in.png)

The person who runs the check needs a reader role such as Global Reader. They do not need permission to edit the app.

## Ask your AI assistant

You can paste the prompt below into ChatGPT, Claude, or Grok, then paste this guide (or the part you are stuck on) underneath it. The assistant should walk one step at a time and explain errors. It is a helper for reading this document. It cannot click the portal for you, and it is not a setup service.

**Never paste tokens or secrets into a chat.** That includes access tokens, refresh tokens, authorization codes, client secrets, passwords, and any sign-in URL that contains `code=`, `access_token`, or `id_token`. If a URL looks long and contains those words, delete the query string before you copy it. An error code such as `AADSTS50011` is safe to paste. A client ID and a tenant ID are safe to paste. A token is not.

```text
You are helping a junior IT person set up OwnerMap, a free read-only
Microsoft 365 and Entra hygiene check, in their own work tenant. They will
paste docs/SETUP.md from the OwnerMap repository, or the section they are
stuck on.

Walk them through that guide one step at a time. Wait until they tell you
what they see before you give the next click or command. Explain errors in
plain language, including AADSTS codes, and name the troubleshooting row
that matches.

Use the PowerShell script (scripts/Register-OwnerMap.ps1) as the recommended
path. Use the manual portal steps only if they cannot run the script.

Follow these rules:
- Never ask them to paste an access token, refresh token, authorization
  code, client secret, password, or a sign-in URL that contains a code or
  token.
- If they paste one of those, stop. Tell them to close the page, sign out,
  and start the sign-in again. Do not repeat the secret back to them.
- Do not tell them to add any Microsoft Graph permission with Write in the
  name.
- Do not tell them to create a client secret, open Certificates & secrets,
  or switch any permission to an application permission.
- The redirect platform is Single-page application, not Web.
- Do not offer a paid setup service. This is a do-it-yourself guide.

They are stuck at this point (they will fill this in):
[step name, what they clicked or which command they ran, and the error text
with any token or secret removed]
```

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `AADSTS50011` or a message about a redirect URI mismatch | The address in the browser is not registered, or it differs by a slash, `http` versus `https`, or the file name. | Copy the address bar, remove anything after `ownermap.html`, and add that exact URL under **Single-page application**. Update it with the script by passing `-RedirectUri` with the exact URL. |
| `AADSTS9002326` or `AADSTS9002325` | The URL was registered as **Web** (or PKCE was rejected). This page only works as a single-page application. | On **Authentication**, delete the URL from **Web** and add it under **Single-page application**. The script does this move when you pass that URL again. |
| `AADSTS65001` or `AADSTS90094` | The signed-in user, or the tenant, has not been granted the permissions. | A consent-role admin opens the admin consent URL and accepts the eight delegated permissions. |
| `AADSTS700016` | The tenant has no app with that client ID. | Check both GUIDs on the app **Overview** page. Confirm the work account belongs to that same tenant. |
| `AADSTS50020` | The account is not in this tenant, or it is a personal Microsoft account. | Sign in with a work account from the organization whose tenant ID you pasted. |
| `AADSTS50105` | The enterprise app is set to require user assignment, and this person is not assigned. | In **Enterprise applications > OwnerMap > Properties**, set **Assignment required** to No, or assign the person under **Users and groups**. |
| `AADSTS70011` | A requested scope is not valid on this app. | Put the permissions back to the eight delegated scopes. Remove anything with `Write` in the name. Grant admin consent again. The script resets the list to those eight. |
| The sign-in window never appears, or the browser says a pop-up was blocked | The login window was blocked. | Allow pop-ups for this site and choose **Sign in and run the check** again. |
| Stale accounts or Conditional Access say the tenant is not licensed, or Graph returns `Authentication_RequestFromNonPremiumTenantOrB2CTenant` | Sign-in dates and Conditional Access need **Entra ID P1** (or P2). | The other checks still run. One Entra ID P1 license in the tenant unlocks sign-in reports. The page explains this on those tabs. You do not fix it by adding a write permission. |
| PowerShell says a module was not found | `Microsoft.Graph.Authentication` or `Microsoft.Graph.Applications` is not installed for this user. | Run the two `Install-Module` commands in the recommended-path section. |
| PowerShell says the script cannot be loaded because running scripts is disabled | Execution policy blocked the file. | From the OwnerMap folder, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` and start the script again in that same window. |
| The script says more than one app is named OwnerMap | An earlier registration used the same display name. | Copy the client ID you want from the error text and run the script again with `-ClientId`. |
| The script says it is not allowed to create the application | The account cannot register apps, or it did not consent to `Application.ReadWrite.All` for the Graph PowerShell sign-in. | Use an account from the register row of the role table. Accept the Graph PowerShell consent for `Application.ReadWrite.All` for yourself. Do not add that permission to the OwnerMap app. |
| A portal page offers to create a client secret | That secret is for a different kind of app. OwnerMap signs in as the current user. | Close that page. Do not create the secret. |

## Checklist

- The page opens from `https://.../ownermap.html` or from `http://localhost:.../ownermap.html`, not from a downloaded file.
- The app is single-tenant, and the redirect URI is on **Single-page application**.
- API permissions are the eight delegated scopes, with admin consent granted.
- No permission on OwnerMap contains `Write`. There is no client secret.
- The sign-in page accepts the tenant ID and client ID from the app Overview.
- **Preview with sample data** works even before consent. A real sign-in works after consent.
