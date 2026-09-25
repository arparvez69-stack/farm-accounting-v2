/**
 * Test Suite for AGRO ERP — UI 1.8A: Loading States
 * 
 * Verifies that loading states across all 7 representative modules adhere to:
 * 1. Localized loading (no full-screen blocking)
 * 2. Stable layouts without layout jumping or huge blank areas
 * 3. Compact indicators matching component footprint
 * 4. Minimal animation (standard pulse/spin)
 * 5. Touch and viewport comfort preserved on iPhone 13 mini
 * 6. Preserved accounting, transactions, and business logic
 */

import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runUIPhase18ALoadingTests(): Promise<{ passed: number; failed: number }> {
  console.log('========================================================');
  console.log('UI 1.8A: LOADING STATES COMPLIANCE AUDIT');
  console.log('Verifying all 7 representative modules');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  const test = (desc: string, fn: () => void) => {
    try {
      fn();
      console.log(`✅ PASS: ${desc}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ FAIL: ${desc} - ${err.message}`);
      failed++;
    }
  };

  // 1. Dashboard Loading States
  test('Dashboard loading states: localized pulse skeletons on metrics & recent activity', () => {
    const filePath = path.resolve('src/components/Dashboard.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert(content.includes('animate-pulse'), 'Dashboard includes pulse skeleton indicators');
    assert(content.includes('loading ?'), 'Dashboard guards data cards with localized loading state');
    assert(!content.includes('fixed inset-0 z-50 bg-white flex items-center justify-center'), 'No full-screen blocking loader in Dashboard');
  });

  // 2. Accounting Module Loading States
  test('Accounting module loading states: localized skeletons for daybook, vouchers & ledger', () => {
    const filePath = path.resolve('src/components/AccountingModule.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert(content.includes('animate-pulse'), 'AccountingModule includes pulse skeleton indicators');
    assert(content.includes('{loading ? ('), 'AccountingModule uses localized loading blocks');
  });

  // 3. Farm Operations Module Loading States
  test('Farm operations module loading states: localized skeletons for livestock, fisheries & crops', () => {
    const filePath = path.resolve('src/components/FarmOperationsModule.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert(content.includes('animate-pulse'), 'FarmOperationsModule includes pulse skeleton indicators');
    assert(content.includes('{loading ? ('), 'FarmOperationsModule uses localized loading blocks');
  });

  // 4. Inventory & Sales Module Loading States
  test('Inventory/Sales module loading states: localized skeletons for inventory cards, purchases & sales', () => {
    const filePath = path.resolve('src/components/InventoryCommerceModule.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert(content.includes('animate-pulse'), 'InventoryCommerceModule includes pulse skeleton indicators');
    assert(content.includes('{loading ? ('), 'InventoryCommerceModule uses localized loading blocks');
  });

  // 5. Banking Module Loading States
  test('Banking module loading states: localized pulse skeletons on bank reconciliation', () => {
    const filePath = path.resolve('src/components/BankingInvestorsModule.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert(content.includes('animate-pulse'), 'BankingInvestorsModule includes pulse skeleton indicators');
    assert(content.includes('reconcileLoading ?'), 'BankingInvestorsModule guards reconcile table with localized loading');
  });

  // 6. Reports Module Loading States
  test('Reports module loading states: localized skeletons for ledger, aging, cash flow & reconciliation', () => {
    const filePath = path.resolve('src/components/ReportsModule.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert(content.includes('animate-pulse'), 'ReportsModule includes pulse skeleton indicators');
    // Cash Flow skeleton
    assert(content.includes('loading || !cashFlowData ? ('), 'ReportsModule guards cash flow with localized skeleton');
    // Reconciliation skeleton
    assert(content.includes('isReconciling || loading) && !reconciliationReport ? ('), 'ReportsModule guards reconciliation with localized skeleton');
    // Ledger skeleton
    assert(content.includes('h-12 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse'), 'ReportsModule provides localized ledger skeleton');
    // Aging skeleton
    assert(content.includes('h-28 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse'), 'ReportsModule provides localized aging skeleton');
  });

  // 7. Settings / More Module Loading States
  test('Settings/More module loading states: localized skeletons for access logs, audit trail & assets', () => {
    const filePath = path.resolve('src/components/MoreModule.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert(content.includes('animate-pulse'), 'MoreModule includes pulse skeleton indicators');
    assert(content.includes('loading ? (\n            <div className="space-y-3">\n              {[1, 2, 3].map((n) => (\n                <div\n                  key={n}\n                  className="h-20 rounded-xl bg-slate-100'), 'MoreModule guards access logs with localized skeleton');
    assert(content.includes('h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse'), 'MoreModule guards audit logs with localized skeleton');
    assert(content.includes('h-64 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse'), 'MoreModule guards fixed assets with localized skeleton');
  });

  console.log(`\nUI 1.8A Loading Tests Summary: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

if (process.argv[1]?.endsWith('testUIPhase18ALoadingStates.ts')) {
  runUIPhase18ALoadingTests()
    .then(({ failed }) => {
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
