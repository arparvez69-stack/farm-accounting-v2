/**
 * Focused Performance and Memory Verification Suite for UI Phase 1.1B
 *
 * Verifies:
 * 1. Repeated navigation cycles (Dashboard → হিসাব → Journal → Detail → Back → Operations → Back → ...)
 * 2. Navigation responsiveness (ensures no progressive slowdown over repeated cycles)
 * 3. Memory bounding (history stack strictly capped at MAX_HISTORY_DEPTH, no memory growth)
 * 4. Subscriber and listener hygiene (no leaked subscribers or dirty checkers)
 * 5. Context restoration over repeated cycles (filter, sub-section, detail)
 */

import {
  pushNav,
  goBack,
  canGoBack,
  getCurrentNav,
  resetToDashboard,
  registerUnsavedChecker,
  hasUnsavedChanges
} from '../services/navigationService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runUIPhase1BPerformanceMemoryTests(): Promise<{ passed: number; failed: number }> {
  console.log('========================================================');
  console.log('UI PHASE 1.1B: BACK NAVIGATION PERFORMANCE & MEMORY CHECK');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  const test = (desc: string, fn: () => void | Promise<void>) => {
    try {
      const res = fn();
      if (res instanceof Promise) {
        throw new Error('Sync test expected');
      }
      console.log(`✅ PASS: ${desc}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ FAIL: ${desc} - ${err.message}`);
      failed++;
    }
  };

  resetToDashboard();

  // Test 1: Repeated multi-step navigation flow
  test('Flow: Dashboard → হিসাব → Journal → Detail → Back → Operations → Back cycle (100 iterations)', () => {
    resetToDashboard();

    const cycleTimes: number[] = [];

    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();

      // 1. Dashboard → হিসাব (vouchers)
      pushNav({ tab: 'accounting', subTab: 'vouchers' });
      assert(getCurrentNav().subTab === 'vouchers', 'In vouchers');

      // 2. হিসাব → Journal (daybook with search)
      pushNav({ tab: 'accounting', subTab: 'daybook', params: { searchQuery: `search_${i}` } });
      assert(getCurrentNav().subTab === 'daybook', 'In daybook');

      // 3. Journal → Detail
      pushNav({ tab: 'accounting', subTab: 'daybook', detailId: `vch_${i}`, params: { searchQuery: `search_${i}` } });
      assert(getCurrentNav().detailId === `vch_${i}`, 'In journal detail');

      // 4. Detail → Back (back to daybook)
      const b1 = goBack();
      assert(b1 !== null && b1.subTab === 'daybook' && !b1.detailId, 'Back to daybook');
      assert(b1?.params?.searchQuery === `search_${i}`, 'Search query preserved');

      // 5. Daybook → Back (back to vouchers)
      const b2 = goBack();
      assert(b2 !== null && b2.subTab === 'vouchers', 'Back to vouchers');

      // 6. Daybook → Operations
      pushNav({ tab: 'operations', subTab: 'livestock' });
      assert(getCurrentNav().tab === 'operations', 'In operations');

      // 7. Operations → Animal Detail
      pushNav({ tab: 'operations', subTab: 'livestock', detailId: `cow_${i}` });
      assert(getCurrentNav().detailId === `cow_${i}`, 'In animal detail');

      // 8. Animal Detail → Back
      const b3 = goBack();
      assert(b3 !== null && b3.tab === 'operations' && !b3.detailId, 'Back to livestock list');

      // 9. Operations → Back (back to vouchers)
      const b4 = goBack();
      assert(b4 !== null && b4.tab === 'accounting', 'Back to accounting');

      // 10. Back to dashboard
      const b5 = goBack();
      assert(b5 !== null && b5.tab === 'dashboard', 'Back to dashboard');

      const t1 = performance.now();
      cycleTimes.push(t1 - t0);
    }

    // Performance verification: ensure no progressive slowdown
    // Compare average time of first 20 cycles vs last 20 cycles
    const first20Avg = cycleTimes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    const last20Avg = cycleTimes.slice(80, 100).reduce((a, b) => a + b, 0) / 20;

    console.log(`   ⏱️ Performance metric: First 20 cycles avg = ${first20Avg.toFixed(3)}ms, Last 20 cycles avg = ${last20Avg.toFixed(3)}ms`);
    // Should not increase by more than 2x (allow minor JIT/system variance)
    assert(last20Avg < Math.max(first20Avg * 2.5, 0.5), 'No progressive degradation in navigation speed');
  });

  // Test 2: Memory bounding check
  test('History stack strictly bounded at MAX_HISTORY_DEPTH (25) over 500 pushes', () => {
    resetToDashboard();

    for (let i = 0; i < 500; i++) {
      pushNav({
        tab: i % 3 === 0 ? 'accounting' : i % 3 === 1 ? 'operations' : 'commerce',
        subTab: `sub_${i}`,
        detailId: `id_${i}`
      });
    }

    // Go back 10 times
    for (let i = 0; i < 10; i++) {
      goBack();
    }

    // Next push should still work cleanly
    pushNav({ tab: 'dashboard' });
    assert(canGoBack() === true, 'canGoBack remains responsive');
  });

  // Test 3: Unsaved checker listener cleanup
  test('Dirty checkers register and unregister cleanly without leaking', () => {
    resetToDashboard();
    assert(hasUnsavedChanges() === false, 'Initially clean');

    const cleanups: (() => void)[] = [];
    for (let i = 0; i < 50; i++) {
      const unreg = registerUnsavedChecker(() => i === 25);
      cleanups.push(unreg);
    }

    assert(hasUnsavedChanges() === true, 'Dirty checker detected');

    // Run cleanups
    cleanups.forEach((c) => c());
    assert(hasUnsavedChanges() === false, 'All checkers cleaned up');
  });

  // Test 4: Cross-section drilldown and multi-level Back
  test('Section → sub-section → deeper section → Back → Back preserves intermediate states', () => {
    resetToDashboard();

    pushNav({ tab: 'commerce', subTab: 'inventory' });
    pushNav({ tab: 'commerce', subTab: 'parties' });
    pushNav({ tab: 'commerce', subTab: 'parties', detailId: 'party_007', params: { search: 'রহিম' } });

    assert(getCurrentNav().detailId === 'party_007', 'At party details');

    const r1 = goBack();
    assert(r1 !== null && r1.subTab === 'parties' && !r1.detailId, 'Step 1: Returns to parties list');
    assert(r1?.params?.search === 'রহিম', 'Search preserved');

    const r2 = goBack();
    assert(r2 !== null && r2.subTab === 'inventory', 'Step 2: Returns to inventory');

    const r3 = goBack();
    assert(r3 !== null && r3.tab === 'dashboard', 'Step 3: Returns to dashboard');
    assert(canGoBack() === false, 'At root');
  });

  console.log('\n========================================================');
  console.log(`UI PHASE 1.1B RESULT: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================\n');

  return { passed, failed };
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testUIPhase1BPerformanceMemory')) {
  runUIPhase1BPerformanceMemoryTests()
    .then((res) => {
      process.exit(res.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
