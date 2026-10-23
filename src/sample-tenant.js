/**
 * Fictional tenant used by the demo view and by unit tests.
 * Dates are fixed against 20 Oct 2026 so results do not drift.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OwnerMapSample = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const NOW = '2026-10-20T12:00:00.000Z';
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const MS = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a';
  const SKU = 'sku-business-standard';

  function user(fields) {
    return Object.assign({
      accountEnabled: true,
      userType: 'Member',
      assignedLicenses: [],
      createdDateTime: '2024-01-15T00:00:00Z'
    }, fields);
  }

  function build() {
    const users = [
      user({ id: 'u-ada', displayName: 'Ada Lovelace', userPrincipalName: 'ada@northwind.example', assignedLicenses: [{ skuId: SKU }] }),
      user({ id: 'u-grace', displayName: 'Grace Hopper', userPrincipalName: 'grace@northwind.example', assignedLicenses: [{ skuId: SKU }] }),
      user({ id: 'u-alan', displayName: 'Alan Turing', userPrincipalName: 'alan@northwind.example', createdDateTime: '2024-01-01T00:00:00Z' }),
      user({ id: 'u-linus', displayName: 'Linus Torvalds', userPrincipalName: 'linus@northwind.example' }),
      user({ id: 'u-disabled-lic', displayName: 'Old Payroll', userPrincipalName: 'payroll-old@northwind.example', accountEnabled: false, assignedLicenses: [{ skuId: SKU }] }),
      user({ id: 'u-disabled-group', displayName: 'Quinn Leaver', userPrincipalName: 'quinn@northwind.example', accountEnabled: false }),
      user({ id: 'u-disabled-clean', displayName: 'Retired Clean', userPrincipalName: 'retired@northwind.example', accountEnabled: false }),
      user({ id: 'u-guest-stale', displayName: 'Pat Partner', userPrincipalName: 'pat_partner.com#EXT#@northwind.example', userType: 'Guest', createdDateTime: '2024-06-01T00:00:00Z' }),
      user({ id: 'u-guest-fresh', displayName: 'Sam Supplier', userPrincipalName: 'sam_supplier.com#EXT#@northwind.example', userType: 'Guest' }),
      user({ id: 'u-guest-new', displayName: 'New Contractor', userPrincipalName: 'new_contractor.com#EXT#@northwind.example', userType: 'Guest', createdDateTime: '2026-10-01T00:00:00Z' }),
      user({ id: 'u-guest-old', displayName: 'Old Contractor', userPrincipalName: 'old_contractor.com#EXT#@northwind.example', userType: 'Guest', createdDateTime: '2025-01-01T00:00:00Z' }),
      user({ id: 'u-sam', displayName: 'Sam Stale', userPrincipalName: 'sam@northwind.example' }),
      user({ id: 'u-boundary', displayName: 'Bailey Recent', userPrincipalName: 'bailey@northwind.example' })
    ];

    const signInById = {
      'u-ada': { lastSignInDateTime: '2026-10-01T12:00:00Z', lastNonInteractiveSignInDateTime: '2026-10-19T12:00:00Z' },
      'u-grace': { lastSignInDateTime: '2026-01-01T12:00:00Z', lastNonInteractiveSignInDateTime: '2026-01-02T12:00:00Z' },
      'u-alan': { lastSignInDateTime: null, lastNonInteractiveSignInDateTime: null },
      'u-linus': { lastSignInDateTime: '2025-01-01T12:00:00Z', lastNonInteractiveSignInDateTime: '2026-10-19T12:00:00Z' },
      'u-disabled-lic': { lastSignInDateTime: '2024-05-01T12:00:00Z' },
      'u-disabled-group': { lastSignInDateTime: '2024-05-01T12:00:00Z' },
      'u-disabled-clean': { lastSignInDateTime: null },
      'u-guest-stale': { lastSignInDateTime: '2025-06-01T12:00:00Z' },
      'u-guest-fresh': { lastSignInDateTime: '2026-10-18T12:00:00Z' },
      'u-guest-new': { lastSignInDateTime: null, lastNonInteractiveSignInDateTime: null },
      'u-guest-old': { lastSignInDateTime: null, lastNonInteractiveSignInDateTime: null },
      'u-sam': { lastSignInDateTime: '2026-05-01T12:00:00Z' },
      'u-boundary': { lastSignInDateTime: '2026-07-23T12:00:00Z' }
    };

    const ada = { id: 'u-ada', displayName: 'Ada Lovelace', userPrincipalName: 'ada@northwind.example' };
    const linus = { id: 'u-linus', displayName: 'Linus Torvalds', userPrincipalName: 'linus@northwind.example' };

    const groups = [
      {
        id: 'g-staff',
        displayName: 'All Staff',
        description: 'Everyone who works here',
        groupTypes: [],
        mailEnabled: false,
        securityEnabled: true,
        onPremisesSyncEnabled: false,
        owners: [ada],
        members: [
          { id: 'u-ada', displayName: 'Ada Lovelace', userPrincipalName: 'ada@northwind.example', '@odata.type': '#microsoft.graph.user' },
          { id: 'u-sam', displayName: 'Sam Stale', userPrincipalName: 'sam@northwind.example', '@odata.type': '#microsoft.graph.user' },
          { id: 'u-boundary', displayName: 'Bailey Recent', userPrincipalName: 'bailey@northwind.example', '@odata.type': '#microsoft.graph.user' },
          { id: 'u-linus', displayName: 'Linus Torvalds', userPrincipalName: 'linus@northwind.example', '@odata.type': '#microsoft.graph.user' }
        ]
      },
      {
        id: 'g-finance',
        displayName: 'Finance',
        description: 'Ledger and payroll files',
        groupTypes: [],
        mailEnabled: false,
        securityEnabled: true,
        onPremisesSyncEnabled: false,
        owners: [],
        members: [
          { id: 'u-grace', displayName: 'Grace Hopper', userPrincipalName: 'grace@northwind.example', '@odata.type': '#microsoft.graph.user' },
          { id: 'u-disabled-lic', displayName: 'Old Payroll', userPrincipalName: 'payroll-old@northwind.example', '@odata.type': '#microsoft.graph.user' }
        ]
      },
      {
        id: 'g-vpn',
        displayName: 'VPN Users',
        description: 'Synced from the office domain',
        groupTypes: [],
        mailEnabled: false,
        securityEnabled: true,
        onPremisesSyncEnabled: true,
        owners: [],
        members: [
          { id: 'u-disabled-group', displayName: 'Quinn Leaver', userPrincipalName: 'quinn@northwind.example', '@odata.type': '#microsoft.graph.user' }
        ]
      },
      {
        id: 'g-team',
        displayName: 'Team Social',
        description: 'Company team',
        groupTypes: ['Unified'],
        mailEnabled: true,
        securityEnabled: false,
        onPremisesSyncEnabled: false,
        owners: [linus],
        members: [
          { id: 'u-ada', displayName: 'Ada Lovelace', userPrincipalName: 'ada@northwind.example', '@odata.type': '#microsoft.graph.user' }
        ]
      },
      {
        id: 'g-news',
        displayName: 'Newsletter',
        description: 'Company announcements',
        groupTypes: [],
        mailEnabled: true,
        securityEnabled: false,
        onPremisesSyncEnabled: false,
        owners: [ada],
        members: []
      }
    ];

    const applications = [
      {
        id: 'app-payroll',
        appId: 'aaaaaaa1-0000-0000-0000-000000000001',
        displayName: 'Payroll Connector',
        createdDateTime: '2023-04-01T00:00:00Z',
        passwordCredentials: [{ keyId: 'cred-old', displayName: 'Payroll secret', endDateTime: '2026-01-01T00:00:00Z' }],
        keyCredentials: [],
        owners: []
      },
      {
        id: 'app-intranet',
        appId: 'aaaaaaa2-0000-0000-0000-000000000002',
        displayName: 'Intranet',
        createdDateTime: '2025-01-01T00:00:00Z',
        passwordCredentials: [],
        keyCredentials: [{ keyId: 'cred-soon', displayName: 'Intranet cert', endDateTime: '2026-10-30T00:00:00Z' }],
        owners: [ada]
      },
      {
        id: 'app-healthy',
        appId: 'aaaaaaa3-0000-0000-0000-000000000003',
        displayName: 'Time Sheets',
        createdDateTime: '2025-06-01T00:00:00Z',
        passwordCredentials: [{ keyId: 'cred-ok', displayName: 'Timesheet secret', endDateTime: '2027-10-20T00:00:00Z' }],
        keyCredentials: [],
        owners: [linus]
      }
    ];

    const servicePrincipals = [
      {
        id: 'sp-payroll',
        appId: 'aaaaaaa1-0000-0000-0000-000000000001',
        displayName: 'Payroll Connector',
        servicePrincipalType: 'Application',
        accountEnabled: true,
        appOwnerOrganizationId: TENANT,
        passwordCredentials: [],
        keyCredentials: [],
        owners: []
      },
      {
        id: 'sp-third',
        appId: 'bbbbbbb1-0000-0000-0000-000000000009',
        displayName: 'Contoso Sync',
        servicePrincipalType: 'Application',
        accountEnabled: true,
        appOwnerOrganizationId: '22222222-2222-2222-2222-222222222222',
        passwordCredentials: [{ keyId: 'cred-third', displayName: 'Sync secret', endDateTime: '2025-12-01T00:00:00Z' }],
        keyCredentials: [],
        owners: []
      },
      {
        id: 'sp-teams',
        appId: 'ccccccc1-0000-0000-0000-000000000010',
        displayName: 'Microsoft Teams',
        servicePrincipalType: 'Application',
        accountEnabled: true,
        appOwnerOrganizationId: MS,
        passwordCredentials: [{ keyId: 'cred-teams', displayName: 'Teams', endDateTime: '2020-01-01T00:00:00Z' }],
        keyCredentials: [],
        owners: []
      },
      {
        id: 'sp-mi',
        appId: 'ddddddd1-0000-0000-0000-000000000011',
        displayName: 'vm-backup',
        servicePrincipalType: 'ManagedIdentity',
        accountEnabled: true,
        appOwnerOrganizationId: TENANT,
        passwordCredentials: [],
        keyCredentials: [],
        owners: []
      },
      {
        id: 'sp-graph',
        appId: '00000003-0000-0000-c000-000000000000',
        displayName: 'Microsoft Graph',
        servicePrincipalType: 'Application',
        appOwnerOrganizationId: MS,
        owners: []
      }
    ];

    return {
      now: NOW,
      tenantId: TENANT,
      users,
      signIn: { available: true, reason: 'ok', byId: signInById },
      groups,
      applications,
      servicePrincipals,
      applicationsAvailable: true,
      graphAppRoles: [
        { id: 'role-rw', value: 'Directory.ReadWrite.All', allowedMemberTypes: ['Application'] },
        { id: 'role-r', value: 'Directory.Read.All', allowedMemberTypes: ['Application'] }
      ],
      appRoleAssignedTo: [
        { principalId: 'sp-payroll', principalDisplayName: 'Payroll Connector', appRoleId: 'role-rw' },
        { principalId: 'sp-third', principalDisplayName: 'Contoso Sync', appRoleId: 'role-r' },
        { principalId: 'sp-teams', principalDisplayName: 'Microsoft Teams', appRoleId: 'role-rw' }
      ],
      subscribedSkus: [
        {
          skuId: SKU,
          skuPartNumber: 'O365_BUSINESS_PREMIUM',
          consumedUnits: 8,
          prepaidUnits: { enabled: 10, suspended: 0, warning: 0 }
        },
        {
          skuId: 'sku-powerbi',
          skuPartNumber: 'POWER_BI_STANDARD',
          consumedUnits: 1,
          prepaidUnits: { enabled: 1000000, suspended: 0, warning: 0 }
        }
      ],
      licensesAvailable: true,
      conditionalAccess: {
        available: true,
        reason: 'ok',
        policies: [
          {
            id: 'pol-mfa-report',
            displayName: 'Require MFA for all users',
            state: 'enabledForReportingButNotEnforced',
            conditions: {
              users: {
                includeUsers: ['All'],
                excludeUsers: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'],
                includeGroups: [],
                excludeGroups: [],
                excludeRoles: []
              },
              applications: { includeApplications: ['All'] },
              clientAppTypes: ['all']
            },
            grantControls: { operator: 'OR', builtInControls: ['mfa'] }
          },
          {
            id: 'pol-legacy-off',
            displayName: 'Block legacy authentication',
            state: 'disabled',
            conditions: {
              users: { includeUsers: ['All'], excludeUsers: [], excludeGroups: [], excludeRoles: [] },
              applications: { includeApplications: ['All'] },
              clientAppTypes: ['exchangeActiveSync', 'other']
            },
            grantControls: { operator: 'OR', builtInControls: ['block'] }
          }
        ]
      },
      securityDefaults: { known: true, enabled: false },
      authorizationPolicy: {
        available: true,
        reason: 'ok',
        policy: {
          id: 'authorizationPolicy',
          allowInvitesFrom: 'everyone',
          guestUserRoleId: '10dae51f-b6af-4016-8d66-8c2a99b929b3',
          defaultUserRolePermissions: {
            allowedToCreateApps: true,
            allowedToCreateTenants: true,
            allowedToCreateSecurityGroups: true,
            allowedToReadOtherUsers: true,
            permissionGrantPoliciesAssigned: [
              'ManagePermissionGrantsForSelf.microsoft-user-default-legacy'
            ]
          }
        }
      }
    };
  }

  return { NOW, TENANT, build };
});
