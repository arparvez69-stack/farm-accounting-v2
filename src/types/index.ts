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

  status: 'ACTIVE' | 'EXITED' | 'CANCELLED';
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

export type TrancheStatus = 'ACTIVE' | 'PARTIALLY_RETURNED' | 'RETURNED' | 'EXITED' | 'CANCELLED';

export interface InvestmentTranche {
  id: string; // unique tranche ID (e.g. 'tranche_...')
  trancheNumber?: string; // human-readable identifier (e.g. 'TR-2026-001')
  investorId: string; // investor reference ID
  investorName?: string; // denormalized investor name
  investmentAmount: number; // investment amount strictly > 0
  effectiveInvestmentDate: string; // YYYY-MM-DD
  contractualProfitSharePercentage: number; // e.g. 25 (for 25% of that investor's allocated economic profit)
  currency: string; // currency (e.g. 'BDT')
  status: TrancheStatus;
  creationTimestamp: string; // ISO 8601 creation timestamp

  // Capital tracking per tranche (never collapsed into a single lump sum)
  currentCapitalBalance?: number;
  totalCapitalReturned?: number;

  // Audit metadata
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;

  // Optional valuation-event reference
  valuationEventId?: string;
  preMoneyValuation?: number;
  postMoneyValuation?: number;
  economicParticipationPercentage?: number;
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
  calculationTimestamp: string;
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
  snapshotId?: string;
  preMoneyValuation: number;
  contributionAmount: number;
  postMoneyValuation: number;

  // Economic Participation
  newInvestorParticipationRatio: number;
  newInvestorParticipationPercentage: number;
  existingEconomicParticipationRatio: number;
  existingEconomicParticipationPercentage: number;

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

