/**
 * Agro ERP - Enterprise Types & Models
 * Bangladesh Integrated Farm Business ERP
 */

export type UserRole = 'OWNER' | 'UNAUTHENTICATED' | 'UNAPPROVED';

export interface UserProfile {
  uid: string;
  email?: string;
  phoneNumber?: string;
  displayName?: string;
  role: UserRole;
  isApproved: boolean;
  isActive?: boolean;
  createdAt?: string;
}

export interface SystemConfig {
  ownerUid: string;
  ownerEmail?: string;
  ownerEmails?: string[];
  companyName: string;
  companyAddress?: string;
  phone?: string;
  currency: string;
  initializedAt: string;
  legacyAccountsMigratedAt?: string;
}

export interface AppAccessLog {
  id: string;
  email: string;
  timestamp: string;
  ip?: string;
  userAgent?: string;
  loginMethod: 'SECRET_PIN' | 'SESSION_RESTORE';
  status: 'SUCCESS' | 'FAILED';
  synced?: boolean;
}

export type AccountClass =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'COGS'
  | 'EXPENSE'
  | 'OTHER_INCOME'
  | 'OTHER_EXPENSE';

export type NormalBalance = 'DEBIT' | 'CREDIT' | 'UNKNOWN' | 'UNRESOLVED' | 'INVALID';

export interface Account {
  id: string;
  code: string;
  nameBn: string;
  nameEn: string;
  accountClass?: AccountClass;
  type?: AccountClass | string;
  parentCode?: string;
  normalBalance: NormalBalance;
  isSystem?: boolean;
  isSystemAccount?: boolean;
  isActive?: boolean;
  currentBalance?: number;
  description?: string;
  synced?: boolean;
  createdAt?: string;
  updatedAt?: string;
  syncedAt?: string;
  ownerUid?: string;
}

export type VoucherType =
  | 'RECEIPT'
  | 'PAYMENT'
  | 'CONTRA'
  | 'JOURNAL'
  | 'PURCHASE'
  | 'SALES'
  | 'PURCHASE_RETURN'
  | 'SALES_RETURN'
  | 'ADJUSTMENT'
  | 'TRANSFER'
  | 'EXPENSE';

export interface JournalLine {
  id?: string;
  accountId?: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo?: string;
  legacyMigrated?: boolean;
  investorId?: string;
  missingAttribution?: boolean;
}

export interface JournalEntry {
  id: string;
  voucherNumber: string;
  voucherType: VoucherType;
  date: string;
  narration: string;
  lines: JournalLine[];
  totalDebit?: number;
  totalCredit?: number;
  reference?: string;
  idempotencyKey?: string;
  createdBy?: string;
  createdAt: string;
  status?: 'POSTED' | 'DRAFT' | 'REVERSED' | string;
  synced?: boolean;
  reversedBy?: string;
  reversalOf?: string;
  correctionOf?: string;
  relatedPerson?: string;
  investorId?: string;
  missingAttribution?: boolean;
  attributionStatus?: 'VERIFIED' | 'MISSING_ATTRIBUTION';
  attributionFlagReason?: string;
  legacyMigrated?: boolean;
  migratedAt?: string;
}

export interface ClosedPeriod {
  id: string;
  endDate: string;
  startDate?: string;
  netProfitTransferred: number;
  closedAt: string;
  closedBy?: string;
  journalEntryId?: string;
  voucherNumber?: string;
  notes?: string;
  synced?: boolean;
}

export type AnimalSpecies = 'CATTLE' | 'GOAT' | 'SHEEP' | 'POULTRY' | 'OTHER';
export type AnimalStatus = 'ACTIVE' | 'SOLD' | 'DECEASED' | 'TRANSFERRED' | 'STOLEN';

export interface Animal {
  id: string; // e.g. COW-001, GOAT-001
  tag: string;
  species: AnimalSpecies;
  breed: string;
  gender: 'MALE' | 'FEMALE';
  birthDate: string;
  purchaseCost: number;
  purchaseDate: string;
  currentWeightKg: number;
  status: AnimalStatus;
  location: string;
  accumulatedFeedCost: number;
  accumulatedMedCost: number;
  accumulatedLabourCost: number;
  otherCosts: number;
  totalCost: number;
  salePrice?: number;
  saleDate?: string | number;
  photoUrl?: string;
  notes?: string;
  journalEntryId?: string;
  paymentMethod?: 'CASH' | 'BANK' | 'CREDIT';
  supplierId?: string;
  bankAccountId?: string;
  synced?: boolean;
  createdAt?: string;
  updatedAt?: string;
  syncedAt?: string;
  ownerUid?: string;
}

export interface AnimalCostBreakdown {
  purchaseCost: number;
  feedCost: number;
  medicineCost: number;
  labourCost: number;
  otherCost: number;
  totalRecordedCost: number;
}

export interface AnimalEvent {
  id: string;
  animalId: string;
  eventType: 'FEED' | 'VACCINE' | 'TREATMENT' | 'WEIGHT' | 'MILK' | 'BREEDING' | 'MORTALITY' | 'LABOUR' | 'OTHER';
  date: string;
  cost: number;
  feedItemId?: string;
  feedQuantityUsed?: number;
  feedUnit?: string;
  milkLiters?: number;
  weightKg?: number;
  vaccineName?: string;
  nextDueDate?: string;
  details: string;
  journalEntryId?: string;
  synced?: boolean;
}

export interface Reminder {
  id: string;
  animalId?: string;
  title: string;
  category: 'VACCINE' | 'TREATMENT' | 'MARKET' | 'OTHER';
  dueDate: string;
  status: 'PENDING' | 'DONE' | 'SKIPPED';
  createdAt: string;
  synced?: boolean;
}

export interface Pond {
  id: string;
  name: string;
  areaDecimals: number;
  depthFeet: number;
  location: string;
  status: 'ACTIVE' | 'PREPARING' | 'FALLOW';
  synced?: boolean;
}

export interface FishBatch {
  id: string;
  pondId: string;
  pondName: string;
  species: string;
  stockingDate: string;
  fingerlingQty: number;
  fingerlingCost: number;
  totalFeedKg: number;
  totalFeedCost: number;
  medicineCost?: number;
  labourCost?: number;
  electricityCost?: number;
  waterTreatmentCost?: number;
  otherCost?: number;
  otherCosts?: number;
  totalCost?: number;
  journalEntryId?: string;
  mortalityCount: number;
  currentEstimatedWeightKg: number;
  harvestWeightKg?: number;
  harvestRevenue?: number;
  harvestDate?: string;
  originalStockedQty?: number;
  initialStockedQty?: number;
  harvestQuantity?: number;
  totalHarvestedQty?: number;
  status: 'ACTIVE' | 'HARVESTED' | 'CLOSED' | 'CANCELLED';
  notes?: string;
  synced?: boolean;
}

export interface Plot {
  id: string;
  name: string;
  areaDecimals: number;
  location: string;
  currentStatus: 'FALLOW' | 'CULTIVATED' | 'FODDER';
  synced?: boolean;
}

export interface CropCycle {
  id: string;
  plotId: string;
  plotName: string;
  cropName: string;
  cropCategory: 'GRAIN' | 'VEGETABLE' | 'FODDER' | 'OTHER';
  plantingDate: string;
  expectedHarvestDate: string;
  actualHarvestDate?: string;
  areaDecimals: number;
  seedCost: number;
  fertilizerCost: number;
  irrigationCost: number;
  labourCost: number;
  otherCost: number;
  protectionCost?: number;
  machineryCost?: number;
  totalCost: number;
  harvestYieldKg: number;
  harvestRevenue: number;
  internalConsumptionKg: number;
  expectedYieldKg?: number;
  totalAvailableYieldKg?: number;
  availableProductionKg?: number;
  status: 'PLANTED' | 'GROWING' | 'HARVESTED' | 'CLOSED' | 'CANCELLED';
  synced?: boolean;
}

