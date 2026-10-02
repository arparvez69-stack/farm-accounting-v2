/**
 * Canonical test fixtures for explicit test setup.
 * Tests must use explicit test fixtures/mocks rather than production bypass conditions.
 */

export const MOCK_FINALIZED_VALUATION_FIXTURE = {
  id: 'val_fixture_canonical',
  status: 'FINALIZED' as const,
  reconciliationStatus: 'PASS' as const,
  resultingNetBusinessValue: 1000000,
  preMoneyValuation: 1000000,
  postMoneyValuation: 1100000,
  valuationDate: '2026-01-01'
};

export const MOCK_FINALIZED_ADMISSION_RECORD_FIXTURE = {
  id: 'adm_fixture_canonical',
  status: 'ADMITTED' as const,
  stage: 'ADMISSION' as const,
  isAdmitted: true,
  valuation: {
    status: 'FINALIZED' as const,
    isFinalized: true,
    preMoneyValuation: 1000000,
    postMoneyValuation: 1100000
  }
};
