const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('../src/hygiene.js');
const sample = require('../src/sample-tenant.js');

const NOW = sample.NOW;

function base(overrides) {
  return Object.assign({
    now: NOW,
    tenantId: sample.TENANT,
    users: [],
    groups: [],
    signIn: { available: true, reason: 'ok', byId: {} },
    applications: [],
    servicePrincipals: [],
    applicationsAvailable: true,
    graphAppRoles: [],
    appRoleAssignedTo: [],
    subscribedSkus: [],
    licensesAvailable: true,
    conditionalAccess: { available: true, reason: 'ok', policies: [] },
    securityDefaults: { known: false, enabled: null }
  }, overrides);
}

function severities(check) {
  return check.findings.map(item => item.severity).sort();
}

test('permission catalog is delegated and read-only', () => {
  assert.equal(h.PERMISSIONS.length, 8);
  h.PERMISSIONS.forEach(permission => {
    assert.equal(permission.type, 'Delegated');
    assert.doesNotMatch(permission.scope, /Write/i);
    assert.match(permission.scope, /^[A-Za-z.]+$/);
  });
  const scopes = h.SCOPES.all;
  assert.equal(new Set(scopes).size, scopes.length);
  scopes.forEach(scope => {
    assert.match(scope, /^https:\/\/graph\.microsoft\.com\//);
    assert.doesNotMatch(scope, /Write/i);
  });
  assert.ok(h.SCOPES.core.includes('https://graph.microsoft.com/Group.Read.All'));
  assert.ok(h.SCOPES.audit.includes('https://graph.microsoft.com/AuditLog.Read.All'));
  assert.ok(h.SCOPES.policy.includes('https://graph.microsoft.com/Policy.Read.All'));
});

test('README lists every permission and drops the stale docs', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  h.PERMISSIONS.forEach(permission => {
    assert.ok(readme.includes(permission.scope), permission.scope + ' missing from README');
  });
  assert.match(readme, /Entra ID P1/);
  assert.match(readme, /read-only/i);
  assert.match(readme, /docs\/SETUP\.md/);
  assert.match(readme, /scripts\/Register-OwnerMap\.ps1/);
  assert.match(readme, /Single-page application/);
  assert.match(readme, /no paid setup service/i);
  assert.doesNotMatch(readme, /Total Members/);
  assert.doesNotMatch(readme, /client credentials/i);
  assert.doesNotMatch(readme, /Certificates & secrets/);
  assert.doesNotMatch(readme, /switch them to Application/);
  assert.doesNotMatch(readme, /choose \*\*Web\*\*/);
  assert.doesNotMatch(readme, /Add a platform → Web/);
});