export interface CropCostBreakdown {
  seedCost: number;
  fertilizerCost: number;
  irrigationCost: number;
  labourCost: number;
  protectionCost: number;
  machineryCost: number;
  otherCost: number;
  totalRecordedCost: number;
}

export interface CropProductionCostParams {
  cycleId: string;
  costType: 'SEED' | 'FERTILIZER' | 'IRRIGATION' | 'LABOUR' | 'PROTECTION' | 'MACHINERY' | 'OTHER';
  category?: 'SEED' | 'FERTILIZER' | 'IRRIGATION' | 'LABOUR' | 'PROTECTION' | 'MACHINERY' | 'OTHER';
  amount: number;
  quantity?: number;
  date?: string;
  paymentMethod?: 'CASH' | 'BANK' | 'CREDIT' | 'INVENTORY';
  bankAccountId?: string;
  supplierId?: string;
  inventoryItemId?: string;
  notes?: string;
  currentUserId?: string;
}

export interface InternalFlow {
  id: string;
  date: string;
  source: string;
  resource: 'MANURE' | 'COMPOST' | 'CROP_RESIDUE' | 'FODDER_GRASS' | 'OTHER';
  destination: string;
  quantity: number;
  unit: string;
  internalCostValuation: number;
  notes: string;
  synced?: boolean;
}

export interface ProcessingRun {
  id: string;
  recipeName: string;
  date: string;
  rawMaterialName: string;
  rawQty: number;
  rawUnit: string;
  rawCost: number;
  additionalCost: number;
  totalCost: number;
  outputProduct: string;
  outputQty: number;
  outputUnit: string;
  unitCost: number;
  notes?: string;
  synced?: boolean;
}

export interface InventoryItem {
  id: string;
  code: string;
  name?: string;
  nameBn?: string;
  nameEn?: string;
  category:
    | 'FEED'
    | 'FEED_STOCK'
    | 'SEED'
    | 'FERTILIZER'
    | 'SEED_FERTILIZER'
    | 'MEDICINE'
    | 'RAW_MATERIAL'
    | 'RAW_MATERIALS'
    | 'WIP'
    | 'FINISHED_GOODS'
    | 'FARM_PRODUCT'
    | 'PROCESSED'
    | 'PACKAGING';
  unit: string;
  currentStock: number;
  reorderLevel?: number;
  avgCostPrice: number;
  costPrice?: number;
  sellingPrice?: number;
  lastRestockAmount?: number;
  lowStockThreshold?: number;
  photoUrl?: string;
  journalEntryId?: string;
  isActive?: boolean;
  createdAt?: string;
  synced?: boolean;
}

export interface StockMovement {
  id: string;
  date: string;
  itemId: string;
  movementType:
    | 'OPENING'
    | 'PURCHASE'
    | 'TRANSFER'
    | 'PRODUCTION'
    | 'CONSUMPTION'
    | 'SALE'
    | 'WASTE'
    | 'DAMAGE'
    | 'ADJUSTMENT'
    | 'REVERSAL'
    | 'SALES_RETURN'
    | 'PURCHASE_RETURN';
  quantity: number;
  unitCost: number;
  totalValue: number;
  referenceId?: string;
  notes?: string;
  reversalOf?: string;
  reversedBy?: string;
  status?: string;
  direction?: 'IN' | 'OUT';
  adjustmentType?: 'INCREASE' | 'DECREASE';
  synced?: boolean;
}

/**
 * PROMPT 08: Physical Inventory Count & Adjustment Audit Record
 * Captures explicit physical stock count vs accounting book quantity, variance, value impact,
 * reason/narration, user, and timestamp before applying formal inventory/accounting adjustments.
 * Physical counts must never silently overwrite accounting records.
 */
export interface PhysicalInventoryCountRecord {
  id: string;
  itemId: string;
  itemCode?: string;
  itemName?: string;
  category?: string;
  inventoryAccountCode?: string;
  adjustmentAccountCode?: string;
  bookQuantity: number;
  physicalQuantity: number;
  variance: number;
  unitCost: number;
  valueImpact: number;
  reason: string;
  narration?: string;
  user: string;
  timestamp: string;
  date: string;
  stockMovementId?: string;
  journalEntryId?: string;
  voucherNumber?: string;
  auditLogId?: string;
  status: 'RECORDED' | 'POSTED';
  synced?: boolean;
}

export interface Party {
  id: string;
  type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  name: string;
  phone: string;
  address?: string;
  balance?: number;
  currentBalance?: number;
  creditLimit?: number;
  isActive?: boolean;
  synced?: boolean;
  createdAt?: string;
}

export interface PurchaseItem {
  itemId: string;
  itemName: string;
  quantity: number;
  unit?: string;
  rate?: number;
  unitPrice?: number;
  total?: number;
  lineTotal?: number;
  vatRatePercent?: number;
  vatAmount?: number;
}

export interface PurchaseLineInput {
  item: InventoryItem;
  quantity: number;
  unitPrice: number;
  vatRatePercent?: number;
}

export interface Purchase {
  id: string;
  invoiceNumber: string;
  displayNumber?: string;
  supplierId: string;
  supplierName: string;
  date: string;
  items: PurchaseItem[];
  subtotal?: number;
  transportCost?: number;
  discount?: number;
  taxVat?: number;
  vatTax?: number;
  vat?: number;
  totalAmount?: number;
  grandTotal: number;
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  paidAmount: number;
  dueAmount?: number;
  advancePaymentId?: string;
  advanceAppliedAmount?: number;
  journalEntryId?: string;
  status?: 'PAID' | 'DUE' | 'PARTIAL' | string;
  paymentStatus?: 'PAID' | 'DUE' | 'PARTIAL' | string;
  createdAt?: string;
  idempotencyKey?: string;
  synced?: boolean;
}

export interface SaleItem {
  itemId: string;
  itemName: string;
  quantity: number;
  unit?: string;
  rate?: number;
  unitPrice?: number;
  total?: number;
  lineTotal?: number;
  cogsAmount?: number;
  vatRatePercent?: number;
  vatAmount?: number;
}

export interface SaleLineInput {
  item: InventoryItem;
  quantity: number;
  unitPrice: number;
  vatRatePercent?: number;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  displayNumber?: string;
  customerId: string;
  customerName: string;
  date: string;
  category?: 'LIVESTOCK' | 'FISH' | 'CROP' | 'MILK' | 'PROCESSED' | 'OTHER';
  items: SaleItem[];
  subtotal?: number;
  discount?: number;
  taxVat?: number;
  vat?: number;
  vatTax?: number;
  totalAmount?: number;
  grandTotal?: number;
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  paidAmount: number;
  dueAmount?: number;
  advancePaymentId?: string;
  advanceAppliedAmount?: number;
  totalCogs?: number;
  journalEntryId?: string;
  status?: 'PAID' | 'DUE' | 'PARTIAL' | string;
  paymentStatus?: 'PAID' | 'DUE' | 'PARTIAL' | string;
  createdAt?: string;
  idempotencyKey?: string;
  synced?: boolean;
}

export type ReturnRefundMethod = 'CASH' | 'BANK' | 'ADJUST_DUE';

export interface SalesReturnItem {
  itemId: string;
  itemName?: string;
  returnedQuantity: number;
  unitPrice?: number;
  lineTotal: number;
  cogsAmount?: number;
  reason?: string;
}

