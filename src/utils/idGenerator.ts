import type { Table } from 'dexie';

/**
 * Reliable Collision-Resistant ID and Transaction Reference Generator
 * Agro ERP - Major Fix V1
 */

let counter = 0;

function getRandomSuffix(len = 6): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(Math.ceil(len / 2));
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
    }
  } catch (e) {}
  return Math.random().toString(36).substring(2, 2 + len);
}

/**
 * Generates a collision-resistant UUID / unique record ID
 */
export function generateUniqueId(prefix?: string): string {
  let base: string;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      base = crypto.randomUUID();
    } else {
      counter = (counter + 1) % 10000;
      base = `${Date.now()}-${counter.toString().padStart(4, '0')}-${getRandomSuffix(8)}`;
    }
  } catch (e) {
    counter = (counter + 1) % 10000;
    base = `${Date.now()}-${counter.toString().padStart(4, '0')}-${getRandomSuffix(8)}`;
  }

  return prefix ? `${prefix}_${base}` : base;
}

/**
 * Formats a sequential date string: YYYYMMDD
 */
function getDateStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Generates collision-resistant human-readable transactional code
 * e.g. SAL-20260915-0042-8f3a
 */
export function generateTransactionNumber(prefix: string): string {
  counter = (counter + 1) % 10000;
  const datePart = getDateStamp();
  const seqPart = counter.toString().padStart(4, '0');
  const randPart = getRandomSuffix(4);
  return `${prefix}-${datePart}-${seqPart}-${randPart}`;
}

/**
 * Safe insertion helper using Dexie `table.add()`.
 * Detecting collision and generating a fresh ID instead of silently overwriting.
 */
export async function safeInsert<T extends { id: string }>(
  table: Table<T, any>,
  record: T,
  options?: {
    idPrefix?: string;
    maxRetries?: number;
    onRegenerateId?: (newId: string, current: T) => T;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 5;
  let currentRecord = { ...record };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await table.add(currentRecord);
      return currentRecord;
    } catch (err: any) {
      // Dexie ConstraintError when key already exists
      const isConstraintError =
        err?.name === 'ConstraintError' ||
        err?.message?.includes('Key already exists') ||
        err?.message?.includes('constraint');

      if (isConstraintError && attempt < maxRetries) {
        const newId = generateUniqueId(options?.idPrefix);
        if (options?.onRegenerateId) {
          currentRecord = options.onRegenerateId(newId, currentRecord);
        } else {
          currentRecord = { ...currentRecord, id: newId };
        }
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to safely insert record into ${table.name} after ${maxRetries} collision retries.`);
}
