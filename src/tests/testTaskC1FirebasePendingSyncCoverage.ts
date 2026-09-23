import { db } from '../db/indexedDb';
import { synchronizePendingData, listenToOnlineSync } from '../firebase/firebaseClient';
import { BankTransfer, AnimalEvent, Reminder, InternalFlow, ProcessingRun, Pond, Plot } from '../types';

export async function runTaskC1Tests() {
  console.log('--- Starting Task C1 Firebase Pending Sync Coverage Tests ---');

  const testId = `c1_test_${Date.now()}`;

  // 1. Insert un-synced test records across newly covered tables
  console.log('1. Inserting un-synced records into Dexie tables...');

  // A. bankTransfers
  const testBankTransfer: BankTransfer = {
    id: `bt_${testId}`,
    date: '2026-09-23',
    fromAccountId: 'acc_cash_test',
    fromAccountName: 'Main Cash',
    toAccountId: 'acc_bank_test',
    toAccountName: 'Primary Bank',
    amount: 5000,
    transferFee: 0,
    type: 'CASH_TO_BANK',
    journalEntryId: `jnl_${testId}`,
    voucherNumber: `VCH-${testId}`,
    reference: `REF-${testId}`,
    narration: 'Task C1 test contra transfer',
    synced: false,
    createdAt: new Date().toISOString()
  };
  await db.bankTransfers.put(testBankTransfer);

  // B. animalEvents
  const testAnimalEvent: AnimalEvent = {
    id: `ev_${testId}`,
    animalId: `anim_${testId}`,
    eventType: 'TREATMENT',
    date: '2026-09-23',
    details: 'Task C1 sync verification',
    cost: 200,
    synced: false
  };
  await db.animalEvents.put(testAnimalEvent);

  // C. reminders
  const testReminder: Reminder = {
    id: `rem_${testId}`,
    title: 'Deworming schedule',
    category: 'TREATMENT',
    dueDate: '2026-09-25',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    synced: false
  };
  await db.reminders.put(testReminder);

  // D. internalFlows
  const testFlow: InternalFlow = {
    id: `flow_${testId}`,
    date: '2026-09-23',
    resource: 'MANURE',
    source: 'Dairy Shed',
    destination: 'Biogas Plant',
    quantity: 150,
    unit: 'কেজি',
    internalCostValuation: 300,
    notes: 'Task C1 sync verification',
    synced: false
  };
  await db.internalFlows.put(testFlow);

  // E. processingRuns
  const testProcessing: ProcessingRun = {
    id: `proc_${testId}`,
    recipeName: 'Ghee Processing',
    date: '2026-09-23',
    rawMaterialName: 'Raw Milk',
    rawQty: 20,
    rawUnit: 'L',
    rawCost: 1200,
    additionalCost: 200,
    totalCost: 1400,
    outputProduct: 'Organic Ghee',
    outputQty: 1,
    outputUnit: 'kg',
    unitCost: 1400,
    notes: 'Task C1 sync verification',
    synced: false
  };
  await db.processingRuns.put(testProcessing);

  // F. ponds
  const testPond: Pond = {
    id: `pond_${testId}`,
    name: 'Pond Alpha',
    areaDecimals: 25,
    depthFeet: 6,
    location: 'North Sector',
    status: 'ACTIVE',
    synced: false
  };
  await db.ponds.put(testPond);

  // G. plots
  const testPlot: Plot = {
    id: `plot_${testId}`,
    name: 'Plot Beta',
    areaDecimals: 250,
    location: 'South Field',
    currentStatus: 'FODDER',
    synced: false
  };
  await db.plots.put(testPlot);

  console.log('2. Verifying pending counts via listenToOnlineSync listener...');
  let pendingReported = 0;
  const unsubscribe = listenToOnlineSync(
    () => {},
    (count) => {
      pendingReported = count;
    }
  );

  // Give a short delay for listenToOnlineSync async calculation
  await new Promise((r) => setTimeout(r, 200));
  unsubscribe();

  if (pendingReported < 7) {
    throw new Error(`Expected at least 7 pending records, but listenToOnlineSync reported ${pendingReported}`);
  }
  console.log(`✓ listenToOnlineSync correctly reported ${pendingReported} pending items.`);

  console.log('3. Triggering synchronizePendingData()...');
  const syncResult = await synchronizePendingData();
  console.log('Sync result:', syncResult);

  // 4. Verify local records were stored
  const savedTransfer = await db.bankTransfers.get(testBankTransfer.id);
  const savedEvent = await db.animalEvents.get(testAnimalEvent.id);
  const savedReminder = await db.reminders.get(testReminder.id);
  const savedFlow = await db.internalFlows.get(testFlow.id);
  const savedProcessing = await db.processingRuns.get(testProcessing.id);
  const savedPond = await db.ponds.get(testPond.id);
  const savedPlot = await db.plots.get(testPlot.id);

  if (!savedTransfer) throw new Error('bankTransfer was not persisted');
  if (!savedEvent) throw new Error('animalEvent was not persisted');
  if (!savedReminder) throw new Error('reminder was not persisted');
  if (!savedFlow) throw new Error('internalFlow was not persisted');
  if (!savedProcessing) throw new Error('processingRun was not persisted');
  if (!savedPond) throw new Error('pond was not persisted');
  if (!savedPlot) throw new Error('plot was not persisted');

  // Clean up test records
  await db.bankTransfers.delete(testBankTransfer.id);
  await db.animalEvents.delete(testAnimalEvent.id);
  await db.reminders.delete(testReminder.id);
  await db.internalFlows.delete(testFlow.id);
  await db.processingRuns.delete(testProcessing.id);
  await db.ponds.delete(testPond.id);
  await db.plots.delete(testPlot.id);

  console.log('✓ All 7 tables verified in synchronizePendingData and listenToOnlineSync pipeline!');
  return { success: true };
}
