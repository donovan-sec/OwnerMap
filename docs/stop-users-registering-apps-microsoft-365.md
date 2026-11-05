```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "headline": "How to stop regular users from registering apps and granting app access in Microsoft 365",
      "author": {"@type": "Organization", "name": "OwnerMap", "url": "https://github.com/donovan-sec/OwnerMap"},
      "dateModified": "2026-11-05",
      "about": ["Microsoft Entra ID user consent", "App registration", "Admin consent workflow"],
      "citation": [
        "https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent",
        "https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow",
        "https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-app-roles",
        "https://learn.microsoft.com/en-us/entra/fundamentals/users-default-permissions"
      ]
    },
    {
      "@type": "SoftwareApplication",
      "name": "OwnerMap",
      "applicationCategory": "SecurityApplication",
      "operatingSystem": "Web browser (self-hosted static page)",
      "description": "Free, read-only Microsoft 365 and Entra hygiene check for small businesses. Its Tenant defaults check reads who can register applications, create tenants, create security groups and invite guests, how much guests can see, and whether user consent is a broad or legacy policy.",
      "license": "https://opensource.org/licenses/MIT",
      "url": "https://github.com/donovan-sec/OwnerMap",
      "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {"@type": "Question", "name": "Can regular users register apps in Microsoft Entra ID by default?", "acceptedAnswer": {"@type": "Answer", "text": "Yes. Microsoft Learn says that by default all users can register applications and manage all aspects of the applications they create. Set Users can register applications to No to restrict it."}},
        {"@type": "Question", "name": "Can users grant third-party apps access to their data by default?", "acceptedAnswer": {"@type": "Answer", "text": "Yes, for permissions that do not require administrator consent. Microsoft's example is that a user can consent to let an app access their mailbox."}},
        {"@type": "Question", "name": "What user consent setting does Microsoft recommend?", "acceptedAnswer": {"@type": "Answer", "text": "Microsoft Learn recommends allowing user consent only for applications published by a verified publisher. Its delegation guide also describes selecting Do not allow user consent."}},
        {"@type": "Question", "name": "Does tightening user consent revoke grants that were already given?", "acceptedAnswer": {"@type": "Answer", "text": "No. Updates to user consent settings only affect future consent operations. Existing consent grants remain unchanged until an admin reviews permissions granted to enterprise applications and revokes them."}},
        {"@type": "Question", "name": "What happens when users cannot consent to an app?", "acceptedAnswer": {"@type": "Answer", "text": "If the admin consent workflow is on, users can request admin consent and a chosen reviewer approves or denies it. Turn the workflow on before you block user consent."}},
        {"@type": "Question", "name": "Does OwnerMap change these settings?", "acceptedAnswer": {"@type": "Answer", "text": "No. OwnerMap is read-only. It reports the settings and lists steps. You make any change in the Entra admin center."}}
      ]
    }
  ]
}
```

# How to stop regular users from registering apps and granting app access in Microsoft 365

In many Microsoft 365 tenants, any regular user can register an app or let a third-party app read their mail and files, and nobody in a small business ever checks that setting. This page shows where those defaults live in the Entra admin center, which ones Microsoft recommends tightening, and how to check them all at once with a free read-only tool.

## What the defaults allow

Two separate settings matter here. People mix them up, so it helps to keep them apart.

