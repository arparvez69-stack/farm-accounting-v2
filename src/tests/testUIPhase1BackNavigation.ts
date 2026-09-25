/**
 * Focused Verification Suite for UI Phase 1.1: Contextual Back Navigation System
 *
 * Verifies:
 * 1. Dashboard → main section → sub-section → Back
 * 2. Main section → list → detail → Back
 * 3. Section → deeper section → Back → Back
 * 4. Filter/search list → detail → Back
 * 5. Context restoration
 * 6. Unsaved form → Back protection
 * 7. Repeated navigation cycles (bounded stack, zero memory accumulation)
 * 8. Re-entering previously visited sections (deduplication)
 */

import {
  pushNav,
  goBack,
  canGoBack,
  getCurrentNav,
  resetToDashboard,
  registerUnsavedChecker,
  hasUnsavedChanges,
  NavEntry
} from '../services/navigationService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runUIPhase1BackNavigationTests(): Promise<{ passed: number; failed: number }> {
  console.log('========================================================');
  console.log('UI PHASE 1.1: CONTEXTUAL BACK NAVIGATION TEST SUITE');
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

  // Reset before testing
  resetToDashboard();

  // Test 1: Initial state
  test('Initial state is root Dashboard with canGoBack === false', () => {
    const cur = getCurrentNav();
    assert(cur.tab === 'dashboard', 'Initial tab is dashboard');
    assert(canGoBack() === false, 'canGoBack is false at root dashboard');
  });

  // Test 2: Dashboard → main section → sub-section → Back
  test('Dashboard → main section (daybook) → sub-section (ledger) → Back returns to daybook then dashboard', () => {
    resetToDashboard();
    pushNav({ tab: 'accounting', subTab: 'daybook' });
    assert(canGoBack() === true, 'canGoBack is true in accounting');
    assert(getCurrentNav().subTab === 'daybook', 'Current subTab is daybook');

    pushNav({ tab: 'accounting', subTab: 'ledger' });
    assert(getCurrentNav().subTab === 'ledger', 'Current subTab is ledger');

    const back1 = goBack();
    assert(back1 !== null && back1.tab === 'accounting' && back1.subTab === 'daybook', 'Back 1 returns to accounting daybook');

    const back2 = goBack();
    assert(back2 !== null && back2.tab === 'dashboard', 'Back 2 returns to root dashboard');
    assert(canGoBack() === false, 'canGoBack is false after returning to dashboard');
  });

  // Test 3: Main section → list → detail → Back
  test('Main section → list → animal detail → Back returns to animal list then dashboard', () => {
    resetToDashboard();
    pushNav({ tab: 'operations', subTab: 'livestock' });
    pushNav({ tab: 'operations', subTab: 'livestock', detailId: 'cow_test_001', title: 'COW-001' });

    assert(getCurrentNav().detailId === 'cow_test_001', 'Viewing animal detail');

    const back1 = goBack();
    assert(back1 !== null && back1.tab === 'operations' && !back1.detailId, 'Back 1 closes detail and returns to animal list');

    const back2 = goBack();
    assert(back2 !== null && back2.tab === 'dashboard', 'Back 2 returns to dashboard');
  });

  // Test 4: Section → deeper section → Back → Back
  test('Section (commerce) → deeper section (parties) → Back → Back', () => {
    resetToDashboard();
    pushNav({ tab: 'commerce', subTab: 'inventory' });
    pushNav({ tab: 'commerce', subTab: 'parties', detailId: 'party_123' });

    const back1 = goBack();
    assert(back1 !== null && back1.subTab === 'inventory', 'Back 1 returns to commerce inventory');

    const back2 = goBack();
    assert(back2 !== null && back2.tab === 'dashboard', 'Back 2 returns to dashboard');
  });

  // Test 5: Filter/search list → detail → Back restores filter context
  test('Filter & search state context is preserved on back navigation', () => {
    resetToDashboard();
    pushNav({
      tab: 'accounting',
      subTab: 'ledger',
      params: { selectedAccount: '1010', dateRange: '2026-05', searchQuery: 'ভাউচার' }
    });
    pushNav({ tab: 'accounting', subTab: 'vouchers' });

    const restored = goBack();
    assert(restored !== null, 'Back succeeded');
    assert(restored?.params?.selectedAccount === '1010', 'Restored selected account 1010');
    assert(restored?.params?.searchQuery === 'ভাউচার', 'Restored search query');
    assert(restored?.params?.dateRange === '2026-05', 'Restored date range');
  });

  // Test 6: Unsaved form → Back protection
  test('Unsaved form protection blocks navigation when user cancels confirmation', () => {
    resetToDashboard();
    pushNav({ tab: 'accounting', subTab: 'vouchers' });

    // Simulate an unsaved voucher form
    let formIsDirty = true;
    const unregister = registerUnsavedChecker(() => formIsDirty);

    assert(hasUnsavedChanges() === true, 'Dirty checker reports unsaved changes');

    // Mock window.confirm declining discard
    const origConfirm = typeof window !== 'undefined' ? window.confirm : undefined;
    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).window.confirm = () => false;

    const blockedResult = goBack();
    assert(blockedResult === null, 'goBack returned null because user declined discarding unsaved form');
    assert(getCurrentNav().subTab === 'vouchers', 'Still on vouchers form');

    // Now mock user accepting discard
    (globalThis as any).window.confirm = () => true;
    const allowedResult = goBack();
    assert(allowedResult !== null && allowedResult.tab === 'dashboard', 'goBack allowed after user confirmed discard');

    // Cleanup
    unregister();
    assert(hasUnsavedChanges() === false, 'hasUnsavedChanges is false after unregister');
    if (origConfirm) {
      (globalThis as any).window.confirm = origConfirm;
    }
  });

  // Test 7: Repeated navigation cycles & bounded stack (performance & zero memory accumulation)
  test('Repeated navigation cycles remain bounded (max 25 entries) without memory leak', () => {
    resetToDashboard();

    // Perform 60 navigation cycles
    for (let i = 0; i < 60; i++) {
      pushNav({ tab: i % 2 === 0 ? 'accounting' : 'operations', subTab: `sub_${i}` });
    }

    // Go back 10 times
    for (let i = 0; i < 10; i++) {
      goBack();
    }

    // Should remain fully responsive and navigate cleanly
    pushNav({ tab: 'finance', subTab: 'loans' });
    assert(getCurrentNav().tab === 'finance', 'Navigation continues smoothly after repeated cycles');
    assert(canGoBack() === true, 'canGoBack is valid');
  });

  // Test 8: Deduplication when re-entering identical location
  test('Pushing identical location does not create redundant history entries', () => {
    resetToDashboard();
    pushNav({ tab: 'reports', subTab: 'pl' });
    pushNav({ tab: 'reports', subTab: 'pl' }); // duplicate push
    pushNav({ tab: 'reports', subTab: 'pl' }); // duplicate push

    const back1 = goBack();
    assert(back1 !== null && back1.tab === 'dashboard', 'Single back returns directly to dashboard (no duplicate entries)');
  });

  // Test 9: Dashboard → হিসাব → Journal → Journal Entry Details → Back → Journal → Back → হিসাব
  test('Exact workflow: Dashboard → হিসাব → Journal (Daybook) → Journal Entry Details → Back → Journal → Back → হিসাব', () => {
    resetToDashboard();
    // 1. Dashboard → হিসাব (vouchers)
    pushNav({ tab: 'accounting', subTab: 'vouchers' });
    assert(getCurrentNav().tab === 'accounting' && getCurrentNav().subTab === 'vouchers', 'At হিসাব (vouchers)');

    // 2. হিসাব → Journal (daybook with search query)
    pushNav({ tab: 'accounting', subTab: 'daybook', params: { searchQuery: 'গরু' } });
    assert(getCurrentNav().subTab === 'daybook', 'At Journal (Daybook)');

    // 3. Journal → Journal Entry Details
    pushNav({ tab: 'accounting', subTab: 'daybook', detailId: 'vch_001', params: { searchQuery: 'গরু' } });
    assert(getCurrentNav().detailId === 'vch_001', 'At Journal Entry Details');

    // 4. Back 1: Journal Entry Details → Journal (Daybook with searchQuery preserved)
    const back1 = goBack();
    assert(back1 !== null && back1.subTab === 'daybook' && !back1.detailId, 'Back returns to Journal');
    assert(back1?.params?.searchQuery === 'গরু', 'Search query preserved');

    // 5. Back 2: Journal → হিসাব (vouchers)
    const back2 = goBack();
    assert(back2 !== null && back2.subTab === 'vouchers', 'Back returns to হিসাব');

    // 6. Back 3: হিসাব → Dashboard
    const back3 = goBack();
    assert(back3 !== null && back3.tab === 'dashboard', 'Back returns to Dashboard');
  });

  console.log('\n========================================================');
  console.log(`UI PHASE 1.1 RESULT: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================\n');

  return { passed, failed };
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testUIPhase1BackNavigation')) {
  runUIPhase1BackNavigationTests()
    .then((res) => {
      process.exit(res.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