export interface SalesReturn {
  id: string;
  returnNumber: string;
  displayNumber?: string;
  saleId: string;
  originalInvoiceNumber?: string;
  customerId: string;
  customerName?: string;
  date: string;
  items: SalesReturnItem[];
  totalRefundAmount: number;
  totalCogsReversed?: number;
  refundMethod: ReturnRefundMethod;
  bankAccountId?: string;
  reason?: string;
  notes?: string;
  journalEntryId?: string;
  createdAt?: string;
  idempotencyKey?: string;
  synced?: boolean;
}

export interface PurchaseReturnItem {
  itemId: string;
  itemName?: string;
  returnedQuantity: number;
  unitPrice?: number;
  lineTotal: number;
  reason?: string;
}

export interface PurchaseReturn {
  id: string;
  returnNumber: string;
  displayNumber?: string;
  purchaseId: string;
  originalInvoiceNumber?: string;
  supplierId: string;
  supplierName?: string;
  date: string;
  items: PurchaseReturnItem[];
  totalRefundAmount: number;
  refundMethod: ReturnRefundMethod;
  bankAccountId?: string;
  reason?: string;
  notes?: string;
  journalEntryId?: string;
  createdAt?: string;
  idempotencyKey?: string;
  synced?: boolean;
}

export interface PaymentRecord {
  id: string;
  parentType: 'SALE' | 'PURCHASE';
  parentId: string;
  amount: number;
  date: string;
  note?: string;
  paymentMethod?: 'CASH' | 'BANK';
  bankAccountId?: string;
  journalEntryId?: string;
  voucherNumber?: string;
  idempotencyKey?: string;
  createdAt?: string;
  synced?: boolean;
  partyId?: string;
  customerId?: string;
  supplierId?: string;
  partyName?: string;
}

export type AdvanceDirection = 'RECEIVED' | 'PAID';

export interface AdvancePayment {
  id: string;
  advanceNumber?: string;
  displayNumber?: string;
  party: Party | string;
  partyId: string;
  partyName?: string;
  amount: number;
  direction: 'RECEIVED' | 'PAID'; // RECEIVED from customer / PAID to supplier
  remainingBalance?: number;
  remainingUnappliedBalance?: number; // remaining unapplied balance
  appliedAmount?: number;
  remainingAmount?: number;
  paymentMethod: 'CASH' | 'BANK';
  cashBankAccountId?: string;
  bankAccountId?: string;
  date: string;
  narration?: string;
  note?: string;
  journalEntryId?: string;
  appliedInvoices?: Array<{
    invoiceId: string;
    invoiceNumber?: string;
    invoiceType: 'SALE' | 'PURCHASE';
    appliedAmount: number;
    journalEntryId?: string;
    date: string;
  }>;
  status?: 'ACTIVE' | 'EXHAUSTED' | 'CANCELLED' | 'FULLY_APPLIED' | 'PARTIALLY_APPLIED';
  notes?: string;
  createdBy?: string;
  idempotencyKey?: string;
  createdAt?: string;
  synced?: boolean;
}

export interface CashBankAccount {
  id: string;
  accountType: 'CASH' | 'BANK' | 'MOBILE_BANKING';
  name: string;
  accountName?: string;
  accountNumber?: string;
  bankName?: string;
  branch?: string;
  currentBalance?: number;
  balance?: number;
  code?: string;
  openingBalance?: number;
  isActive?: boolean;
  synced?: boolean;
}

export interface BankTransfer {
  id: string;
  date: string;
  fromAccountId: string;
  fromAccountName: string;
  toAccountId: string;
  toAccountName: string;
  amount: number;
  transferFee: number;
  reference: string;
  type: 'CASH_TO_BANK' | 'BANK_TO_CASH' | 'BANK_TO_BANK' | 'CASH_TO_CASH';
  journalEntryId?: string;
  voucherNumber?: string;
  narration?: string;
  status?: string;
  reversedBy?: string;
  createdBy?: string;
  createdAt?: string;
  idempotencyKey?: string;
  synced?: boolean;
}

export interface AmortizationScheduleItem {
  installmentNumber: number;
  date: string;
  principalPortion: number;
  interestPortion: number;
  totalPayment: number;
  paymentAmount?: number;
  remainingBalance: number;
  endingBalance?: number;
  isPaid?: boolean;
  paidDate?: string;
  repaymentJournalId?: string;
}

export interface Loan {
  id: string;
  lenderName: string;
  loanType: 'BANK' | 'NGO' | 'INDIVIDUAL';
  principalAmount: number;
  interestRateAnnual: number;
  annualInterestRatePercent?: number;
  loanNumber?: string;
  term?: string;
  interestRate?: number;
  remainingBalance?: number;
  startDate?: string;
  disbursedDate?: string;
  termMonths?: number;
  tenureMonths?: number;
  monthlyInstallment?: number;
  totalPaidPrincipal?: number;
  totalPaidInterest?: number;
  outstandingPrincipal?: number;
  remainingPrincipal?: number;
  schedule?: AmortizationScheduleItem[];
  status: 'ACTIVE' | 'PAID_OFF' | 'CANCELLED';
  synced?: boolean;
}

export interface Investor {
  id: string;
  name: string;
  phone?: string;
  entryDate?: string;
  joinedDate?: string;
  admissionDate?: string;
  effectiveInvestmentDate?: string;
  effectiveDate?: string;
  economicParticipationPercentage?: number;

  // 1. Investor Capital Contributed & Balance
  initialCapital?: number;
  capitalAmount?: number;
  capitalContributed?: number;
  totalContribution?: number;
  additionalCapital?: number;

  // 2. Agreed Profit-Sharing Ratio (Sleeping Partner vs Working Partner)
  profitSharingRatio?: number; // e.g. 40 (for 40%)
  profitSharePercentage?: number; // e.g. 40
  sharePercentage?: number; // e.g. 40
  workingPartnerShareRatio?: number; // e.g. 60 (for 60%)

  // 3. Actual Profit Allocated
  totalProfitAllocated?: number;
  lastProfitAllocationDate?: string;

  // 4. Investor Profit Payable
  profitPayable?: number;

  // 5. Profit Actually Paid
  totalProfitPaid?: number;
  lastProfitPaymentDate?: string;

  // 6. Capital Returned
  totalCapitalReturned?: number;
  currentCapitalBalance?: number;
  withdrawals?: number;
  totalWithdrawals?: number;
  drawings?: number;
  lastCapitalReturnDate?: string;

  // Net Equity Balances
  netCapital?: number;
  currentBalance?: number;
  currentEquityBalance?: number;

  // Capacity profile (e.g. CAPITAL_PROVIDER vs MUDARIB)
  financialCapacities?: FinancialCapacity[];
  participantCapacity?: FinancialCapacity;

  status: 'ACTIVE' | 'REQUESTED' | 'PENDING_ADMISSION' | 'PENDING' | 'EXITED' | 'CANCELLED';
  admissionRequestId?: string;
  isAdmitted?: boolean;
  economicParticipationActive?: boolean;
  notes?: string;
  synced?: boolean;

  // Legacy / optional fields for backwards compatibility
  annualInterestRatePercent?: number;
  termMonths?: number;
  schedule?: AmortizationScheduleItem[];
  ownershipPct?: number;
  ownershipPercentage?: number;
  profitSharingPct?: number;
  allocationMethod?:
    | 'OWNERSHIP_BASED'
    | 'CAPITAL_BASED'
    | 'TIME_WEIGHTED'
    | 'AGREEMENT_BASED';
}

export type FinancialCapacity =
  | 'CAPITAL_PROVIDER'
  | 'INVESTOR'
  | 'MUDARIB'
  | 'WORKING_PARTNER';

export interface ParticipantCapacityProfile {
  capacity: FinancialCapacity;
  personId: string;
  personName: string;
  capitalAmount: number;
  currentCapitalBalance: number;
  profitAllocated: number;
  profitPayable: number;
  profitWithdrawn: number;
  glAccountCode: string;
}