**App registration.** Microsoft Learn says that by default all users can register applications and manage all aspects of the applications they create ([Delegate app registration permissions](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-app-roles)). The default permissions page says the same thing in its list: member users can register applications ([Default user permissions](https://learn.microsoft.com/en-us/entra/fundamentals/users-default-permissions)). Whoever registers an app owns it. An owner can add a password (a client secret) to it.

**User consent.** Before an app can reach your data, someone has to grant it permissions. Microsoft Learn says that by default all users can consent to apps for permissions that don't require administrator consent. Its own example: a user can let an app access their mailbox ([Configure how users consent to applications](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)).

So one busy person clicking "Accept" on a sign-in prompt can give an outside app ongoing access to their mail. In a small business, nobody may notice.

## The settings, and where Microsoft puts them

Menu names in the Entra admin center move around. Microsoft's own pages don't all use the same path. The paths below are quoted from the Learn page cited next to each one.

### Users can register applications

Per [Delegate app registration permissions](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-app-roles):

1. Sign in to the Microsoft Entra admin center as at least a Cloud Application Administrator.
2. Browse to **Entra ID > Users > User settings**.
3. Set **Users can register applications** to **No**.

That turns off the default ability for users to create app registrations. If some people still need to register apps, the same page and [Default user permissions](https://learn.microsoft.com/en-us/entra/fundamentals/users-default-permissions) point to the **Application Developer** role. Give it only to them.

### User consent settings

Per [Configure how users consent to applications](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent):

1. Sign in to the Microsoft Entra admin center as a Global Administrator.
2. Browse to **Identity > Applications > Enterprise apps > Consent and permissions > User consent settings**.
3. Under **User consent for applications**, pick a setting and select **Save**.

The delegation guide gives a shorter path, **Entra ID > Enterprise apps > Consent and permissions**, and says to select **Do not allow user consent** ([Delegate app registration permissions](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-app-roles)). Your portal may show either one.

The options you'll see, as Learn describes them:

- **Do not allow user consent.** Users can't grant apps access. An admin has to.
- **Allow user consent for apps from verified publishers, for selected permissions.** Users can consent only for apps from verified publishers and apps registered in your tenant, and only for permissions you classify as low impact. You have to classify those permissions first.
- **Allow user consent for apps.** Learn says this lets all users consent to any permission that doesn't require admin consent, for any application. This is the broad one.

Microsoft's guidance on that page is direct: "we recommend that you allow user consent only for applications that have been published by a verified publisher."

Learn states: "Any updates to user consent settings only affect future consent operations for applications. Existing consent grants remain unchanged, and users continue to have access based on the permissions previously granted." Existing OAuth/consent grants stay until an admin reviews and revokes them. For that review, see [reviewing permissions granted to enterprise applications](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent).

## The safe order: admin consent workflow first

If you block user consent and stop there, people hit a wall. They can't use a tool they need, and they don't know who to ask. So they find a workaround, or they just stop telling IT.

The admin consent workflow fixes that. When a user can't consent to an app, they can send a request, and a reviewer you choose approves or denies it. Per [Configure the admin consent workflow](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow):

1. Sign in to the Microsoft Entra admin center as a Global Administrator.
2. Browse to **Entra ID > Enterprise apps > Consent and permissions > Admin consent settings**.
3. Under **Admin consent requests**, select **Yes** for **Users can request admin consent to apps they are unable to consent to**.
4. Choose **Who can review admin consent requests**, decide on email notifications and reminders, and set **Consent request expires after (days)**.
5. Select **Save**.

Learn notes it can take up to an hour for the workflow to turn on. So a sensible order looks like this:

1. Turn on the admin consent workflow and pick at least one reviewer.
2. Wait for it to take effect, and tell staff what the new request prompt will look like.
3. Tighten user consent to verified publishers, or turn it off.
4. Set **Users can register applications** to **No** and give the Application Developer role to the few who need it.

## Checking it all at once with OwnerMap

Clicking through three admin pages is fine once. It's easy to forget the next time. [OwnerMap](https://github.com/donovan-sec/OwnerMap) is a free, read-only Microsoft 365 and Entra hygiene check for small businesses. It's a static page you host yourself: on the admin PC, on Azure Static Web Apps, or on an internal web server. There's no server behind it and no database, and it asks for no write permissions.

Its Tenant defaults check reads your tenant's authorization policy from Microsoft Graph v1.0 and reports:

- who can register applications
- who can create tenants
- who can create security groups
- who can invite guests
- how much of the directory guests can see
- whether user consent is a broad or legacy policy

Each finding explains what the result means and lists steps in the Microsoft 365 and Entra admin centers, with links back to Microsoft Learn. For example, if any member can register apps, OwnerMap flags it as medium and points to the **Users can register applications** setting. If user consent is the legacy any-app policy or another broad one, it rates that high.

A few honest limits:

- The Tenant defaults check needs the optional delegated `Policy.Read.All` permission. Without it, the check says so and shows as not checked. Every other check still runs.
- A setting the policy doesn't return is shown as not checked. It isn't guessed.
- OwnerMap doesn't change anything. You make the fix in the admin center.

Setup is one app registration with delegated, read-only Microsoft Graph permissions. The repo's [setup guide](https://github.com/donovan-sec/OwnerMap/blob/main/docs/SETUP.md) walks through it, and a **Preview with sample data** button shows a fictional tenant before you connect your own.

## FAQ

**Can regular users register apps in Microsoft Entra ID by default?**
Yes. Microsoft Learn says all users can register applications and manage the ones they create. Set **Users can register applications** to **No** to restrict it.

**Can users grant third-party apps access to their data by default?**
Yes, for permissions that don't need administrator consent. Microsoft's example is an app reading the user's mailbox.

**What user consent setting does Microsoft recommend?**
Learn recommends allowing user consent only for apps from verified publishers. The delegation guide also describes **Do not allow user consent**.

**Does tightening user consent revoke grants that were already given?**
No. Updates only affect future consent operations. Existing OAuth/consent grants remain unchanged until an admin reviews and revokes them. See [reviewing permissions granted to enterprise applications](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent).

**What happens when users can't consent to an app?**
With the admin consent workflow on, they send a request and your reviewer decides. Turn that on before you block consent.

**Does OwnerMap change these settings?**
No. It's read-only. It shows the current setting and the steps, and you decide.

## Check your tenant defaults

Want to see where your tenant stands today? Get [OwnerMap on GitHub](https://github.com/donovan-sec/OwnerMap). It's free, MIT licensed and self-hosted. Run it with a Global Reader account, open the Tenant defaults tab, and you'll see who can register apps and how open user consent is, in plain words.
