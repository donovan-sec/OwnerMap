const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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

/** Node reads TZ at process start, so each zone is a fresh process. */
function credentialLifetimesInZone(tz, spans) {
  const hygienePath = require.resolve('../src/hygiene.js');
  const script = `
    const h = require(${JSON.stringify(hygienePath)});
    const spans = ${JSON.stringify(spans)};
    const now = ${JSON.stringify(NOW)};
    const out = spans.map(span => {
      const life = h.longLivedCredential({ startDateTime: span.start, endDateTime: span.end });
      const report = h.analyze({
        now: now,
        applications: [{
          id: 'tz-app',
          appId: 'tz-app',
          displayName: 'TZ App',
          owners: [{ displayName: 'Ada', userPrincipalName: 'ada@example.com' }],
          passwordCredentials: [{
            keyId: 'tz-key',
            displayName: 'tz secret',
            startDateTime: span.start,
            endDateTime: span.end
          }],
          keyCredentials: []
        }]
      });
      const creds = report.checks.applications.findings.filter(item => String(item.id).indexOf('apps:cred:') === 0);
      return {
        name: span.name,
        longLived: !!(life && life.longLived),
        titles: creds.map(item => item.title),
        details: creds.map(item => item.detail)
      };
    });
    process.stdout.write(JSON.stringify({
      tz: process.env.TZ,
      offsetAtSpring: new Date('2024-03-09T12:00:00.000Z').getTimezoneOffset(),
      results: out
    }));
  `;
  const env = Object.assign({}, process.env, { TZ: tz });
  delete env.NODE_CHANNEL_FD;
  delete env.NODE_CHANNEL_SERIALIZATION_MODE;
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['-e', script], {
    env,
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(child.status, 0, tz + ' child failed\n' + child.stderr + '\n' + child.stdout);
  return JSON.parse(child.stdout);
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
  assert.doesNotMatch(readme, /github/i);
  assert.match(readme, /Azure Static Web Apps/);
  assert.match(readme, /Serve-OwnerMap\.ps1/);
});