export interface ParticipantFinancialProfile {
  personId: string;
  name: string;
  phone?: string;
  isOwner?: boolean;
  capacities: FinancialCapacity[];
  capitalProviderBalance: {
    capitalAmount: number; // e.g. Owner personal capital = 100
    currentCapitalBalance: number;
    profitPayable: number;
    totalProfitAllocated: number;
    glAccountCode: string; // '3010' for Owner personal capital or '3020' for Investor capital
  };
  workingPartnerBalance: {
    mudaribProfitEarned: number; // e.g. Owner Mudarib profit = 170
    mudaribProfitPayable: number;
    totalWithdrawn: number;
    glAccountCode: string; // '3015' for Mudarib Profit Equity or '2060' for Mudarib Profit Payable
  };
  isSeparate: boolean;
}

export type TrancheStatus = 'ACTIVE' | 'PENDING_ADMISSION' | 'REQUESTED' | 'PARTIALLY_RETURNED' | 'RETURNED' | 'EXITED' | 'CANCELLED';

export interface InvestmentTranche {
  id: string; // unique tranche ID (e.g. 'tranche_...')
  trancheId?: string; // alias/explicit tranche ID
  trancheNumber?: string; // human-readable identifier (e.g. 'TR-2026-001')
  investorId: string; // investor reference ID
  participantId?: string; // alias for investor/participant ID
  investorName?: string; // denormalized investor name
  investmentAmount: number; // investment amount strictly > 0
  originalCapital?: number; // alias for original investment capital
  investmentDate?: string; // date of investment
  effectiveDate?: string; // alias for effective date
  effectiveInvestmentDate: string; // YYYY-MM-DD
  contractualProfitSharePercentage: number; // e.g. 25 (for 25% of that investor's allocated economic profit)
  currency: string; // currency (e.g. 'BDT')
  status: TrancheStatus;
  creationTimestamp: string; // ISO 8601 creation timestamp

  // Capital tracking per tranche (never collapsed into a single lump sum)
  currentCapital?: number; // alias for current capital
  currentCapitalBalance?: number;
  totalCapitalReturned?: number;

  // Audit metadata
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;

  // Optional valuation-event reference
  valuationEventId?: string;
  valuationReference?: string;
  finalizedValuationId?: string;
  preMoneyValuation?: number;
  postMoneyValuation?: number;
  economicParticipationPercentage?: number;
  exactEconomicParticipationPercentage?: number;
  admissionAuditId?: string;

  // Optional withdrawal/closure information
  withdrawalDate?: string;
  closureDate?: string;
  closureReason?: string;
  closureNotes?: string;

  // Linked GL journal & financial transaction metadata
  journalEntryId?: string;
  targetAccountId?: string;
  reference?: string;

  // Investor attribution integrity & historical audit flags
  missingAttribution?: boolean;
  attributionStatus?: 'VERIFIED' | 'MISSING_ATTRIBUTION';
  attributionFlagReason?: string;

  synced?: boolean;
}

export type CapitalMovementType =
  | 'INITIAL_CONTRIBUTION'
  | 'ADDITIONAL_CONTRIBUTION'
  | 'WITHDRAWAL'
  | 'REINVESTED_PROFIT'
  | 'ADJUSTMENT';

export interface InvestorCapitalMovement {
  id: string;
  investorId: string;
  investorName?: string;
  trancheId?: string;
  movementType: CapitalMovementType;
  amount: number;
  direction: 'INFLOW' | 'OUTFLOW';
  date: string;
  journalEntryId: string;
  voucherNumber: string;
  sourceOrTargetAccountId?: string;
  notes?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  approvedBy?: string;
  createdAt: string;
  createdBy: string;
  synced?: boolean;
}

export interface ValuationAssetItem {
  code: string;
  name: string;
  amount: number;
}

export interface ValuationLiabilityItem {
  code: string;
  name: string;
  amount: number;
}

export interface NavAssetCategorySummary {
  category: 'CASH' | 'BANK' | 'INVENTORY' | 'RECEIVABLES' | 'FIXED_ASSETS' | 'PRODUCTION_ASSETS' | 'OTHER_CURRENT_ASSETS';
  categoryLabel: string;
  totalAmount: number;
  items: ValuationAssetItem[];
}

export interface NavLiabilityCategorySummary {
  category: 'TRADE_PAYABLES' | 'LOANS' | 'CUSTOMER_ADVANCES' | 'ACCRUED_OBLIGATIONS' | 'OTHER_LIABILITIES';
  categoryLabel: string;
  totalAmount: number;
  items: ValuationLiabilityItem[];
}

export interface NavAuditCalculation {
  valuationDate: string;
  formula: string;
  assetCategories: NavAssetCategorySummary[];
  totalEligibleAssets: number;
  liabilityCategories: NavLiabilityCategorySummary[];
  totalDeductedLiabilities: number;
  netAssetValue: number;
  reproducibilityChecksum: string;
  reproducibleFromGl: boolean;
  revenueExcludedFromAssets: boolean;
  unrecognizedProfitExcluded: boolean;
  investorCapitalExcludedFromNavBasis: boolean;
  marketValueInventionDetected: boolean;
  // Prompt 11: Correct NAV formula (approved assets - approved liabilities)
  netProfitExcludedFromNavSum?: boolean;
  doubleCountingProfitPrevented?: boolean;
  calculationTimestamp: string;
}

/**
 * PROMPT 10: Valuation Liability Verification Report
 * Ensures valuation includes material liabilities such as:
 * - supplier payables;
 * - loans;
 * - accrued obligations;
 * - other recorded liabilities.
 * Do not use only cash liabilities.
 * The system must use the accounting source of truth.
 */
export interface ValuationLiabilityVerificationReport {
  valuationDate: string;
  totalEligibleAssets: number;
  totalDeductedLiabilities: number;
  netAssetValue: number; // totalEligibleAssets - totalDeductedLiabilities
  supplierPayables: number;
  loans: number;
  accruedObligations: number;
  otherRecordedLiabilities: number;
  customerAdvances: number;
  includesNonCashAccrualLiabilities: boolean;
  onlyCashLiabilitiesUsed: boolean; // strictly FALSE
  accountingSourceOfTruthVerified: boolean;
  status: 'PASS' | 'UNRESOLVED';
  liabilityBreakdown: {
    category: NavLiabilityCategorySummary['category'];
    categoryLabel: string;
    amount: number;
    items: ValuationLiabilityItem[];
  }[];
  unresolvedReasons?: string[];
}

export interface ValuationReconciliationGateCheck {
  item: 'cash' | 'bank' | 'inventory' | 'receivables' | 'payables' | 'loans' | 'fixed_assets' | 'depreciation' | 'other_material';
  nameBn: string;
  nameEn: string;
  operationalAmount: number;
  glAmount: number;
  difference: number;
  isMatched: boolean;
  status: 'MATCHED' | 'MISMATCH' | 'MISSING_DATA';
  accountCodes?: string;
  details?: string;
}

export interface ValuationReconciliationGateResult {
  asOfDate: string;
  timestamp: string;
  passed: boolean;
  status: 'PASS' | 'UNRESOLVED';
  checks: ValuationReconciliationGateCheck[];
  unresolvedCount: number;
  unresolvedDiscrepancies: Array<{
    item: string;
    description: string;
    operationalAmount: number;
    glAmount: number;
    difference: number;
    reason: string;
  }>;
  totalMaterialDiscrepancy: number;
  blockingReason?: string;
}

