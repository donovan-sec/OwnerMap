/**
 * OwnerMap hygiene rules. Pure functions: no network, no DOM.
 * The page fetches Microsoft Graph, then calls analyze() with that payload.
 * Unit tests feed the same shape with mocked Graph responses.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OwnerMapHygiene = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STALE_DAYS = 90;
  const EXPIRING_DAYS = 30;
  const MS_FIRST_PARTY_TENANT = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a';
  const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
  const BROAD_USERS_MEDIUM = 5;
  const BROAD_USERS_HIGH = 15;
  const BROAD_GROUPS_MEDIUM = 2;
  const BROAD_GROUPS_HIGH = 4;

  /** Delegated read scopes the page requests. No write scopes, ever. */
  const PERMISSIONS = [
    { scope: 'User.Read', type: 'Delegated', required: true, license: 'Any', purpose: 'Sign in and confirm the account running the check' },
    { scope: 'Group.Read.All', type: 'Delegated', required: true, license: 'Any', purpose: 'Read groups and their owners' },
    { scope: 'GroupMember.Read.All', type: 'Delegated', required: true, license: 'Any', purpose: 'Read group members' },
    { scope: 'User.Read.All', type: 'Delegated', required: true, license: 'Any', purpose: 'Read users, guests, enabled state, and assigned licenses' },
    { scope: 'Directory.Read.All', type: 'Delegated', required: true, license: 'Any', purpose: 'Read directory objects, on-prem sync flags, and subscribed licenses' },
    { scope: 'Application.Read.All', type: 'Delegated', required: true, license: 'Any', purpose: 'Read app registrations, enterprise apps, owners, and credentials' },
    { scope: 'AuditLog.Read.All', type: 'Delegated', required: false, license: 'Entra ID P1 or P2', purpose: 'Read signInActivity for stale accounts and stale guests' },
    { scope: 'Policy.Read.All', type: 'Delegated', required: false, license: 'Entra ID P1 or P2', purpose: 'Read Conditional Access policies and security defaults' }
  ];

  const GRAPH_SCOPE = 'https://graph.microsoft.com/';
  const SCOPES = {
    core: PERMISSIONS.filter(p => p.required).map(p => GRAPH_SCOPE + p.scope),
    audit: [GRAPH_SCOPE + 'AuditLog.Read.All'],
    policy: [GRAPH_SCOPE + 'Policy.Read.All']
  };
  SCOPES.all = SCOPES.core.concat(SCOPES.audit, SCOPES.policy);

  /** Application permissions (app roles) worth telling a small-business admin about. */
  const HIGH_PRIVILEGE_GRAPH_ROLES = {
    'RoleManagement.ReadWrite.Directory': 'Can assign admin roles to anyone, including itself.',
    'Directory.ReadWrite.All': 'Can change users, groups, and devices without a person signing in.',
    'Application.ReadWrite.All': 'Can create apps and add secrets to them.',
    'AppRoleAssignment.ReadWrite.All': 'Can grant other apps powerful permissions.',
    'PrivilegedAccess.ReadWrite.AzureAD': 'Can change privileged access in the directory.',
    'PrivilegedAccess.ReadWrite.AzureADGroup': 'Can change privileged group access.',
    'PrivilegedAccess.ReadWrite.AzureResources': 'Can change privileged access for Azure resources.',
    'Policy.ReadWrite.ConditionalAccess': 'Can change the sign-in rules that require MFA.',
    'Policy.ReadWrite.AuthenticationMethod': 'Can change how MFA works.',
    'Policy.ReadWrite.Authorization': 'Can change authorization policy.',
    'Group.ReadWrite.All': 'Can add or remove anyone from any group.',
    'User.ReadWrite.All': 'Can change every user account.',
    'Organization.ReadWrite.All': 'Can change tenant-wide settings.',
    'Domain.ReadWrite.All': 'Can change the domains this tenant trusts.',
    'UserAuthenticationMethod.ReadWrite.All': 'Can change or delete MFA methods on user accounts.',
    'IdentityRiskyUser.ReadWrite.All': 'Can dismiss risky-user flags.',
    'DeviceManagementConfiguration.ReadWrite.All': 'Can change device configuration policies.',
    'DeviceManagementManagedDevices.PrivilegedOperations.All': 'Can run privileged actions on managed devices.',
    'Sites.FullControl.All': 'Can control every SharePoint site.',
    'Files.ReadWrite.All': 'Can read and change every file the tenant can reach.',
    'Mail.ReadWrite': 'Can read and change every mailbox.',
    'Mail.Send': 'Can send mail as any user.',
    'SecurityEvents.ReadWrite.All': 'Can change security alerts.',
    'RoleAssignmentSchedule.ReadWrite.Directory': 'Can schedule admin role assignments.',
    'EntitlementManagement.ReadWrite.All': 'Can change access packages and who can request them.'
  };

  const MEDIUM_PRIVILEGE_GRAPH_ROLES = {
    'Directory.Read.All': 'Can read the whole directory, including users and groups.',
    'Application.Read.All': 'Can read every app registration and its configuration.',
    'User.Read.All': 'Can read every user profile.',
    'Group.Read.All': 'Can read every group and its membership.',
    'Mail.Read': 'Can read every mailbox.',
    'Files.Read.All': 'Can read every file the tenant can reach.',
    'Sites.Read.All': 'Can read every SharePoint site.',
    'AuditLog.Read.All': 'Can read sign-in and audit logs.',
    'Policy.Read.All': 'Can read Conditional Access and other policies.',
    'Member.Read.Hidden': 'Can read hidden group memberships.'
  };

  const SKU_NAMES = {
    SPE_E3: 'Microsoft 365 E3',
    SPE_E5: 'Microsoft 365 E5',
    ENTERPRISEPACK: 'Office 365 E3',
    ENTERPRISEPREMIUM: 'Office 365 E5',
    O365_BUSINESS_PREMIUM: 'Microsoft 365 Business Standard',
    O365_BUSINESS_ESSENTIALS: 'Microsoft 365 Business Basic',
    SPB: 'Microsoft 365 Business Premium',
    SMB_BUSINESS: 'Microsoft 365 Apps for business',
    SMB_BUSINESS_ESSENTIALS: 'Microsoft 365 Business Basic',
    EXCHANGESTANDARD: 'Exchange Online (Plan 1)',
    EXCHANGEENTERPRISE: 'Exchange Online (Plan 2)',
    FLOW_FREE: 'Power Automate Free',
    POWER_BI_STANDARD: 'Power BI Free',
    TEAMS_EXPLORATORY: 'Microsoft Teams Exploratory',
    AAD_PREMIUM: 'Microsoft Entra ID P1',
    AAD_PREMIUM_P2: 'Microsoft Entra ID P2',
    EMS: 'Enterprise Mobility + Security E3',
    EMSPREMIUM: 'Enterprise Mobility + Security E5',
    ATP_ENTERPRISE: 'Microsoft Defender for Office 365 (Plan 1)',
    DESKLESSPACK: 'Office 365 F3',
    SPE_F1: 'Microsoft 365 F3',
    M365_F1: 'Microsoft 365 F1',
    VISIOCLIENT: 'Visio Plan 2',
    PROJECTPROFESSIONAL: 'Project Plan 3',
    PROJECTPREMIUM: 'Project Plan 5',
    WIN_DEF_ATP: 'Microsoft Defender for Endpoint',
    MCOPSTN1: 'Teams Phone Standard',
    RIGHTSMANAGEMENT_ADHOC: 'Rights Management Adhoc'
  };

  const SPECIAL_AUDIENCE = new Set(['All', 'None', 'GuestsOrExternalUsers']);

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Prefix spreadsheet formulas so Excel and Sheets treat the cell as text. */
  function csvCell(value) {
    const s = String(value === null || value === undefined ? '' : value);
    return /^[=+\-@\t\r]/.test(s) ? '\t' + s : s;
  }

  function toCsv(headers, records) {
    const lines = [headers].concat(records).map(row =>
      asArray(row).map(cell => '"' + csvCell(cell).replace(/"/g, '""') + '"').join(',')
    );
    return lines.join('\n');
  }

  function checkToCsv(check) {
    const columns = asArray(check && check.columns);
    const headers = columns.map(column => column.label);
    const records = asArray(check && check.rows).map(row =>
      columns.map(column => row[column.key] == null ? '' : row[column.key])
    );
    return toCsv(headers, records);
  }

  function parseTime(value) {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }

  function daysBetween(laterMs, earlierMs) {
    return Math.floor((laterMs - earlierMs) / 86400000);
  }

  function formatDate(ms) {
    if (ms === null || ms === undefined || Number.isNaN(ms)) return '';
    const date = new Date(ms);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return date.getUTCDate() + ' ' + months[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
  }

  function plural(count, singular, pluralWord) {
    return count + ' ' + (count === 1 ? singular : (pluralWord || singular + 's'));
  }

  function latestSignInMs(activity) {
    if (!activity) return null;
    const stamps = [activity.lastSignInDateTime, activity.lastNonInteractiveSignInDateTime]
      .map(parseTime)
      .filter(time => time !== null);
    if (!stamps.length) return null;
    return Math.max.apply(null, stamps);
  }

  function isGuest(user) {
    return String(user && user.userType || '') === 'Guest';
  }

  function isEnabled(user) {
    return !user || user.accountEnabled !== false;
  }

  function displayName(user) {
    return (user && (user.displayName || user.userPrincipalName || user.mail || user.id)) || '(unnamed)';
  }

  function upn(user) {
    return (user && (user.userPrincipalName || user.mail || user.id)) || '';
  }

  function countsOf(findings) {
    const counts = { high: 0, medium: 0, low: 0 };
    asArray(findings).forEach(finding => {
      if (counts[finding.severity] !== undefined) counts[finding.severity] += 1;
    });
    return counts;
  }

  function worstSeverity(findings) {
    const counts = countsOf(findings);
    if (counts.high) return 'high';
    if (counts.medium) return 'medium';
    if (counts.low) return 'low';
    return 'ok';
  }

  function sortFindings(findings) {
    const rank = { high: 0, medium: 1, low: 2 };
    return findings.slice().sort((a, b) => {
      const bySeverity = (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
      if (bySeverity) return bySeverity;
      return String(a.subject || '').localeCompare(String(b.subject || ''));
    });
  }

  function finding(fields) {
    return {
      id: fields.id,
      checkId: fields.checkId,
      severity: fields.severity,
      title: fields.title,
      subject: fields.subject,
      detail: fields.detail,
      steps: fields.steps || [],
      subjectId: fields.subjectId || ''
    };
  }

  function interpretOptionalError(kind, error) {
    const status = error && error.status ? error.status : 0;
    const code = String(error && (error.code || error.errorCode) || '');
    const message = String(error && (error.graphMessage || error.message) || '');
    const blob = (code + ' ' + message).toLowerCase();
    let reason = 'error';
    if (
      code === 'Authentication_RequestFromNonPremiumTenantOrB2CTenant' ||
      blob.includes('premium') ||
      blob.includes('not licensed') ||
      blob.includes('subscription')
    ) {
      reason = 'license';
    } else if (
      status === 401 || status === 403 ||
      code === 'Authorization_RequestDenied' ||
      code === 'AccessDenied' ||
      blob.includes('insufficient') ||
      blob.includes('forbidden') ||
      blob.includes('authorization')
    ) {
      reason = 'permission';
    }
    return {
      available: false,
      reason,
      message: unavailableMessage(kind, reason, null)
    };
  }

  function unavailableMessage(kind, reason, securityDefaults) {
    if (kind === 'signIn' && reason === 'license') {
      return 'Sign-in dates need Microsoft Entra ID P1 (or P2) plus the AuditLog.Read.All permission. This tenant does not appear to have that license, so stale accounts and stale guests were skipped. Every other check still ran. One Entra ID P1 license is enough to unlock sign-in reports for the whole tenant.';
    }
    if (kind === 'signIn' && reason === 'permission') {
      return 'Sign-in dates need the delegated permission AuditLog.Read.All. An admin has to open the app registration, add that permission, and click Grant admin consent. Stale accounts and stale guests were skipped. Every other check still ran.';
    }
    if (kind === 'signIn') {
      return 'Microsoft Graph did not return sign-in dates, so stale accounts and stale guests were skipped. Every other check still ran. Try the check again in a few minutes.';
    }
    if (kind === 'conditionalAccess' && reason === 'license') {
      let text = 'Conditional Access needs Microsoft Entra ID P1 (or P2) and the Policy.Read.All permission. This tenant does not appear to have that license, so sign-in policies were skipped. Every other check still ran.';
      if (securityDefaults && securityDefaults.known && securityDefaults.enabled) {
        text += ' Security defaults are turned on. They require MFA for admin roles and they challenge risky sign-ins. They do not block legacy mail apps, and they do not let you write your own rules. That is a reasonable start for a very small tenant.';
      } else if (securityDefaults && securityDefaults.known && securityDefaults.enabled === false) {
        text += ' Security defaults are turned off as well, so this tenant does not currently have that built-in safety net.';
      }
      return text;
    }
    if (kind === 'conditionalAccess' && reason === 'permission') {
      return 'Conditional Access needs the delegated permission Policy.Read.All. An admin has to add that permission and click Grant admin consent. Sign-in policies were skipped. Every other check still ran.';
    }
    if (kind === 'conditionalAccess') {
      return 'Microsoft Graph did not return Conditional Access policies. This check was skipped. Every other check still ran.';
    }
    return 'This check could not be completed.';
  }

  function classifyGroupType(group) {
    const types = asArray(group && group.groupTypes);
    if (types.indexOf('Unified') !== -1) return 'm365';
    if (group && group.mailEnabled && !group.securityEnabled) return 'distribution';
    if (group && group.securityEnabled) return 'security';
    return 'other';
  }

  const GROUP_TYPE_LABEL = {
    m365: 'M365',
    distribution: 'Distribution',
    security: 'Security',
    other: 'Other'
  };

  function personList(people, limit) {
    const items = asArray(people);
    const shown = items.slice(0, limit).map(person => {
      const name = person.displayName || person.userPrincipalName || person.mail || person.id || 'Unknown';
      const id = person.userPrincipalName || person.mail || person.id || '';
      return id ? name + ' <' + id + '>' : name;
    });
    if (items.length > limit) shown.push('+' + (items.length - limit) + ' more');
    return shown.join(' | ');
  }

  function analyzeGroups(groups, users) {
    const memberIds = new Set();
    const rows = asArray(groups).map(group => {
      const owners = asArray(group.owners);
      const members = asArray(group.members);
      members.forEach(member => { if (member && member.id) memberIds.add(member.id); });
      const type = classifyGroupType(group);
      const source = group.onPremisesSyncEnabled ? 'on-prem' : 'cloud';
      const ownerCount = owners.length;
      return {
        id: group.id,
        name: group.displayName || '(Unnamed group)',
        description: group.description || '',
        type: GROUP_TYPE_LABEL[type] || 'Other',
        typeKey: type,
        source: source === 'on-prem' ? 'On-prem' : 'Cloud',
        sourceKey: source,
        membersCount: String(members.length),
        ownersCount: String(ownerCount),
        ownersLabel: ownerCount ? personList(owners, 8) : 'No owner',
        membersLabel: members.length ? personList(members, 100) : '',
        severity: ownerCount === 0 ? 'high' : 'ok',
        owners,
        members
      };
    });

    const findings = [];
    rows.filter(row => row.severity === 'high').forEach(row => {
      findings.push(finding({
        id: 'groups:no-owner:' + row.id,
        checkId: 'groups',
        severity: 'high',
        title: 'Group has no owner',
        subject: row.name,
        detail: row.type + ' group · ' + row.source + ' · ' + plural(Number(row.membersCount), 'member') + '. Nobody is responsible for approving who belongs here.',
        steps: groupSteps()
      }));
    });

    const unassigned = asArray(users).filter(user =>
      user && user.id && isEnabled(user) && !isGuest(user) && !memberIds.has(user.id)
    );
    if (unassigned.length) {
      findings.push(finding({
        id: 'groups:unassigned',
        checkId: 'groups',
        severity: 'low',
        title: 'Enabled accounts are not in any group',
        subject: plural(unassigned.length, 'enabled account'),
        detail: 'These people are not direct members of any group. They are easy to forget when someone leaves. ' +
          unassigned.slice(0, 12).map(displayName).join(', ') +
          (unassigned.length > 12 ? ', +' + (unassigned.length - 12) + ' more' : '') + '.',
        steps: [
          'Open the Microsoft Entra admin center and go to Identity → Users → All users.',
          'Compare this list with the people who still work for you.',
          'Leave the account as it is when the person still needs mail or files and simply has no group.',
          'When the person has left, block sign-in and remove their licenses.'
        ]
      }));
    }

    const noOwner = rows.filter(row => row.severity === 'high').length;
    return checkResult({
      id: 'groups',
      title: 'Groups and owners',
      nav: 'Groups',
      available: true,
      explanation: 'A group with no owner has nobody to approve who should be in it. New access gets added by whoever happens to be an admin, and people who leave can stay in the group. This is a common gap when an auditor asks who approves access.',
      steps: groupSteps(),
      findings,
      rows,
      columns: [
        { key: 'name', label: 'Group name', table: true },
        { key: 'description', label: 'Description' },
        { key: 'type', label: 'Type', table: true },
        { key: 'source', label: 'Source', table: true },
        { key: 'membersCount', label: 'Members', table: true },
        { key: 'ownersCount', label: 'Owner count' },
        { key: 'ownersLabel', label: 'Owners', table: true },
        { key: 'membersLabel', label: 'Members (name and UPN)' },
        { key: 'severity', label: 'Severity', table: true }
      ],
      headline: groupHeadline(noOwner, unassigned.length),
      stats: {
        groups: rows.length,
        noOwner,
        unassigned: unassigned.length,
        security: rows.filter(row => row.typeKey === 'security').length,
        coverage: rows.length ? Math.round(((rows.length - noOwner) / rows.length) * 100) : 100
      },
      extraRows: {
        unassigned: unassigned.map(user => ({
          name: displayName(user),
          upn: upn(user),
          severity: 'low'
        }))
      }
    });
  }

  function groupHeadline(noOwner, unassigned) {
    const bits = [];
    if (noOwner) bits.push(plural(noOwner, 'group') + (noOwner === 1 ? ' has no owner' : ' have no owner'));
    if (unassigned) bits.push(plural(unassigned, 'enabled account') + (unassigned === 1 ? ' is not in a group' : ' are not in a group'));
    return bits.length ? bits.join(', and ') : 'Every group has an owner';
  }

  function groupSteps() {
    return [
      'Open the Microsoft Entra admin center (entra.microsoft.com) and go to Identity → Groups → All groups.',
      'Open the group named in this finding.',
      'Select Owners → Add owners.',
      'Pick the manager who should approve access. Use a named person, and keep a shared mailbox off the owner list.',
      'Repeat for every group flagged here, starting with Security groups.'
    ];
  }

  function activityFor(user, signInById, signInAvailable) {
    if (!signInAvailable) return undefined;
    if (!signInById) return null;
    if (Object.prototype.hasOwnProperty.call(signInById, user.id)) return signInById[user.id];
    return null;
  }

  function staleness(user, activity, nowMs, staleDays) {
    const last = latestSignInMs(activity);
    if (last === null) {
      const created = parseTime(user.createdDateTime);
      if (created === null) return { stale: true, reason: 'never', days: null, last: null };
      const days = daysBetween(nowMs, created);
      return { stale: days >= staleDays, reason: 'never', days, last: null };
    }
    const days = daysBetween(nowMs, last);
    return { stale: days >= staleDays, reason: 'inactive', days, last };
  }

  function analyzeStale(users, signIn, nowMs, staleDays) {
    const available = !!(signIn && signIn.available);
    const steps = [
      'Open the Microsoft 365 admin center (admin.microsoft.com) → Users → Active users.',
      'For each person on this list, ask their manager whether they still work here.',
      'When they have left, open them in the Entra admin center → Properties, and set Account enabled to No.',
      'Then open Licenses and apps and clear every license.',
      'Shared mailboxes and connector accounts often have no human sign-in. Read the name before you block anything.',
      'When someone is on leave, leave the account enabled and check this list again next quarter.'
    ];
    if (!available) {
      return checkResult({
        id: 'staleAccounts',
        title: 'Stale accounts',
        nav: 'Stale',
        available: false,
        unavailableMessage: (signIn && signIn.message) || unavailableMessage('signIn', signIn && signIn.reason, null),
        explanation: 'An enabled account that nobody has used in 90 days is still a door into mail and files. This check reads the sign-in date Microsoft stores on each user.',
        steps,
        findings: [],
        rows: [],
        columns: staleColumns(),
        headline: 'Sign-in dates unavailable',
        stats: { stale: 0 }
      });
    }

    const rows = [];
    const findings = [];
    asArray(users).forEach(user => {
      if (!user || !user.id || !isEnabled(user) || isGuest(user)) return;
      const state = staleness(user, activityFor(user, signIn.byId, true), nowMs, staleDays);
      if (!state.stale) return;
      const when = state.reason === 'never'
        ? (state.days === null
          ? 'No sign-in is recorded, and Microsoft did not return a created date.'
          : 'No sign-in is recorded. The account was created ' + plural(state.days, 'day') + ' ago.')
        : 'Last sign-in was ' + plural(state.days, 'day') + ' ago (' + formatDate(state.last) + ').';
      const row = {
        id: user.id,
        name: displayName(user),
        upn: upn(user),
        lastSignIn: state.last ? formatDate(state.last) : 'Never',
        days: state.days === null ? '' : String(state.days),
        detail: when,
        severity: 'high'
      };
      rows.push(row);
      findings.push(finding({
        id: 'stale:' + user.id,
        checkId: 'staleAccounts',
        severity: 'high',
        title: 'Enabled account with no recent sign-in',
        subject: row.name,
        detail: row.upn + ' — ' + when,
        steps
      }));
    });

    return checkResult({
      id: 'staleAccounts',
      title: 'Stale accounts',
      nav: 'Stale',
      available: true,
      explanation: 'These people can still sign in, and Microsoft has no sign-in for them in the last ' + staleDays + ' days. We use the newest date Microsoft recorded, including background sign-ins such as Outlook on a phone. Forgotten accounts are a common way into a small business.',
      steps,
      findings,
      rows,
      columns: staleColumns(),
      headline: rows.length ? plural(rows.length, 'enabled account') + ' with no sign-in in ' + staleDays + '+ days' : 'No stale enabled accounts',
      stats: { stale: rows.length }
    });
  }

  function staleColumns() {
    return [
      { key: 'name', label: 'Name' },
      { key: 'upn', label: 'User principal name' },
      { key: 'lastSignIn', label: 'Last sign-in' },
      { key: 'days', label: 'Days' },
      { key: 'detail', label: 'What we found' },
      { key: 'severity', label: 'Severity' }
    ];
  }

  function licenseNames(user, skuNameById) {
    return asArray(user && user.assignedLicenses).map(entry => {
      const name = skuNameById[entry && entry.skuId];
      return name || (entry && entry.skuId) || 'Unknown license';
    });
  }

  function analyzeDisabled(users, groups, skuNameById) {
    const memberOf = {};
    const ownerOf = {};
    asArray(groups).forEach(group => {
      const name = group.displayName || group.id;
      asArray(group.members).forEach(member => {
        if (!member || !member.id) return;
        (memberOf[member.id] || (memberOf[member.id] = [])).push(name);
      });
      asArray(group.owners).forEach(owner => {
        if (!owner || !owner.id) return;
        (ownerOf[owner.id] || (ownerOf[owner.id] = [])).push(name);
      });
    });

    const steps = [
      'Open the Entra admin center → Identity → Users → All users, and open the person.',
      'Open Licenses and clear every license, then Save. A blocked account that still holds a license is still being paid for.',
      'Open Groups and remove the person from each group listed here.',
      'Open the groups they own and add a current employee as owner before you remove them.',
      'After your usual retention period, delete the account from Users.'
    ];

    const findings = [];
    const rows = [];
    asArray(users).forEach(user => {
      if (!user || !user.id || isEnabled(user)) return;
      const licenses = licenseNames(user, skuNameById);
      const groupsIn = memberOf[user.id] || [];
      const owns = ownerOf[user.id] || [];
      if (!licenses.length && !groupsIn.length && !owns.length) return;
      const severity = licenses.length ? 'high' : 'medium';
      const parts = ['Sign-in is already blocked.'];
      if (licenses.length) parts.push('Still licensed for ' + licenses.join(', ') + '.');
      if (groupsIn.length) parts.push('Still a member of ' + groupsIn.join(', ') + '.');
      if (owns.length) parts.push('Still an owner of ' + owns.join(', ') + '.');
      const row = {
        id: user.id,
        name: displayName(user),
        upn: upn(user),
        licenses: licenses.join(', '),
        groups: groupsIn.join(', '),
        owns: owns.join(', '),
        detail: parts.join(' '),
        severity
      };
      rows.push(row);
      findings.push(finding({
        id: 'disabled:' + user.id,
        checkId: 'disabledUsers',
        severity,
        title: licenses.length ? 'Disabled account still holds a license' : 'Disabled account still has group access',
        subject: row.name,
        detail: row.upn + ' — ' + row.detail,
        steps
      }));
    });

    return checkResult({
      id: 'disabledUsers',
      title: 'Disabled accounts',
      nav: 'Disabled',
      available: true,
      explanation: 'These accounts cannot sign in, which is what you want after someone leaves. They still sit in groups, still own groups, or still hold a paid license. Group membership keeps them in access reviews. A license on a blocked account is money spent on a person who cannot use it.',
      steps,
      findings,
      rows,
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'upn', label: 'User principal name' },
        { key: 'licenses', label: 'Licenses' },
        { key: 'groups', label: 'Member of' },
        { key: 'owns', label: 'Owner of' },
        { key: 'detail', label: 'What we found' },
        { key: 'severity', label: 'Severity' }
      ],
      headline: findings.length ? plural(findings.length, 'disabled account') + ' still in a group or still licensed' : 'No disabled account still has a license or a group',
      stats: {
        flagged: findings.length,
        withLicenses: findings.filter(item => item.severity === 'high').length
      }
    });
  }

  function analyzeGuests(users, signIn, nowMs, staleDays) {
    const signInAvailable = !!(signIn && signIn.available);
    const steps = [
      'Open the Entra admin center → Identity → Users → All users.',
      'Add a filter for User type = Guest.',
      'For each stale guest, ask the employee who invited them whether that person still needs access to Teams, SharePoint, or mail.',
      'When access is finished, open the guest and choose Delete user.',
      'Run this check again each quarter. Guests do not show up in a normal staff list, so they are easy to leave behind.'
    ];
    const findings = [];
    const rows = [];
    asArray(users).forEach(user => {
      if (!user || !user.id || !isGuest(user)) return;
      let stale = false;
      let detail = 'Guest account.';
      let lastLabel = signInAvailable ? 'Never' : 'Unknown';
      let daysLabel = '';
      if (!isEnabled(user)) {
        detail = 'Guest account with sign-in already blocked.';
        lastLabel = 'Blocked';
      } else if (signInAvailable) {
        const state = staleness(user, activityFor(user, signIn.byId, true), nowMs, staleDays);
        stale = state.stale;
        if (state.last) lastLabel = formatDate(state.last);
        if (state.days !== null) daysLabel = String(state.days);
        if (stale && state.reason === 'never') {
          detail = state.days === null
            ? 'Guest has never signed in.'
            : 'Guest has never signed in, and the invite is ' + plural(state.days, 'day') + ' old.';
        } else if (stale) {
          detail = 'Guest last signed in ' + plural(state.days, 'day') + ' ago (' + formatDate(state.last) + ').';
        } else if (state.reason === 'never') {
          detail = 'Guest has not signed in yet. The invite is ' + plural(state.days, 'day') + ' old, which is inside the ' + staleDays + '-day window.';
        } else {
          detail = 'Guest signed in ' + plural(state.days, 'day') + ' ago (' + formatDate(state.last) + ').';
        }
      } else {
        detail = 'Guest account. Sign-in dates are unavailable, so this row is only an inventory.';
      }
      const severity = stale ? 'high' : 'ok';
      const row = {
        id: user.id,
        name: displayName(user),
        upn: upn(user),
        created: formatDate(parseTime(user.createdDateTime)) || '',
        lastSignIn: lastLabel,
        days: daysLabel,
        stale: stale ? 'Yes' : 'No',
        detail,
        severity
      };
      rows.push(row);
      if (stale) {
        findings.push(finding({
          id: 'guest:' + user.id,
          checkId: 'guests',
          severity: 'high',
          title: 'Stale guest account',
          subject: row.name,
          detail: row.upn + ' — ' + detail,
          steps
        }));
      }
    });

    const note = signInAvailable
      ? ''
      : 'Stale guests could not be separated from active guests because sign-in dates are unavailable. The list below is every guest we could read.';

    return checkResult({
      id: 'guests',
      title: 'Guest accounts',
      nav: 'Guests',
      available: true,
      note,
      explanation: 'Guests are people outside your company who were invited into Teams, SharePoint, or email. A stale guest has not signed in for ' + staleDays + ' days, or was invited that long ago and has never signed in, and can still open whatever was shared with them.',
      steps,
      findings,
      rows,
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'upn', label: 'User principal name' },
        { key: 'created', label: 'Created' },
        { key: 'lastSignIn', label: 'Last sign-in' },
        { key: 'days', label: 'Days' },
        { key: 'stale', label: 'Stale' },
        { key: 'detail', label: 'What we found' },
        { key: 'severity', label: 'Severity' }
      ],
      headline: findings.length
        ? plural(findings.length, 'stale guest') + ' of ' + plural(rows.length, 'guest')
        : (rows.length ? plural(rows.length, 'guest') + ', none stale' : 'No guest accounts'),
      stats: { guests: rows.length, stale: findings.length }
    });
  }

  function credentialState(credential, nowMs, expiringDays) {
    if (!credential) return null;
    const end = parseTime(credential.endDateTime);
    if (end === null) return null;
    if (end < nowMs) return { state: 'expired', end, days: daysBetween(nowMs, end) };
    const daysLeft = daysBetween(end, nowMs);
    if (daysLeft <= expiringDays) return { state: 'expiring', end, days: daysLeft };
    return { state: 'ok', end, days: daysLeft };
  }

  function isFirstParty(sp) {
    return String(sp && sp.appOwnerOrganizationId || '').toLowerCase() === MS_FIRST_PARTY_TENANT;
  }

  function isInspectableSp(sp) {
    if (!sp) return false;
    const type = sp.servicePrincipalType || 'Application';
    if (type === 'ManagedIdentity' || type === 'SocialIdp') return false;
    if (String(sp.appId || '').toLowerCase() === GRAPH_APP_ID) return false;
    return true;
  }

  function analyzeApps(snapshot, nowMs, expiringDays) {
    const stepsOwner = [
      'Open the Entra admin center → Applications → App registrations, and open the app.',
      'Select Owners → Add owners.',
      'Pick a current employee who is responsible for that app. A shared mailbox cannot renew a secret or answer an auditor.'
    ];
    const stepsSecret = [
      'Open the Entra admin center → Applications → App registrations → the app → Certificates & secrets.',
      'Create a new client secret or, better, a certificate. Copy the secret value when it is shown. Microsoft will not show it again.',
      'Update the application or integration that uses the old secret so it uses the new one.',
      'Delete the expired secret after the integration works.',
      'Put a reminder on the calendar a week before the new expiry date.'
    ];
    const stepsPriv = [
      'Open the Entra admin center → Applications → Enterprise applications, and open the app.',
      'Select Permissions and review the Microsoft Graph application permissions.',
      'Remove any permission the app does not need, especially RoleManagement.ReadWrite.Directory, Directory.ReadWrite.All, and Application.ReadWrite.All.',
      'Ask the person who installed the app, or the vendor, before you remove a permission that a product you use might need.',
      'When you are unsure, create a fresh client secret and rotate it first so a leaked secret stops working.'
    ];

    const applications = asArray(snapshot.applications);
    const servicePrincipals = asArray(snapshot.servicePrincipals);
    const appByAppId = {};
    applications.forEach(app => { if (app && app.appId) appByAppId[app.appId] = app; });

    const roleById = {};
    asArray(snapshot.graphAppRoles).forEach(role => {
      if (role && role.id) roleById[role.id] = role;
    });
    const permsByPrincipal = {};
    asArray(snapshot.appRoleAssignedTo).forEach(assignment => {
      if (!assignment || !assignment.principalId) return;
      (permsByPrincipal[assignment.principalId] || (permsByPrincipal[assignment.principalId] = [])).push(assignment);
    });

    const findings = [];
    const rows = [];
    const seenCreds = new Set();

    function pushCredFindings(subject, label, credentials, kindLabel) {
      asArray(credentials).forEach(credential => {
        const state = credentialState(credential, nowMs, expiringDays);
        if (!state || state.state === 'ok') return;
        const key = (subject.id || subject.name) + ':' + (credential.keyId || credential.displayName || credential.endDateTime);
        if (seenCreds.has(key)) return;
        seenCreds.add(key);
        const name = credential.displayName || kindLabel;
        const when = formatDate(state.end);
        const expired = state.state === 'expired';
        const relative = state.days === 0
          ? 'today'
          : (expired ? plural(state.days, 'day') + ' ago' : plural(state.days, 'day') + ' from now');
        findings.push(finding({
          id: 'apps:cred:' + key,
          checkId: 'applications',
          severity: expired ? 'high' : 'medium',
          title: expired ? 'Expired app credential' : 'App credential expiring soon',
          subject: subject.name,
          subjectId: subject.rowId,
          detail: label + ' "' + name + '" ' + (expired ? 'expired on ' : 'expires on ') + when + ' (' + relative + ').',
          steps: stepsSecret
        }));
      });
    }

    applications.forEach(app => {
      if (!app) return;
      const name = app.displayName || app.appId || '(unnamed app)';
      const owners = asArray(app.owners);
      rows.push({
        id: app.id || app.appId,
        kind: 'App registration',
        name,
        appId: app.appId || '',
        owners: owners.length ? personList(owners, 6) : 'No owner',
        severity: owners.length ? 'ok' : 'high'
      });
      if (!owners.length) {
        findings.push(finding({
          id: 'apps:owner:app:' + (app.id || app.appId),
          checkId: 'applications',
          severity: 'high',
          title: 'App registration has no owner',
          subject: name,
          subjectId: app.id || app.appId,
          detail: 'Nobody in your tenant is listed as responsible for this app registration' + (app.appId ? ' (' + app.appId + ')' : '') + '.',
          steps: stepsOwner
        }));
      }
      pushCredFindings({ id: 'app:' + (app.appId || app.id), rowId: app.id || app.appId, name }, 'App registration secret or certificate', asArray(app.passwordCredentials).concat(asArray(app.keyCredentials)), 'Credential');
    });

    servicePrincipals.forEach(sp => {
      if (!isInspectableSp(sp)) return;
      const firstParty = isFirstParty(sp);
      const name = sp.displayName || sp.appId || '(unnamed enterprise app)';
      const owners = asArray(sp.owners);
      const matchingApp = sp.appId ? appByAppId[sp.appId] : null;
      const ownTenant = snapshot.tenantId && String(sp.appOwnerOrganizationId || '').toLowerCase() === String(snapshot.tenantId).toLowerCase();
      const registrationOwned = matchingApp && asArray(matchingApp.owners).length > 0;
      let ownerSeverity = 'ok';
      if (!firstParty && !owners.length && !registrationOwned && !matchingApp) {
        ownerSeverity = ownTenant ? 'high' : 'medium';
      } else if (!firstParty && !owners.length && registrationOwned) {
        ownerSeverity = 'medium';
      }
      rows.push({
        id: sp.id,
        kind: 'Enterprise app',
        name,
        appId: sp.appId || '',
        owners: owners.length ? personList(owners, 6) : (firstParty ? 'Microsoft' : 'No owner'),
        severity: ownerSeverity
      });

      // A registration with no owners is already flagged. Flag the enterprise
      // app on its own when it has no registration, or when the registration
      // has owners and this object does not.
      if (!firstParty && !owners.length && (!matchingApp || registrationOwned)) {
        const severity = !matchingApp && !ownTenant ? 'medium' : (registrationOwned ? 'medium' : 'high');
        findings.push(finding({
          id: 'apps:owner:sp:' + sp.id,
          checkId: 'applications',
          severity,
          title: !matchingApp && !ownTenant
            ? 'Third-party app has no owner in your tenant'
            : 'Enterprise app has no owner',
          subject: name,
          subjectId: sp.id,
          detail: !matchingApp && !ownTenant
            ? 'This enterprise app was published by another organization and nobody in your tenant owns it.'
            : 'This enterprise app has no owner' + (registrationOwned ? ', even though the app registration lists one.' : '.'),
          steps: stepsOwner
        }));
      }

      if (!firstParty) {
        const credSubject = { id: 'sp:' + (sp.appId || sp.id), rowId: sp.id, name };
        pushCredFindings(credSubject, 'Enterprise app credential', asArray(sp.passwordCredentials).concat(asArray(sp.keyCredentials)), 'Credential');
      }

      if (firstParty) return;
      const assignments = permsByPrincipal[sp.id] || [];
      const high = [];
      const medium = [];
      let unknown = 0;
      assignments.forEach(assignment => {
        const role = roleById[assignment.appRoleId];
        if (!role || !role.value) {
          unknown += 1;
          return;
        }
        if (HIGH_PRIVILEGE_GRAPH_ROLES[role.value]) high.push(role.value);
        else if (MEDIUM_PRIVILEGE_GRAPH_ROLES[role.value]) medium.push(role.value);
      });
      if (high.length) {
        findings.push(finding({
          id: 'apps:priv:' + sp.id,
          checkId: 'applications',
          severity: 'high',
          title: 'High-privilege Microsoft Graph application permission',
          subject: name,
          subjectId: sp.id,
          detail: 'Application permission ' + high.join(', ') + '. ' + HIGH_PRIVILEGE_GRAPH_ROLES[high[0]],
          steps: stepsPriv
        }));
      } else if (medium.length) {
        findings.push(finding({
          id: 'apps:priv:' + sp.id,
          checkId: 'applications',
          severity: 'medium',
          title: 'Broad Microsoft Graph read permission',
          subject: name,
          subjectId: sp.id,
          detail: 'Application permission ' + medium.join(', ') + '. ' + MEDIUM_PRIVILEGE_GRAPH_ROLES[medium[0]],
          steps: stepsPriv
        }));
      } else if (unknown) {
        findings.push(finding({
          id: 'apps:priv:' + sp.id,
          checkId: 'applications',
          severity: 'medium',
          title: 'Microsoft Graph application permission',
          subject: name,
          subjectId: sp.id,
          detail: 'This app has ' + plural(unknown, 'Microsoft Graph application permission') + ' whose name could not be resolved. Review it in Enterprise applications → Permissions.',
          steps: stepsPriv
        }));
      }
    });

    const notes = [];
    if (snapshot.privilegeNote) notes.push(snapshot.privilegeNote);
    else if (!asArray(snapshot.graphAppRoles).length && asArray(snapshot.appRoleAssignedTo).length) {
      notes.push('Microsoft Graph permission names could not be loaded, so privilege ratings may be incomplete.');
    }

    const rank = { high: 0, medium: 1, low: 2, ok: 3 };
    rows.forEach(row => {
      const related = findings.filter(item => item.subjectId && item.subjectId === row.id);
      row.issues = related.map(item => item.title).join('; ');
      if (!related.length) return;
      const worst = worstSeverity(related);
      if ((rank[worst] ?? 9) < (rank[row.severity] ?? 9)) row.severity = worst;
    });

    return checkResult({
      id: 'applications',
      title: 'Apps and service principals',
      nav: 'Apps',
      available: snapshot.applicationsAvailable !== false,
      unavailableMessage: snapshot.applicationsMessage || '',
      note: notes.join(' '),
      explanation: 'App registrations and enterprise apps can hold passwords and broad access that keep working after the person who set them up has left. This check looks for apps with no owner, secrets or certificates that are expired or expire within ' + expiringDays + ' days, and Microsoft Graph application permissions that can read or change large parts of the tenant. Built-in Microsoft apps are left out of the owner list so the report stays about your own apps.',
      sections: [
        { title: 'Give the app an owner', steps: stepsOwner },
        { title: 'Renew a secret or certificate', steps: stepsSecret },
        { title: 'Remove powerful Graph permissions', steps: stepsPriv }
      ],
      steps: [],
      findings: snapshot.applicationsAvailable === false ? [] : findings,
      rows: snapshot.applicationsAvailable === false ? [] : rows,
      columns: [
        { key: 'kind', label: 'Kind', table: true },
        { key: 'name', label: 'Name', table: true },
        { key: 'appId', label: 'App ID', table: true },
        { key: 'owners', label: 'Owners', table: true },
        { key: 'issues', label: 'Issues', table: true },
        { key: 'severity', label: 'Severity', table: true }
      ],
      headline: snapshot.applicationsAvailable === false
        ? 'App list unavailable'
        : (findings.length ? plural(findings.length, 'app issue') : 'No owner, credential, or privilege issues'),
      stats: {
        apps: applications.length,
        servicePrincipals: servicePrincipals.filter(isInspectableSp).length,
        issues: snapshot.applicationsAvailable === false ? 0 : findings.length
      }
    });
  }

  function skuLabel(sku) {
    const part = sku && (sku.skuPartNumber || sku.skuId) || 'Unknown license';
    return SKU_NAMES[part] || part;
  }

  function isUnlimitedSku(sku) {
    const prepaid = sku && sku.prepaidUnits && sku.prepaidUnits.enabled || 0;
    const part = String(sku && sku.skuPartNumber || '');
    if (prepaid >= 100000) return true;
    return /FREE|VIRAL|EXPLORATORY|STREAM|RIGHTSMANAGEMENT_ADHOC/i.test(part);
  }

  function analyzeLicenses(snapshot, nowMs, staleDays) {
    const skus = asArray(snapshot.subscribedSkus);
    const skuNameById = {};
    skus.forEach(sku => {
      if (sku && sku.skuId) skuNameById[sku.skuId] = skuLabel(sku);
    });
    const signIn = snapshot.signIn || {};
    const signInAvailable = !!signIn.available;
    const stepsUnused = [
      'Open the Microsoft 365 admin center → Billing → Licenses.',
      'Compare Purchased with Assigned for the license named here.',
      'Assign a spare license to someone who needs it, or reduce the subscription count at the next renewal so you stop paying for empty seats.'
    ];
    const stepsUser = [
      'Open the Microsoft 365 admin center → Users → Active users, and open the person.',
      'Select Licenses and apps and clear the license, then Save.',
      'Confirm with their manager before you remove a license from someone who is on leave.'
    ];

    const findings = [];
    const rows = [];
    skus.forEach(sku => {
      if (!sku) return;
      const purchased = sku.prepaidUnits && sku.prepaidUnits.enabled || 0;
      const assigned = sku.consumedUnits || 0;
      const unused = Math.max(0, purchased - assigned);
      const unlimited = isUnlimitedSku(sku);
      let severity = 'ok';
      let detail = plural(purchased, 'purchased') + ', ' + plural(assigned, 'assigned') + '.';
      if (!unlimited && unused > 0) {
        severity = 'medium';
        detail = plural(purchased, 'seat') + ' purchased and ' + plural(assigned, 'seat') + ' assigned, so ' + plural(unused, 'seat') + ' are unused.';
        findings.push(finding({
          id: 'licenses:unused:' + (sku.skuId || sku.skuPartNumber),
          checkId: 'licenses',
          severity: 'medium',
          title: 'Purchased licenses are unused',
          subject: skuLabel(sku),
          detail,
          steps: stepsUnused
        }));
      } else if (assigned > purchased && !unlimited) {
        severity = 'medium';
        detail = plural(assigned, 'seat') + ' are assigned and ' + plural(purchased, 'seat') + ' are purchased.';
        findings.push(finding({
          id: 'licenses:over:' + (sku.skuId || sku.skuPartNumber),
          checkId: 'licenses',
          severity: 'medium',
          title: 'More licenses assigned than purchased',
          subject: skuLabel(sku),
          detail,
          steps: [
            'Open the Microsoft 365 admin center → Billing → Licenses.',
            'Either buy the missing seats or remove the license from people who do not need it.'
          ]
        }));
      } else if (unlimited) {
        detail = 'This catalog license does not represent paid empty seats (' + purchased + ' purchased, ' + assigned + ' assigned).';
      }
      rows.push({
        kind: 'Subscription',
        name: skuLabel(sku),
        purchased: String(purchased),
        assigned: String(assigned),
        unused: unlimited ? '' : String(unused),
        detail,
        severity
      });
    });

    asArray(snapshot.users).forEach(user => {
      if (!user || !user.id) return;
      const names = licenseNames(user, skuNameById);
      if (!names.length) return;
      const disabled = !isEnabled(user);
      let stale = false;
      if (!disabled && signInAvailable && !isGuest(user)) {
        stale = staleness(user, activityFor(user, signIn.byId, true), nowMs, staleDays).stale;
      }
      if (!disabled && !stale) return;
      const severity = disabled ? 'high' : 'medium';
      const why = disabled
        ? 'Assigned to a disabled account: ' + names.join(', ') + '.'
        : 'Assigned to an account with no sign-in in ' + staleDays + '+ days: ' + names.join(', ') + '.';
      rows.push({
        kind: 'Person',
        name: displayName(user),
        purchased: '',
        assigned: names.join(', '),
        unused: '',
        detail: why,
        severity
      });
      findings.push(finding({
        id: 'licenses:user:' + user.id,
        checkId: 'licenses',
        severity,
        title: disabled ? 'License assigned to a disabled account' : 'License assigned to a stale account',
        subject: displayName(user),
        detail: upn(user) + ' — ' + why,
        steps: stepsUser
      }));
    });

    const purchased = skus.reduce((sum, sku) => sum + ((sku && sku.prepaidUnits && sku.prepaidUnits.enabled) || 0), 0);
    const assigned = skus.reduce((sum, sku) => sum + ((sku && sku.consumedUnits) || 0), 0);

    return checkResult({
      id: 'licenses',
      title: 'Licenses',
      nav: 'Licenses',
      available: snapshot.licensesAvailable !== false,
      unavailableMessage: snapshot.licensesMessage || '',
      note: signInAvailable ? '' : 'Licenses on stale accounts were skipped because sign-in dates are unavailable. Licenses on disabled accounts are still listed.',
      explanation: 'Unused licenses are seats you pay for and nobody is using. A license on a disabled or stale account is the same waste attached to a specific person. Free catalogs such as Power BI Free are ignored when Microsoft lists a huge included quantity.',
      steps: stepsUnused.concat(stepsUser),
      findings: snapshot.licensesAvailable === false ? [] : findings,
      rows: snapshot.licensesAvailable === false ? [] : rows,
      columns: [
        { key: 'kind', label: 'Kind' },
        { key: 'name', label: 'Name' },
        { key: 'purchased', label: 'Purchased' },
        { key: 'assigned', label: 'Assigned' },
        { key: 'unused', label: 'Unused' },
        { key: 'detail', label: 'What we found' },
        { key: 'severity', label: 'Severity' }
      ],
      headline: snapshot.licensesAvailable === false
        ? 'License list unavailable'
        : (findings.length ? plural(findings.length, 'license issue') : 'No unused or stranded licenses'),
      stats: { purchased, assigned, issues: findings.length },
      skuNameById
    });
  }

  function policyRequiresMfa(policy) {
    if (!policy || policy.state !== 'enabled') return false;
    const grant = policy.grantControls || {};
    const controls = asArray(grant.builtInControls);
    if (controls.indexOf('mfa') !== -1) return true;
    const strength = grant.authenticationStrength;
    if (!strength) return false;
    const name = String(strength.requirementsSatisfied || '') + ' ' + String(strength.displayName || '');
    return /mfa|multifactor|passwordless/i.test(name);
  }

  function policyCoversAllUsers(policy) {
    return asArray(policy && policy.conditions && policy.conditions.users && policy.conditions.users.includeUsers).indexOf('All') !== -1;
  }

  function policyCoversAllApps(policy) {
    return asArray(policy && policy.conditions && policy.conditions.applications && policy.conditions.applications.includeApplications).indexOf('All') !== -1;
  }

  function legacyCoverage(policy) {
    if (!policy || policy.state !== 'enabled') return 'none';
    const controls = asArray(policy.grantControls && policy.grantControls.builtInControls);
    if (controls.indexOf('block') === -1) return 'none';
    const apps = asArray(policy.conditions && policy.conditions.clientAppTypes);
    if (apps.indexOf('all') !== -1) return 'full';
    const hasOther = apps.indexOf('other') !== -1;
    const hasEas = apps.indexOf('exchangeActiveSync') !== -1;
    if (hasOther && hasEas) return 'full';
    if (hasOther || hasEas) return 'partial';
    return 'none';
  }

  function countAudience(list) {
    return asArray(list).filter(item => item && !SPECIAL_AUDIENCE.has(item)).length;
  }

  function exclusionBreadth(policy) {
    const users = (policy && policy.conditions && policy.conditions.users) || {};
    return {
      appliesToAll: policyCoversAllUsers(policy),
      excludeUsers: countAudience(users.excludeUsers),
      excludeGroups: countAudience(users.excludeGroups),
      excludeRoles: countAudience(users.excludeRoles),
      excludesGuests: !!users.excludeGuestsOrExternalUsers || asArray(users.excludeUsers).indexOf('GuestsOrExternalUsers') !== -1
    };
  }

  function describePolicy(policy) {
    if (!policy) return 'Unknown policy';
    if (policy.state === 'disabled') return 'Turned off';
    const bits = [];
    const controls = asArray(policy.grantControls && policy.grantControls.builtInControls);
    if (controls.indexOf('mfa') !== -1 || (policy.grantControls && policy.grantControls.authenticationStrength)) bits.push('Requires MFA');
    if (controls.indexOf('block') !== -1) bits.push('Blocks sign-in');
    const legacy = legacyCoverage(Object.assign({}, policy, { state: 'enabled' }));
    if (legacy === 'full') bits.push('Covers legacy mail apps');
    if (legacy === 'partial') bits.push('Covers only some legacy mail apps');
    if (!bits.length) bits.push('Other grant');
    if (policy.state === 'enabledForReportingButNotEnforced') return bits.join(', ') + ' (report only)';
    return bits.join(', ');
  }

  function analyzeConditionalAccess(snapshot) {
    const ca = snapshot.conditionalAccess || { available: false, reason: 'error' };
    const mfaSteps = [
      'Open the Entra admin center → Protection → Conditional Access → Create new policy.',
      'Name it Require MFA for all users.',
      'Users → Include → All users. Under Exclude, add only your one or two break-glass admin accounts.',
      'Target resources → Cloud apps → All cloud apps.',
      'Grant → Require multifactor authentication.',
      'Set Enable policy to On, then Create. Ask people to register MFA first, or leave the policy on Report-only for a week and then switch it to On.'
    ];
    const legacySteps = [
      'Create a Conditional Access policy named Block legacy authentication.',
      'Users → All users. Exclude only a break-glass account if you truly must.',
      'Conditions → Client apps → uncheck Browser and Mobile apps and desktop clients, and check Exchange ActiveSync clients and Other clients.',
      'Grant → Block access.',
      'Set Enable policy to On, then Create.'
    ];
    const reportSteps = [
      'Open the policy named in this finding.',
      'Read a few recent sign-in logs filtered to this policy so you know who would be affected.',
      'Set Enable policy to On and Save. Report-only writes a log line and does not require MFA or block anything.'
    ];
    const exclusionSteps = [
      'Open the policy → Users → Exclude.',
      'Remove everyday admins and anyone who is not a dedicated break-glass account.',
      'Two break-glass accounts, stored with their passwords offline, is the usual maximum.',
      'Admins need MFA too. An excluded admin account is the one an attacker will try.'
    ];

    if (!ca.available) {
      const unavailableMessageText = (ca.reason === 'license')
        ? unavailableMessage('conditionalAccess', 'license', snapshot.securityDefaults)
        : (ca.message || unavailableMessage('conditionalAccess', ca.reason, snapshot.securityDefaults));
      return checkResult({
        id: 'conditionalAccess',
        title: 'Conditional Access',
        nav: 'Access policies',
        available: false,
        unavailableMessage: unavailableMessageText,
        explanation: 'Conditional Access is the set of rules that can require MFA and block old mail apps that skip MFA. Reading those rules needs Entra ID P1.',
        sections: [
          { title: 'Require MFA', steps: mfaSteps },
          { title: 'Block legacy sign-in', steps: legacySteps }
        ],
        findings: [],
        rows: [],
        columns: caColumns(),
        headline: 'Policies unavailable',
        stats: { policies: 0 }
      });
    }

    const policies = asArray(ca.policies);
    const findings = [];
    const mfaPolicies = policies.filter(policyRequiresMfa);
    const mfaForAll = mfaPolicies.filter(policy => policyCoversAllUsers(policy) && policyCoversAllApps(policy));
    const mfaForAllUsers = mfaPolicies.filter(policyCoversAllUsers);
    if (!mfaPolicies.length) {
      findings.push(finding({
        id: 'ca:no-mfa',
        checkId: 'conditionalAccess',
        severity: 'high',
        title: 'No policy requires MFA',
        subject: 'Conditional Access',
        detail: 'No turned-on Conditional Access policy requires multifactor authentication. A stolen password is enough to open mail and files.',
        steps: mfaSteps
      }));
    } else if (!mfaForAllUsers.length) {
      findings.push(finding({
        id: 'ca:partial-mfa-users',
        checkId: 'conditionalAccess',
        severity: 'medium',
        title: 'MFA is not required for everyone',
        subject: 'Conditional Access',
        detail: 'At least one turned-on policy requires MFA, and none of them include all users.',
        steps: mfaSteps
      }));
    } else if (!mfaForAll.length) {
      findings.push(finding({
        id: 'ca:partial-mfa-apps',
        checkId: 'conditionalAccess',
        severity: 'medium',
        title: 'MFA is not required for every cloud app',
        subject: 'Conditional Access',
        detail: 'MFA is required for all users, and the turned-on policies do not target all cloud apps.',
        steps: mfaSteps
      }));
    }

    const legacy = policies.map(legacyCoverage);
    if (legacy.indexOf('full') === -1) {
      if (legacy.indexOf('partial') !== -1) {
        findings.push(finding({
          id: 'ca:legacy-partial',
          checkId: 'conditionalAccess',
          severity: 'medium',
          title: 'Legacy authentication is only partly blocked',
          subject: 'Conditional Access',
          detail: 'A turned-on policy blocks some older mail clients. Exchange ActiveSync and other legacy clients both need to be blocked. Older Outlook, IMAP, POP, and SMTP can still sign in with only a password.',
          steps: legacySteps
        }));
      } else {
        findings.push(finding({
          id: 'ca:legacy-open',
          checkId: 'conditionalAccess',
          severity: 'high',
          title: 'Legacy authentication is not blocked',
          subject: 'Conditional Access',
          detail: 'No turned-on policy blocks Exchange ActiveSync and other legacy clients. Those apps can sign in with a password and skip MFA.',
          steps: legacySteps
        }));
      }
    }

    policies.forEach(policy => {
      const name = policy.displayName || policy.id || 'Unnamed policy';
      if (policy.state === 'enabledForReportingButNotEnforced') {
        findings.push(finding({
          id: 'ca:report:' + (policy.id || name),
          checkId: 'conditionalAccess',
          severity: 'medium',
          title: 'Policy is report-only',
          subject: name,
          detail: 'This policy only writes a report. It does not make anyone use MFA and it does not block sign-ins.',
          steps: reportSteps
        }));
      }
      const active = policy.state === 'enabled' || policy.state === 'enabledForReportingButNotEnforced';
      if (!active) return;
      const breadth = exclusionBreadth(policy);
      const problems = [];
      let severity = null;
      if (breadth.excludeRoles > 0) {
        severity = 'high';
        problems.push(plural(breadth.excludeRoles, 'directory role') + ' excluded');
      }
      if (breadth.appliesToAll && breadth.excludeUsers >= BROAD_USERS_HIGH) {
        severity = 'high';
        problems.push(plural(breadth.excludeUsers, 'user') + ' excluded');
      } else if (breadth.appliesToAll && breadth.excludeUsers >= BROAD_USERS_MEDIUM) {
        severity = severity || 'medium';
        problems.push(plural(breadth.excludeUsers, 'user') + ' excluded');
      }
      if (breadth.appliesToAll && breadth.excludeGroups >= BROAD_GROUPS_HIGH) {
        severity = 'high';
        problems.push(plural(breadth.excludeGroups, 'group') + ' excluded');
      } else if (breadth.appliesToAll && breadth.excludeGroups >= BROAD_GROUPS_MEDIUM) {
        severity = severity || 'medium';
        problems.push(plural(breadth.excludeGroups, 'group') + ' excluded');
      }
      if (breadth.appliesToAll && breadth.excludesGuests && (policyRequiresMfa(policy) || asArray(policy.grantControls && policy.grantControls.builtInControls).indexOf('mfa') !== -1 || policy.grantControls && policy.grantControls.authenticationStrength)) {
        severity = severity || 'medium';
        problems.push('guests excluded');
      }
      if (severity) {
        findings.push(finding({
          id: 'ca:exclude:' + (policy.id || name),
          checkId: 'conditionalAccess',
          severity,
          title: 'Policy has broad exclusions',
          subject: name,
          detail: problems.join(', ') + '. A policy that says everyone, then skips a long list, is much weaker than it looks.',
          steps: exclusionSteps
        }));
      }
    });

    const rows = policies.map(policy => {
      const breadth = exclusionBreadth(policy);
      const related = findings.filter(item => item.subject === (policy.displayName || policy.id));
      const severity = related.length ? worstSeverity(related) : 'ok';
      return {
        id: policy.id,
        name: policy.displayName || '(unnamed policy)',
        state: policy.state === 'enabled' ? 'On' : (policy.state === 'enabledForReportingButNotEnforced' ? 'Report only' : 'Off'),
        does: describePolicy(policy),
        excludedUsers: String(breadth.excludeUsers),
        excludedGroups: String(breadth.excludeGroups),
        excludedRoles: String(breadth.excludeRoles),
        severity
      };
    });
    findings.filter(item => item.subject === 'Conditional Access').forEach(item => {
      rows.unshift({
        id: item.id,
        name: item.title,
        state: 'Posture',
        does: item.detail,
        excludedUsers: '',
        excludedGroups: '',
        excludedRoles: '',
        severity: item.severity
      });
    });

    return checkResult({
      id: 'conditionalAccess',
      title: 'Conditional Access',
      nav: 'Access policies',
      available: true,
      explanation: 'Conditional Access is how a tenant requires a second factor and refuses old mail apps that only know a password. Report-only policies are drafts: Microsoft logs what would have happened and still lets the sign-in through. A long exclude list punches holes in a rule that looks like it covers everyone.',
      sections: [
        { title: 'Require MFA', steps: mfaSteps },
        { title: 'Block legacy sign-in', steps: legacySteps },
        { title: 'Turn report-only policies on', steps: reportSteps },
        { title: 'Shrink exclusions', steps: exclusionSteps }
      ],
      findings,
      rows,
      columns: caColumns(),
      headline: findings.length ? plural(findings.length, 'policy issue') : 'MFA is required and legacy clients are blocked',
      stats: { policies: policies.length, reportOnly: policies.filter(policy => policy.state === 'enabledForReportingButNotEnforced').length }
    });
  }

  function caColumns() {
    return [
      { key: 'name', label: 'Policy' },
      { key: 'state', label: 'State' },
      { key: 'does', label: 'What it does' },
      { key: 'excludedUsers', label: 'Excluded users' },
      { key: 'excludedGroups', label: 'Excluded groups' },
      { key: 'excludedRoles', label: 'Excluded roles' },
      { key: 'severity', label: 'Severity' }
    ];
  }

  function checkResult(fields) {
    const available = fields.available !== false;
    const findings = available ? sortFindings(asArray(fields.findings)) : [];
    const counts = countsOf(findings);
    return {
      id: fields.id,
      title: fields.title,
      nav: fields.nav,
      available,
      unavailableMessage: available ? '' : (fields.unavailableMessage || ''),
      note: fields.note || '',
      explanation: fields.explanation || '',
      steps: fields.steps || [],
      sections: fields.sections || [],
      findings,
      rows: fields.rows || [],
      columns: fields.columns || [],
      counts,
      status: available ? worstSeverity(findings) : 'unavailable',
      headline: fields.headline || '',
      stats: fields.stats || {},
      extraRows: fields.extraRows || null,
      skuNameById: fields.skuNameById || null
    };
  }

  function findingsToCsv(report) {
    const records = [];
    asArray(report && report.order).forEach(id => {
      const check = report.checks && report.checks[id];
      if (!check) return;
      asArray(check.findings).forEach(item => {
        records.push([
          check.title,
          item.severity,
          item.subject,
          item.title,
          item.detail,
          asArray(item.steps).join(' ')
        ]);
      });
    });
    return toCsv(['Check', 'Severity', 'Subject', 'Title', 'Detail', 'Suggested fix'], records);
  }

  function analyze(snapshot) {
    const input = snapshot || {};
    const nowMs = parseTime(input.now) || Date.now();
    const staleDays = input.staleDays || STALE_DAYS;
    const expiringDays = input.expiringDays || EXPIRING_DAYS;
    const signIn = Object.assign(
      { available: false, reason: 'error', byId: {}, message: '' },
      input.signIn
    );
    if (!signIn.available && !signIn.message) {
      signIn.message = unavailableMessage('signIn', signIn.reason || 'error', null);
    }

    const licenseCheck = analyzeLicenses(Object.assign({}, input, { signIn }), nowMs, staleDays);
    const checks = {
      groups: analyzeGroups(input.groups, input.users),
      staleAccounts: analyzeStale(input.users, signIn, nowMs, staleDays),
      disabledUsers: analyzeDisabled(input.users, input.groups, licenseCheck.skuNameById || {}),
      guests: analyzeGuests(input.users, signIn, nowMs, staleDays),
      applications: analyzeApps(input, nowMs, expiringDays),
      licenses: licenseCheck,
      conditionalAccess: analyzeConditionalAccess(input)
    };
    const order = ['groups', 'staleAccounts', 'disabledUsers', 'guests', 'applications', 'licenses', 'conditionalAccess'];
    const counts = { high: 0, medium: 0, low: 0 };
    const unavailable = [];
    order.forEach(id => {
      const check = checks[id];
      if (!check.available) {
        unavailable.push(id);
        return;
      }
      counts.high += check.counts.high;
      counts.medium += check.counts.medium;
      counts.low += check.counts.low;
    });
    return {
      generatedAt: new Date(nowMs).toISOString(),
      staleDays,
      expiringDays,
      counts,
      unavailable,
      checks,
      order
    };
  }

  return {
    STALE_DAYS,
    EXPIRING_DAYS,
    MS_FIRST_PARTY_TENANT,
    GRAPH_APP_ID,
    PERMISSIONS,
    SCOPES,
    HIGH_PRIVILEGE_GRAPH_ROLES,
    MEDIUM_PRIVILEGE_GRAPH_ROLES,
    SKU_NAMES,
    esc,
    csvCell,
    toCsv,
    checkToCsv,
    findingsToCsv,
    classifyGroupType,
    credentialState,
    policyRequiresMfa,
    policyCoversAllUsers,
    legacyCoverage,
    exclusionBreadth,
    describePolicy,
    interpretOptionalError,
    unavailableMessage,
    latestSignInMs,
    analyze
  };
});
