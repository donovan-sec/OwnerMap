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
  assert.deepEqual(report.unavailable.sort(), ['conditionalAccess', 'staleAccounts', 'tenantDefaults']);
  assert.equal(report.checks.staleAccounts.findings.length, 0);
});

test('sample tenant produces a stable mixed report', () => {
  const report = h.analyze(sample.build());
  assert.equal(report.generatedAt, NOW);
  assert.deepEqual(report.counts, { high: 18, medium: 9, low: 1 });
  assert.deepEqual(report.checks.groups.counts, { high: 2, medium: 0, low: 1 });
  assert.equal(report.checks.groups.headline, '2 groups have no owner, and 1 enabled account is not in a group');
  assert.deepEqual(report.checks.staleAccounts.counts, { high: 3, medium: 0, low: 0 });
  assert.deepEqual(report.checks.disabledUsers.counts, { high: 1, medium: 1, low: 0 });
  assert.deepEqual(report.checks.guests.counts, { high: 2, medium: 0, low: 0 });
  assert.deepEqual(report.checks.applications.counts, { high: 4, medium: 3, low: 0 });
  assert.deepEqual(report.checks.licenses.counts, { high: 1, medium: 2, low: 0 });
  assert.deepEqual(report.checks.conditionalAccess.counts, { high: 2, medium: 2, low: 0 });
  assert.deepEqual(report.checks.tenantDefaults.counts, { high: 3, medium: 1, low: 0 });
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

const GUEST_ROLE_MEMBER = 'a0b1b346-4d3e-4e8b-98f8-753987be4970';
const GUEST_ROLE_GUEST = '10dae51f-b6af-4016-8d66-8c2a99b929b3';
const GUEST_ROLE_RESTRICTED = '2af84b1e-32c8-42b7-82bc-daa82404023b';
const FINDING_KEYS = ['checkId', 'detail', 'id', 'severity', 'steps', 'subject', 'subjectId', 'title'];

function perms(overrides) {
  return Object.assign({
    allowedToCreateApps: false,
    allowedToCreateTenants: false,
    allowedToCreateSecurityGroups: true,
    allowedToReadOtherUsers: false,
    permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-low']
  }, overrides);
}

function authz(policyOverrides, permOverrides) {
  const policy = Object.assign({
    id: 'authorizationPolicy',
    allowInvitesFrom: 'adminsAndGuestInviters',
    guestUserRoleId: GUEST_ROLE_RESTRICTED,
    unknownDirectorySetting: true,
    defaultUserRolePermissions: perms(permOverrides)
  }, policyOverrides || {});
  if (policyOverrides && Object.prototype.hasOwnProperty.call(policyOverrides, 'defaultUserRolePermissions')) {
    policy.defaultUserRolePermissions = policyOverrides.defaultUserRolePermissions;
  }
  return { available: true, reason: 'ok', policy };
}

function tenantCheck(authorizationPolicy) {
  return h.analyze(base({ authorizationPolicy })).checks.tenantDefaults;
}

function byId(check) {
  return Object.fromEntries(check.findings.map(item => [item.id, item]));
}

function assertFindingShape(item) {
  assert.deepEqual(Object.keys(item).sort(), FINDING_KEYS);
  assert.equal(item.checkId, 'tenantDefaults');
  assert.equal(item.subject, 'Tenant defaults');
  assert.ok(item.steps.length >= 3);
  item.steps.forEach(step => assert.doesNotMatch(step, /PATCH|ReadWrite|\/beta|allowedToReadOtherUsers/i));
}

test('tenant defaults stay quiet when the documented safe values are set', () => {
  const check = tenantCheck(authz());
  assert.equal(check.available, true);
  assert.equal(check.status, 'ok');
  assert.equal(check.findings.length, 0);
  assert.equal(check.headline, 'No flagged tenant defaults');
  assert.equal(check.note, '');
  assert.deepEqual(check.counts, { high: 0, medium: 0, low: 0 });
  const groups = check.rows.find(row => row.setting === 'Users can create security groups');
  assert.equal(groups.value, 'Any member');
  assert.equal(groups.severity, 'ok');
  assert.equal(check.findings.some(item => /security group/i.test(item.title)), false);
  const report = h.analyze(base({ authorizationPolicy: authz() }));
  assert.equal(report.unavailable.includes('tenantDefaults'), false);
  assert.equal(report.order[report.order.length - 1], 'tenantDefaults');
});

test('each tenant-default finding turns on and off', () => {
  const risky = tenantCheck(authz({
    allowInvitesFrom: 'everyone',
    guestUserRoleId: GUEST_ROLE_MEMBER
  }, {
    allowedToCreateApps: true,
    allowedToCreateTenants: true,
    allowedToCreateSecurityGroups: true,
    allowedToReadOtherUsers: false,
    permissionGrantPoliciesAssigned: [
      'ManagePermissionGrantsForSelf.microsoft-user-default-legacy',
      'ManagePermissionGrantsForSelf.microsoft-user-default-legacy',
      'managePermissionGrantsForSelf.microsoft-all-application-permissions',
      'ManagePermissionGrantsForOwnedResource.microsoft-dynamically-managed-permissions-for-team',
      'ManagePermissionGrantsForOwnedResource.microsoft-dynamically-managed-permissions-for-chat',
      'ManagePermissionGrantsForSelf.microsoft-user-default-low'
    ]
  }));
  const found = byId(risky);
  assert.deepEqual(Object.keys(found).sort(), [
    'td:create-apps',
    'td:create-tenants',
    'td:guest-invites',
    'td:guest-role',
    'td:user-consent'
  ]);
  assert.equal(risky.findings.length, 5);
  risky.findings.forEach(assertFindingShape);
  assert.equal(found['td:create-apps'].severity, 'medium');
  assert.equal(found['td:create-apps'].title, 'Users can register applications');
  assert.match(found['td:create-apps'].detail, /Application Developer/);
  assert.equal(found['td:create-tenants'].severity, 'high');
  assert.equal(found['td:create-tenants'].title, 'Users can create tenants');
  assert.match(found['td:create-tenants'].detail, /Global Administrator/);
  assert.match(found['td:create-tenants'].detail, /Restrict non-admin users from creating tenants/);
  assert.equal(found['td:guest-invites'].severity, 'high');
  assert.equal(found['td:guest-invites'].title, 'Anyone, including guests, can invite guests');
  assert.equal(found['td:guest-role'].severity, 'high');
  assert.equal(found['td:guest-role'].title, 'Guests have the same access as members');
  assert.equal(found['td:user-consent'].severity, 'high');
  assert.equal(found['td:user-consent'].title, 'Users can grant broad application consent');
  assert.match(found['td:user-consent'].detail, /legacy policy/);
  assert.match(found['td:user-consent'].detail, /all application permissions for any app/);
  assert.doesNotMatch(found['td:user-consent'].detail, /verified publishers and selected permissions/);
  assert.equal(risky.findings.some(item => /security group/i.test(item.title)), false);
  assert.doesNotMatch(JSON.stringify(risky.findings), /allowedToReadOtherUsers|\/beta/i);
  risky.findings.forEach(item => assert.equal(item.subjectId, 'authorizationPolicy'));
  assert.doesNotMatch(found['td:create-apps'].detail, /Microsoft recommends/);
  assert.match(found['td:create-apps'].detail, /OwnerMap rates this medium/);
  assert.match(found['td:create-apps'].detail, /delegate-app-roles/);
  assert.match(found['td:create-tenants'].detail, /OwnerMap rates this high/);
  assert.match(found['td:create-tenants'].detail, /zero-trust-protect-tenants/);
  assert.doesNotMatch(found['td:guest-invites'].detail, /Microsoft warns|compromised guest/);
  assert.match(found['td:guest-invites'].detail, /entitlement-management-external-users/);
  assert.match(found['td:guest-invites'].detail, /including guests themselves/);
  assert.match(found['td:guest-invites'].detail, /OwnerMap rates this high/);
  assert.match(found['td:guest-role'].detail, /OwnerMap rates this high/);
  assert.match(found['td:guest-role'].detail, /users-restrict-guest-permissions/);
  assert.match(found['td:user-consent'].detail, /configure-user-consent/);
  assert.match(found['td:user-consent'].detail, /OwnerMap rates this high/);
  assert.doesNotMatch(found['td:user-consent'].detail, /turning user consent off/);

  const appsOff = tenantCheck(authz(null, { allowedToCreateApps: false }));
  assert.equal(appsOff.findings.some(item => item.id === 'td:create-apps'), false);
  assert.equal(appsOff.rows.find(row => row.setting === 'Users can register applications').severity, 'ok');

  const tenantsOff = tenantCheck(authz(null, { allowedToCreateTenants: false }));
  assert.equal(tenantsOff.findings.some(item => item.id === 'td:create-tenants'), false);
  assert.equal(tenantsOff.rows.find(row => row.setting === 'Users can create tenants').value, 'Tenant Creator role');

  const groupsOff = tenantCheck(authz(null, { allowedToCreateSecurityGroups: false }));
  assert.equal(groupsOff.findings.length, 0);
  assert.equal(groupsOff.rows.find(row => row.setting === 'Users can create security groups').value, 'User Administrator and above');
});

test('every allowInvitesFrom value is judged on its own', () => {
  function invites(value) {
    return tenantCheck(authz({ allowInvitesFrom: value }));
  }
  const everyone = invites('everyone');
  const everyoneFinding = everyone.findings.find(item => item.id === 'td:guest-invites');
  assert.equal(everyoneFinding.severity, 'high');
  assert.equal(everyoneFinding.title, 'Anyone, including guests, can invite guests');
  assert.match(everyoneFinding.detail, /including guests themselves/);
  assert.equal(invites('EVERYONE').findings.find(item => item.id === 'td:guest-invites').title, everyoneFinding.title);

  const members = invites('adminsGuestInvitersAndAllMembers');
  assert.equal(members.findings.some(item => item.id === 'td:guest-invites'), false);
  assert.equal(members.rows.find(row => row.setting === 'Who can invite guests').value, 'Members and guest-inviter admins');
  assert.equal(members.rows.find(row => row.setting === 'Who can invite guests').severity, 'ok');
  assert.equal(invites('  adminsGuestInvitersAndAllMembers  ').findings.some(item => item.id === 'td:guest-invites'), false);

  ['adminsAndGuestInviters', 'none'].forEach(value => {
    const check = invites(value);
    assert.equal(check.findings.some(item => item.id === 'td:guest-invites'), false, value);
    assert.equal(check.rows.find(row => row.setting === 'Who can invite guests').severity, 'ok', value);
  });
  const unknown = invites('guestsOnly');
  assert.equal(unknown.findings.some(item => item.id === 'td:guest-invites'), false);
  assert.equal(unknown.rows.find(row => row.setting === 'Who can invite guests').severity, 'unavailable');
  assert.match(unknown.note, /who can invite guests/);
});

test('every guestUserRoleId value is judged on its own', () => {
  function role(value) {
    return tenantCheck(authz({ guestUserRoleId: value }));
  }
  const member = role(GUEST_ROLE_MEMBER);
  const memberFinding = member.findings.find(item => item.id === 'td:guest-role');
  assert.equal(memberFinding.severity, 'high');
  assert.equal(memberFinding.title, 'Guests have the same access as members');
  assert.equal(role(GUEST_ROLE_MEMBER.toUpperCase()).findings.find(item => item.id === 'td:guest-role').severity, 'high');

  const guest = role(GUEST_ROLE_GUEST);
  assert.equal(guest.findings.some(item => item.id === 'td:guest-role'), false);
  assert.equal(guest.rows.find(row => row.setting === 'Guest directory access').value, 'Default limited guest');
  assert.equal(guest.rows.find(row => row.setting === 'Guest directory access').severity, 'ok');
  assert.equal(role('  ' + GUEST_ROLE_GUEST.toUpperCase() + '  ').findings.some(item => item.id === 'td:guest-role'), false);

  const restricted = role(GUEST_ROLE_RESTRICTED);
  assert.equal(restricted.findings.some(item => item.id === 'td:guest-role'), false);
  assert.equal(restricted.rows.find(row => row.setting === 'Guest directory access').value, 'Own profile only');
  assert.equal(restricted.rows.find(row => row.setting === 'Guest directory access').severity, 'ok');

  const unknown = role('00000000-0000-0000-0000-000000000000');
  assert.equal(unknown.findings.some(item => item.id === 'td:guest-role'), false);
  assert.equal(unknown.rows.find(row => row.setting === 'Guest directory access').severity, 'unavailable');
  assert.match(unknown.note, /guest directory access/);
});

test('user consent policies are flagged only when they are broad or legacy', () => {
  function consent(list) {
    return tenantCheck(authz(null, { permissionGrantPoliciesAssigned: list }));
  }
  function consentFinding(list) {
    const findings = consent(list).findings.filter(item => item.id === 'td:user-consent');
    assert.equal(findings.length <= 1, true);
    return findings[0] || null;
  }

  assert.equal(consentFinding([]), null);
  assert.equal(consent([]).rows.find(row => row.setting === 'User consent to apps').value, 'Off');
  assert.equal(consent([]).rows.find(row => row.setting === 'User consent to apps').severity, 'ok');

  [
    ['ManagePermissionGrantsForSelf.microsoft-user-default-low'],
    ['managePermissionGrantsForSelf.microsoft-user-default-recommended'],
    ['ManagePermissionGrantsForSelf.microsoft-user-default-allow-consent-apps'],
    ['ManagePermissionGrantsForSelf.microsoft-user-allow-default-consent-apps'],
    [
      'ManagePermissionGrantsForSelf.microsoft-user-default-recommended',
      'ManagePermissionGrantsForSelf.microsoft-user-default-allow-consent-apps',
      'ManagePermissionGrantsForOwnedResource.microsoft-dynamically-managed-permissions-for-chat'
    ]
  ].forEach(list => {
    assert.equal(consentFinding(list), null, list.join(','));
    assert.equal(consent(list).rows.find(row => row.setting === 'User consent to apps').severity, 'ok', list.join(','));
  });

  assert.equal(consentFinding([
    'ManagePermissionGrantsForOwnedResource.microsoft-dynamically-managed-permissions-for-team'
  ]), null);
  assert.equal(consent([
    'ManagePermissionGrantsForOwnedResource.microsoft-dynamically-managed-permissions-for-team'
  ]).rows.find(row => row.setting === 'User consent to apps').value, 'Off');

  const legacy = consentFinding(['ManagePermissionGrantsForSelf.microsoft-user-default-legacy']);
  assert.equal(legacy.severity, 'high');
  assert.equal(legacy.title, 'Users can consent to any app');
  assert.match(legacy.detail, /any app/);
  assert.match(legacy.detail, /we recommend that you allow user consent only for applications that have been published by a verified publisher/);
  assert.equal(consentFinding([
    'managepermissiongrantsforself.microsoft-user-default-legacy',
    'ManagePermissionGrantsForSelf.microsoft-user-default-low'
  ]).title, 'Users can consent to any app');

  [
    ['microsoft-all-application-permissions', /all application permissions for any app/],
    ['microsoft-all-application-permissions-verified', /verified publishers and apps registered in this tenant/],
    ['microsoft-application-admin', /application administrator consent policy/],
    ['microsoft-company-admin', /company administrator consent policy/]
  ].forEach(pair => {
    const item = consentFinding(['ManagePermissionGrantsForSelf.' + pair[0]]);
    assert.equal(item.severity, 'high', pair[0]);
    assert.equal(item.title, 'Users can grant broad application consent', pair[0]);
    assert.match(item.detail, pair[1], pair[0]);
    assert.doesNotMatch(item.detail, /legacy policy/, pair[0]);
  });

  const custom = consent(['ManagePermissionGrantsForSelf.my-custom-policy']);
  assert.equal(custom.findings.some(item => item.id === 'td:user-consent'), false);
  assert.equal(custom.rows.find(row => row.setting === 'User consent to apps').severity, 'unavailable');
  assert.match(custom.note, /does not recognize/);
  assert.equal(custom.headline, 'No risky default in the settings Microsoft returned');

  const mixed = consentFinding([
    'ManagePermissionGrantsForSelf.my-custom-policy',
    'ManagePermissionGrantsForSelf.microsoft-user-default-legacy'
  ]);
  assert.equal(mixed.title, 'Users can consent to any app');
  assert.match(mixed.detail, /microsoft-user-default-legacy|legacy policy/);
  assert.doesNotMatch(mixed.detail, /my-custom-policy/);

  const junk = consent(['not-a-policy']);
  assert.equal(junk.findings.some(item => item.id === 'td:user-consent'), false);
  assert.equal(junk.rows.find(row => row.setting === 'User consent to apps').severity, 'unavailable');
});

test('missing and null authorization-policy properties are not safe or risky', () => {
  const emptyPerms = tenantCheck(authz({
    allowInvitesFrom: null,
    guestUserRoleId: null,
    defaultUserRolePermissions: {
      allowedToCreateApps: null,
      allowedToCreateTenants: null,
      allowedToCreateSecurityGroups: null,
      permissionGrantPoliciesAssigned: null,
      allowedToReadOtherUsers: null
    }
  }));
  assert.equal(emptyPerms.available, true);
  assert.equal(emptyPerms.findings.length, 0);
  assert.notEqual(emptyPerms.headline, 'No flagged tenant defaults');
  assert.match(emptyPerms.note, /not judged/);
  emptyPerms.rows.forEach(row => assert.equal(row.severity, 'unavailable', row.setting));
  ['who can register applications', 'who can create tenants', 'who can create security groups', 'who can invite guests', 'guest directory access', 'user consent'].forEach(label => {
    assert.match(emptyPerms.note, new RegExp(label));
  });

  const omittedCheck = tenantCheck(authz({
    allowInvitesFrom: undefined,
    guestUserRoleId: undefined,
    defaultUserRolePermissions: {}
  }));
  assert.equal(omittedCheck.findings.length, 0);
  assert.match(omittedCheck.note, /who can register applications/);
  assert.match(omittedCheck.note, /user consent/);

  const sibling = tenantCheck(authz({
    allowInvitesFrom: null,
    guestUserRoleId: GUEST_ROLE_RESTRICTED,
    defaultUserRolePermissions: {
      allowedToCreateApps: null,
      allowedToCreateTenants: true,
      allowedToCreateSecurityGroups: null,
      permissionGrantPoliciesAssigned: []
    }
  }));
  assert.deepEqual(sibling.findings.map(item => item.id), ['td:create-tenants']);
  assert.equal(sibling.rows.find(row => row.setting === 'Users can register applications').severity, 'unavailable');
  assert.equal(sibling.rows.find(row => row.setting === 'Users can create security groups').severity, 'unavailable');
  assert.equal(sibling.rows.find(row => row.setting === 'Who can invite guests').severity, 'unavailable');
  assert.equal(sibling.rows.find(row => row.setting === 'User consent to apps').severity, 'ok');
  assert.equal(sibling.findings.some(item => item.id === 'td:create-apps'), false);

  const noPerms = tenantCheck(authz({ defaultUserRolePermissions: null }));
  assert.equal(noPerms.findings.length, 0);
  assert.match(noPerms.note, /who can register applications/);
  assert.match(noPerms.note, /user consent/);
  assert.equal(noPerms.rows.find(row => row.setting === 'Guest directory access').severity, 'ok');

  const textValues = tenantCheck(authz(null, {
    allowedToCreateApps: 'true',
    allowedToCreateTenants: 'false',
    allowedToCreateSecurityGroups: 'true',
    permissionGrantPoliciesAssigned: 'ManagePermissionGrantsForSelf.microsoft-user-default-legacy'
  }));
  assert.equal(textValues.findings.length, 0);
  assert.equal(textValues.rows.find(row => row.setting === 'Users can register applications').severity, 'unavailable');
  assert.equal(textValues.rows.find(row => row.setting === 'Users can create tenants').severity, 'unavailable');
  assert.equal(textValues.rows.find(row => row.setting === 'Users can create security groups').severity, 'unavailable');
  assert.equal(textValues.rows.find(row => row.setting === 'User consent to apps').severity, 'unavailable');
  assert.match(textValues.note, /not judged/);
});

test('an unreadable authorization policy is not a clean bill of health', () => {
  function fromError(error) {
    const interpreted = h.interpretOptionalError('tenantDefaults', error);
    const report = h.analyze(base({
      groups: [{ id: 'g', displayName: 'Finance', securityEnabled: true, owners: [], members: [] }],
      authorizationPolicy: interpreted
    }));
    const check = report.checks.tenantDefaults;
    assert.equal(interpreted.available, false);
    assert.equal(check.available, false);
    assert.equal(check.status, 'unavailable');
    assert.equal(check.findings.length, 0);
    assert.deepEqual(check.counts, { high: 0, medium: 0, low: 0 });
    assert.equal(check.headline, 'Tenant defaults unavailable');
    assert.match(check.unavailableMessage, /Policy\.Read\.All/);
    assert.match(check.unavailableMessage, /Every other check still ran/);
    assert.doesNotMatch(check.unavailableMessage, /tightened|no risky/i);
    assert.ok(report.unavailable.includes('tenantDefaults'));
    assert.equal(report.checks.groups.counts.high, 1);
    assert.ok(report.counts.high >= 1);
    return { interpreted, check, report };
  }

  const denied = fromError({
    status: 403,
    code: 'Authorization_RequestDenied',
    graphMessage: 'Insufficient privileges to complete the operation.'
  });
  assert.equal(denied.interpreted.reason, 'permission');
  assert.match(denied.check.unavailableMessage, /Grant admin consent/);

  const unauthorized = fromError({ status: 401, code: '', graphMessage: 'Access token has expired.' });
  assert.equal(unauthorized.interpreted.reason, 'permission');
  assert.match(unauthorized.check.unavailableMessage, /Policy\.Read\.All/);

  const licensed = fromError({
    status: 403,
    code: 'Authentication_RequestFromNonPremiumTenantOrB2CTenant',
    graphMessage: "Neither tenant is B2C or tenant doesn't have premium license"
  });
  assert.equal(licensed.interpreted.reason, 'license');
  assert.match(licensed.check.unavailableMessage, /license or subscription/);
  assert.match(licensed.check.unavailableMessage, /Policy\.Read\.All/);

  const subscription = fromError({ status: 400, code: '', graphMessage: 'Subscription not found' });
  assert.equal(subscription.interpreted.reason, 'license');

  const generic = fromError({ status: 500, code: 'UnknownError', graphMessage: 'Something went wrong.' });
  assert.equal(generic.interpreted.reason, 'error');
  assert.match(generic.check.unavailableMessage, /did not return the authorization policy/);
  assert.match(generic.check.unavailableMessage, /Every other check still ran/);

  const bare = h.analyze(base());
  assert.equal(bare.checks.tenantDefaults.available, false);
  assert.equal(bare.checks.tenantDefaults.findings.length, 0);
  assert.equal(bare.checks.tenantDefaults.status, 'unavailable');
  assert.ok(bare.unavailable.includes('tenantDefaults'));
  assert.match(bare.checks.tenantDefaults.unavailableMessage, /Policy\.Read\.All/);

  const nullPolicy = tenantCheck({ available: true, reason: 'ok', policy: null });
  assert.equal(nullPolicy.available, false);
  assert.equal(nullPolicy.status, 'unavailable');
  assert.equal(nullPolicy.findings.length, 0);
  assert.match(nullPolicy.unavailableMessage, /Policy\.Read\.All/);
  assert.match(nullPolicy.unavailableMessage, /Every other check still ran/);
});

test('tenant defaults add no permission and the page stays on v1.0', () => {
  assert.equal(h.PERMISSIONS.length, 8);
  assert.deepEqual(h.PERMISSIONS.map(permission => permission.scope), [
    'User.Read',
    'Group.Read.All',
    'GroupMember.Read.All',
    'User.Read.All',
    'Directory.Read.All',
    'Application.Read.All',
    'AuditLog.Read.All',
    'Policy.Read.All'
  ]);
  h.PERMISSIONS.forEach(permission => {
    assert.equal(permission.type, 'Delegated');
    assert.doesNotMatch(permission.scope, /Write/i);
  });
  const policyPerm = h.PERMISSIONS.find(permission => permission.scope === 'Policy.Read.All');
  assert.equal(policyPerm.required, false);
  assert.equal(policyPerm.purpose, 'Read Conditional Access policies and security defaults');

  const root = path.join(__dirname, '..');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'ownermap.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'src', 'hygiene.js'), 'utf8');
  assert.match(readme, /Tenant defaults/);
  assert.match(readme, /optional `Policy\.Read\.All`/);
  assert.match(readme, /tenant default settings/);
  assert.match(html, /Tenant default settings use the same optional Policy\.Read\.All permission/);
  assert.match(html, /graphGet\(GRAPH \+ '\/policies\/authorizationPolicy', appState\.tokens\.policy\)/);
  assert.match(html, /interpretOptionalError\('tenantDefaults', error\)/);
  assert.match(html, /unavailableMessage\('tenantDefaults', 'permission'\)/);
  assert.doesNotMatch(html, /graph\.microsoft\.com\/beta/);
  assert.doesNotMatch(source, /graph\.microsoft\.com\/beta|\/beta\/policies/);
  assert.doesNotMatch(readme, /graph\.microsoft\.com\/beta/);
  assert.doesNotMatch(readme, /Read and change/i);
  assert.match(readme, /License needs for that permission vary by tenant/);
  assert.match(html, /License needs for that permission vary by tenant/);
  readme.split('\n').filter(line => line.startsWith('- ')).forEach(line => {
    assert.doesNotMatch(line, /\s\|$/, line.slice(0, 80));
  });
  h.PERMISSIONS.forEach(permission => {
    const line = readme.split('\n').find(row => row.startsWith('| `' + permission.scope + '`'));
    assert.ok(line, permission.scope);
    assert.ok(line.replace(/`/g, '').includes(permission.purpose), permission.scope);
    assert.ok(line.includes(permission.license), permission.scope);
    assert.doesNotMatch(line, /Read and change/i);
  });
  const tenantDefaultsRow = readme.split('\n').find(line => line.startsWith('| Tenant defaults'));
  assert.match(tenantDefaultsRow, /Microsoft Graph v1\.0/);
  assert.match(tenantDefaultsRow, /Policy\.Read\.All/);
  assert.doesNotMatch(tenantDefaultsRow, /beta/i);
  assert.doesNotMatch(tenantDefaultsRow, /Entra ID P1/);
  assert.doesNotMatch(tenantDefaultsRow, /\b(change|update|write|fix automatically|set)\b/i);
  assert.match(readme, /read-only/i);
  assert.match(readme, /no write access/i);
  assert.doesNotMatch(readme, /OwnerMap (has|grants|uses) write access/i);
  assert.doesNotMatch(readme, /does not need Entra ID P1|do not need Entra ID P1|no P1 is needed/i);
  assert.match(readme, /Tenant default settings/);
  assert.match(readme, /Entra ID P1 or P2/);

  const sampleReport = h.analyze(sample.build());
  const sampleCheck = sampleReport.checks.tenantDefaults;
  const samplePolicy = sample.build().authorizationPolicy.policy;
  assert.equal(samplePolicy.defaultUserRolePermissions.allowedToCreateSecurityGroups, true);
  assert.equal(samplePolicy.guestUserRoleId, GUEST_ROLE_GUEST);
  assert.ok(samplePolicy.defaultUserRolePermissions.permissionGrantPoliciesAssigned.includes('ManagePermissionGrantsForSelf.microsoft-user-default-low'));
  assert.deepEqual(sampleCheck.findings.map(item => item.id).sort(), [
    'td:create-apps',
    'td:create-tenants',
    'td:guest-invites',
    'td:user-consent'
  ]);
  assert.equal(sampleCheck.findings.find(item => item.id === 'td:user-consent').title, 'Users can consent to any app');
  assert.equal(sampleCheck.findings.filter(item => item.id === 'td:user-consent').length, 1);
  assert.equal(sampleCheck.findings.some(item => item.id === 'td:guest-role'), false);
  assert.equal(sampleCheck.findings.some(item => /security group/i.test(item.title)), false);
  const sampleGroups = sampleCheck.rows.find(row => row.setting === 'Users can create security groups');
  assert.equal(sampleGroups.value, 'Any member');
  assert.equal(sampleGroups.severity, 'ok');
  const sampleGuest = sampleCheck.rows.find(row => row.setting === 'Guest directory access');
  assert.equal(sampleGuest.value, 'Default limited guest');
  assert.equal(sampleGuest.severity, 'ok');
  const sampleCsv = h.checkToCsv(sampleCheck);
  assert.match(sampleCsv, /Users can create security groups/);
  assert.match(sampleCsv, /Any member/);
  assert.match(html, /row\[column\.key\]/);

  const analyzeAt = html.indexOf('const report = OwnerMapHygiene.analyze(');
  assert.ok(analyzeAt >= 0);
  const analyzeEnd = html.indexOf('});', analyzeAt);
  assert.ok(analyzeEnd > analyzeAt);
  const analyzeCall = html.slice(analyzeAt, analyzeEnd);
  assert.match(analyzeCall, /\bauthorizationPolicy\b/);
});

test('invite values are trimmed before they are compared', () => {
  function invites(value) {
    return tenantCheck(authz({ allowInvitesFrom: value }));
  }
  ['  everyone  ', '\teveryone\n', ' EVERYONE '].forEach(value => {
    const check = invites(value);
    const finding = check.findings.find(item => item.id === 'td:guest-invites');
    assert.ok(finding, JSON.stringify(value));
    assert.equal(finding.title, 'Anyone, including guests, can invite guests');
    assert.equal(check.findings.filter(item => item.id === 'td:guest-invites').length, 1);
  });
  ['  adminsAndGuestInviters  ', '\tnone\n'].forEach(value => {
    const check = invites(value);
    assert.equal(check.findings.some(item => item.id === 'td:guest-invites'), false, JSON.stringify(value));
    assert.equal(check.rows.find(row => row.setting === 'Who can invite guests').severity, 'ok', JSON.stringify(value));
  });
  const members = invites(' \tadminsGuestInvitersAndAllMembers \n');
  assert.equal(members.findings.some(item => item.id === 'td:guest-invites'), false);
  assert.equal(members.rows.find(row => row.setting === 'Who can invite guests').value, 'Members and guest-inviter admins');
  assert.equal(members.rows.find(row => row.setting === 'Who can invite guests').severity, 'ok');
});

test('consent policy ids match the whole id after an anchored prefix', () => {
  function consent(list) {
    return tenantCheck(authz(null, { permissionGrantPoliciesAssigned: list }));
  }
  function consentFindings(list) {
    return consent(list).findings.filter(item => item.id === 'td:user-consent');
  }

  [
    'ManagePermissionGrantsForSelf.microsoft-user-default-legacy-extra',
    'ManagePermissionGrantsForSelf.microsoft-user-default-legacy2',
    'ManagePermissionGrantsForSelf.notmicrosoft-user-default-legacy',
    'notmicrosoft-user-default-legacy',
    'microsoft-user-default-legacy',
    'xmanagePermissionGrantsForSelf.microsoft-user-default-legacy',
    'prefix-managePermissionGrantsForSelf.microsoft-user-default-legacy',
    'managePermissionGrantsForSelf.microsoft-user-default-legacy.more'
  ].forEach(entry => {
    const check = consent([entry]);
    assert.equal(consentFindings([entry]).length, 0, entry);
    assert.equal(check.rows.find(row => row.setting === 'User consent to apps').severity, 'unavailable', entry);
  });

  [
    'ManagePermissionGrantsForSelf.Microsoft-User-Default-Legacy',
    'managePermissionGrantsForSelf.MICROSOFT-USER-DEFAULT-LEGACY',
    '  ManagePermissionGrantsForSelf.microsoft-user-default-legacy  '
  ].forEach(entry => {
    const findings = consentFindings([entry]);
    assert.equal(findings.length, 1, entry);
    assert.equal(findings[0].title, 'Users can consent to any app', entry);
    assert.match(findings[0].detail, /legacy policy/, entry);
  });

  const duplicates = consentFindings([
    'ManagePermissionGrantsForSelf.microsoft-user-default-legacy',
    'managePermissionGrantsForSelf.MICROSOFT-USER-DEFAULT-LEGACY',
    'ManagePermissionGrantsForSelf.microsoft-user-default-legacy'
  ]);
  assert.equal(duplicates.length, 1);
  assert.equal((duplicates[0].detail.match(/legacy policy/g) || []).length, 1);
});

test('non-string and blank consent entries are ignored', () => {
  const junk = ['', '   ', '\n\t', null, undefined, 0, false, { id: 'microsoft-user-default-legacy' }];
  const onlyJunk = tenantCheck(authz(null, { permissionGrantPoliciesAssigned: junk }));
  assert.equal(onlyJunk.findings.some(item => item.id === 'td:user-consent'), false);
  assert.equal(onlyJunk.rows.find(row => row.setting === 'User consent to apps').severity, 'unavailable');

  const withLow = tenantCheck(authz(null, {
    permissionGrantPoliciesAssigned: junk.concat('ManagePermissionGrantsForSelf.microsoft-user-default-low')
  }));
  assert.equal(withLow.findings.some(item => item.id === 'td:user-consent'), false);
  assert.equal(withLow.rows.find(row => row.setting === 'User consent to apps').severity, 'ok');
  assert.equal(withLow.rows.find(row => row.setting === 'User consent to apps').value, 'verified publishers and selected permissions');
});

test('inherited properties are not tenant-default settings', () => {
  const inherited = Object.create({
    allowInvitesFrom: 'everyone',
    guestUserRoleId: GUEST_ROLE_MEMBER,
    id: 'inherited-policy',
    toString: () => 'everyone',
    constructor: { allowInvitesFrom: 'everyone' },
    defaultUserRolePermissions: {
      allowedToCreateApps: true,
      allowedToCreateTenants: true,
      allowedToCreateSecurityGroups: true,
      permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy']
    }
  });
  const inheritedCheck = tenantCheck({ available: true, reason: 'ok', policy: inherited });
  assert.equal(inheritedCheck.findings.length, 0);
  inheritedCheck.rows.forEach(row => assert.equal(row.severity, 'unavailable', row.setting));

  const permProto = {
    allowedToCreateApps: true,
    allowedToCreateTenants: true,
    permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy']
  };
  const ownPerms = Object.create(permProto);
  ownPerms.allowedToCreateSecurityGroups = true;
  const policy = Object.create({
    allowInvitesFrom: 'everyone',
    guestUserRoleId: GUEST_ROLE_MEMBER,
    id: 'inherited-id'
  });
  policy.defaultUserRolePermissions = ownPerms;
  const mixed = tenantCheck({ available: true, reason: 'ok', policy });
  assert.equal(mixed.findings.length, 0);
  assert.equal(mixed.rows.find(row => row.setting === 'Users can register applications').severity, 'unavailable');
  assert.equal(mixed.rows.find(row => row.setting === 'Users can create tenants').severity, 'unavailable');
  assert.equal(mixed.rows.find(row => row.setting === 'User consent to apps').severity, 'unavailable');
  assert.equal(mixed.rows.find(row => row.setting === 'Who can invite guests').severity, 'unavailable');
  assert.equal(mixed.rows.find(row => row.setting === 'Guest directory access').severity, 'unavailable');
  assert.equal(mixed.rows.find(row => row.setting === 'Users can create security groups').value, 'Any member');
  assert.equal(mixed.rows.find(row => row.setting === 'Users can create security groups').severity, 'ok');
  assert.equal(mixed.findings.some(item => item.subjectId === 'inherited-id'), false);

  const nullProto = Object.create(null);
  nullProto.id = 'authorizationPolicy';
  nullProto.allowInvitesFrom = 'everyone';
  nullProto.guestUserRoleId = GUEST_ROLE_RESTRICTED;
  nullProto.defaultUserRolePermissions = Object.create(null);
  nullProto.defaultUserRolePermissions.allowedToCreateApps = false;
  nullProto.defaultUserRolePermissions.allowedToCreateTenants = false;
  nullProto.defaultUserRolePermissions.allowedToCreateSecurityGroups = true;
  nullProto.defaultUserRolePermissions.permissionGrantPoliciesAssigned = ['ManagePermissionGrantsForSelf.microsoft-user-default-low'];
  const fromNull = tenantCheck({ available: true, reason: 'ok', policy: nullProto });
  assert.deepEqual(fromNull.findings.map(item => item.id), ['td:guest-invites']);
  assert.equal(fromNull.findings[0].subjectId, 'authorizationPolicy');
});

test('an array, scalar, or collection envelope is not a readable policy', () => {
  function unreadable(policy) {
    const report = h.analyze(base({ authorizationPolicy: { available: true, reason: 'ok', policy } }));
    const check = report.checks.tenantDefaults;
    assert.equal(check.available, false);
    assert.equal(check.status, 'unavailable');
    assert.equal(check.findings.length, 0);
    assert.equal(check.rows.length, 0);
    assert.equal(check.headline, 'Tenant defaults unavailable');
    assert.notEqual(check.headline, 'No risky default in the settings Microsoft returned');
    assert.ok(report.unavailable.includes('tenantDefaults'));
    return check;
  }
  const risky = authz({
    allowInvitesFrom: 'everyone',
    guestUserRoleId: GUEST_ROLE_MEMBER
  }, {
    allowedToCreateApps: true,
    allowedToCreateTenants: true,
    permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy']
  }).policy;
  [[], ['not-a-policy'], 'authorizationPolicy', 1, true, { value: [risky] }, { value: [] }].forEach(unreadable);

  const empty = tenantCheck({ available: true, reason: 'ok', policy: {} });
  assert.equal(empty.available, true);
  assert.equal(empty.findings.length, 0);
  assert.equal(empty.rows.length > 0, true);
  empty.rows.forEach(row => assert.equal(row.severity, 'unavailable', row.setting));
  assert.match(empty.note, /not judged/);
});

test('an unavailable authorization policy produces no findings', () => {
  const risky = authz({
    allowInvitesFrom: 'everyone',
    guestUserRoleId: GUEST_ROLE_MEMBER
  }, {
    allowedToCreateApps: true,
    allowedToCreateTenants: true,
    permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy']
  }).policy;
  const report = h.analyze(base({
    groups: [{ id: 'g', displayName: 'Finance', securityEnabled: true, owners: [], members: [] }],
    authorizationPolicy: {
      available: false,
      reason: 'permission',
      message: h.unavailableMessage('tenantDefaults', 'permission'),
      policy: risky
    }
  }));
  const check = report.checks.tenantDefaults;
  assert.equal(check.available, false);
  assert.equal(check.status, 'unavailable');
  assert.equal(check.findings.length, 0);
  assert.deepEqual(check.counts, { high: 0, medium: 0, low: 0 });
  assert.ok(report.unavailable.includes('tenantDefaults'));
  assert.equal(report.checks.groups.counts.high, 1);
  assert.equal(check.stats.judged, undefined);
});

test('each tenant-default finding keeps its own subject id and steps', () => {
  const check = tenantCheck(authz({
    allowInvitesFrom: 'everyone',
    guestUserRoleId: GUEST_ROLE_MEMBER
  }, {
    allowedToCreateApps: true,
    allowedToCreateTenants: true,
    permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy']
  }));
  const found = byId(check);
  check.findings.forEach(item => {
    assert.equal(item.subjectId, 'authorizationPolicy');
    assert.ok(item.steps.length >= 3);
  });

  const apps = found['td:create-apps'].steps.join('\n');
  const tenants = found['td:create-tenants'].steps.join('\n');
  const invites = found['td:guest-invites'].steps.join('\n');
  const role = found['td:guest-role'].steps.join('\n');
  const consent = found['td:user-consent'].steps.join('\n');

  assert.match(apps, /Users can register applications/);
  assert.match(apps, /Application Developer/);
  assert.doesNotMatch(apps, /Restrict non-admin users from creating tenants|Tenant Creator|Guests can invite|Guest user access|configure-user-consent/);
  assert.match(tenants, /Restrict non-admin users from creating tenants/);
  assert.match(tenants, /Tenant Creator/);
  assert.doesNotMatch(tenants, /Application Developer|Guests can invite|Guest user access|configure-user-consent/);
  assert.match(invites, /Guests can invite/);
  assert.match(invites, /entitlement-management-external-users/);
  assert.doesNotMatch(invites, /Guest user access|Tenant Creator|Application Developer|Restrict non-admin users from creating tenants|configure-user-consent/);
  assert.match(role, /Guest user access/);
  assert.match(role, /users-restrict-guest-permissions/);
  assert.doesNotMatch(role, /Tenant Creator|Restrict non-admin users from creating tenants|Application Developer|Guests can invite|configure-user-consent/);
  assert.match(consent, /configure-user-consent/);
  assert.match(consent, /verified publisher/);
  assert.doesNotMatch(consent, /Tenant Creator|Restrict non-admin users from creating tenants|Application Developer|Guests can invite|Guest user access/);

  const missingId = tenantCheck(authz({ id: undefined, allowInvitesFrom: 'everyone' }));
  const inviteFinding = missingId.findings.find(item => item.id === 'td:guest-invites');
  assert.ok(inviteFinding);
  assert.equal(inviteFinding.subjectId, '');
});

test('guest invite values keep their own table text', () => {
  const want = {
    none: 'Nobody',
    adminsAndGuestInviters: 'Global Administrator, User Administrator, and Guest Inviter',
    adminsGuestInvitersAndAllMembers: 'Members and guest-inviter admins',
    everyone: 'Anyone, including guests'
  };
  Object.keys(want).forEach(value => {
    const check = tenantCheck(authz({ allowInvitesFrom: value }));
    const row = check.rows.find(item => item.setting === 'Who can invite guests');
    assert.equal(row.value, want[value], value);
  });
  const neutral = tenantCheck(authz({
    allowInvitesFrom: 'adminsGuestInvitersAndAllMembers',
    guestUserRoleId: GUEST_ROLE_GUEST
  }));
  assert.equal(neutral.findings.length, 0);
  assert.equal(neutral.headline, 'No flagged tenant defaults');
  assert.doesNotMatch(neutral.headline, /Microsoft|tightened|hardened/i);
  const roles = {
    [GUEST_ROLE_MEMBER]: 'Same as members',
    [GUEST_ROLE_GUEST]: 'Default limited guest',
    [GUEST_ROLE_RESTRICTED]: 'Own profile only'
  };
  Object.keys(roles).forEach(value => {
    const check = tenantCheck(authz({ guestUserRoleId: value }));
    const row = check.rows.find(item => item.setting === 'Guest directory access');
    assert.equal(row.value, roles[value], value);
  });
});

test('duplicate consent policy ids are described once', () => {
  function consent(list) {
    return tenantCheck(authz(null, { permissionGrantPoliciesAssigned: list }));
  }
  const legacy = 'ManagePermissionGrantsForSelf.microsoft-user-default-legacy';
  const duplicated = consent([legacy, legacy, legacy.toLowerCase()]);
  const row = duplicated.rows.find(item => item.setting === 'User consent to apps');
  assert.equal(duplicated.findings.filter(item => item.id === 'td:user-consent').length, 1);
  assert.equal(row.value.split('the legacy policy').length - 1, 1);
  assert.equal(duplicated.findings[0].detail.split('legacy policy').length - 1, 1);
  const safe = consent([
    'ManagePermissionGrantsForSelf.microsoft-user-default-low',
    'managePermissionGrantsForSelf.microsoft-user-default-low'
  ]);
  assert.equal(safe.findings.length, 0);
  assert.equal(
    safe.rows.find(item => item.setting === 'User consent to apps').value,
    'verified publishers and selected permissions'
  );
});

test('Learn quotes and page citations stay attached to the finding they support', () => {
  const check = tenantCheck(authz({
    allowInvitesFrom: 'everyone',
    guestUserRoleId: GUEST_ROLE_MEMBER
  }, {
    allowedToCreateApps: true,
    allowedToCreateTenants: true,
    permissionGrantPoliciesAssigned: [
      'ManagePermissionGrantsForSelf.microsoft-user-default-legacy',
      'ManagePermissionGrantsForSelf.microsoft-all-application-permissions'
    ]
  }));
  const found = byId(check);
  function sentences(item) {
    return [item.detail].concat(item.steps).flatMap(part => part.split(/(?<=\.)\s+/));
  }
  const inviteQuote = 'Allowing guests to invite other guests to your directory means that guest invites can occur outside of entitlement management. We recommend setting Guests can invite to No to only allow for properly governed invitations.';
  assert.ok(found['td:guest-invites'].detail.includes('"' + inviteQuote + '"'));
  assert.ok(found['td:guest-invites'].detail.includes('(https://learn.microsoft.com/en-us/entra/id-governance/entitlement-management-external-users)'));
  assert.match(found['td:create-apps'].detail, /^By default, all users can register applications/);
  assert.match(found['td:create-apps'].detail, /manage all aspects of applications they create/);
  assert.match(found['td:create-apps'].detail, /https:\/\/learn\.microsoft\.com\/en-us\/entra\/identity\/role-based-access-control\/delegate-app-roles/);
  assert.match(found['td:create-tenants'].detail, /https:\/\/learn\.microsoft\.com\/en-us\/entra\/fundamentals\/users-default-permissions/);
  assert.match(found['td:create-tenants'].detail, /https:\/\/learn\.microsoft\.com\/en-us\/entra\/fundamentals\/zero-trust-protect-tenants/);
  assert.match(found['td:guest-role'].detail, /https:\/\/learn\.microsoft\.com\/en-us\/entra\/identity\/users\/users-restrict-guest-permissions/);
  assert.ok(found['td:user-consent'].detail.includes('for any application (https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent).'));
  assert.ok(found['td:user-consent'].detail.includes('(https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies).'));

  const consentSentences = sentences(found['td:user-consent']);
  const doNotAllow = consentSentences.filter(sentence => sentence.includes('Do not allow user consent'));
  assert.ok(doNotAllow.length >= 1);
  doNotAllow.forEach(sentence => {
    assert.match(sentence, /delegate-app-roles/);
    assert.doesNotMatch(sentence, /configure-user-consent/);
  });
  const publisher = consentSentences.filter(sentence => sentence.includes('published by a verified publisher'));
  assert.ok(publisher.length >= 1);
  publisher.forEach(sentence => {
    assert.match(sentence, /configure-user-consent/);
    assert.doesNotMatch(sentence, /delegate-app-roles/);
    assert.doesNotMatch(sentence, /Do not allow user consent/);
  });

  check.findings.forEach(item => {
    assert.match(item.detail, /OwnerMap rates this (high|medium) because/, item.id);
    assert.doesNotMatch(item.detail + '\n' + item.steps.join('\n'), /Microsoft (recommends|warns)|increased-security/, item.id);
  });
  assert.match(check.explanation, /security groups/);
  assert.match(check.explanation, /default limited guest role/);
  assert.match(check.explanation, /not findings/);
});