export interface InvestmentValuationEvent {
  id: string;
  valuationDate: string; // YYYY-MM-DD
  totalBusinessAssetsIncluded: number;
  relevantLiabilities: number;
  resultingNetBusinessValue: number; // totalBusinessAssetsIncluded - relevantLiabilities
  valuationMethodology: 'BOOK_VALUE' | 'NET_ASSET_VALUE' | string;
  responsibleUser: string;
  timestamp: string; // ISO 8601
  createdAt: string;
  createdBy: string;

  // Finalization & Reconciliation Gate Audit (Prompt 07 & 13)
  status?: 'DRAFT' | 'FINALIZED' | 'BLOCKED' | 'REJECTED';
  finalizedAt?: string;
  finalizedBy?: string;
  approver?: string;
  reconciliationStatus?: 'PASS' | 'UNRESOLVED' | 'SKIPPED';
  reconciliationGate?: ValuationReconciliationGateResult;
  adjustments?: number;
  valuationAdjustments?: number;
  isImmutable?: boolean;

  // Revisions & Adjustment Events (Prompt 13)
  revisionOfValuationId?: string;
  revisionNumber?: number;
  revisionReason?: string;
  supersededByRevisionId?: string;

  // Linked investment admission
  linkedInvestorId?: string;
  linkedInvestorName?: string;
  linkedTrancheId?: string;
  admissionReference?: string;

  // Breakdown of included accounting values
  includedAssets?: ValuationAssetItem[];
  includedLiabilities?: ValuationLiabilityItem[];

  // Detailed transparent Net Asset Value audit calculation
  auditCalculation?: NavAuditCalculation;

  // Formal audit trail
  auditTrail: {
    eventId: string;
    action: string;
    timestamp: string;
    performedBy: string;
    details: string;
  };

  notes?: string;
  synced?: boolean;
}

export interface ExistingInvestorParticipationSnapshot {
  investorId: string;
  investorName: string;
  capitalContributed: number;
  currentCapitalBalance: number;
  profitSharingRatio: number;
  totalCapitalReturned: number;
  activeTrancheCount: number;
}

export interface ExistingTrancheSnapshot {
  trancheId: string;
  trancheNumber?: string;
  investorId: string;
  investorName: string;
  investmentAmount: number;
  effectiveInvestmentDate: string;
  contractualProfitSharePercentage: number;
  currentCapitalBalance: number;
  status: string;
}

export interface PendingTransactionSnapshotItem {
  id: string;
  type: string;
  date: string;
  amount: number;
  description: string;
  synced: boolean;
}

export interface InvestorEntrySnapshot {
  id: string;
  snapshotDate: string; // YYYY-MM-DD
  valuationEventId?: string;
  status: 'DRAFT' | 'FINALIZED' | 'REVERSED';

  // Current Financial Position
  currentBusinessAssets: number;
  currentLiabilities: number;
  netBusinessValue: number;
  assetBreakdown: ValuationAssetItem[];
  liabilityBreakdown: ValuationLiabilityItem[];
  navAuditCalculation?: NavAuditCalculation;

  // Existing Investor Economic Participation
  existingInvestors: ExistingInvestorParticipationSnapshot[];

  // Existing Investment Tranches
  existingTranches: ExistingTrancheSnapshot[];

  // Pending Transactions Affecting Valuation
  pendingTransactions: PendingTransactionSnapshotItem[];
  hasPendingUnsynchronizedData: boolean;

  // Immutability & Lifecycle Metadata
  isImmutable: boolean;
  finalizedAt?: string;
  finalizedBy?: string;
  createdBy: string;
  createdAt: string;

  // Explicit Audited Correction / Reversal Metadata
  reversalReason?: string;
  reversedAt?: string;
  reversedBy?: string;
  correctionReference?: string;

  auditTrail: {
    snapshotId: string;
    action: string;
    timestamp: string;
    performedBy: string;
    details: string;
  };

  notes?: string;
  synced?: boolean;
}

export interface ExistingInvestorDilutionItem {
  investorId: string;
  investorName: string;
  historicalCapital: number;
  previousParticipationPercentage: number;
  newParticipationPercentage: number;
}

export interface InvestorAdmissionAudit {
  admissionId: string;
  investorId: string;
  investorName: string;
  trancheId: string;
  admissionDate: string;

  // Valuation Basis
  valuationEventId?: string;
  valuationReference?: string;
  finalizedValuationId?: string;
  valuationBasis?: 'FINALIZED_NAV' | 'SNAPSHOT' | 'BOOK_VALUE' | string;
  snapshotId?: string;
  preMoneyValuation: number;
  contributionAmount: number;
  postMoneyValuation: number;

  // Economic Participation
  newInvestorParticipationRatio: number;
  newInvestorParticipationPercentage: number;
  exactNewInvestorParticipationPercentage?: number;
  existingEconomicParticipationRatio: number;
  existingEconomicParticipationPercentage: number;
  exactExistingEconomicParticipationPercentage?: number;
  newInvestorPercentage6Dec?: number;
  existingParticipantsPercentage6Dec?: number;
  intermediateCalculationsUnrounded?: boolean;

  // Dilution breakdown of existing investors
  existingInvestorsDilution: ExistingInvestorDilutionItem[];

  // Audit integrity guarantees
  is5050DefaultPrevented: boolean;
  historicalCapitalPreserved: boolean;
  valuationDrivenParticipation: boolean;
  auditExplanation: string;
  timestamp: string;
  responsibleUser: string;
}

/**
 * PROMPT 15: New Investor Admission Request & 7-Stage Lifecycle
 * Stages:
 * REQUEST -> RECONCILIATION -> VALUATION -> REVIEW -> APPROVAL -> CAPITAL RECEIPT -> ADMISSION
 *
 * Invariant: Merely creating an investor record or request does NOT grant active economic participation.
 * Only explicit completion through the full pipeline grants active status.
 */
export type AdmissionStage =
  | 'REQUEST'
  | 'RECONCILIATION'
  | 'VALUATION'
  | 'REVIEW'
  | 'APPROVAL'
  | 'CAPITAL_RECEIPT'
  | 'ADMISSION';

export type AdmissionRequestStatus =
  | 'REQUESTED'
  | 'RECONCILED'
  | 'VALUED'
  | 'REVIEWED'
  | 'APPROVED'
  | 'CAPITAL_RECEIVED'
  | 'ADMITTED'
  | 'REJECTED'
  | 'CANCELLED';

export interface InvestorAdmissionRequest {
  id: string; // e.g. 'adm_req_...'
  requestNumber: string; // e.g. 'AR-2026-001'
  reference?: string;
  investorName: string;
  phone?: string;
  proposedContribution: number;
  proposedProfitSharingRatio: number;
  requestDate: string; // YYYY-MM-DD
  stage: AdmissionStage;
  status: AdmissionRequestStatus;
  isAdmitted: boolean; // strictly false until final ADMISSION step
  economicParticipationActive: boolean; // strictly false until ADMISSION
  investorId?: string; // linked candidate investor record

  // Step 1: Request
  requestDetails?: {
    requestedBy: string;
    requestedAt: string;
    notes?: string;
  };

  // Step 2: Reconciliation
  reconciliation?: {
    status: 'PENDING' | 'PASS' | 'UNRESOLVED';
    reconciledAt?: string;
    reconciledBy?: string;
    gateResult?: ValuationReconciliationGateResult;
    notes?: string;
  };

  // Step 3: Valuation
  valuation?: {
    status: 'PENDING' | 'VALUED' | 'FINALIZED';
    valuationEventId?: string;
    valuationReference?: string;
    finalizedValuationId?: string;
    valuationBasis?: 'FINALIZED_NAV' | 'SNAPSHOT' | 'BOOK_VALUE' | string;
    preMoneyValuation?: number;
    postMoneyValuation?: number;
    calculatedParticipationRatio?: number;
    calculatedParticipationPercentage?: number;
    exactParticipationPercentage?: number;
    exactExistingParticipationPercentage?: number;
    valuedAt?: string;
    valuedBy?: string;
    isFinalized?: boolean;
    finalizedAt?: string;
    finalizedBy?: string;
  };

