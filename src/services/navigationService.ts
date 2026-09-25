import { ActiveTab } from '../components/MobileBottomNav';

export interface NavEntry {
  tab: ActiveTab;
  subTab?: string;
  detailId?: string | null;
  params?: Record<string, any>;
  title?: string;
}

// Bounded history stack (capped at 25 entries to guarantee zero memory leaks)
const MAX_HISTORY_DEPTH = 25;

let historyStack: NavEntry[] = [
  { tab: 'dashboard', title: 'ড্যাশবোর্ড' }
];
let currentIndex = 0;

type NavSubscriber = (current: NavEntry, canBack: boolean) => void;
const subscribers = new Set<NavSubscriber>();

type DirtyChecker = () => boolean;
const dirtyCheckers = new Set<DirtyChecker>();

/**
 * Register an unsaved changes dirty checker.
 * Returns an unregister cleanup function.
 */
export function registerUnsavedChecker(checker: DirtyChecker): () => void {
  dirtyCheckers.add(checker);
  return () => {
    dirtyCheckers.delete(checker);
  };
}

/**
 * Check if any registered form currently has unsaved changes.
 */
export function hasUnsavedChanges(): boolean {
  for (const checker of dirtyCheckers) {
    try {
      if (checker()) return true;
    } catch {}
  }
  return false;
}

/**
 * Prompt user to confirm discarding unsaved changes.
 * Returns true if user allows navigating away, false to stay.
 */
export function confirmDiscardUnsaved(): boolean {
  if (!hasUnsavedChanges()) return true;
  return window.confirm(
    'আপনার কিছু অসংরক্ষিত তথ্য রয়েছে। আপনি কি নিশ্চিত যে আপনি পরিবর্তনগুলো বাতিল করে ফিরে যেতে চান?\n(You have unsaved changes. Are you sure you want to discard them and go back?)'
  );
}

export function getCurrentNav(): NavEntry {
  return historyStack[currentIndex] || { tab: 'dashboard' };
}

export function canGoBack(): boolean {
  return currentIndex > 0;
}

export function getHistoryLength(): number {
  return currentIndex;
}

function notifySubscribers() {
  const current = getCurrentNav();
  const canBack = canGoBack();
  subscribers.forEach((cb) => {
    try {
      cb(current, canBack);
    } catch (e) {
      console.error('Nav subscriber error:', e);
    }
  });
}

/**
 * Push a new navigation entry onto the stack.
 * Automatically deduplicates if identical to the current entry.
 */
export function pushNav(entry: NavEntry): void {
  const current = getCurrentNav();
  if (
    current.tab === entry.tab &&
    current.subTab === entry.subTab &&
    current.detailId === entry.detailId
  ) {
    // Same location, update params if provided
    if (entry.params) {
      current.params = { ...current.params, ...entry.params };
    }
    return;
  }

  // If we branched from middle of history, truncate forward entries
  historyStack = historyStack.slice(0, currentIndex + 1);

  // Push new entry
  historyStack.push({ ...entry });

  // Cap history to MAX_HISTORY_DEPTH
  if (historyStack.length > MAX_HISTORY_DEPTH) {
    historyStack = historyStack.slice(historyStack.length - MAX_HISTORY_DEPTH);
  }

  currentIndex = historyStack.length - 1;

  // Sync with browser history state
  try {
    if (typeof window !== 'undefined' && window.history) {
      window.history.pushState({ agroNav: true, depth: currentIndex }, '', window.location.href);
    }
  } catch {}

  notifySubscribers();
}

/**
 * Update current navigation location without adding a new history entry.
 */
export function replaceNav(update: Partial<NavEntry>): void {
  if (!historyStack[currentIndex]) return;
  historyStack[currentIndex] = {
    ...historyStack[currentIndex],
    ...update
  };
  notifySubscribers();
}

let isInternalPopping = false;

/**
 * Go back to the previous navigation entry.
 * Checks for unsaved changes before popping.
 * Returns the restored entry, or null if cannot go back or cancelled.
 */
export function goBack(): NavEntry | null {
  if (!canGoBack()) return null;

  if (!confirmDiscardUnsaved()) {
    return null;
  }

  const current = historyStack[currentIndex];
  currentIndex -= 1;
  const previous = historyStack[currentIndex];

  // If returning from a detail view to its parent list in the same tab/subTab,
  // preserve lightweight query/filter params that were active
  if (
    current?.detailId &&
    previous &&
    !previous.detailId &&
    current.tab === previous.tab &&
    current.subTab === previous.subTab &&
    current.params
  ) {
    previous.params = { ...previous.params, ...current.params };
  }

  // Synchronize browser history stack
  try {
    if (typeof window !== 'undefined' && window.history && window.history.state?.agroNav) {
      isInternalPopping = true;
      window.history.back();
    }
  } catch {}

  notifySubscribers();
  return previous;
}

/**
 * Reset navigation back to root dashboard.
 */
export function resetToDashboard(): void {
  historyStack = [{ tab: 'dashboard', title: 'ড্যাশবোর্ড' }];
  currentIndex = 0;
  notifySubscribers();
}

/**
 * Subscribe to navigation changes.
 * Returns unsubscribe cleanup function.
 */
export function subscribeToNavigation(callback: NavSubscriber): () => void {
  subscribers.add(callback);
  // Immediately call with current state
  callback(getCurrentNav(), canGoBack());
  return () => {
    subscribers.delete(callback);
  };
}

// Initialize popstate listener for device/browser Back button
if (typeof window !== 'undefined') {
  // Push initial base state if needed
  try {
    if (window.history && !window.history.state?.agroNav) {
      window.history.replaceState({ agroNav: true, depth: 0 }, '', window.location.href);
    }
  } catch {}

  window.addEventListener('popstate', (e) => {
    if (isInternalPopping) {
      isInternalPopping = false;
      return;
    }

    if (!canGoBack()) return;

    if (!confirmDiscardUnsaved()) {
      // Re-push state to prevent browser from moving back
      try {
        window.history.pushState({ agroNav: true, depth: currentIndex }, '', window.location.href);
      } catch {}
      return;
    }

    const current = historyStack[currentIndex];
    if (e.state && typeof e.state.depth === 'number') {
      const targetIndex = Math.max(0, Math.min(e.state.depth, historyStack.length - 1));
      currentIndex = targetIndex;
    } else {
      currentIndex = Math.max(0, currentIndex - 1);
    }
    const previous = historyStack[currentIndex];

    if (
      current?.detailId &&
      previous &&
      !previous.detailId &&
      current.tab === previous.tab &&
      current.subTab === previous.subTab &&
      current.params
    ) {
      previous.params = { ...previous.params, ...current.params };
    }

    notifySubscribers();
  });
}