test('setup guide and registration script stay on the read-only scope list', () => {
  const root = path.join(__dirname, '..');
  const setup = fs.readFileSync(path.join(root, 'docs', 'SETUP.md'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'scripts', 'Register-OwnerMap.ps1'), 'utf8');
  const block = script.match(/# OWNERMAP_SCOPES_START\r?\n([\s\S]*?)# OWNERMAP_SCOPES_END/);
  assert.ok(block, 'scope block missing from the registration script');
  const listed = [...block[1].matchAll(/'([A-Za-z.]+)'/g)].map(match => match[1]);
  assert.deepEqual(listed, h.PERMISSIONS.map(permission => permission.scope));
  assert.doesNotMatch(block[1], /Write/);
  h.PERMISSIONS.forEach(permission => {
    assert.ok(setup.includes(permission.scope), permission.scope + ' missing from SETUP.md');
  });
  assert.match(setup, /Who needs which role/);
  assert.match(setup, /Cloud Application Administrator/);
  assert.match(setup, /Privileged Role Administrator/);
  assert.match(setup, /Application Developer/);
  assert.match(setup, /Ask your AI assistant/);
  assert.match(setup, /Never paste tokens or secrets/i);
  assert.match(setup, /ChatGPT, Claude, or Grok/);
  assert.match(setup, /Screenshot placeholder/);
  assert.match(setup, /Single-page application/);
  assert.match(setup, /scripts\/Register-OwnerMap\.ps1/);
  assert.match(setup, /no paid setup service/i);
  assert.match(setup, /grant-admin-consent/);
  assert.doesNotMatch(setup, /contact us to set this up|professional services engagement|we will register it for you/i);
  assert.match(script, /Application\.ReadWrite\.All/);
  assert.doesNotMatch(script, /New-MgOauth2PermissionGrant|New-MgServicePrincipalAppRoleAssignment/);
  assert.match(script, /type\s*=\s*'Scope'/);
  assert.doesNotMatch(script, /client_secret|clientSecret|PasswordCredential/);
});

test('classifyGroupType distinguishes security, M365, and distribution groups', () => {
  assert.equal(h.classifyGroupType({ groupTypes: ['Unified'], mailEnabled: true, securityEnabled: false }), 'm365');
  assert.equal(h.classifyGroupType({ groupTypes: [], mailEnabled: true, securityEnabled: false }), 'distribution');
  assert.equal(h.classifyGroupType({ groupTypes: [], mailEnabled: false, securityEnabled: true }), 'security');
  assert.equal(h.classifyGroupType({ groupTypes: [], mailEnabled: true, securityEnabled: true }), 'security');
  assert.equal(h.classifyGroupType({}), 'other');
});

test('group ownership, source, and unassigned members', () => {
  const report = h.analyze(base({
    users: [
      { id: 'member', accountEnabled: true, userType: 'Member', displayName: 'Member' },
      { id: 'alone', accountEnabled: true, userType: 'Member', displayName: 'Alone' },
      { id: 'guest', accountEnabled: true, userType: 'Guest', displayName: 'Guest' },
      { id: 'blocked', accountEnabled: false, userType: 'Member', displayName: 'Blocked' }
    ],
    groups: [
      {
        id: 'g1',
        displayName: 'Finance',
        description: 'Money',
        securityEnabled: true,
        mailEnabled: false,
        groupTypes: [],
        onPremisesSyncEnabled: true,
        owners: [],
        members: [{ id: 'member', displayName: 'Member', userPrincipalName: 'member@example.com' }]
      },
      {
        id: 'g2',
        displayName: 'Team',
        groupTypes: ['Unified'],
        mailEnabled: true,
        securityEnabled: false,
        owners: [{ id: 'member', displayName: 'Member', userPrincipalName: 'member@example.com' }],
        members: []
      }
    ]
  }));
  const groups = report.checks.groups;
  assert.equal(groups.stats.noOwner, 1);
  assert.equal(groups.stats.unassigned, 1);
  assert.equal(groups.stats.security, 1);
  const finance = groups.rows.find(row => row.name === 'Finance');
  assert.equal(finance.severity, 'high');
  assert.equal(finance.source, 'On-prem');
  assert.equal(finance.type, 'Security');
  assert.equal(groups.rows.find(row => row.name === 'Team').type, 'M365');
  assert.deepEqual(severities(groups), ['high', 'low']);
  assert.match(groups.findings.find(item => item.id === 'groups:unassigned').detail, /Alone/);
});

test('stale boundary uses the newer of interactive and background sign-in', () => {
  const report = h.analyze(base({
    users: [
      { id: 'old', accountEnabled: true, userType: 'Member', displayName: 'Old', userPrincipalName: 'old@example.com', createdDateTime: '2020-01-01T00:00:00Z' },
      { id: 'exact', accountEnabled: true, userType: 'Member', displayName: 'Exact', createdDateTime: '2020-01-01T00:00:00Z' },
      { id: 'fresh', accountEnabled: true, userType: 'Member', displayName: 'Fresh', createdDateTime: '2020-01-01T00:00:00Z' },
      { id: 'background', accountEnabled: true, userType: 'Member', displayName: 'Background', createdDateTime: '2020-01-01T00:00:00Z' },
      { id: 'never-new', accountEnabled: true, userType: 'Member', displayName: 'New Hire', createdDateTime: '2026-10-01T00:00:00Z' },
      { id: 'never-old', accountEnabled: true, userType: 'Member', displayName: 'Never Old', createdDateTime: '2024-01-01T00:00:00Z' },
      { id: 'disabled', accountEnabled: false, userType: 'Member', displayName: 'Disabled', createdDateTime: '2020-01-01T00:00:00Z' },
      { id: 'guest', accountEnabled: true, userType: 'Guest', displayName: 'Guest', createdDateTime: '2020-01-01T00:00:00Z' }
    ],
    signIn: {
      available: true,
      byId: {
        old: { lastSignInDateTime: '2026-01-01T12:00:00Z' },
        exact: { lastSignInDateTime: '2026-07-22T12:00:00Z' },
        fresh: { lastSignInDateTime: '2026-07-23T12:00:00Z' },
        background: { lastSignInDateTime: '2025-01-01T12:00:00Z', lastNonInteractiveSignInDateTime: '2026-10-19T12:00:00Z' },
        'never-new': { lastSignInDateTime: null, lastNonInteractiveSignInDateTime: null },
        'never-old': { lastSignInDateTime: null },
        disabled: { lastSignInDateTime: '2020-01-01T00:00:00Z' },
        guest: { lastSignInDateTime: '2020-01-01T00:00:00Z' }
      }
    }
  }));
  const names = report.checks.staleAccounts.rows.map(row => row.name).sort();
  assert.deepEqual(names, ['Exact', 'Never Old', 'Old']);
  assert.equal(report.checks.staleAccounts.counts.high, 3);
  const never = report.checks.staleAccounts.rows.find(row => row.name === 'Never Old');
  assert.equal(never.lastSignIn, 'Never');
  assert.match(never.detail, /created/i);
});

test('stale check degrades when sign-in activity is unavailable', () => {
  const license = h.interpretOptionalError('signIn', {
    status: 403,
    code: 'Authentication_RequestFromNonPremiumTenantOrB2CTenant',
    graphMessage: "Neither tenant is B2C or tenant doesn't have premium license"
  });
  assert.equal(license.reason, 'license');
  assert.match(license.message, /Entra ID P1/);
  assert.match(license.message, /AuditLog\.Read\.All/);
  assert.match(license.message, /other check still ran/i);

  const denied = h.interpretOptionalError('signIn', {
    status: 403,
    code: 'Authorization_RequestDenied',
    graphMessage: 'Insufficient privileges to complete the operation.'
  });
  assert.equal(denied.reason, 'permission');
  assert.match(denied.message, /Grant admin consent/);

  const report = h.analyze(base({
    users: [{ id: 'old', accountEnabled: true, userType: 'Member', displayName: 'Old', createdDateTime: '2020-01-01T00:00:00Z' }],
    signIn: license,
    conditionalAccess: { available: false, reason: 'license', message: 'skipped' }
  }));
  assert.equal(report.checks.staleAccounts.available, false);
  assert.equal(report.checks.staleAccounts.findings.length, 0);
  assert.equal(report.counts.high, 0);
  assert.ok(report.unavailable.includes('staleAccounts'));
  assert.match(report.checks.staleAccounts.unavailableMessage, /P1/);
  assert.match(report.checks.guests.note, /unavailable/i);
});

test('conditional access license error is not treated as a clean bill of health', () => {
  const error = h.interpretOptionalError('conditionalAccess', {
    status: 403,
    code: 'AccessDenied',
    graphMessage: 'Your tenant is not licensed for this feature. Please check your subscriptions.'
  });
  assert.equal(error.reason, 'license');
  const report = h.analyze(base({
    conditionalAccess: error,
    securityDefaults: { known: true, enabled: true }
  }));
  const check = report.checks.conditionalAccess;
  assert.equal(check.available, false);
  assert.equal(check.status, 'unavailable');
  assert.equal(check.findings.length, 0);
  assert.match(check.unavailableMessage, /Entra ID P1/);
  assert.match(check.unavailableMessage, /Security defaults are turned on/);
  assert.ok(report.unavailable.includes('conditionalAccess'));
});

test('disabled accounts are flagged only when a license or group remains', () => {
  const report = h.analyze(base({
    users: [
      { id: 'lic', accountEnabled: false, displayName: 'Licensed', userPrincipalName: 'lic@example.com', assignedLicenses: [{ skuId: 'sku1' }] },
      { id: 'grp', accountEnabled: false, displayName: 'Grouped', userPrincipalName: 'grp@example.com', assignedLicenses: [] },
      { id: 'own', accountEnabled: false, displayName: 'Owner', assignedLicenses: [] },
      { id: 'clean', accountEnabled: false, displayName: 'Clean', assignedLicenses: [] },
      { id: 'on', accountEnabled: true, displayName: 'Enabled', assignedLicenses: [{ skuId: 'sku1' }] }
    ],
    groups: [
      {
        id: 'g',
        displayName: 'Finance',
        securityEnabled: true,
        owners: [{ id: 'own', displayName: 'Owner' }],
        members: [{ id: 'grp', displayName: 'Grouped' }, { id: 'lic', displayName: 'Licensed' }]
      }
    ],
    subscribedSkus: [{ skuId: 'sku1', skuPartNumber: 'SPB', consumedUnits: 2, prepaidUnits: { enabled: 2 } }]
  }));
  const byName = Object.fromEntries(report.checks.disabledUsers.findings.map(item => [item.subject, item]));
  assert.equal(byName.Licensed.severity, 'high');
  assert.match(byName.Licensed.detail, /Microsoft 365 Business Premium/);
  assert.match(byName.Licensed.detail, /Finance/);
  assert.equal(byName.Grouped.severity, 'medium');
  assert.match(byName.Grouped.detail, /Finance/);
  assert.equal(byName.Owner.severity, 'medium');
  assert.match(byName.Owner.detail, /owner of Finance/i);
  assert.equal(byName.Clean, undefined);
  assert.equal(byName.Enabled, undefined);
});

test('guests are inventoried and only stale guests become findings', () => {
  const report = h.analyze(base({
    users: [
      { id: 'stale', userType: 'Guest', accountEnabled: true, displayName: 'Stale Guest', createdDateTime: '2024-01-01T00:00:00Z' },
      { id: 'fresh', userType: 'Guest', accountEnabled: true, displayName: 'Fresh Guest', createdDateTime: '2024-01-01T00:00:00Z' },
      { id: 'never-new', userType: 'Guest', accountEnabled: true, displayName: 'New Guest', createdDateTime: '2026-10-01T00:00:00Z' },
      { id: 'never-old', userType: 'Guest', accountEnabled: true, displayName: 'Old Invite', createdDateTime: '2025-01-01T00:00:00Z' },
      { id: 'member', userType: 'Member', accountEnabled: true, displayName: 'Member', createdDateTime: '2020-01-01T00:00:00Z' }
    ],
    signIn: {
      available: true,
      byId: {
        stale: { lastSignInDateTime: '2025-06-01T00:00:00Z' },
        fresh: { lastSignInDateTime: '2026-10-18T00:00:00Z' },
        'never-new': { lastSignInDateTime: null },
        'never-old': { lastSignInDateTime: null },
        member: { lastSignInDateTime: '2020-01-01T00:00:00Z' }
      }
    }
  }));
  assert.equal(report.checks.guests.stats.guests, 4);
  assert.deepEqual(
    report.checks.guests.findings.map(item => item.subject).sort(),
    ['Old Invite', 'Stale Guest']
  );
  assert.equal(report.checks.staleAccounts.findings.some(item => item.subject === 'Stale Guest'), false);
  assert.equal(report.checks.staleAccounts.findings.some(item => item.subject === 'Member'), true);
});

test('app owners, credential expiry, and Graph privileges use mocked directory objects', () => {
  const expired = h.credentialState({ endDateTime: '2026-01-01T00:00:00Z' }, Date.parse(NOW), 30);
  assert.equal(expired.state, 'expired');
  const soon = h.credentialState({ endDateTime: '2026-10-30T00:00:00Z' }, Date.parse(NOW), 30);
  assert.equal(soon.state, 'expiring');
  const onTheLine = h.credentialState({ endDateTime: '2026-11-19T12:00:00Z' }, Date.parse(NOW), 30);
  assert.equal(onTheLine.state, 'expiring');
  const later = h.credentialState({ endDateTime: '2026-11-21T12:00:00Z' }, Date.parse(NOW), 30);
  assert.equal(later.state, 'ok');
  assert.equal(h.credentialState({ displayName: 'no end' }, Date.parse(NOW), 30), null);

  const report = h.analyze(base({
    applications: [
      {
        id: 'app-orphan',
        appId: 'app-1',
        displayName: 'Payroll',
        passwordCredentials: [{ keyId: 'k1', displayName: 'old', endDateTime: '2026-01-01T00:00:00Z' }],
        keyCredentials: [],
        owners: []
      },
      {
        id: 'app-owned',
        appId: 'app-2',
        displayName: 'Intranet',
        passwordCredentials: [],
        keyCredentials: [{ keyId: 'k2', displayName: 'cert', endDateTime: '2026-10-25T00:00:00Z' }],
        owners: [{ displayName: 'Ada', userPrincipalName: 'ada@example.com' }]
      }
    ],
    servicePrincipals: [
      {
        id: 'sp-own',
        appId: 'app-1',
        displayName: 'Payroll',
        servicePrincipalType: 'Application',
        appOwnerOrganizationId: sample.TENANT,
        owners: []
      },
      {
        id: 'sp-third',
        appId: 'app-9',
        displayName: 'Contoso Sync',
        servicePrincipalType: 'Application',
        appOwnerOrganizationId: '22222222-2222-2222-2222-222222222222',
        passwordCredentials: [{ keyId: 'k9', displayName: 'sync', endDateTime: '2025-01-01T00:00:00Z' }],
        owners: []
      },
      {
        id: 'sp-ms',
        appId: 'app-ms',
        displayName: 'Microsoft Teams',
        servicePrincipalType: 'Application',
        appOwnerOrganizationId: h.MS_FIRST_PARTY_TENANT,
        passwordCredentials: [{ keyId: 'kms', displayName: 'teams', endDateTime: '2020-01-01T00:00:00Z' }],
        owners: []
      },
      {
        id: 'sp-mi',
        appId: 'app-mi',
        displayName: 'vm-backup',
        servicePrincipalType: 'ManagedIdentity',
        appOwnerOrganizationId: sample.TENANT,
        owners: []
      }
    ],
    graphAppRoles: [
      { id: 'role-high', value: 'Directory.ReadWrite.All' },
      { id: 'role-med', value: 'Directory.Read.All' },
      { id: 'role-delegated', value: 'User.Read' }
    ],
    appRoleAssignedTo: [
      { principalId: 'sp-own', appRoleId: 'role-high' },
      { principalId: 'sp-third', appRoleId: 'role-med' },
      { principalId: 'sp-ms', appRoleId: 'role-high' },
      { principalId: 'sp-own', appRoleId: 'role-delegated' }
    ]
  }));
  const findings = report.checks.applications.findings;
  const titles = findings.map(item => item.subject + '|' + item.severity + '|' + item.title);
  assert.equal(findings.filter(item => item.subject === 'Payroll' && /no owner/i.test(item.title)).length, 1);
  assert.ok(titles.some(item => item.includes('Payroll|high|Expired app credential')));
  assert.ok(titles.some(item => item.includes('Directory.ReadWrite.All') || item.includes('High-privilege')));
  assert.ok(findings.some(item => item.subject === 'Payroll' && item.title.includes('High-privilege') && item.detail.includes('Directory.ReadWrite.All')));
  assert.ok(findings.some(item => item.subject === 'Intranet' && item.severity === 'medium' && item.title.includes('expiring')));
  assert.ok(findings.some(item => item.subject === 'Contoso Sync' && item.severity === 'medium' && item.title.includes('Third-party')));
  assert.ok(findings.some(item => item.subject === 'Contoso Sync' && item.severity === 'high' && item.title.includes('Expired')));
  assert.ok(findings.some(item => item.subject === 'Contoso Sync' && item.severity === 'medium' && item.detail.includes('Directory.Read.All')));
  assert.equal(findings.some(item => item.subject === 'Microsoft Teams'), false);
  assert.equal(findings.some(item => item.subject === 'vm-backup'), false);
  findings.forEach(item => {
    assert.ok(item.detail.length > 10);
    assert.ok(item.steps.length >= 3);
  });
});

test('licenses compare purchased and assigned and skip free catalogs', () => {
  const report = h.analyze(base({
    users: [
      { id: 'off', accountEnabled: false, displayName: 'Off', userPrincipalName: 'off@example.com', assignedLicenses: [{ skuId: 'paid' }] },
      { id: 'stale', accountEnabled: true, userType: 'Member', displayName: 'Stale', userPrincipalName: 'stale@example.com', assignedLicenses: [{ skuId: 'paid' }], createdDateTime: '2020-01-01T00:00:00Z' },
      { id: 'active', accountEnabled: true, userType: 'Member', displayName: 'Active', assignedLicenses: [{ skuId: 'paid' }], createdDateTime: '2020-01-01T00:00:00Z' }
    ],
    signIn: {
      available: true,
      byId: {
        off: { lastSignInDateTime: '2020-01-01T00:00:00Z' },
        stale: { lastSignInDateTime: '2026-01-01T00:00:00Z' },
        active: { lastSignInDateTime: '2026-10-01T00:00:00Z' }
      }
    },
    subscribedSkus: [
      { skuId: 'paid', skuPartNumber: 'O365_BUSINESS_PREMIUM', consumedUnits: 7, prepaidUnits: { enabled: 10 } },
      { skuId: 'free', skuPartNumber: 'POWER_BI_STANDARD', consumedUnits: 1, prepaidUnits: { enabled: 1000000 } }
    ]
  }));
  const licenseFindings = report.checks.licenses.findings;
  assert.ok(licenseFindings.some(item => item.subject === 'Microsoft 365 Business Standard' && item.severity === 'medium' && item.detail.includes('3 seats are unused')));
  assert.ok(licenseFindings.some(item => item.subject === 'Off' && item.severity === 'high'));
  assert.ok(licenseFindings.some(item => item.subject === 'Stale' && item.severity === 'medium'));
  assert.equal(licenseFindings.some(item => item.subject === 'Active'), false);
  assert.equal(licenseFindings.some(item => item.subject.includes('Power BI')), false);
  assert.equal(report.checks.licenses.stats.purchased, 10 + 1000000);
});

test('conditional access posture from mocked policies', () => {
  assert.equal(h.policyRequiresMfa({
    state: 'enabled',
    grantControls: { builtInControls: ['mfa'] }
  }), true);
  assert.equal(h.policyRequiresMfa({
    state: 'enabledForReportingButNotEnforced',
    grantControls: { builtInControls: ['mfa'] }
  }), false);
  assert.equal(h.policyRequiresMfa({
    state: 'enabled',
    grantControls: { builtInControls: [], authenticationStrength: { displayName: 'Multifactor authentication', requirementsSatisfied: 'mfa' } }
  }), true);
  assert.equal(h.legacyCoverage({
    state: 'enabled',
    grantControls: { builtInControls: ['block'] },
    conditions: { clientAppTypes: ['exchangeActiveSync', 'other'] }
  }), 'full');
  assert.equal(h.legacyCoverage({
    state: 'enabled',
    grantControls: { builtInControls: ['block'] },
    conditions: { clientAppTypes: ['other'] }
  }), 'partial');
  assert.equal(h.legacyCoverage({
    state: 'disabled',
    grantControls: { builtInControls: ['block'] },
    conditions: { clientAppTypes: ['all'] }
  }), 'none');

  const open = h.analyze(base({
    conditionalAccess: { available: true, policies: [] }
  }));
  assert.ok(open.checks.conditionalAccess.findings.some(item => item.id === 'ca:no-mfa' && item.severity === 'high'));
  assert.ok(open.checks.conditionalAccess.findings.some(item => item.id === 'ca:legacy-open' && item.severity === 'high'));

  const partial = h.analyze(base({
    conditionalAccess: {
      available: true,
      policies: [
        {
          id: 'mfa-some',
          displayName: 'MFA for finance',
          state: 'enabled',
          conditions: {
            users: { includeUsers: ['user-1'], excludeUsers: [], excludeGroups: [], excludeRoles: [] },
            applications: { includeApplications: ['All'] },
            clientAppTypes: ['all']
          },
          grantControls: { builtInControls: ['mfa'] }
        },
        {
          id: 'legacy-some',
          displayName: 'Block SMTP',
          state: 'enabled',
          conditions: {
            users: { includeUsers: ['All'], excludeUsers: [], excludeGroups: [], excludeRoles: [] },
            applications: { includeApplications: ['All'] },
            clientAppTypes: ['other']
          },
          grantControls: { builtInControls: ['block'] }
        }
      ]
    }
  }));
  const partialIds = partial.checks.conditionalAccess.findings.map(item => item.id);
  assert.ok(partialIds.includes('ca:partial-mfa-users'));
  assert.ok(partialIds.includes('ca:legacy-partial'));
  assert.equal(partialIds.includes('ca:no-mfa'), false);

  const broad = h.analyze(base({
    conditionalAccess: {
      available: true,
      policies: [
        {
          id: 'broad',
          displayName: 'Require MFA',
          state: 'enabled',
          conditions: {
            users: {
              includeUsers: ['All'],
              excludeUsers: ['1', '2', '3', '4', '5', 'GuestsOrExternalUsers'],
              excludeGroups: ['g1', 'g2'],
              excludeRoles: ['role-admin']
            },
            applications: { includeApplications: ['Office365'] },
            clientAppTypes: ['all']
          },
          grantControls: { builtInControls: ['mfa'] }
        },
        {
          id: 'report',
          displayName: 'Pilot block',
          state: 'enabledForReportingButNotEnforced',
          conditions: {
            users: { includeUsers: ['All'], excludeUsers: [], excludeGroups: [], excludeRoles: [] },
            applications: { includeApplications: ['All'] },
            clientAppTypes: ['exchangeActiveSync', 'other']
          },
          grantControls: { builtInControls: ['block'] }
        },
        {
          id: 'legacy',
          displayName: 'Block legacy',
          state: 'enabled',
          conditions: {
            users: { includeUsers: ['All'], excludeUsers: ['breakglass'], excludeGroups: [], excludeRoles: [] },
            applications: { includeApplications: ['All'] },
            clientAppTypes: ['all']
          },
          grantControls: { builtInControls: ['block'] }
        }
      ]
    }
  }));
  const ca = broad.checks.conditionalAccess;
  assert.equal(ca.findings.some(item => item.id === 'ca:no-mfa'), false);
  assert.equal(ca.findings.some(item => item.id === 'ca:legacy-open'), false);
  assert.ok(ca.findings.some(item => item.id === 'ca:partial-mfa-apps'));
  const exclusion = ca.findings.find(item => item.id === 'ca:exclude:broad');
  assert.equal(exclusion.severity, 'high');
  assert.match(exclusion.detail, /1 directory role/);
  assert.match(exclusion.detail, /5 users/);
  assert.match(exclusion.detail, /2 groups/);
  assert.match(exclusion.detail, /guests excluded/);
  assert.ok(ca.findings.some(item => item.id === 'ca:report:report' && item.severity === 'medium'));
  assert.equal(h.describePolicy(broad.checks.conditionalAccess.rows && {
    state: 'enabledForReportingButNotEnforced',
    grantControls: { builtInControls: ['block'] },
    conditions: { clientAppTypes: ['exchangeActiveSync', 'other'] }
  }), 'Blocks sign-in, Covers legacy mail apps (report only)');
  const reportRow = ca.rows.find(row => row.name === 'Pilot block');
  assert.equal(reportRow.state, 'Report only');
  assert.match(reportRow.does, /report only/i);

  const fifteen = h.exclusionBreadth({
    conditions: {
      users: {
        includeUsers: ['All'],
        excludeUsers: Array.from({ length: 15 }, (_, index) => 'u' + index),
        excludeGroups: ['a', 'b', 'c', 'd'],
        excludeRoles: []
      }
    }
  });
  assert.equal(fifteen.excludeUsers, 15);
  assert.equal(fifteen.excludeGroups, 4);
});

test('severity rollup ignores unavailable checks and sorts findings', () => {
  const report = h.analyze(base({
    users: [
      { id: 'stale', accountEnabled: true, userType: 'Member', displayName: 'Zed', createdDateTime: '2020-01-01T00:00:00Z' }
    ],
    signIn: { available: false, reason: 'license', message: h.unavailableMessage('signIn', 'license') },
    conditionalAccess: { available: false, reason: 'permission', message: h.unavailableMessage('conditionalAccess', 'permission') }
  }));
  assert.equal(report.counts.high, 0);
  assert.deepEqual(report.unavailable.sort(), ['conditionalAccess', 'staleAccounts']);
  assert.equal(report.checks.staleAccounts.findings.length, 0);
});

test('sample tenant produces a stable mixed report', () => {
  const report = h.analyze(sample.build());
  assert.equal(report.generatedAt, NOW);
  assert.deepEqual(report.counts, { high: 15, medium: 8, low: 1 });
  assert.deepEqual(report.checks.groups.counts, { high: 2, medium: 0, low: 1 });
  assert.equal(report.checks.groups.headline, '2 groups have no owner, and 1 enabled account is not in a group');
  assert.deepEqual(report.checks.staleAccounts.counts, { high: 3, medium: 0, low: 0 });
  assert.deepEqual(report.checks.disabledUsers.counts, { high: 1, medium: 1, low: 0 });
  assert.deepEqual(report.checks.guests.counts, { high: 2, medium: 0, low: 0 });
  assert.deepEqual(report.checks.applications.counts, { high: 4, medium: 3, low: 0 });
  assert.deepEqual(report.checks.licenses.counts, { high: 1, medium: 2, low: 0 });
  assert.deepEqual(report.checks.conditionalAccess.counts, { high: 2, medium: 2, low: 0 });
  report.order.forEach(id => {
    const check = report.checks[id];
    assert.ok(check.explanation.length > 40, id);
    const steps = check.steps.length ? check.steps : check.sections.flatMap(section => section.steps);
    assert.ok(steps.length >= 2, id);
    steps.forEach(step => assert.doesNotMatch(step, /PATCH|grant .*ReadWrite|application password into OwnerMap/i));
  });
});

test('csv escaping neutralises formulas and quotes', () => {
  assert.equal(h.csvCell('=1+1'), '\t=1+1');
  assert.equal(h.csvCell('+1'), '\t+1');
  assert.equal(h.csvCell('-1'), '\t-1');
  assert.equal(h.csvCell('@cmd'), '\t@cmd');
  assert.equal(h.csvCell('\t=1'), '\t\t=1');
  assert.equal(h.csvCell('safe'), 'safe');
  assert.equal(h.csvCell(null), '');
  assert.equal(h.csvCell(undefined), '');
  const csv = h.toCsv(['Name', 'Note'], [['=HYPERLINK("http://evil")', 'she said "hi"']]);
  assert.equal(csv, '"Name","Note"\n"\t=HYPERLINK(""http://evil"")","she said ""hi"""');

  const report = h.analyze(base({
    groups: [{
      id: 'g',
      displayName: '=cmd|\' /C calc\'!A0',
      description: 'ok',
      securityEnabled: true,
      owners: [],
      members: []
    }]
  }));
  const exported = h.checkToCsv(report.checks.groups);
  assert.match(exported, /"\t=cmd/);
  assert.doesNotMatch(exported.split('\n')[1], /^"=cmd/);
  const findings = h.findingsToCsv(report);
  assert.match(findings, /"\t=cmd/);
  assert.match(findings, /Suggested fix/);
});

test('html escaping covers the characters used in markup', () => {
  assert.equal(h.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(h.esc(`"'&`), '&quot;&#39;&amp;');
  assert.equal(h.esc(null), '');
  assert.equal(h.esc(''), '');
});

test('page asks only for the catalog scopes', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ownermap.html'), 'utf8');
  assert.match(html, /OwnerMapHygiene\.SCOPES/);
  assert.doesNotMatch(html, /ReadWrite/);
  assert.doesNotMatch(html, /client_secret|clientSecret/);
  assert.match(html, /Single-page application/);
  assert.match(html, /AADSTS9002326/);
  assert.match(html, /AADSTS65001/);
  assert.match(html, /cacheLocation:\s*'memory'/);
  assert.match(html, /graph\.microsoft\.com/);
  assert.match(html, /integrity="sha384-/);
});