  // Step 4: Review
  review?: {
    status: 'PENDING' | 'REVIEWED';
    reviewedAt?: string;
    reviewedBy?: string;
    reviewNotes?: string;
    approvedRecommendation?: boolean;
  };

  // Step 5: Approval
  approval?: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    approvedAt?: string;
    approvedBy?: string;
    approvalNotes?: string;
  };

  // Step 6: Capital Receipt
  capitalReceipt?: {
    status: 'PENDING' | 'RECEIVED';
    receivedAmount?: number;
    targetAccountId?: string;
    receiptDate?: string;
    receiptVoucherNumber?: string;
    journalEntryId?: string;
    receivedBy?: string;
    receivedAt?: string;
    idempotencyKey?: string;
  };

  // Step 7: Admission
  admission?: {
    status: 'PENDING' | 'ADMITTED';
    admittedInvestorId?: string;
    admittedTrancheId?: string;
    admissionAuditId?: string;
    admissionDate?: string;
    admittedBy?: string;
    admittedAt?: string;
    valuationEventId?: string;
    valuationReference?: string;
    finalizedValuationId?: string;
    preMoneyValuation?: number;
    postMoneyValuation?: number;
  };

  auditTrail: Array<{
    stage: AdmissionStage;
    action: string;
    timestamp: string;
    performedBy: string;
    details: string;
  }>;

  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  synced?: boolean;
}

export interface InvestorAllocationDistributionItem {
  investorId: string;
  investorName: string;
  profitSharingRatio: number;
  allocatedProfitAmount: number;
  journalEntryId: string;
  voucherNumber: string;
  payableGlCode: string;
  distributionGlCode: string;
  ineligibleReason?: string;
  effectiveDate?: string;
}

export interface BusinessProfitAllocationResult {
  allocationId: string;
  periodStartDate: string;
  periodEndDate: string;
  finalizedBusinessProfit: number;
  totalAllocatedToInvestors: number;
  retainedBusinessProfit: number;
  allocations: InvestorAllocationDistributionItem[];
  preAllocationOperatingPnl: {
    totalRevenue: number;
    totalCogs: number;
    totalOperatingExpenses: number;
    netProfit: number;
  };
  postAllocationOperatingPnl: {
    totalRevenue: number;
    totalCogs: number;
    totalOperatingExpenses: number;
    netProfit: number;
  };
  operatingPnlUnaltered: boolean;
  salesUnaltered: boolean;
  expensesUnaltered: boolean;
  cogsUnaltered: boolean;
  trialBalanceBalanced: boolean;
}

export interface TrancheEconomicParticipationAllocation {
  id?: string;
  trancheId: string;
  trancheNumber?: string;
  investorId: string;
  investorName: string;
  investmentAmount: number;
  economicParticipationRatio: number;
  economicParticipationPercentage: number;
  applicableBusinessProfit: number;
  contractualProfitSharePercentage: number;
  investorProfitShare: number;
  workingPartnerProfitSharePercentage: number;
  workingPartnerProfitShare: number;
  journalEntryId?: string;
  voucherNumber?: string;
  payableGlCode?: string;
  distributionGlCode?: string;
}

export interface CapitalParticipationAllocationResult {
  allocationId: string;
  periodStartDate?: string;
  periodEndDate?: string;
  finalizedBusinessProfit: number;
  totalEconomicProfitAllocatedToTranches: number;
  totalInvestorProfitShare: number;
  totalWorkingPartnerShareFromTranches: number;
  retainedBusinessEquityProfit: number;
  totalWorkingPartnerEarnings: number;
  trancheAllocations: TrancheEconomicParticipationAllocation[];
  investorSummary: Array<{
    investorId: string;
    investorName: string;
    totalInvestmentAmount: number;
    effectiveEconomicParticipationPercentage: number;
    totalAllocatedEconomicProfit: number;
    totalInvestorProfitShare: number;
    totalWorkingPartnerShare: number;
    trancheCount: number;
  }>;
  noLeakageGuaranteed: boolean;
  notFlatFarmPercentageGuaranteed: boolean;
}

export interface UnattributedRecordAudit {
  id: string;
  recordType: 'INVESTMENT_TRANCHE' | 'JOURNAL_ENTRY' | 'INVESTOR';
  date?: string;
  amount?: number;
  description: string;
  flagReason: string;
  isFlagged: boolean;
}

export type SalesInvoice = Sale;
export type PurchaseInvoice = Purchase;
export type AuditLog = AuditLogEntry;

export interface FixedAsset {
  id: string;
  name: string;
  category:
    | 'LAND'
    | 'BUILDINGS'
    | 'BUILDING'
    | 'PONDS'
    | 'MACHINERY'
    | 'EQUIPMENT'
    | 'VEHICLES';
  purchaseDate: string;
  originalCost: number;
  usefulLifeYears: number;
  usefulLifeMonths?: number;
  salvageValue: number;
  accumulatedDepreciation: number;
  currentBookValue: number;
  depreciationRatePercent?: number; // annual %, entered once at purchase
  lastDepreciationDate?: string; // defaults to purchase date, hidden from the user
  photoUrl?: string;
  journalEntryId?: string;
  paymentMethod?: 'CASH' | 'BANK' | 'CREDIT';
  supplierId?: string;
  bankAccountId?: string;
  status?: 'ACTIVE' | 'DISPOSED' | 'CANCELLED';
  disposalDate?: string;
  disposalProceeds?: number;
  gainLossOnDisposal?: number;
  disposalJournalId?: string;
  disposedOriginalCost?: number;
  disposedAccumulatedDepreciation?: number;
  disposalReason?: string;
  // Prompt 09: Fixed Asset Verification & Revaluation Audit
  verifiedApprovedValue?: number;
  revaluationAdjustment?: number;
  revaluationReason?: string;
  lastRevaluationDate?: string;
  revaluationJournalId?: string;
  synced?: boolean;
}

/**
 * PROMPT 09: Fixed Asset Verification Item Breakdown
 * Explicitly separates:
 * - original cost;
 * - accumulated depreciation;
 * - carrying amount;
 * - verified/approved value;
 * - adjustment;
 * - reason.
 */
export interface FixedAssetVerificationItem {
  assetId: string;
  assetName: string;
  category: string;
  originalCost: number;
  accumulatedDepreciation: number;
  carryingAmount: number; // originalCost - accumulatedDepreciation
  verifiedApprovedValue: number;
  adjustment: number; // verifiedApprovedValue - carryingAmount
  adjustmentType: 'IMPAIRMENT_DECREASE' | 'REVALUATION_SURPLUS' | 'NO_CHANGE';
  reason: string;
  status: 'VERIFIED' | 'ADJUSTED' | 'PENDING';
}

/**
 * PROMPT 09: Fixed Asset Revaluation / Adjustment Event
 * Auditable revaluation event for user corrections.
 * Does not silently overwrite historical depreciation.
 * Does not automatically classify valuation adjustments as operating profit.
 */