test('hosting guide offers the three SMB options and keeps several redirect URIs', () => {
  const root = path.join(__dirname, '..');
  const setup = fs.readFileSync(path.join(root, 'docs', 'SETUP.md'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'scripts', 'Register-OwnerMap.ps1'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'scripts', 'Serve-OwnerMap.ps1'), 'utf8');
  for (const rel of ['README.md', 'docs/SETUP.md', 'ownermap.html', 'scripts/Register-OwnerMap.ps1', 'scripts/Serve-OwnerMap.ps1']) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(text, /github/i, rel);
  }
  assert.match(setup, /link you were given/);
  assert.match(setup, /Local admin PC/);
  assert.match(setup, /Azure Static Web Apps/);
  assert.match(setup, /Internal web server/);
  assert.match(setup, /Serve-OwnerMap\.ps1/);
  assert.match(setup, /py -m http\.server 8080/);
  assert.match(setup, /http:\/\/localhost:8080\/ownermap\.html/);
  assert.match(setup, /Deployment details/);
  assert.match(setup, /deployment token/i);
  assert.match(setup, /--env production/);
  assert.match(setup, /Custom domains/);
  assert.match(setup, /Install-WindowsFeature Web-Server/);
  assert.match(setup, /mimeMap fileExtension="\.js"/);
  assert.match(setup, /nginx/);
  assert.match(setup, /Apache/);
  assert.match(setup, /https:\/\/ownermap\.contoso\.local\/ownermap\.html/);
  assert.match(setup, /Ask your AI assistant/);
  assert.match(setup, /deployment token/i);
  assert.match(script, /\[string\[\]\]\$RedirectUri/);
  assert.match(script, /-WhatIf/);
  assert.match(script, /http:\/\/localhost:8080\/ownermap\.html','https:\/\/ownermap\.contoso\.local\/ownermap\.html/);
  assert.match(server, /http:\/\/localhost:/);
  assert.doesNotMatch(server, /0\.0\.0\.0|\+:/);
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

test('long-lived and ownerless credentials reuse fetched dates and stay one finding per credential', () => {
  const nowMs = Date.parse(NOW);
  assert.equal(h.LONG_LIVED_YEARS, 2);
  assert.equal(h.EXPIRING_DAYS, 30);

  function life(start, end) {
    return h.longLivedCredential({ startDateTime: start, endDateTime: end });
  }

  assert.equal(life('2025-06-01T00:00:00Z', '2027-06-01T00:00:00Z').longLived, false);
  assert.equal(life('2025-06-01T00:00:00Z', '2027-05-31T00:00:00Z').longLived, false);
  assert.equal(life('2025-06-01T00:00:00Z', '2027-06-02T00:00:00Z').longLived, true);
  assert.equal(life('2024-02-29T00:00:00Z', '2026-02-28T00:00:00Z').longLived, false);
  assert.equal(life('2024-02-29T00:00:00Z', '2026-03-01T00:00:00Z').longLived, true);
  assert.equal(h.longLivedCredential({ endDateTime: '2027-06-02T00:00:00Z' }), null);
  assert.equal(h.longLivedCredential({ startDateTime: '2025-06-01T00:00:00Z' }), null);
  assert.equal(h.longLivedCredential({ startDateTime: '2027-06-02T00:00:00Z', endDateTime: '2025-06-01T00:00:00Z' }), null);
  assert.equal(h.longLivedCredential(null), null);

  const atThreshold = h.credentialState({ endDateTime: '2026-11-19T12:00:00Z' }, nowMs, h.EXPIRING_DAYS);
  assert.equal(atThreshold.state, 'expiring');
  assert.equal(atThreshold.days, 30);
  assert.equal(h.credentialState({ endDateTime: '2026-11-20T12:00:00Z' }, nowMs, h.EXPIRING_DAYS).state, 'ok');
  assert.equal(h.credentialState({ endDateTime: '2026-01-01T00:00:00Z' }, nowMs, h.EXPIRING_DAYS).state, 'expired');

  const ada = [{ displayName: 'Ada', userPrincipalName: 'ada@example.com' }];
  function secret(keyId, name, start, end) {
    return { keyId, displayName: name, startDateTime: start, endDateTime: end };
  }
  function registration(id, name, owners, passwords, keys) {
    return {
      id,
      appId: id,
      displayName: name,
      owners,
      passwordCredentials: passwords,
      keyCredentials: keys
    };
  }

  const exactPw = secret('exact-pw', 'exact password', '2025-06-01T00:00:00Z', '2027-06-01T00:00:00Z');
  const minusPw = secret('minus-pw', 'minus password', '2025-06-01T00:00:00Z', '2027-05-31T00:00:00Z');
  const plusPw = secret('plus-pw', 'plus password', '2025-06-01T00:00:00Z', '2027-06-02T00:00:00Z');
  const exactKey = secret('exact-key', 'exact cert', '2025-06-01T00:00:00Z', '2027-06-01T00:00:00Z');
  const minusKey = secret('minus-key', 'minus cert', '2025-06-01T00:00:00Z', '2027-05-31T00:00:00Z');
  const plusKey = secret('plus-key', 'plus cert', '2025-06-01T00:00:00Z', '2027-06-02T00:00:00Z');
  const thresholdExact = secret('threshold-exact', 'threshold exact', '2024-11-19T12:00:00Z', '2026-11-19T12:00:00Z');
  const thresholdLong = secret('threshold-long', 'threshold long', '2024-11-18T12:00:00Z', '2026-11-19T12:00:00Z');
  const expiredLongPw = secret('expired-long-pw', 'expired password', '2023-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  const expiredLongKey = secret('expired-long-key', 'expired cert', '2023-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  const expiredNoStart = { keyId: 'expired-nostart', displayName: 'old password', endDateTime: '2026-01-01T00:00:00Z' };
  const expiringPw = secret('expiring-pw', 'soon password', '2026-01-01T00:00:00Z', '2026-10-30T00:00:00Z');
  const expiringKey = secret('expiring-key', 'soon cert', '2026-01-01T00:00:00Z', '2026-10-25T00:00:00Z');
  const duplicate = secret('dup', 'duplicate secret', '2024-01-01T00:00:00Z', '2027-06-02T00:00:00Z');

  const report = h.analyze(base({
    applications: [
      registration('exact-pw-app', 'Exact Password', ada, [exactPw], []),
      registration('minus-pw-app', 'Minus Password', ada, [minusPw], []),
      registration('plus-pw-app', 'Plus Password', ada, [plusPw], []),
      registration('exact-key-app', 'Exact Cert', ada, [], [exactKey]),
      registration('minus-key-app', 'Minus Cert', ada, [], [minusKey]),
      registration('plus-key-app', 'Plus Cert', ada, [], [plusKey]),
      registration('both-types', 'Both Types', ada, [exactPw], [plusKey]),
      registration('threshold-owned', 'Threshold Owned', ada, [thresholdExact], []),
      registration('threshold-orphan', 'Threshold Orphan', [], [], [thresholdLong]),
      registration('expired-owned', 'Expired Owned', ada, [expiredLongPw], []),
      registration('expired-orphan', 'Expired Orphan', [], [], [expiredLongKey]),
      registration('expired-nostart', 'Expired No Start', ada, [expiredNoStart], []),
      registration('expiring-orphan', 'Expiring Orphan', [], [expiringPw], [expiringKey]),
      registration('long-orphan', 'Long Orphan', [], [plusPw], []),
      registration('no-creds-owned', 'No Creds Owned', ada, [], []),
      registration('no-creds-orphan', 'No Creds Orphan', [], [], []),
      { id: 'omitted', appId: 'omitted', displayName: 'Omitted Creds', owners: ada },
      registration('duplicates', 'Duplicate Secret', ada, [duplicate, duplicate], []),
      registration('reg-owned', 'Registration Owned', ada, [], []),
      registration('empty-entries', 'Empty Entries', ada, [null, {}], [])
    ],
    servicePrincipals: [
      {
        id: 'sp-long',
        appId: 'sp-long',
        displayName: 'Owned Enterprise',
        servicePrincipalType: 'Application',
        appOwnerOrganizationId: sample.TENANT,
        passwordCredentials: [plusPw],
        keyCredentials: [],
        owners: ada
      },
      {
        id: 'sp-covered',
        appId: 'reg-owned',
        displayName: 'Covered Enterprise',
        servicePrincipalType: 'Application',
        appOwnerOrganizationId: sample.TENANT,
        passwordCredentials: [],
        keyCredentials: [expiringKey],
        owners: []
      },
      {
        id: 'sp-orphan',
        appId: 'sp-orphan',
        displayName: 'Orphan Enterprise',
        servicePrincipalType: 'Application',
        appOwnerOrganizationId: sample.TENANT,
        passwordCredentials: [expiredLongPw],
        keyCredentials: [],
        owners: []
      },
      {
        id: 'sp-ms',
        appId: 'sp-ms',
        displayName: 'Microsoft Teams',
        servicePrincipalType: 'Application',
        appOwnerOrganizationId: h.MS_FIRST_PARTY_TENANT,
        passwordCredentials: [expiredLongPw, plusPw],
        keyCredentials: [expiredLongKey],
        owners: []
      }
    ]
  }));

  const findings = report.checks.applications.findings;
  function creds(subject) {
    return findings.filter(item => item.subject === subject && item.id.indexOf('apps:cred:') === 0);
  }
  function titles(subject) {
    return creds(subject).map(item => item.title);
  }

  ['Exact Password', 'Minus Password', 'Exact Cert', 'Minus Cert', 'No Creds Owned', 'Omitted Creds', 'Empty Entries'].forEach(subject => {
    assert.deepEqual(titles(subject), [], subject);
  });
  assert.deepEqual(findings.filter(item => item.subject === 'No Creds Owned' || item.subject === 'Omitted Creds' || item.subject === 'Empty Entries'), []);
  assert.deepEqual(titles('No Creds Orphan'), []);
  assert.equal(findings.filter(item => item.subject === 'No Creds Orphan' && /no owner/i.test(item.title)).length, 1);

  assert.deepEqual(titles('Plus Password'), ['Long-lived app credential']);
  assert.deepEqual(titles('Plus Cert'), ['Long-lived app credential']);
  assert.match(creds('Plus Password')[0].detail, /plus password/);
  assert.match(creds('Plus Password')[0].detail, /1 Jun 2025/);
  assert.match(creds('Plus Password')[0].detail, /2 Jun 2027/);
  assert.match(creds('Plus Password')[0].detail, /more than 2 years/);
  assert.match(creds('Plus Cert')[0].detail, /plus cert/);
  assert.equal(creds('Plus Password')[0].severity, 'medium');
  assert.ok(creds('Plus Cert')[0].steps.some(step => /2 years or less/.test(step)));

  assert.deepEqual(titles('Both Types'), ['Long-lived app credential']);
  assert.match(creds('Both Types')[0].detail, /plus cert/);

  assert.deepEqual(titles('Threshold Owned'), ['App credential expiring soon']);
  assert.doesNotMatch(creds('Threshold Owned')[0].detail, /more than 2 years/);
  assert.equal(creds('Threshold Owned')[0].severity, 'medium');

  assert.deepEqual(titles('Threshold Orphan'), ['App credential expiring soon on an ownerless app']);
  assert.match(creds('Threshold Orphan')[0].detail, /more than 2 years/);
  assert.match(creds('Threshold Orphan')[0].detail, /Nobody owns this app/);
  assert.equal(findings.filter(item => item.subject === 'Threshold Orphan' && /no owner/i.test(item.title)).length, 1);
  assert.equal(creds('Threshold Orphan')[0].steps.length, 8);

  assert.deepEqual(titles('Expired Owned'), ['Expired app credential']);
  assert.match(creds('Expired Owned')[0].detail, /more than 2 years/);
  assert.equal(creds('Expired Owned')[0].severity, 'high');
  assert.doesNotMatch(creds('Expired Owned')[0].detail, /Nobody owns this app/);

  assert.deepEqual(titles('Expired Orphan'), ['Expired app credential on an ownerless app']);
  assert.match(creds('Expired Orphan')[0].detail, /expired cert/);
  assert.match(creds('Expired Orphan')[0].detail, /more than 2 years/);
  assert.equal(findings.filter(item => item.subject === 'Expired Orphan' && /no owner/i.test(item.title)).length, 1);

  assert.deepEqual(titles('Expired No Start'), ['Expired app credential']);
  assert.doesNotMatch(creds('Expired No Start')[0].detail, /more than 2 years/);

  assert.deepEqual(titles('Expiring Orphan').sort(), [
    'App credential expiring soon on an ownerless app',
    'App credential expiring soon on an ownerless app'
  ]);
  assert.equal(creds('Expiring Orphan').length, 2);
  creds('Expiring Orphan').forEach(item => {
    assert.equal(item.severity, 'medium');
    assert.match(item.detail, /Nobody owns this app/);
    assert.doesNotMatch(item.detail, /more than 2 years/);
  });
  assert.ok(creds('Expiring Orphan').some(item => /soon password/.test(item.detail)));
  assert.ok(creds('Expiring Orphan').some(item => /soon cert/.test(item.detail)));
  assert.equal(findings.filter(item => item.subject === 'Expiring Orphan' && /no owner/i.test(item.title)).length, 1);

  assert.deepEqual(titles('Long Orphan'), ['Long-lived app credential']);
  assert.equal(findings.filter(item => item.subject === 'Long Orphan' && item.title === 'App registration has no owner').length, 1);
  assert.equal(creds('Long Orphan').some(item => /ownerless/.test(item.title)), false);

  assert.equal(creds('Duplicate Secret').length, 1);
  assert.equal(creds('Duplicate Secret')[0].title, 'Long-lived app credential');

  assert.deepEqual(titles('Owned Enterprise'), ['Long-lived app credential']);
  assert.match(creds('Owned Enterprise')[0].detail, /Enterprise app credential/);
  assert.deepEqual(titles('Covered Enterprise'), ['App credential expiring soon']);
  assert.doesNotMatch(creds('Covered Enterprise')[0].detail, /Nobody owns this app/);
  assert.ok(findings.some(item => item.subject === 'Covered Enterprise' && item.title === 'Enterprise app has no owner'));
  assert.deepEqual(titles('Orphan Enterprise'), ['Expired app credential on an ownerless app']);
  assert.equal(findings.some(item => item.subject === 'Microsoft Teams'), false);

  const shape = ['checkId', 'detail', 'id', 'severity', 'steps', 'subject', 'subjectId', 'title'];
  creds('Plus Password').concat(creds('Expired Orphan'), creds('Threshold Orphan')).forEach(item => {
    assert.deepEqual(Object.keys(item).sort(), shape);
    assert.equal(item.checkId, 'applications');
    assert.ok(item.steps.length >= 3);
  });

  const sampleFindings = h.analyze(sample.build()).checks.applications.findings;
  const payroll = sampleFindings.filter(item => item.subject === 'Payroll Connector' && item.id.indexOf('apps:cred:') === 0);
  assert.equal(payroll.length, 1);
  assert.equal(payroll[0].title, 'Expired app credential on an ownerless app');
  assert.equal(payroll[0].severity, 'high');
  const intranet = sampleFindings.filter(item => item.subject === 'Intranet' && item.id.indexOf('apps:cred:') === 0);
  assert.deepEqual(intranet.map(item => item.title), ['App credential expiring soon']);

  assert.match(h.findingsToCsv(report), /Long-lived app credential/);
  assert.equal(h.PERMISSIONS.length, 8);
});

test('two calendar years across a leap day are not 730 days or 2 times 365.25 days', () => {
  const day = 86400000;
  const start = Date.parse('2024-01-01T00:00:00.000Z');
  const anniversary = Date.parse('2026-01-01T00:00:00.000Z');
  const justUnder = Date.parse('2025-12-31T23:59:59.999Z');
  const justOver730 = Date.parse('2025-12-31T00:00:00.001Z');
  assert.equal((anniversary - start) / day, 731);
  assert.equal(anniversary - start > 730 * day, true);
  assert.equal(anniversary - start > 2 * 365.25 * day, true);
  assert.equal(justUnder > start + 730 * day, true);
  assert.equal(justUnder > start + 2 * 365.25 * day, true);
  assert.equal(justUnder < anniversary, true);
  assert.equal(justOver730 > start + 730 * day, true);
  assert.equal(justOver730 > start + 2 * 365.25 * day, false);

  function life(end) {
    const result = h.longLivedCredential({
      startDateTime: '2024-01-01T00:00:00.000Z',
      endDateTime: new Date(end).toISOString()
    });
    assert.ok(result);
    return result.longLived;
  }

  assert.equal(life(anniversary), false);
  assert.equal(life(anniversary + 1), true);
  assert.equal(life(justUnder), false);
  assert.equal(life(justOver730), false);
});

test('credential lifetime stays on UTC years in Chicago, Kiritimati, and Pago Pago', () => {
  const spans = [
    { name: 'leap-anniversary', start: '2024-01-01T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z', longLived: false },
    { name: 'leap-plus-1ms', start: '2024-01-01T00:00:00.000Z', end: '2026-01-01T00:00:00.001Z', longLived: true },
    { name: 'spring-anniversary', start: '2024-03-09T12:00:00.000Z', end: '2026-03-09T12:00:00.000Z', longLived: false },
    { name: 'spring-before', start: '2024-03-09T12:00:00.000Z', end: '2026-03-09T11:30:00.000Z', longLived: false },
    { name: 'spring-after', start: '2024-03-09T12:00:00.000Z', end: '2026-03-09T12:00:01.000Z', longLived: true },
    { name: 'fall-anniversary', start: '2024-11-02T12:00:00.000Z', end: '2026-11-02T12:00:00.000Z', longLived: false },
    { name: 'fall-after', start: '2024-11-02T12:00:00.000Z', end: '2026-11-02T12:30:00.000Z', longLived: true },
    { name: 'future-long', start: '2024-06-01T00:00:00.000Z', end: '2027-06-02T00:00:00.000Z', longLived: true }
  ];
  const zones = [
    { tz: 'America/Chicago', offsetAtSpring: 360 },
    { tz: 'Pacific/Kiritimati', offsetAtSpring: -840 },
    { tz: 'Pacific/Pago_Pago', offsetAtSpring: 660 },
    { tz: 'UTC', offsetAtSpring: 0 }
  ];

  zones.forEach(zone => {
    const report = credentialLifetimesInZone(zone.tz, spans);
    assert.equal(report.tz, zone.tz);
    assert.equal(report.offsetAtSpring, zone.offsetAtSpring, zone.tz);
    const byName = {};
    report.results.forEach(item => { byName[item.name] = item; });
    spans.forEach(span => {
      const item = byName[span.name];
      assert.ok(item, zone.tz + ' ' + span.name);
      assert.equal(item.longLived, span.longLived, zone.tz + ' ' + span.name);
      assert.equal(item.titles.length, 1, zone.tz + ' ' + span.name);
      const saysLong = /more than 2 years/.test(item.details[0]);
      const titledLong = item.titles[0] === 'Long-lived app credential';
      assert.equal(saysLong || titledLong, span.longLived, zone.tz + ' ' + span.name + ' ' + item.details[0]);
    });
    const future = byName['future-long'];
    assert.equal(future.titles[0], 'Long-lived app credential');
    assert.match(future.details[0], /1 Jun 2024/);
    assert.match(future.details[0], /2 Jun 2027/);
    assert.match(future.details[0], /more than 2 years/);
    assert.equal(byName['spring-anniversary'].titles[0], 'Expired app credential');
    assert.doesNotMatch(byName['spring-anniversary'].details[0], /more than 2 years/);
  });
});

test('expiry is strictly before now and whole days round down', () => {
  const nowMs = Date.parse(NOW);
  const day = 86400000;
  const hour = 3600000;
  const edges = [
    { label: 'end equal to now', end: nowMs, state: 'expiring', days: 0 },
    { label: 'now minus 1 ms', end: nowMs - 1, state: 'expired', days: 0 },
    { label: 'exactly 30 days', end: nowMs + 30 * day, state: 'expiring', days: 30 },
    { label: '30 days plus 12 hours', end: nowMs + 30 * day + 12 * hour, state: 'expiring', days: 30 },
    { label: '31 days minus 1 ms', end: nowMs + 31 * day - 1, state: 'expiring', days: 30 },
    { label: 'exactly 31 days', end: nowMs + 31 * day, state: 'ok', days: 31 }
  ];
  edges.forEach(item => {
    const state = h.credentialState({ endDateTime: new Date(item.end).toISOString() }, nowMs, h.EXPIRING_DAYS);
    assert.ok(state, item.label);
    assert.equal(state.state, item.state, item.label);
    assert.equal(state.days, item.days, item.label);
  });

  const ada = [{ displayName: 'Ada', userPrincipalName: 'ada@example.com' }];
  function registration(id, endMs) {
    return {
      id,
      appId: id,
      displayName: id,
      owners: ada,
      passwordCredentials: [{
        keyId: id,
        displayName: id,
        startDateTime: '2026-01-01T00:00:00.000Z',
        endDateTime: new Date(endMs).toISOString()
      }],
      keyCredentials: []
    };
  }
  const report = h.analyze(base({
    applications: [
      registration('ends-now', nowMs),
      registration('ends-just-before', nowMs - 1),
      registration('thirty-exact', nowMs + 30 * day),
      registration('thirty-and-a-half', nowMs + 30 * day + 12 * hour),
      registration('thirty-one-minus', nowMs + 31 * day - 1),
      registration('thirty-one', nowMs + 31 * day)
    ]
  }));
  function cred(subject) {
    return report.checks.applications.findings.filter(item => item.subject === subject && item.id.indexOf('apps:cred:') === 0);
  }
  assert.equal(cred('ends-now')[0].title, 'App credential expiring soon');
  assert.match(cred('ends-now')[0].detail, /today/);
  assert.equal(cred('ends-just-before')[0].title, 'Expired app credential');
  assert.equal(cred('thirty-exact')[0].title, 'App credential expiring soon');
  assert.equal(cred('thirty-and-a-half')[0].title, 'App credential expiring soon');
  assert.equal(cred('thirty-one-minus')[0].title, 'App credential expiring soon');
  assert.equal(cred('thirty-one').length, 0);
});

test('credential dedupe keeps case-distinct keyIds and falls back when keyId is missing', () => {
  const ada = [{ displayName: 'Ada', userPrincipalName: 'ada@example.com' }];
  const start = '2024-01-01T00:00:00.000Z';
  const endA = '2027-06-02T00:00:00.000Z';
  const endB = '2027-08-02T00:00:00.000Z';
  function registration(id, passwords) {
    return {
      id,
      appId: id,
      displayName: id,
      owners: ada,
      passwordCredentials: passwords,
      keyCredentials: []
    };
  }
  const report = h.analyze(base({
    applications: [
      registration('case-ids', [
        { keyId: 'AbC', displayName: 'upper', startDateTime: start, endDateTime: endA },
        { keyId: 'abc', displayName: 'lower', startDateTime: start, endDateTime: endA }
      ]),
      registration('names', [
        { displayName: 'alpha', startDateTime: start, endDateTime: endA },
        { displayName: 'beta', startDateTime: start, endDateTime: endA }
      ]),
      registration('ends', [
        { startDateTime: start, endDateTime: endA },
        { startDateTime: start, endDateTime: endB }
      ]),
      registration('same-end', [
        { startDateTime: start, endDateTime: endA },
        { startDateTime: '2024-06-01T00:00:00.000Z', endDateTime: endA }
      ])
    ]
  }));
  function creds(subject) {
    return report.checks.applications.findings.filter(item => item.subject === subject && item.id.indexOf('apps:cred:') === 0);
  }
  assert.equal(creds('case-ids').length, 2);
  assert.equal(creds('names').length, 2);
  assert.equal(creds('ends').length, 2);
  assert.equal(creds('same-end').length, 1);
  creds('case-ids').concat(creds('names'), creds('ends'), creds('same-end')).forEach(item => {
    assert.equal(item.title, 'Long-lived app credential');
    assert.match(item.detail, /more than 2 years/);
  });
  const dated = creds('case-ids')[0];
  assert.match(dated.detail, /1 Jan 2024/);
  assert.match(dated.detail, /2 Jun 2027/);
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