export interface FixedAssetRevaluationEvent {
  id: string;
  assetId: string;
  assetName: string;
  category: string;
  valuationDate: string;
  originalCost: number;
  accumulatedDepreciation: number;
  carryingAmount: number;
  verifiedApprovedValue: number;
  adjustment: number;
  reason: string;
  accountingTreatment: 'IMPAIRMENT_LOSS' | 'REVALUATION_SURPLUS' | 'EQUITY_REVALUATION_RESERVE' | 'NON_OPERATING_LOSS';
  debitAccountCode: string;
  creditAccountCode: string;
  isOperatingProfit: boolean; // strictly false for valuation adjustments
  user: string;
  timestamp: string;
  journalEntryId?: string;
  voucherNumber?: string;
  auditLogId?: string;
  synced?: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  role: string;
  action: string;
  module: string;
  entity?: string;
  recordId: string;
  status: 'SUCCESS' | 'FAILURE';
  details: string;
  synced?: boolean;
}

export type SyncState = 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'SYNCED' | 'PENDING' | 'RETRYING' | 'SYNC_FAILED' | 'IDLE' | 'ERROR';

export interface VaccineTemplate {
  id: string;
  name: string;
  intervalDays: number;
  appliesTo?: string;
}

export interface RecurringExpenseTemplate {
  id: string;
  description: string;
  amount: number;
  accountCode: string;
  dayOfMonth: number;
  active: boolean;
  synced?: boolean;
}

/**
 * PROMPT 17: Pre-Money NAV Admission Inspection
 * Validates that admission valuation strictly uses the finalized business NAV immediately before admission
 * and does NOT use original nominal capital only, historical contribution total only, or current cash only.
 */
export interface AdmissionValuationInspectionResult {
  passed: boolean;
  preMoneyNav: number;
  finalizedBusinessNav: number;
  nominalCapitalOnly: number;
  historicalContributionTotal: number;
  currentCashOnly: number;
  referencedValuationEventId?: string;
  valuationReference?: string;
  isFinalizedValuationReferenced: boolean;
  valuationReferenceStored: boolean;
  rejectedNominalCapitalOnly: boolean;
  rejectedHistoricalContributionOnly: boolean;
  rejectedCurrentCashOnly: boolean;
  details: string;
}

/**
 * PROMPT 18: Post-Money NAV Calculation & Double-Profit Prevention
 * Formula: POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL
 * Example: Pre-money NAV = 600, New capital = 100 -> Post-money NAV = 700.
 * Strictly prohibits adding profit again.
 */
export interface PostMoneyNavCalculationResult {
  preMoneyNav: number;
  newCapital: number;
  postMoneyNav: number;
  formula: string;
  profitDoubleCounted: boolean;
  erroneousWithProfitNav?: number;
  auditExplanation: string;
}

export interface PostMoneyNavInspectionResult {
  passed: boolean;
  preMoneyNav: number;
  newCapital: number;
  postMoneyNav: number;
  expectedPostMoneyNav: number;
  formula: string;
  profitDoubleCounted: boolean;
  details: string;
}

/**
 * PROMPT 19: NAV-Based Admission Participation
 *
 * Formula:
 * New investor participation = New capital / Post-money NAV
 * Existing participants collectively represent = Pre-money NAV / Post-money NAV
 *
 * Example:
 * 100 / 700 = 14.285714...%
 * 600 / 700 = 85.714285...%
 *
 * Safe decimal/money precision: intermediate calculations are NOT prematurely rounded.
 */
export interface NavAdmissionParticipationResult {
  preMoneyNav: number;
  newCapital: number;
  postMoneyNav: number;
  // Exact unrounded intermediate ratios
  newInvestorParticipationRatio: number; // e.g. 100 / 700 = 0.14285714285714285...
  existingParticipantsRatio: number; // e.g. 600 / 700 = 0.8571428571428571...
  existingEconomicParticipationRatio?: number; // alias
  // Exact unrounded percentages
  exactNewInvestorPercentage: number; // 14.285714285714285...
  exactExistingParticipantsPercentage: number; // 85.71428571428571...
  exactNewInvestorParticipationPercentage?: number; // alias
  exactExistingEconomicParticipationPercentage?: number; // alias
  // High-precision display representations
  newInvestorPercentage6Dec: number; // 14.285714
  existingParticipantsPercentage6Dec: number; // 85.714285
  newInvestorPercentageFormatted: string; // "14.285714...%"
  existingParticipantsPercentageFormatted: string; // "85.714285...%"
  newInvestorPercentageWithEllipsis?: string; // "14.285714...%"
  existingParticipantsPercentageWithEllipsis?: string; // "85.714285...%"
  newInvestorPercentagePlain?: string; // "14.285714%"
  existingParticipantsPercentagePlain?: string; // "85.714285%"
  // Standard financial display (2 decimal places)
  newInvestorPercentage2Dec: number; // 14.29
  existingParticipantsPercentage2Dec: number; // 85.71
  // Compatibility aliases
  newInvestorParticipationPercentage: number; // 14.29
  existingEconomicParticipationPercentage: number; // 85.71
  existingParticipantsPercentage?: number; // 85.71
  existingInvestorsDilution?: ExistingInvestorDilutionItem[];
  isPrematurelyRounded: boolean;
  intermediateCalculationsUnrounded?: boolean;
  safePrecision?: boolean;
  formula: string;
  formulaDetailed?: string;
  auditExplanation: string;
}

export interface NavAdmissionParticipationInspectionResult {
  passed: boolean;
  preMoneyNav: number;
  newCapital: number;
  postMoneyNav: number;
  newInvestorParticipationRatio?: number;
  existingParticipantsRatio?: number;
  exactNewInvestorPercentage: number;
  exactExistingParticipantsPercentage: number;
  newInvestorPercentage6Dec?: number;
  existingParticipantsPercentage6Dec?: number;
  newInvestorPercentageFormatted: string;
  existingParticipantsPercentageFormatted: string;
  sumPercentage: number;
  isPrematurelyRounded: boolean;
  safePrecision?: boolean;
  formula: string;
  details: string;
}

/**
 * PROMPT 20: Protect Historical Profit & Admission-Period Profit Allocation
 * A new investor admitted after a finalized profit period must not receive profit from that earlier period.
 * Admission must create a clear effective date/period boundary.
 */
export interface AdmissionPeriodProfitAllocationInspectionParams {
  periodStartDate: string;
  periodEndDate: string;
  targetInvestorId?: string;
  admittedInvestorId?: string;
  existingInvestorId?: string;
  dbInstance?: any;
}

export interface AdmissionPeriodProfitAllocationInspectionResult {
  passed: boolean;
  periodStartDate: string;
  periodEndDate: string;
  historicalProfitProtected: boolean;
  clearBoundaryEstablished: boolean;
  postPeriodAdmittedInvestorId?: string;
  postPeriodAdmittedInvestorName?: string;
  postPeriodAdmittedInvestorAllocation: number; // MUST be 0!
  prePeriodInvestorAllocation?: number;
  totalPeriodProfit?: number;
  postPeriodInvestorEffectiveDate?: string;
  ineligibleInvestorsDetected?: Array<{
    investorId: string;
    investorName: string;
    effectiveDate: string;
    allocatedProfit: number;
  }>;
  details: string;
  boundaryRule: string;
}

/**
 * PROMPT 21: Capital Receipt Inspection
 * - The investor's new capital contribution must:
 *   - increase the appropriate asset/cash/bank account;
 *   - increase participant capital/economic position;
 *   - NOT become revenue;
 *   - NOT become operating profit.
 * - The event must have an idempotency key.
 * - Repeat the same capital receipt twice -> verify only one economic/accounting contribution exists.
 */
export interface CapitalReceiptInspectionParams {
  requestId?: string;
  investorId?: string;
  idempotencyKey?: string;
  expectedAmount?: number;
  targetAccountId?: string;
  dbInstance?: any;
}

export interface CapitalReceiptInspectionResult {
  passed: boolean;
  idempotencyKey?: string;
  singleContributionVerified: boolean;
  assetIncreased: boolean;
  capitalIncreased: boolean;
  revenueZero: boolean;
  operatingProfitZero: boolean;
  receivedAmount: number;
  targetAccountId?: string;
  targetAccountType?: string;
  assetAccountCode: string;
  equityAccountCode: string;
  journalEntryCount: number;
  totalDebitToAsset: number;
  totalCreditToEquity: number;
  totalCreditToRevenue: number;
  operatingProfitImpact: number;
  details: string;
}

/**
 * PROMPT 22: Finalize Admission Atomically Inspection
 * Invariants:
 * - The operation must be atomic across all records.
 * - It must not be possible to create:
 *   - capital receipt without participant admission;
 *   - admission without capital receipt when capital is required;
 *   - economic units without the underlying event;
 *   - partial profit eligibility.
 * - Simulate a failure during the operation -> verify no half-completed admission remains.
 */
export interface FinalAdmissionInspectionParams {
  requestId: string;
  investorId?: string;
  trancheId?: string;
  dbInstance?: any;
}

export interface FinalAdmissionInspectionResult {
  passed: boolean;
  isAtomic: boolean;
  noCapitalReceiptWithoutAdmission: boolean;
  noAdmissionWithoutCapitalReceipt: boolean;
  noEconomicUnitsWithoutEvent: boolean;
  noPartialProfitEligibility: boolean;
  noHalfCompletedAdmission: boolean;
  isAdmitted: boolean;
  economicParticipationActive: boolean;
  investorConsistent: boolean;
  trancheConsistent: boolean;
  requestConsistent: boolean;
  auditTrailConsistent: boolean;
  details: string;
}

/**
 * PHASE 4 — PROFIT ALLOCATION
 * PROMPT 23: Create the Profit Pool & Inspect Profit Allocation
 * 
 * Invariants & Requirements:
 * 1. First determine the finalized accounting/distributable profit for the eligible period.
 * 2. Do not calculate investor profit directly from random account balances.
 * 3. Do not change the accounting P&L during allocation.
 * 4. Create a clear allocation event referencing:
 *    - period;
 *    - profit pool;
 *    - valuation/eligibility boundary;
 *    - source accounting result.
 * 5. Test with distributable profit = 300.
 * 6. Verify allocation starts from exactly 300.
 */
export interface ProfitAllocationPeriod {
  startDate: string;
  endDate: string;
}

export interface ProfitPool {
  poolId: string;
  poolAmount: number;
  distributableProfit: number;
  currency?: string;
  description?: string;
  createdAt: string;
  isFinalized: boolean;
}

export interface ValuationEligibilityBoundary {
  cutoffDate: string;
  eligibleAdmissionCutoffDate: string;
  valuationEventId?: string;
  valuationReference?: string;
  eligibleTrancheIds?: string[];
  eligibleInvestorIds?: string[];
  boundaryRule?: string;
  notes?: string;
}

export interface SourceAccountingResult {
  sourceType: 'PROFIT_AND_LOSS' | 'FINANCIAL_STATEMENTS' | 'GENERAL_LEDGER';
  periodStartDate: string;
  periodEndDate: string;
  totalRevenue: number;
  totalCogs: number;
  totalOperatingExpenses: number;
  operatingProfit: number;
  netProfit: number;
  finalizedDistributableProfit: number;
  pnlReportReference?: string;
  isUnalteredByAllocation: boolean;
}

export interface ProfitAllocationEvent {
  id: string;
  allocationNumber: string;
  eventType: 'PROFIT_POOL_ALLOCATION';
  status: 'DRAFT' | 'FINALIZED' | 'DISTRIBUTED';
  createdAt: string;
  createdDate: string;
  responsibleUser: string;
  period: ProfitAllocationPeriod;
  profitPool: ProfitPool;
  valuationEligibilityBoundary: ValuationEligibilityBoundary;
  sourceAccountingResult: SourceAccountingResult;
  allocationStartingAmount: number;
  totalAllocated: number;
  remainingPoolAmount: number;
  allocations?: Array<{
    investorId: string;
    investorName: string;
    trancheId?: string;
    profitSharingRatio: number;
    economicParticipationRatio?: number;
    allocatedAmount: number;
    journalEntryId?: string;
    voucherNumber?: string;
  }>;
  notes?: string;
  synced?: boolean;
}

export interface ProfitAllocationInspectionParams {
  allocationEventId?: string;
  allocationEvent?: ProfitAllocationEvent;
  startDate?: string;
  endDate?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  expectedDistributableProfit?: number;
  dbInstance?: any;
}

export interface ProfitAllocationInspectionResult {
  passed: boolean;
  allocationStartsFromExactDistributableProfit: boolean;
  distributableProfit: number;
  initialPoolAmount: number;
  accountingPnlUnchanged: boolean;
  notCalculatedFromRandomBalances: boolean;
  referencesPeriod: boolean;
  referencesProfitPool: boolean;
  referencesValuationEligibilityBoundary: boolean;
  referencesSourceAccountingResult: boolean;
  allocationEventId?: string;
  period?: ProfitAllocationPeriod;
  details: string;
}

/**
 * PHASE 4 — PROFIT ALLOCATION
 * PROMPT 24: Economic Allocation by Capital
 * 
 * Requirements & Invariants:
 * 1. Implement the economic allocation layer.
 * 2. When participants have equal eligibility periods, allocate profit according to eligible capital proportion.
 * 3. Example:
 *    A = 100
 *    B = 200
 *    Profit = 300
 *    Economic allocation:
 *    A = 100
 *    B = 200
 * 4. This is BEFORE applying their individual contractual profit-sharing percentages.
 * 5. Do not apply A's 50% or B's 60% directly to the total 300.
 * 6. Test the exact example.
 */
export interface ParticipantCapitalPosition {
  participantId?: string;
  id?: string;
  investorId?: string;
  participantName?: string;
  name?: string;
  investorName?: string;
  eligibleCapital?: number;
  capitalAmount?: number;
  investmentAmount?: number;
  contractualProfitSharingPercentage?: number; // e.g. A = 50%, B = 60%
  contractualProfitSharePercentage?: number;
  profitSharingRatio?: number;
  eligibilityPeriodStart?: string;
  eligibilityPeriodEnd?: string;
  status?: string;
}

export interface ParticipantEconomicAllocation {
  participantId: string;
  participantName: string;
  eligibleCapital: number;
  capitalProportionRatio: number;
  capitalProportionPercentage: number;
  allocatedEconomicProfit: number; // Allocated BEFORE contractual percentages are applied
  contractualProfitSharingPercentage?: number;
  investorContractualProfit?: number; // Result after applying contractual % to allocatedEconomicProfit
  workingPartnerShare?: number;
  directContractualApplicationToTotalProfitBlocked?: boolean;
}

export interface EconomicAllocationByCapitalResult {
  distributableProfit: number;
  totalEligibleCapital: number;
  hasEqualEligibilityPeriods: boolean;
  allocations: ParticipantEconomicAllocation[];
  totalAllocatedEconomicProfit: number;
  remainingEconomicProfit: number;
  isBeforeContractualPercentages: boolean;
  flatProfitSharingAntiPatternPrevented: boolean;
  proportionsSumToOne: boolean;
  notes?: string;
}

export interface EconomicAllocationInspectionParams {
  distributableProfit: number;
  participants: ParticipantCapitalPosition[];
  expectedEconomicAllocations?: Record<string, number>;
}

export interface EconomicAllocationInspectionResult {
  passed: boolean;
  exactExampleVerified: boolean;
  allocationsMatchCapitalProportions: boolean;
  beforeContractualPercentagesApplied: boolean;
  directApplicationOfContractualRateToTotalProfitBlocked: boolean;
  allocations: Record<string, number>;
  totalAllocated: number;
  distributableProfit: number;
  details: string;
}




