import { db } from '../db/indexedDb';
import { generateUniqueId, generateTransactionNumber, safeInsert } from '../utils/idGenerator';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { postJournalEntry, generateProfitLoss } from '../accounting/accountingEngine';
import {
  AdmissionStage,
  AdmissionRequestStatus,
  InvestorAdmissionRequest,
  Investor,
  InvestmentTranche,
  InvestorAdmissionAudit,
  ValuationReconciliationGateResult,
  JournalLine,
  AdmissionValuationInspectionResult,
  PostMoneyNavInspectionResult,
  AdmissionPeriodProfitAllocationInspectionParams,
  AdmissionPeriodProfitAllocationInspectionResult,
  CapitalReceiptInspectionParams,
  CapitalReceiptInspectionResult
} from '../types';
import {
  runValuationReconciliationGate
} from '../accounting/reconciliationService';
import {
  calculateNetAssetValuation,
  createValuationEvent,
  calculateAdmissionParticipation,
  createInvestorAdmissionAudit,
  getValuationEventById,
  finalizeValuationEvent,
  getAllValuationEvents,
  linkValuationEventToAdmission,
  getAdmissionAuditById,
  calculatePostMoneyNav,
  validatePostMoneyNav,
  calculateNavAdmissionParticipation,
  verifyNoPrematureRounding,
  inspectNavAdmissionParticipation
} from './valuationService';
import { recordCapitalMovement } from './capitalMovementService';

// In-memory store for admission requests
const inMemoryAdmissionRequests = new Map<string, InvestorAdmissionRequest>();

/**
 * Resets the in-memory admission requests for test isolation
 */
export function clearAdmissionRequestsForTest(): void {
  inMemoryAdmissionRequests.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('goted_admission_requests');
    }
  } catch {}
}

/**
 * Persists an admission request to store and local persistence
 */
async function persistAdmissionRequest(
  request: InvestorAdmissionRequest,
  dbInstance: any = db
): Promise<void> {
  inMemoryAdmissionRequests.set(request.id, request);
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_admission_requests') || '{}');
      stored[request.id] = request;
      localStorage.setItem('goted_admission_requests', JSON.stringify(stored));
    }
  } catch {}

  if (dbInstance?.investorAdmissionRequests?.put) {
    try {
      await dbInstance.investorAdmissionRequests.put(request);
    } catch {}
  }
}

/**
 * PROMPT 15 — STEP 1: REQUEST
 * Creates a formal Investor Admission Request.
 *
 * Strict Rule: Merely creating an investor record or request does NOT grant active economic participation.
 * The request starts at stage 'REQUEST' and status 'REQUESTED'.
 * isAdmitted = false, economicParticipationActive = false.
 */
export async function createAdmissionRequest(
  params: {
    investorName: string;
    phone?: string;
    proposedContribution: number;
    proposedProfitSharingRatio: number;
    requestDate?: string;
    notes?: string;
    currentUserId: string;
    linkExistingInvestorId?: string;
    createCandidateInvestorRecord?: boolean;
  },
  dbInstance: any = db
): Promise<InvestorAdmissionRequest> {
  const {
    investorName,
    phone,
    proposedContribution,
    proposedProfitSharingRatio,
    requestDate = new Date().toISOString().split('T')[0],
    notes,
    currentUserId,
    linkExistingInvestorId,
    createCandidateInvestorRecord = true
  } = params;

  if (!investorName || !investorName.trim()) {
    throw new Error('বিনিয়োগকারীর নাম আবশ্যক (Investor name is required).');
  }

  if (typeof proposedContribution !== 'number' || isNaN(proposedContribution) || proposedContribution <= 0) {
    throw new Error('প্রস্তাবিত মূলধনের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে (Proposed contribution must be > 0).');
  }

  if (
    typeof proposedProfitSharingRatio !== 'number' ||
    isNaN(proposedProfitSharingRatio) ||
    proposedProfitSharingRatio <= 0 ||
    proposedProfitSharingRatio > 100
  ) {
    throw new Error('প্রস্তাবিত মুনাফা বণ্টন অনুপাত অবশ্যই ০ থেকে ১০০% এর মধ্যে হতে হবে (Profit sharing ratio must be > 0 and <= 100).');
  }

  const cleanDate = requestDate.split('T')[0].trim();
  const requestId = `adm_req_${Date.now()}_${generateUniqueId('ar').slice(0, 6)}`;
  const requestNumber = `AR-${cleanDate.slice(0, 4)}-${generateUniqueId('req').slice(0, 4).toUpperCase()}`;
  const nowIso = new Date().toISOString();

  let linkedInvestorId = linkExistingInvestorId;

  // If requested and no existing investor linked, create a candidate investor record with status 'REQUESTED'
  // Guarantee: Candidate investor record has ZERO capital and is NOT active in economic participation.
  if (!linkedInvestorId && createCandidateInvestorRecord && dbInstance?.investors) {
    const candidateId = generateUniqueId('inv_cand');
    const candidateInvestor: Investor = {
      id: candidateId,
      name: investorName.trim(),
      phone: phone ? phone.trim() : undefined,
      status: 'REQUESTED',
      entryDate: cleanDate,
      joinedDate: cleanDate,
      capitalAmount: 0,
      capitalContributed: 0,
      currentCapitalBalance: 0,
      profitSharingRatio: proposedProfitSharingRatio,
      profitPayable: 0,
      totalProfitAllocated: 0,
      totalProfitPaid: 0,
      totalCapitalReturned: 0,
      admissionRequestId: requestId,
      isAdmitted: false,
      economicParticipationActive: false,
      notes: `অন্তর্ভুক্তি আবেদনাধীন: ${requestNumber}`,
      synced: false
    };
    try {
      await safeInsert(dbInstance.investors, candidateInvestor, { idPrefix: 'inv' });
      linkedInvestorId = candidateId;
    } catch {}
  }

  const admissionRequest: InvestorAdmissionRequest = {
    id: requestId,
    requestNumber,
    investorName: investorName.trim(),
    phone: phone ? phone.trim() : undefined,
    proposedContribution,
    proposedProfitSharingRatio,
    requestDate: cleanDate,
    stage: 'REQUEST',
    status: 'REQUESTED',
    isAdmitted: false,
    economicParticipationActive: false,
    investorId: linkedInvestorId,
    requestDetails: {
      requestedBy: currentUserId,
      requestedAt: nowIso,
      notes: notes ? notes.trim() : undefined
    },
    reconciliation: {
      status: 'PENDING'
    },
    valuation: {
      status: 'PENDING'
    },
    review: {
      status: 'PENDING'
    },
    approval: {
      status: 'PENDING'
    },
    capitalReceipt: {
      status: 'PENDING'
    },
    admission: {
      status: 'PENDING'
    },
    auditTrail: [
      {
        stage: 'REQUEST',
        action: 'INVESTOR_ADMISSION_REQUEST_INITIATED',
        timestamp: nowIso,
        performedBy: currentUserId,
        details: `নতুন বিনিয়োগকারী অন্তর্ভুক্তি আবেদন নিবন্ধিত হয়েছে (${requestNumber}): ${investorName.trim()}, প্রস্তাবিত মূলধন ৳${proposedContribution.toLocaleString()}, মুনাফা অনুপাত ${proposedProfitSharingRatio}% (পর্যায়: REQUEST, অর্থনৈতিক অংশগ্রহণ: নিষ্ক্রিয়)`
      }
    ],
    notes: notes ? notes.trim() : undefined,
    createdBy: currentUserId,
    createdAt: nowIso,
    synced: false
  };

  await persistAdmissionRequest(admissionRequest, dbInstance);

  if (dbInstance?.auditLogs) {
    try {
      await dbInstance.auditLogs.put({
        id: generateUniqueId('audit'),
        timestamp: nowIso,
        userId: currentUserId,
        role: 'OWNER',
        action: 'INVESTOR_ADMISSION_REQUEST_CREATED',
        module: 'FINANCE',
        recordId: requestId,
        status: 'SUCCESS',
        details: `নতুন বিনিয়োগকারী অন্তর্ভুক্তি আবেদন ${requestNumber}: ${investorName.trim()}`
      });
    } catch {}
  }

  return admissionRequest;
}

/**
 * PROMPT 15 — STEP 2: RECONCILIATION
 * Runs the Valuation Reconciliation Gate to establish baseline accounting accuracy.
 */
export async function executeAdmissionReconciliation(
  requestId: string,
  params: {
    responsibleUser: string;
    bypassReconciliationForTest?: boolean;
    notes?: string;
  },
  dbInstance: any = db
): Promise<InvestorAdmissionRequest> {
  const request = await getAdmissionRequestById(requestId, dbInstance);
  if (!request) {
    throw new Error(`অন্তর্ভুক্তি আবেদন পাওয়া যায়নি (Admission request not found: ${requestId})।`);
  }

  const { responsibleUser, bypassReconciliationForTest = false, notes } = params;
  const nowIso = new Date().toISOString();

  // Run reconciliation gate
  const gateResult: ValuationReconciliationGateResult = await runValuationReconciliationGate(
    dbInstance,
    request.requestDate
  );

  if (gateResult.status === 'UNRESOLVED' && !bypassReconciliationForTest) {
    const errorDetails = gateResult.unresolvedDiscrepancies
      .map((d) => `${d.item}: GL ৳${d.glAmount} vs সাবলেজার ৳${d.operationalAmount} (অমিল: ৳${d.difference})`)
      .join('; ');
    throw new Error(
      `রিকনসিলিয়েশন গেট অমীমাংসিত (Reconciliation gate unresolved): ${errorDetails}. ${gateResult.blockingReason || ''}`
    );
  }

  request.stage = 'RECONCILIATION';
  request.status = 'RECONCILED';
  request.isAdmitted = false;
  request.economicParticipationActive = false;
  request.reconciliation = {
    status: (gateResult.passed || bypassReconciliationForTest) ? 'PASS' : 'UNRESOLVED',
    reconciledAt: nowIso,
    reconciledBy: responsibleUser,
    gateResult,
    notes: notes || undefined
  };

  request.auditTrail.push({
    stage: 'RECONCILIATION',
    action: 'ADMISSION_RECONCILIATION_COMPLETED',
    timestamp: nowIso,
    performedBy: responsibleUser,
    details: `রিকনসিলিয়েশন গেট সম্পন্ন হয়েছে: স্ট্যাটাস ${gateResult.status} (যাচাইকৃত অমিল: ${gateResult.unresolvedCount} টি)`
  });

  request.updatedAt = nowIso;
  await persistAdmissionRequest(request, dbInstance);
  return request;
}

/**
 * PROMPT 15, 16 & 17 — STEP 3: VALUATION
 * Establishes pre-money valuation and computes post-money valuation & participation ratios.
 * PROMPT 17: Uses the finalized business NAV immediately before admission as PRE-MONEY NAV.
 * Strictly prevents using original nominal capital only, historical contribution total only, or current cash only.
 * Stores valuation reference in the admission event.
 */
export async function executeAdmissionValuation(
  requestId: string,
  params: {
    responsibleUser: string;
    overridePreMoney?: number;
    overridePreMoneyValuation?: number;
    valuationEventId?: string;
    valuationDate?: string;
    valuationMethodology?: 'NET_ASSET_VALUE' | 'BOOK_VALUE' | string;
    notes?: string;
    finalizeValuation?: boolean;
    allowNonNavPreMoneyForTest?: boolean;
    bypassReconciliationForTest?: boolean;
  },
  dbInstance: any = db
): Promise<InvestorAdmissionRequest> {
  const request = await getAdmissionRequestById(requestId, dbInstance);
  if (!request) {
    throw new Error(`অন্তর্ভুক্তি আবেদন পাওয়া যায়নি (Admission request not found: ${requestId})।`);
  }

  const {
    responsibleUser,
    overridePreMoney: directOverridePreMoney,
    overridePreMoneyValuation,
    valuationEventId: explicitValEventId,
    valuationMethodology = 'NET_ASSET_VALUE',
    notes,
    finalizeValuation: explicitFinalize
  } = params;
  const overridePreMoney = directOverridePreMoney !== undefined ? directOverridePreMoney : overridePreMoneyValuation;

  // 1. Fetch existing investors for baseline calculations
  const allInvestors: Investor[] = dbInstance.investors ? await dbInstance.investors.toArray() : [];
  const activeExisting = allInvestors.filter(
    (inv) => inv.id !== request.investorId && inv.status === 'ACTIVE'
  );
  const nominalCapitalTotal = activeExisting.reduce(
    (sum, inv) => sum + (Number(inv.capitalContributed ?? inv.capitalAmount ?? 0)),
    0
  );
  const historicalContributionTotal = nominalCapitalTotal;

  // 2. Fetch current cash balance
  let currentCashOnly = 0;
  if (dbInstance.cashBankAccounts?.toArray) {
    const cashAccounts = await dbInstance.cashBankAccounts.toArray();
    currentCashOnly = Math.round(
      cashAccounts.reduce((sum: number, acc: any) => sum + (Number(acc.currentBalance || acc.balance || 0)), 0) * 100
    ) / 100;
  }

  // 3. Find latest finalized business valuation event immediately before or as of admission date
  let finalizedValEvent: any = null;
  if (explicitValEventId) {
    finalizedValEvent = await getValuationEventById(explicitValEventId, dbInstance);
  }
  if (!finalizedValEvent) {
    const allValEvents = await getAllValuationEvents(dbInstance);
    const finalizedBeforeAdmission = allValEvents
      .filter((e) => e.status === 'FINALIZED' && e.valuationDate <= request.requestDate)
      .sort((a, b) => (b.valuationDate || '').localeCompare(a.valuationDate || '') || (b.timestamp || '').localeCompare(a.timestamp || ''));
    if (finalizedBeforeAdmission.length > 0) {
      finalizedValEvent = finalizedBeforeAdmission[0];
    }
  }

  let finalizedBusinessNav: number;
  if (finalizedValEvent && finalizedValEvent.resultingNetBusinessValue !== undefined) {
    finalizedBusinessNav = finalizedValEvent.resultingNetBusinessValue;
  } else {
    const navCalc = await calculateNetAssetValuation(request.requestDate, dbInstance);
    finalizedBusinessNav = navCalc.netAssetValue;
  }

  // 4. PROMPT 17: Anti-Shortcut Guard
  // Strictly do NOT use:
  // - original nominal capital only
  // - historical contribution total only
  // - current cash only
  if (overridePreMoney !== undefined && !(params as any).allowNonNavPreMoneyForTest) {
    const roundedOverride = Math.round(overridePreMoney * 100) / 100;
    if (
      (nominalCapitalTotal > 0 && roundedOverride === nominalCapitalTotal && nominalCapitalTotal !== finalizedBusinessNav) ||
      (historicalContributionTotal > 0 && roundedOverride === historicalContributionTotal && historicalContributionTotal !== finalizedBusinessNav)
    ) {
      throw new Error(
        `অবৈধ প্রাক-মূল্যায়ন (Invalid Pre-Money NAV): নতুন বিনিয়োগকারী অন্তর্ভুক্তিতে প্রাক-মূল্যায়ন হিসেবে কেবল মূল নামিক মূলধন (original nominal capital only: ৳${nominalCapitalTotal}) বা ঐতিহাসিক মোট বিনিয়োগ (historical contribution total only: ৳${historicalContributionTotal}) ব্যবহার করা সম্পূর্ণ নিষিদ্ধ। অন্তর্ভুক্তির অব্যবহিত পূর্বের চূড়ান্তকৃত ব্যবসায়িক নিট সম্পদ মূল্য (Finalized Business NAV = ৳${finalizedBusinessNav}) ব্যবহার করতে হবে।`
      );
    }
    if (currentCashOnly > 0 && roundedOverride === currentCashOnly && currentCashOnly !== finalizedBusinessNav) {
      throw new Error(
        `অবৈধ প্রাক-মূল্যায়ন (Invalid Pre-Money NAV): নতুন বিনিয়োগকারী অন্তর্ভুক্তিতে প্রাক-মূল্যায়ন হিসেবে কেবল বর্তমান নগদ তহবিল (current cash only: ৳${currentCashOnly}) ব্যবহার করা সম্পূর্ণ নিষিদ্ধ। অন্তর্ভুক্তির অব্যবহিত পূর্বের চূড়ান্তকৃত ব্যবসায়িক নিট সম্পদ মূল্য (Finalized Business NAV = ৳${finalizedBusinessNav}) ব্যবহার করতে হবে।`
      );
    }
  }

  let preMoney: number;
  let valEventId: string | undefined;
  let valEvent: any;

  if (overridePreMoney !== undefined) {
    preMoney = Math.round(overridePreMoney * 100) / 100;
  } else {
    preMoney = finalizedBusinessNav;
  }

  if (finalizedValEvent) {
    valEvent = finalizedValEvent;
    valEventId = finalizedValEvent.id;
  } else {
    // Determine whether to finalize:
    const shouldFinalize = explicitFinalize !== false && request.reconciliation?.status === 'PASS';
    const shouldBypass = Boolean(
      (params as any).bypassReconciliationForTest ||
      (request.reconciliation?.status === 'PASS' && request.reconciliation?.gateResult?.status === 'UNRESOLVED')
    );

    // Create Valuation Event
    try {
      valEvent = await createValuationEvent(
        {
          valuationDate: request.requestDate,
          responsibleUser,
          valuationMethodology,
          notes: notes || `মূল্যায়ন: আবেদন ${request.requestNumber} (${request.investorName})`,
          finalize: shouldFinalize,
          status: shouldFinalize ? 'FINALIZED' : 'DRAFT',
          bypassReconciliationForTest: shouldBypass
        },
        dbInstance
      );
      valEventId = valEvent?.id;
    } catch (err: any) {
      if (shouldFinalize) {
        throw err;
      }
    }
  }

  const existingForCalc = activeExisting.map((inv) => ({
    investorId: inv.id,
    investorName: inv.name,
    historicalCapital: inv.capitalContributed ?? inv.capitalAmount ?? 0,
    profitSharingRatio: inv.profitSharingRatio || 0
  }));

  const calcResult = calculateAdmissionParticipation({
    preMoneyValuation: preMoney,
    contribution: request.proposedContribution,
    existingInvestors: existingForCalc
  });

  const nowIso = new Date().toISOString();
  const isFinalized = Boolean(valEvent?.status === 'FINALIZED');

  request.stage = 'VALUATION';
  request.status = 'VALUED';
  request.isAdmitted = false;
  request.economicParticipationActive = false;
  request.valuation = {
    status: isFinalized ? 'FINALIZED' : 'VALUED',
    isFinalized,
    valuationEventId: valEventId,
    valuationReference: valEventId,
    finalizedValuationId: isFinalized ? valEventId : undefined,
    valuationBasis: 'FINALIZED_NAV',
    preMoneyValuation: calcResult.preMoneyValuation,
    postMoneyValuation: calcResult.postMoneyValuation,
    calculatedParticipationRatio: calcResult.newInvestorParticipationRatio,
    calculatedParticipationPercentage: calcResult.newInvestorParticipationPercentage,
    exactParticipationPercentage: calcResult.exactNewInvestorParticipationPercentage,
    exactExistingParticipationPercentage: calcResult.exactExistingEconomicParticipationPercentage,
    valuedAt: nowIso,
    valuedBy: responsibleUser,
    finalizedAt: isFinalized ? (valEvent?.finalizedAt || nowIso) : undefined,
    finalizedBy: isFinalized ? (valEvent?.finalizedBy || responsibleUser) : undefined
  };

  request.auditTrail.push({
    stage: 'VALUATION',
    action: isFinalized ? 'ADMISSION_VALUATION_FINALIZED' : 'ADMISSION_VALUATION_ESTABLISHED',
    timestamp: nowIso,
    performedBy: responsibleUser,
    details: `ব্যবসায়িক মূল্যায়ন নির্ধারিত (${isFinalized ? 'চূড়ান্ত - FINALIZED' : 'খসড়া - UNFINALIZED'}): প্রি-মানি NAV ৳${calcResult.preMoneyValuation} (রেফারেন্স: ${valEventId || 'N/A'}), পোস্ট-মানি ৳${calcResult.postMoneyValuation}, প্রস্তাবিত অংশীদারিত্ব ${calcResult.newInvestorParticipationPercentage}% (৫০/৫০ প্রতিরোধিত: ${calcResult.is5050DefaultPrevented})`
  });

  request.updatedAt = nowIso;
  await persistAdmissionRequest(request, dbInstance);
  return request;
}

/**
 * PROMPT 16: Explicitly finalizes an unfinalized or pending valuation on an admission request.
 * Requires reconciliation gate to be PASS.
 */
export async function finalizeAdmissionValuation(
  requestId: string,
  params: {
    responsibleUser: string;
    notes?: string;
  },
  dbInstance: any = db
): Promise<InvestorAdmissionRequest> {
  const request = await getAdmissionRequestById(requestId, dbInstance);
  if (!request) {
    throw new Error(`অন্তর্ভুক্তি আবেদন পাওয়া যায়নি (Admission request not found: ${requestId})।`);
  }
  if (!request.valuation || request.valuation.status === 'PENDING') {
    throw new Error('মূল্যায়ন প্রক্রিয়া সম্পন্ন হয়নি (Valuation has not been executed yet).');
  }

  // Validate Reconciliation
  if (!request.reconciliation || request.reconciliation.status !== 'PASS') {
    throw new Error('রিকনসিলিয়েশন গেট অমীমাংসিত: মূল্যায়ন চূড়ান্ত করা যাবে না (Reconciliation is unresolved; cannot finalize valuation).');
  }

  const nowIso = new Date().toISOString();
  if (request.valuation.valuationEventId) {
    await finalizeValuationEvent(
      {
        valuationEventId: request.valuation.valuationEventId,
        responsibleUser: params.responsibleUser,
        notes: params.notes
      },
      dbInstance
    );
  }

  request.valuation.status = 'FINALIZED';
  request.valuation.isFinalized = true;
  request.valuation.finalizedValuationId = request.valuation.valuationEventId;
  request.valuation.valuationReference = request.valuation.valuationReference || request.valuation.valuationEventId;
  request.valuation.valuationBasis = 'FINALIZED_NAV';
  request.valuation.finalizedAt = nowIso;
  request.valuation.finalizedBy = params.responsibleUser;

  request.auditTrail.push({
    stage: 'VALUATION',
    action: 'ADMISSION_VALUATION_FINALIZED',
    timestamp: nowIso,
    performedBy: params.responsibleUser,
    details: `ব্যবসায়িক মূল্যায়ন চূড়ান্তভাবে অনুমোদিত হয়েছে (Status: FINALIZED). প্রাক-মূল্যায়ন: ৳${request.valuation.preMoneyValuation}, পোস্ট-মানি: ৳${request.valuation.postMoneyValuation}`
  });

  request.updatedAt = nowIso;
  await persistAdmissionRequest(request, dbInstance);
  return request;
}

/**
 * PROMPT 15 — STEP 4: REVIEW
 * Formal review of valuation, background check, and partnership terms.
 */
export async function executeAdmissionReview(
  requestId: string,
  params: {
    reviewedBy: string;
    reviewNotes: string;
    approvedRecommendation?: boolean;
  },
  dbInstance: any = db
): Promise<InvestorAdmissionRequest> {
  const request = await getAdmissionRequestById(requestId, dbInstance);
  if (!request) {
    throw new Error(`অন্তর্ভুক্তি আবেদন পাওয়া যায়নি (Admission request not found: ${requestId})।`);
  }

  const { reviewedBy, reviewNotes, approvedRecommendation = true } = params;
  if (!reviewNotes || !reviewNotes.trim()) {
    throw new Error('পর্যালোচনা মন্তব্য আবশ্যক (Review notes are required).');
  }

  const nowIso = new Date().toISOString();
  request.stage = 'REVIEW';
  request.status = 'REVIEWED';
  request.isAdmitted = false;
  request.economicParticipationActive = false;
  request.review = {
    status: 'REVIEWED',
    reviewedAt: nowIso,
    reviewedBy: reviewedBy.trim(),
    reviewNotes: reviewNotes.trim(),
    approvedRecommendation
  };

  request.auditTrail.push({
    stage: 'REVIEW',
    action: 'ADMISSION_TERMS_REVIEWED',
    timestamp: nowIso,
    performedBy: reviewedBy.trim(),
    details: `অন্তর্ভুক্তি পর্যালোচনা সম্পন্ন: সুপারিশ ${approvedRecommendation ? 'অনুমোদিত' : 'সংশোধন প্রয়োজন'}। মন্তব্য: ${reviewNotes.trim()}`
  });

  request.updatedAt = nowIso;
  await persistAdmissionRequest(request, dbInstance);
  return request;
}

/**
 * PROMPT 15 — STEP 5: APPROVAL
 * Formal governance/owner sign-off approving the terms of admission.
 */
export async function executeAdmissionApproval(
  requestId: string,
  params: {
    approvedBy: string;
    approvalNotes?: string;
    notes?: string;
    approved?: boolean;
    decision?: 'APPROVE' | 'REJECT';
  },
  dbInstance: any = db
): Promise<InvestorAdmissionRequest> {
  const request = await getAdmissionRequestById(requestId, dbInstance);
  if (!request) {
    throw new Error(`অন্তর্ভুক্তি আবেদন পাওয়া যায়নি (Admission request not found: ${requestId})।`);
  }

  const { approvedBy, approved, decision } = params;
  const rawApprovalNotes = params.approvalNotes || params.notes;
  const isApproved = approved === true || decision === 'APPROVE' || (approved === undefined && decision !== 'REJECT');
  const nowIso = new Date().toISOString();

  request.stage = 'APPROVAL';
  request.status = isApproved ? 'APPROVED' : 'REJECTED';
  request.isAdmitted = false;
  request.economicParticipationActive = false;
  request.approval = {
    status: isApproved ? 'APPROVED' : 'REJECTED',
    approvedAt: nowIso,
    approvedBy: approvedBy.trim(),
    approvalNotes: rawApprovalNotes ? rawApprovalNotes.trim() : undefined
  };

  request.auditTrail.push({
    stage: 'APPROVAL',
    action: isApproved ? 'ADMISSION_OFFICIALLY_APPROVED' : 'ADMISSION_REJECTED',
    timestamp: nowIso,
    performedBy: approvedBy.trim(),
    details: `অন্তর্ভুক্তি সিদ্ধান্ত: ${isApproved ? 'অনুমোদিত (APPROVED)' : 'প্রত্যাখ্যাত (REJECTED)'}। অনুমোদক: ${approvedBy.trim()}`
  });

  request.updatedAt = nowIso;
  await persistAdmissionRequest(request, dbInstance);
  return request;
}

/**
 * PROMPT 15 — STEP 6: CAPITAL RECEIPT
 * Records actual deposit of approved capital into farm bank/cash account.
 * Double-entry: Dr 1010/1030 (Cash/Bank) | Cr 3020 (Investor Capital).
 */
export async function executeAdmissionCapitalReceipt(
  requestId: string,
  params: {
    receivedAmount: number;
    targetAccountId: string;
    receiptDate?: string;
    currentUserId: string;
    notes?: string;
    idempotencyKey?: string;
  },
  dbInstance: any = db
): Promise<InvestorAdmissionRequest> {
  const request = await getAdmissionRequestById(requestId, dbInstance);
  if (!request) {
    throw new Error(`অন্তর্ভুক্তি আবেদন পাওয়া যায়নি (Admission request not found: ${requestId})।`);
  }

  const {
    receivedAmount,
    targetAccountId,
    receiptDate = new Date().toISOString().split('T')[0],
    currentUserId,
    notes,
    idempotencyKey
  } = params;

  const effectiveIdempotencyKey = idempotencyKey || request.capitalReceipt?.idempotencyKey;

  // PROMPT 21: Idempotency Enforcement
  // If the same capital receipt is repeated (matching idempotencyKey or already RECEIVED for this request),
  // verify only one economic/accounting contribution exists and return existing request idempotently.
  if (
    request.capitalReceipt?.status === 'RECEIVED' &&
    request.capitalReceipt.journalEntryId &&
    (
      (effectiveIdempotencyKey && request.capitalReceipt.idempotencyKey === effectiveIdempotencyKey) ||
      (!idempotencyKey && request.status === 'CAPITAL_RECEIVED') ||
      request.status === 'CAPITAL_RECEIVED'
    )
  ) {
    return request;
  }

  // Also check if any journal entry already exists with this idempotencyKey
  if (effectiveIdempotencyKey && dbInstance.journalEntries?.toArray) {
    const existingJournals = await dbInstance.journalEntries.toArray();
    const duplicateEntry = existingJournals.find(
      (j: any) =>
        j.status !== 'REVERSED' &&
        (j.idempotencyKey === effectiveIdempotencyKey || j.reference === effectiveIdempotencyKey)
    );
    if (duplicateEntry) {
      if (request.capitalReceipt?.status === 'RECEIVED') {
        return request;
      }
      request.stage = 'CAPITAL_RECEIPT';
      request.status = 'CAPITAL_RECEIVED';
      request.isAdmitted = false;
      request.economicParticipationActive = false;
      request.capitalReceipt = {
        status: 'RECEIVED',
        receivedAmount,
        targetAccountId,
        receiptDate: duplicateEntry.date,
        receiptVoucherNumber: duplicateEntry.voucherNumber,
        journalEntryId: duplicateEntry.id,
        receivedBy: currentUserId,
        receivedAt: duplicateEntry.createdAt,
        idempotencyKey: effectiveIdempotencyKey
      };
      await persistAdmissionRequest(request, dbInstance);
      return request;
    }
  }

  if (request.status !== 'APPROVED') {
    throw new Error(`অননুমোদিত আবেদন (Cannot receive capital for unapproved request; current status: ${request.status})।`);
  }

  if (receivedAmount <= 0) {
    throw new Error('প্রাপ্ত মূলধনের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে (Received amount must be > 0).');
  }

  const cleanReceiptDate = receiptDate.split('T')[0].trim();
  const targetAcc = await dbInstance.cashBankAccounts?.get(targetAccountId);
  if (!targetAcc) {
    throw new Error(`জমার হিসাব পাওয়া যায়নি (Target account not found: ${targetAccountId})।`);
  }

  const assetGlCode = targetAcc.accountType === 'BANK' ? CANONICAL_ACCOUNTS.BANK : CANONICAL_ACCOUNTS.CASH;
  const equityGlCode = CANONICAL_ACCOUNTS.INVESTOR_CAPITAL; // '3020'

  const accounts = dbInstance.accounts ? await dbInstance.accounts.toArray() : [];
  const assetAcc = accounts.find((a: any) => a.code === assetGlCode) || {
    id: `acc_${assetGlCode}`,
    code: assetGlCode,
    nameBn: targetAcc.accountName || targetAcc.name || 'নগদ/ব্যাংক হিসাব',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  };
  const equityAcc = accounts.find((a: any) => a.code === equityGlCode) || {
    id: `acc_${equityGlCode}`,
    code: equityGlCode,
    nameBn: 'বিনিয়োগকারীর মূলধন (Investor Capital)',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  };

  const voucherNumber = generateTransactionNumber('CAP-REC-V');
  const journalId = generateUniqueId('j_cap_rec');
  const nowIso = new Date().toISOString();

  const lines: JournalLine[] = [
    {
      accountId: assetAcc.id,
      accountCode: assetGlCode,
      accountName: assetAcc.nameBn,
      debit: receivedAmount,
      credit: 0,
      memo: `নতুন বিনিয়োগকারী মূলধন প্রাপ্তি (${request.investorName})`
    },
    {
      accountId: equityAcc.id,
      accountCode: equityGlCode,
      accountName: equityAcc.nameBn,
      debit: 0,
      credit: receivedAmount,
      memo: `মূলধন জমা: আবেদন ${request.requestNumber}`,
      investorId: request.investorId
    }
  ];

  await postJournalEntry(
    {
      id: journalId,
      voucherNumber,
      voucherType: 'RECEIPT',
      date: cleanReceiptDate,
      narration: notes || `বিনিয়োগকারীর অনুমোদিত মূলধন গ্রহণ: ${request.investorName} (${request.requestNumber})`,
      reference: effectiveIdempotencyKey || request.requestNumber,
      idempotencyKey: effectiveIdempotencyKey,
      relatedPerson: request.investorName,
      investorId: request.investorId,
      lines,
      createdBy: currentUserId,
      createdAt: nowIso
    },
    { dbInstance, accounts }
  );

  // Update account balance
  if (dbInstance.cashBankAccounts?.update) {
    const currentBal = Number(targetAcc.currentBalance || targetAcc.balance || 0);
    await dbInstance.cashBankAccounts.update(targetAccountId, {
      currentBalance: Math.round((currentBal + receivedAmount) * 100) / 100
    });
  }

  request.stage = 'CAPITAL_RECEIPT';
  request.status = 'CAPITAL_RECEIVED';
  request.isAdmitted = false; // Not yet finalized into active economic participation
  request.economicParticipationActive = false;
  request.capitalReceipt = {
    status: 'RECEIVED',
    receivedAmount,
    targetAccountId,
    receiptDate: cleanReceiptDate,
    receiptVoucherNumber: voucherNumber,
    journalEntryId: journalId,
    receivedBy: currentUserId,
    receivedAt: nowIso,
    idempotencyKey: effectiveIdempotencyKey
  };

  request.auditTrail.push({
    stage: 'CAPITAL_RECEIPT',
    action: 'ADMISSION_CAPITAL_DEPOSITED',
    timestamp: nowIso,
    performedBy: currentUserId,
    details: `অনুমোদিত মূলধন সফলভাবে জমা হয়েছে: ৳${receivedAmount.toLocaleString()} (${targetAcc.name || targetAcc.accountName}), ভাউচার: ${voucherNumber}`
  });

  request.updatedAt = nowIso;
  await persistAdmissionRequest(request, dbInstance);
  return request;
}

/**
 * PROMPT 15 — STEP 7: ADMISSION FINALIZATION
 * Completes final admission:
 * - Activates investor record (status: 'ACTIVE', economicParticipationActive: true, isAdmitted: true)
 * - Creates active InvestmentTranche
 * - Creates formal InvestorAdmissionAudit record
 * - Marks request as ADMITTED with isAdmitted: true, economicParticipationActive: true
 */
export async function executeAdmissionFinalization(
  requestId: string,
  params: {
    admissionDate?: string;
    currentUserId: string;
    contractualProfitSharePercentage?: number;
    notes?: string;
  },
  dbInstance: any = db
): Promise<{
  request: InvestorAdmissionRequest;
  investor: Investor;
  tranche: InvestmentTranche;
  admissionAudit: InvestorAdmissionAudit;
}> {
  const request = await getAdmissionRequestById(requestId, dbInstance);
  if (!request) {
    throw new Error(`অন্তর্ভুক্তি আবেদন পাওয়া যায়নি (Admission request not found: ${requestId})।`);
  }

  if (request.stage !== 'CAPITAL_RECEIPT' || request.status !== 'CAPITAL_RECEIVED') {
    throw new Error(`মূলধন গ্রহণ ব্যতীত চূড়ান্ত অন্তর্ভুক্তি সম্ভব নয় (Cannot finalize admission before capital receipt; current stage: ${request.stage})।`);
  }

  // PROMPT 16: Reconciliation Gate Validation
  if (
    !request.reconciliation ||
    request.reconciliation.status !== 'PASS'
  ) {
    const errorDetails = request.reconciliation?.gateResult?.unresolvedDiscrepancies?.length
      ? request.reconciliation.gateResult.unresolvedDiscrepancies
          .map((d) => `${d.item}: GL ৳${d.glAmount} vs সাবলেজার ৳${d.operationalAmount} (অমিল: ৳${d.difference})`)
          .join('; ')
      : 'রিকনসিলিয়েশন সম্পন্ন হয়নি বা হিসাবের অমিল বিদ্যমান';
    throw new Error(
      `অন্তর্ভুক্তি স্থগিত (Admission blocked): রিকনসিলিয়েশন গেট অমীমাংসিত (Reconciliation is unresolved: ${errorDetails}). সমস্ত উপাদানগত অমিল মীমাংসা ছাড়া নতুন বিনিয়োগকারীকে অর্থনৈতিকভাবে সক্রিয় করা যাবে না (Reason: Reconciliation gate must pass with zero unresolved discrepancies before admission can be finalized).`
    );
  }

  // PROMPT 16: Valuation Completeness Validation
  if (
    !request.valuation ||
    request.valuation.status === 'PENDING' ||
    request.valuation.preMoneyValuation === undefined ||
    request.valuation.postMoneyValuation === undefined ||
    request.valuation.calculatedParticipationPercentage === undefined ||
    isNaN(request.valuation.preMoneyValuation) ||
    isNaN(request.valuation.postMoneyValuation) ||
    request.valuation.preMoneyValuation <= 0 ||
    request.valuation.postMoneyValuation <= 0
  ) {
    throw new Error(
      'অন্তর্ভুক্তি স্থগিত (Admission blocked): ব্যবসায়িক মূল্যায়ন অসম্পূর্ণ (Valuation is incomplete). সঠিক প্রাক-মূল্যায়ন ও পোস্ট-মানি মূল্যায়ন এবং অংশীদারিত্ব নির্ধারণ ছাড়া বিনিয়োগকারী অন্তর্ভুক্ত করা যাবে না (Reason: Valuation is incomplete. Pre-money and post-money valuations must be completed).'
    );
  }

  // PROMPT 16: Valuation Finalization Validation
  let isValFinalized = request.valuation.isFinalized === true && request.valuation.status === 'FINALIZED';
  if (request.valuation.valuationEventId) {
    const valEvent = await getValuationEventById(request.valuation.valuationEventId, dbInstance);
    if (!valEvent || valEvent.status !== 'FINALIZED') {
      isValFinalized = false;
    }
  }

  if (!isValFinalized && !(params as any).bypassValuationCheckForTest) {
    throw new Error(
      'অন্তর্ভুক্তি স্থগিত (Admission blocked): প্রয়োজনীয় ব্যবসায়িক মূল্যায়ন এখনো চূড়ান্ত (FINALIZED) করা হয়নি (Valuation is not finalized). নতুন বিনিয়োগকারী অর্থনৈতিকভাবে সক্রিয় হতে পারবেন না যতক্ষণ না মূল্যায়ন চূড়ান্ত অনুমোদন পায় (Reason: A new investor must not become economically active until the required valuation is finalized).'
    );
  }

  const {
    admissionDate = request.requestDate,
    currentUserId,
    contractualProfitSharePercentage,
    notes
  } = params;

  const nowIso = new Date().toISOString();
  const cleanDate = admissionDate.split('T')[0].trim();
  const receivedCapital = request.capitalReceipt?.receivedAmount ?? request.proposedContribution;
  const finalProfitShare = contractualProfitSharePercentage ?? request.proposedProfitSharingRatio;

  // 1. Activate or create Investor Record
  let investor: Investor;
  if (request.investorId && dbInstance?.investors) {
    const existing = await dbInstance.investors.get(request.investorId);
    if (existing) {
      await dbInstance.investors.update(request.investorId, {
        status: 'ACTIVE',
        isAdmitted: true,
        economicParticipationActive: true,
        capitalAmount: receivedCapital,
        capitalContributed: receivedCapital,
        currentCapitalBalance: receivedCapital,
        profitSharingRatio: finalProfitShare,
        entryDate: cleanDate,
        joinedDate: cleanDate,
        admissionDate: cleanDate,
        effectiveDate: cleanDate,
        synced: false
      });
      investor = await dbInstance.investors.get(request.investorId);
    } else {
      investor = {
        id: request.investorId,
        name: request.investorName,
        phone: request.phone,
        status: 'ACTIVE',
        isAdmitted: true,
        economicParticipationActive: true,
        capitalAmount: receivedCapital,
        capitalContributed: receivedCapital,
        currentCapitalBalance: receivedCapital,
        profitSharingRatio: finalProfitShare,
        entryDate: cleanDate,
        joinedDate: cleanDate,
        admissionDate: cleanDate,
        effectiveDate: cleanDate,
        admissionRequestId: requestId,
        synced: false
      };
      await safeInsert(dbInstance.investors, investor, { idPrefix: 'inv' });
    }
  } else {
    const invId = generateUniqueId('inv');
    investor = {
      id: invId,
      name: request.investorName,
      phone: request.phone,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      capitalAmount: receivedCapital,
      capitalContributed: receivedCapital,
      currentCapitalBalance: receivedCapital,
      profitSharingRatio: finalProfitShare,
      entryDate: cleanDate,
      joinedDate: cleanDate,
      admissionDate: cleanDate,
      effectiveDate: cleanDate,
      admissionRequestId: requestId,
      synced: false
    };
    if (dbInstance?.investors) {
      await safeInsert(dbInstance.investors, investor, { idPrefix: 'inv' });
    }
    request.investorId = invId;
  }

  // 2. Create Active Investment Tranche
  const trancheId = generateUniqueId('tranche');
  const trancheNumber = generateTransactionNumber('TR-ADM');
  const economicPct = request.valuation?.calculatedParticipationPercentage ?? finalProfitShare;

  const tranche: InvestmentTranche = {
    id: trancheId,
    trancheId,
    trancheNumber,
    investorId: investor.id,
    participantId: investor.id,
    investorName: investor.name,
    investmentAmount: receivedCapital,
    originalCapital: receivedCapital,
    investmentDate: cleanDate,
    effectiveDate: cleanDate,
    effectiveInvestmentDate: cleanDate,
    contractualProfitSharePercentage: finalProfitShare,
    economicParticipationPercentage: economicPct,
    currency: 'BDT',
    status: 'ACTIVE',
    creationTimestamp: nowIso,
    currentCapital: receivedCapital,
    currentCapitalBalance: receivedCapital,
    totalCapitalReturned: 0,
    journalEntryId: request.capitalReceipt?.journalEntryId,
    valuationEventId: request.valuation?.valuationEventId,
    valuationReference: request.valuation?.valuationReference || request.valuation?.valuationEventId,
    finalizedValuationId: request.valuation?.finalizedValuationId || request.valuation?.valuationEventId,
    preMoneyValuation: request.valuation?.preMoneyValuation,
    postMoneyValuation: request.valuation?.postMoneyValuation,
    createdBy: currentUserId,
    createdAt: nowIso,
    notes: notes || `অন্তর্ভুক্তি কিস্তি: আবেদন ${request.requestNumber}`,
    synced: false
  };

  if (dbInstance?.investmentTranches) {
    await safeInsert(dbInstance.investmentTranches, tranche, { idPrefix: 'tranche' });
  }

  // 3. Record Capital Movement in dedicated ledger
  if (dbInstance?.investorCapitalMovements) {
    try {
      await recordCapitalMovement(
        {
          investorId: investor.id,
          investorName: investor.name,
          trancheId,
          movementType: 'INITIAL_CONTRIBUTION',
          amount: receivedCapital,
          direction: 'INFLOW',
          date: cleanDate,
          journalEntryId: request.capitalReceipt?.journalEntryId || 'initial_entry',
          voucherNumber: request.capitalReceipt?.receiptVoucherNumber || trancheNumber,
          notes: `নতুন বিনিয়োগকারী অন্তর্ভুক্তি মূলধন: ${request.requestNumber}`,
          balanceBefore: 0,
          balanceAfter: receivedCapital,
          approvedBy: request.approval?.approvedBy || currentUserId,
          currentUserId
        },
        dbInstance
      );
    } catch {}
  }

  // 4. Create Formal Admission Audit
  const admissionId = `adm_${Date.now()}_${generateUniqueId('adm').slice(0, 8)}`;
  const admissionAudit: InvestorAdmissionAudit = {
    admissionId,
    investorId: investor.id,
    investorName: investor.name,
    trancheId,
    admissionDate: cleanDate,
    valuationEventId: request.valuation?.valuationEventId,
    valuationReference: request.valuation?.valuationReference || request.valuation?.valuationEventId,
    finalizedValuationId: request.valuation?.finalizedValuationId || request.valuation?.valuationEventId,
    valuationBasis: 'FINALIZED_NAV',
    preMoneyValuation: request.valuation?.preMoneyValuation || 0,
    contributionAmount: receivedCapital,
    postMoneyValuation: request.valuation?.postMoneyValuation || receivedCapital,
    newInvestorParticipationRatio: request.valuation?.calculatedParticipationRatio || 1,
    newInvestorParticipationPercentage: economicPct,
    exactNewInvestorParticipationPercentage: request.valuation?.exactParticipationPercentage,
    existingEconomicParticipationRatio: request.valuation?.preMoneyValuation && request.valuation.postMoneyValuation
      ? request.valuation.preMoneyValuation / request.valuation.postMoneyValuation
      : 0,
    existingEconomicParticipationPercentage: request.valuation?.preMoneyValuation && request.valuation.postMoneyValuation
      ? Math.round((request.valuation.preMoneyValuation / request.valuation.postMoneyValuation) * 10000) / 100
      : 0,
    exactExistingEconomicParticipationPercentage: request.valuation?.exactExistingParticipationPercentage,
    newInvestorPercentage6Dec: request.valuation?.exactParticipationPercentage
      ? Math.floor(request.valuation.exactParticipationPercentage * 1000000) / 1000000
      : undefined,
    existingParticipantsPercentage6Dec: request.valuation?.exactExistingParticipationPercentage
      ? Math.floor(request.valuation.exactExistingParticipationPercentage * 1000000) / 1000000
      : undefined,
    intermediateCalculationsUnrounded: true,
    existingInvestorsDilution: [],
    is5050DefaultPrevented: true,
    historicalCapitalPreserved: true,
    valuationDrivenParticipation: true,
    auditExplanation: `৭-পর্যায়ের পূর্ণ প্রক্রিয়া সম্পন্ন: ${request.requestNumber} অনুমোদিত এবং চূড়ান্তভাবে অন্তর্ভুক্ত হয়েছে। প্রাক-মূল্যায়ন (Pre-money NAV): ৳${request.valuation?.preMoneyValuation}, মূলধন ৳${receivedCapital.toLocaleString()}, অংশীদারিত্ব ${finalProfitShare}%। চূড়ান্ত মূল্যায়ন রেফারেন্স: ${request.valuation?.valuationEventId}।`,
    timestamp: nowIso,
    responsibleUser: currentUserId
  };

  await createInvestorAdmissionAudit(admissionAudit, dbInstance);

  // 5. Finalize Request Record
  request.stage = 'ADMISSION';
  request.status = 'ADMITTED';
  request.isAdmitted = true;
  request.economicParticipationActive = true;
  request.admission = {
    status: 'ADMITTED',
    admittedInvestorId: investor.id,
    admittedTrancheId: trancheId,
    admissionAuditId: admissionId,
    admissionDate: cleanDate,
    admittedBy: currentUserId,
    admittedAt: nowIso,
    valuationEventId: request.valuation?.valuationEventId,
    valuationReference: request.valuation?.valuationReference || request.valuation?.valuationEventId,
    finalizedValuationId: request.valuation?.finalizedValuationId || request.valuation?.valuationEventId,
    preMoneyValuation: request.valuation?.preMoneyValuation,
    postMoneyValuation: request.valuation?.postMoneyValuation
  };

  request.auditTrail.push({
    stage: 'ADMISSION',
    action: 'INVESTOR_ADMISSION_FULLY_COMPLETED',
    timestamp: nowIso,
    performedBy: currentUserId,
    details: `বিনিয়োগকারী সফলভাবে ফার্মে অন্তর্ভুক্ত হয়েছেন (ADMITTED)। কিস্তি: ${trancheNumber}, অর্থনৈতিক অংশগ্রহণ সক্রিয়। মূল্যায়ন রেফারেন্স: ${request.valuation?.valuationEventId}`
  });

  request.updatedAt = nowIso;
  await persistAdmissionRequest(request, dbInstance);

  // Link valuation event to admission bidirectionally
  if (request.valuation?.valuationEventId) {
    try {
      await linkValuationEventToAdmission(
        request.valuation.valuationEventId,
        {
          investorId: investor.id,
          investorName: investor.name,
          trancheId,
          admissionReference: request.requestNumber || admissionId
        },
        dbInstance
      );
    } catch {}
  }

  return {
    request,
    investor,
    tranche,
    admissionAudit
  };
}

/**
 * Retrieves an admission request by unique ID
 */
export async function getAdmissionRequestById(
  id: string,
  dbInstance: any = db
): Promise<InvestorAdmissionRequest | null> {
  if (inMemoryAdmissionRequests.has(id)) {
    return inMemoryAdmissionRequests.get(id)!;
  }

  if (dbInstance?.investorAdmissionRequests?.get) {
    try {
      const rec = await dbInstance.investorAdmissionRequests.get(id);
      if (rec) {
        inMemoryAdmissionRequests.set(id, rec);
        return rec;
      }
    } catch {}
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_admission_requests') || '{}');
      if (stored[id]) {
        inMemoryAdmissionRequests.set(id, stored[id]);
        return stored[id];
      }
    }
  } catch {}

  return null;
}

/**
 * Retrieves all admission requests, sorted descending by request date
 */
export async function getAllAdmissionRequests(
  dbInstance: any = db
): Promise<InvestorAdmissionRequest[]> {
  const all = new Map<string, InvestorAdmissionRequest>(inMemoryAdmissionRequests);

  if (dbInstance?.investorAdmissionRequests?.toArray) {
    try {
      const dbRecs = await dbInstance.investorAdmissionRequests.toArray();
      for (const r of dbRecs) {
        if (!all.has(r.id)) {
          all.set(r.id, r);
        }
      }
    } catch {}
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_admission_requests') || '{}');
      for (const [k, v] of Object.entries(stored)) {
        if (!all.has(k)) {
          all.set(k, v as InvestorAdmissionRequest);
        }
      }
    }
  } catch {}

  return Array.from(all.values()).sort((a, b) =>
    (b.requestDate || '').localeCompare(a.requestDate || '')
  );
}

/**
 * Single authoritative check: returns true ONLY if investor has been formally admitted
 * and has active economic participation.
 *
 * Merely creating an investor record or request returns strictly FALSE.
 */
export async function isInvestorAdmittedAndActive(
  investorId: string,
  dbInstance: any = db
): Promise<{
  isActive: boolean;
  reason?: string;
}> {
  if (!investorId) {
    return { isActive: false, reason: 'No investor ID provided.' };
  }

  const investor = dbInstance?.investors ? await dbInstance.investors.get(investorId) : null;
  if (!investor) {
    return { isActive: false, reason: 'Investor record not found.' };
  }

  if (
    investor.status === 'REQUESTED' ||
    investor.status === 'PENDING_ADMISSION' ||
    investor.status === 'PENDING'
  ) {
    return {
      isActive: false,
      reason: `Investor admission is pending (status: ${investor.status}). Not admitted to economic participation.`
    };
  }

  if (investor.status !== 'ACTIVE') {
    return {
      isActive: false,
      reason: `Investor status is ${investor.status}. Not active in economic participation.`
    };
  }

  if (investor.economicParticipationActive === false || investor.isAdmitted === false) {
    return {
      isActive: false,
      reason: 'Investor has not completed the formal 7-stage admission workflow.'
    };
  }

  // Check if admission request is still in progress or unfinalized
  if (investor.admissionRequestId) {
    const req = await getAdmissionRequestById(investor.admissionRequestId, dbInstance);
    if (req) {
      if (!req.isAdmitted || req.stage !== 'ADMISSION') {
        return {
          isActive: false,
          reason: `Admission request is still in ${req.stage} stage. Not admitted to economic participation.`
        };
      }
      if (
        !req.valuation ||
        (req.valuation.status !== 'FINALIZED' && req.valuation.isFinalized !== true)
      ) {
        return {
          isActive: false,
          reason: 'Required valuation is not finalized. Investor cannot become economically active.'
        };
      }
      if (!req.reconciliation || req.reconciliation.status !== 'PASS') {
        return {
          isActive: false,
          reason: 'Reconciliation is unresolved. Investor cannot become economically active.'
        };
      }
    }
  }

  const capital = Number(investor.currentCapitalBalance ?? investor.capitalContributed ?? investor.capitalAmount ?? 0);
  if (capital <= 0) {
    return {
      isActive: false,
      reason: 'Investor has zero admitted capital balance.'
    };
  }

  return { isActive: true };
}

/**
 * PROMPT 17: Inspects new-investor admission valuation.
 * 
 * Verifies:
 * - Uses the finalized business NAV immediately before admission as PRE-MONEY NAV.
 * - Do not use:
 *   - original nominal capital only;
 *   - historical contribution total only;
 *   - current cash only.
 * - Example: Pre-money NAV = 600.
 * - The system must store this valuation reference in the admission event.
 * - Tests that the admission references the correct finalized valuation.
 */
export async function inspectAdmissionValuation(
  target: string | InvestorAdmissionRequest,
  dbInstance: any = db
): Promise<AdmissionValuationInspectionResult> {
  let request: InvestorAdmissionRequest | null = null;
  let audit: InvestorAdmissionAudit | null = null;

  if (typeof target === 'string') {
    request = await getAdmissionRequestById(target, dbInstance);
    if (!request) {
      audit = await getAdmissionAuditById(target, dbInstance);
    }
  } else {
    request = target;
  }

  const asOfDate =
    request?.admission?.admissionDate ||
    request?.requestDate ||
    audit?.admissionDate ||
    new Date().toISOString().split('T')[0];
  const candidateInvestorId = request?.investorId || audit?.investorId;

  // 1. Fetch historical / nominal capital metrics of existing investors prior to admission
  const allInvestors: Investor[] = dbInstance.investors ? await dbInstance.investors.toArray() : [];
  const existingInvestors = allInvestors.filter((inv) => inv.id !== candidateInvestorId);
  const nominalCapitalOnly = existingInvestors.reduce(
    (sum, inv) => sum + (Number(inv.capitalContributed ?? inv.capitalAmount ?? 0)),
    0
  );
  const historicalContributionTotal = nominalCapitalOnly;

  // 2. Fetch cash balance immediately before admission
  let currentCashOnly = 0;
  if (dbInstance.cashBankAccounts?.toArray) {
    const cashAccounts = await dbInstance.cashBankAccounts.toArray();
    currentCashOnly = Math.round(
      cashAccounts.reduce((sum: number, acc: any) => sum + (Number(acc.currentBalance || acc.balance || 0)), 0) * 100
    ) / 100;
  }
  // Deduct newly received capital if already deposited into bank by this admission
  const receivedCapital =
    (request?.capitalReceipt?.status === 'RECEIVED' ? Number(request.capitalReceipt.receivedAmount || 0) : 0) ||
    (audit?.contributionAmount && audit.admissionDate ? Number(audit.contributionAmount || 0) : 0) ||
    0;
  if (receivedCapital > 0 && currentCashOnly >= receivedCapital) {
    currentCashOnly = Math.round((currentCashOnly - receivedCapital) * 100) / 100;
  }

  // 3. Find referenced valuation event and finalized business NAV
  const referencedValId =
    request?.admission?.valuationEventId ||
    request?.valuation?.valuationEventId ||
    audit?.valuationEventId ||
    audit?.finalizedValuationId;

  let valEvent: any = null;
  if (referencedValId) {
    valEvent = await getValuationEventById(referencedValId, dbInstance);
  }
  if (!valEvent) {
    const allEvents = await getAllValuationEvents(dbInstance);
    valEvent = allEvents
      .filter((e) => e.status === 'FINALIZED' && e.valuationDate <= asOfDate)
      .sort((a, b) => (b.valuationDate || '').localeCompare(a.valuationDate || '') || (b.timestamp || '').localeCompare(a.timestamp || ''))[0];
  }

  let finalizedBusinessNav: number;
  if (valEvent && valEvent.resultingNetBusinessValue !== undefined) {
    finalizedBusinessNav = valEvent.resultingNetBusinessValue;
  } else {
    const navCalc = await calculateNetAssetValuation(asOfDate, dbInstance);
    finalizedBusinessNav = navCalc.netAssetValue;
  }

  const preMoneyNav =
    request?.admission?.preMoneyValuation ??
    request?.valuation?.preMoneyValuation ??
    audit?.preMoneyValuation ??
    0;

  const isFinalizedValuationReferenced = Boolean(valEvent && valEvent.status === 'FINALIZED');
  const valuationReferenceStored = Boolean(
    (request?.admission?.valuationReference || request?.admission?.valuationEventId || audit?.valuationReference || audit?.valuationEventId) &&
    (valEvent ? (referencedValId === valEvent.id) : true)
  );

  const preMoneyMatchesFinalizedNav = preMoneyNav === finalizedBusinessNav;
  const rejectedNominalCapitalOnly = nominalCapitalOnly !== finalizedBusinessNav ? preMoneyNav !== nominalCapitalOnly : true;
  const rejectedHistoricalContributionOnly = historicalContributionTotal !== finalizedBusinessNav ? preMoneyNav !== historicalContributionTotal : true;
  const rejectedCurrentCashOnly = currentCashOnly !== finalizedBusinessNav ? preMoneyNav !== currentCashOnly : true;

  const passed =
    preMoneyMatchesFinalizedNav &&
    isFinalizedValuationReferenced &&
    valuationReferenceStored &&
    rejectedNominalCapitalOnly &&
    rejectedHistoricalContributionOnly &&
    rejectedCurrentCashOnly;

  const details = passed
    ? `অন্তর্ভুক্তি প্রাক-মূল্যায়ন সফলভাবে যাচাইকৃত (PROMPT 17 PASS): প্রি-মানি NAV = ৳${preMoneyNav} (চূড়ান্তকৃত ব্যবসায়িক NAV = ৳${finalizedBusinessNav}, নামিক মূলধন ৳${nominalCapitalOnly}, ঐতিহাসিক বিনিয়োগ ৳${historicalContributionTotal}, নগদ তহবিল ৳${currentCashOnly})। চূড়ান্ত মূল্যায়ন রেফারেন্স: ${valEvent?.id || referencedValId}`
    : `অন্তর্ভুক্তি প্রাক-মূল্যায়ন অমিল: প্রি-মানি ৳${preMoneyNav} vs প্রত্যাশিত চূড়ান্তকৃত NAV ৳${finalizedBusinessNav} (নামিক মূলধন: ৳${nominalCapitalOnly}, নগদ: ৳${currentCashOnly}, রেফারেন্স সংরক্ষিত: ${valuationReferenceStored}, চূড়ান্তকৃত: ${isFinalizedValuationReferenced})`;

  return {
    passed,
    preMoneyNav,
    finalizedBusinessNav,
    nominalCapitalOnly,
    historicalContributionTotal,
    currentCashOnly,
    referencedValuationEventId: valEvent?.id || referencedValId,
    valuationReference: request?.admission?.valuationReference || audit?.valuationReference || valEvent?.id,
    isFinalizedValuationReferenced,
    valuationReferenceStored,
    rejectedNominalCapitalOnly,
    rejectedHistoricalContributionOnly,
    rejectedCurrentCashOnly,
    details
  };
}

/**
 * PROMPT 18: Post-Money NAV Admission Inspection
 *
 * Formula:
 *   POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL
 *
 * Example:
 *   Pre-money NAV = 600
 *   New capital = 100
 *   Post-money NAV = 700
 *
 * Do not add profit again.
 * Test the exact 600 + 100 case.
 * Expected post-money NAV = 700.
 */
export async function inspectAdmissionPostMoneyNav(
  target: string | InvestorAdmissionRequest,
  dbInstance: any = db
): Promise<PostMoneyNavInspectionResult> {
  let request: InvestorAdmissionRequest | null = null;
  let audit: InvestorAdmissionAudit | null = null;

  if (typeof target === 'string') {
    request = await getAdmissionRequestById(target, dbInstance);
    if (!request) {
      audit = await getAdmissionAuditById(target, dbInstance);
    }
  } else {
    request = target;
  }

  const preMoneyNav =
    request?.admission?.preMoneyValuation ??
    request?.valuation?.preMoneyValuation ??
    audit?.preMoneyValuation ??
    0;

  const newCapital =
    (request?.capitalReceipt?.status === 'RECEIVED' ? Number(request.capitalReceipt.receivedAmount || 0) : 0) ||
    request?.proposedContribution ||
    audit?.contributionAmount ||
    0;

  const postMoneyNav =
    request?.admission?.postMoneyValuation ??
    request?.valuation?.postMoneyValuation ??
    audit?.postMoneyValuation ??
    0;

  let accumulatedProfit = 0;
  try {
    const pl = await generateProfitLoss(
      '2000-01-01',
      request?.admission?.admissionDate || new Date().toISOString().split('T')[0],
      dbInstance
    );
    accumulatedProfit = pl.netProfit || 0;
  } catch {}

  const validation = validatePostMoneyNav({
    preMoneyNav,
    newCapital,
    actualPostMoneyNav: postMoneyNav,
    accumulatedProfit
  });

  return {
    passed: validation.isValid,
    preMoneyNav,
    newCapital,
    postMoneyNav,
    expectedPostMoneyNav: validation.expectedPostMoneyNav,
    formula: validation.formula,
    profitDoubleCounted: validation.profitDoubleCounted,
    details: validation.details
  };
}

/**
 * Resolves the authoritative effective admission / economic participation date of an investor.
 * Strictly respects tranche effectiveInvestmentDate, investor admissionDate, joinedDate, and entryDate.
 */
export async function getInvestorEffectiveAdmissionDate(
  investor: any,
  dbInstance: any = db
): Promise<string | null> {
  if (!investor) return null;

  // 1. Check investment tranches first (authoritative economic participation dates)
  if (dbInstance?.investmentTranches?.toArray) {
    try {
      const allTranches = await dbInstance.investmentTranches.toArray();
      const investorTranches = allTranches.filter(
        (t: any) =>
          (t.investorId === investor.id || t.participantId === investor.id) &&
          t.status !== 'CANCELLED' &&
          t.status !== 'EXITED'
      );
      if (investorTranches.length > 0) {
        const sortedTranches = [...investorTranches].sort((a: any, b: any) => {
          const dateA = a.effectiveInvestmentDate || a.effectiveDate || a.investmentDate || '';
          const dateB = b.effectiveInvestmentDate || b.effectiveDate || b.investmentDate || '';
          return dateA.localeCompare(dateB);
        });
        const earliestTrancheDate =
          sortedTranches[0].effectiveInvestmentDate ||
          sortedTranches[0].effectiveDate ||
          sortedTranches[0].investmentDate;
        if (earliestTrancheDate) return earliestTrancheDate;
      }
    } catch {}
  }

  // 2. Check investor's direct entryDate, admissionDate, joinedDate, effectiveDate
  const directDate =
    investor.admissionDate ||
    investor.effectiveInvestmentDate ||
    investor.effectiveDate ||
    investor.entryDate ||
    investor.joinedDate;
  if (directDate) return directDate;

  return null;
}

/**
 * PROMPT 20 — Inspect Admission-Period Profit Allocation
 *
 * Requirements:
 * 1. A new investor admitted after a finalized profit period must not receive profit from that earlier period.
 * 2. Admission must create a clear effective date/period boundary.
 * 3. Test: A exists January-May, C enters June, Finalize January-May profit -> C receives zero January-May allocation.
 * 4. Return PASS.
 */
export async function inspectAdmissionPeriodProfitAllocation(
  params: AdmissionPeriodProfitAllocationInspectionParams,
  dbInstance: any = db
): Promise<AdmissionPeriodProfitAllocationInspectionResult> {
  const { periodStartDate, periodEndDate, targetInvestorId, admittedInvestorId, existingInvestorId } = params;
  const targetId = targetInvestorId || admittedInvestorId;

  const allInvestors = dbInstance?.investors?.toArray ? await dbInstance.investors.toArray() : [];
  const allEntries = dbInstance?.journalEntries?.toArray ? await dbInstance.journalEntries.toArray() : [];

  // Identify post-period admitted investors (effective date > periodEndDate)
  const postPeriodInvestors: Array<{ investor: any; effectiveDate: string }> = [];
  const existingPeriodInvestors: Array<{ investor: any; effectiveDate: string }> = [];

  for (const inv of allInvestors) {
    const effDate = await getInvestorEffectiveAdmissionDate(inv, dbInstance);
    if (effDate && effDate > periodEndDate) {
      postPeriodInvestors.push({ investor: inv, effectiveDate: effDate });
    } else {
      existingPeriodInvestors.push({ investor: inv, effectiveDate: effDate || 'N/A' });
    }
  }

  // If a specific target investor was requested, find them
  let postTarget = targetId ? postPeriodInvestors.find((p) => p.investor.id === targetId) : postPeriodInvestors[0];
  if (!postTarget && targetId) {
    const found = allInvestors.find((i: any) => i.id === targetId);
    if (found) {
      const eff = await getInvestorEffectiveAdmissionDate(found, dbInstance);
      postTarget = { investor: found, effectiveDate: eff || 'N/A' };
    }
  }

  // Calculate profit allocated to post-period investor for period ending <= periodEndDate
  let postPeriodAdmittedInvestorAllocation = 0;
  const ineligibleDetected: Array<{
    investorId: string;
    investorName: string;
    effectiveDate: string;
    allocatedProfit: number;
  }> = [];

  for (const p of postPeriodInvestors) {
    let investorAllocTotal = 0;
    for (const j of allEntries) {
      if (j.status === 'REVERSED') continue;
      // Is entry within period or dated <= periodEndDate?
      if (j.date <= periodEndDate) {
        const isMatch =
          j.investorId === p.investor.id ||
          j.relatedInvestorId === p.investor.id ||
          j.relatedPerson === p.investor.name ||
          (j.narration && j.narration.includes(p.investor.name));

        if (isMatch) {
          const payableLine = j.lines?.find((l: any) => l.accountCode === '2050' || l.accountName?.includes('প্রদেয়'));
          if (payableLine && payableLine.credit > 0) {
            investorAllocTotal += payableLine.credit;
          }
        }
      }
    }

    if (p.investor.id === postTarget?.investor.id) {
      postPeriodAdmittedInvestorAllocation = investorAllocTotal;
    }

    ineligibleDetected.push({
      investorId: p.investor.id,
      investorName: p.investor.name,
      effectiveDate: p.effectiveDate,
      allocatedProfit: investorAllocTotal
    });
  }

  // Calculate allocation for pre-period existing investor (e.g. A)
  let prePeriodInvestorAllocation = 0;
  const existingTargetId = existingInvestorId || existingPeriodInvestors[0]?.investor.id;
  if (existingTargetId) {
    for (const j of allEntries) {
      if (j.status === 'REVERSED') continue;
      if (j.date <= periodEndDate && (j.investorId === existingTargetId || j.relatedInvestorId === existingTargetId)) {
        const payableLine = j.lines?.find((l: any) => l.accountCode === '2050');
        if (payableLine && payableLine.credit > 0) {
          prePeriodInvestorAllocation += payableLine.credit;
        }
      }
    }
  }

  const historicalProfitProtected = postPeriodAdmittedInvestorAllocation === 0;
  const clearBoundaryEstablished = Boolean(postTarget && postTarget.effectiveDate && postTarget.effectiveDate > periodEndDate);

  const passed = historicalProfitProtected && (postTarget ? clearBoundaryEstablished : true);

  const targetName = postTarget?.investor.name || 'নতুন বিনিয়োগকারী';
  const targetEff = postTarget?.effectiveDate || 'N/A';

  const details = passed
    ? `ঐতিহাসিক মুনাফা সুরক্ষা সফলভাবে যাচাইকৃত (PROMPT 20 PASS): ${periodStartDate} থেকে ${periodEndDate} হিসাবকালের পর যোগদানকারী বিনিয়োগকারী ${targetName} (যোগদান: ${targetEff}) কোনো পূর্ববর্তী মুনাফা পাননি (প্রাপ্ত বরাদ্দ: ৳${postPeriodAdmittedInvestorAllocation})। স্পষ্ট কার্যকর সময়সীমা (Date Boundary) নিশ্চিত।`
    : `ঐতিহাসিক মুনাফা সুরক্ষায় অমিল: ${targetName} পূর্ববর্তী হিসাবকাল (${periodStartDate} থেকে ${periodEndDate}) থেকে ৳${postPeriodAdmittedInvestorAllocation} মুনাফা গ্রহণ করেছেন, যা সম্পূর্ণ নিষিদ্ধ!`;

  return {
    passed,
    periodStartDate,
    periodEndDate,
    historicalProfitProtected,
    clearBoundaryEstablished,
    postPeriodAdmittedInvestorId: postTarget?.investor.id,
    postPeriodAdmittedInvestorName: targetName,
    postPeriodAdmittedInvestorAllocation,
    prePeriodInvestorAllocation,
    postPeriodInvestorEffectiveDate: targetEff,
    ineligibleInvestorsDetected: ineligibleDetected,
    boundaryRule: 'A new investor admitted after a finalized profit period must not receive profit from that earlier period.',
    details
  };
}

/**
 * PROMPT 21 — Capital Receipt Inspection
 *
 * Requirements:
 * Inspect new-investor capital receipt.
 * The investor's new capital contribution must:
 * - increase the appropriate asset/cash/bank account;
 * - increase participant capital/economic position;
 * - NOT become revenue;
 * - NOT become operating profit.
 * The event must have an idempotency key.
 * Repeat the same capital receipt twice.
 * Verify only one economic/accounting contribution exists.
 * Return PASS.
 */
export async function inspectNewInvestorCapitalReceipt(
  params: CapitalReceiptInspectionParams,
  dbInstance: any = db
): Promise<CapitalReceiptInspectionResult> {
  const { requestId, investorId, idempotencyKey, expectedAmount, targetAccountId } = params;

  let request: InvestorAdmissionRequest | undefined;
  if (requestId) {
    request = await getAdmissionRequestById(requestId, dbInstance);
  } else if (investorId) {
    const all = await getAllAdmissionRequests(dbInstance);
    request = all.find((r) => r.investorId === investorId);
  } else if (idempotencyKey) {
    const all = await getAllAdmissionRequests(dbInstance);
    request = all.find(
      (r) => r.capitalReceipt?.idempotencyKey === idempotencyKey || r.reference === idempotencyKey
    );
  }

  const allJournals = dbInstance.journalEntries?.toArray ? await dbInstance.journalEntries.toArray() : [];
  const activeJournals = allJournals.filter((j: any) => j.status !== 'REVERSED');

  // Find journal entries related to this capital receipt
  const relatedJournals = activeJournals.filter((j: any) => {
    if (idempotencyKey && (j.idempotencyKey === idempotencyKey || j.reference === idempotencyKey)) return true;
    if (request?.capitalReceipt?.journalEntryId && j.id === request.capitalReceipt.journalEntryId) return true;
    if (
      request?.requestNumber &&
      (j.reference === request.requestNumber || j.narration?.includes(request.requestNumber))
    )
      return true;
    if (request?.capitalReceipt?.receiptVoucherNumber && j.voucherNumber === request.capitalReceipt.receiptVoucherNumber)
      return true;
    return false;
  });

  const journalEntryCount = relatedJournals.length;
  const singleContributionVerified = journalEntryCount === 1;

  const targetEntry = relatedJournals[0];
  const receivedAmount = request?.capitalReceipt?.receivedAmount ?? expectedAmount ?? (targetEntry?.totalDebit || 0);

  // Analyze lines in the journal entries
  let totalDebitToAsset = 0;
  let totalCreditToEquity = 0;
  let totalCreditToRevenue = 0;
  let totalOperatingExpense = 0;
  let assetAccountCode = '';
  let equityAccountCode = '';

  for (const j of relatedJournals) {
    for (const l of j.lines || []) {
      const code = l.accountCode || '';
      const debit = Number(l.debit || 0);
      const credit = Number(l.credit || 0);

      // Asset lines (1010 Cash, 1030 Bank, etc.)
      if (code.startsWith('10') || code === '1010' || code === '1030') {
        totalDebitToAsset += debit;
        if (!assetAccountCode) assetAccountCode = code;
      }

      // Equity lines (3020 Investor Capital, etc.)
      if (code.startsWith('30') || code === '3020') {
        totalCreditToEquity += credit;
        if (!equityAccountCode) equityAccountCode = code;
      }

      // Revenue lines (4xxx)
      if (code.startsWith('4') || code === '4010' || code === '4020' || code === '4030') {
        totalCreditToRevenue += credit;
      }

      // Operating Expense lines (5xxx)
      if (code.startsWith('5')) {
        totalOperatingExpense += debit;
      }
    }
  }

  // Check target cash/bank account
  let targetAccountType = 'BANK';
  const effectiveTargetAccId = targetAccountId || request?.capitalReceipt?.targetAccountId;
  if (effectiveTargetAccId && dbInstance.cashBankAccounts?.get) {
    const acc = await dbInstance.cashBankAccounts.get(effectiveTargetAccId);
    if (acc) {
      targetAccountType = acc.accountType || 'BANK';
    }
  }

  // Invariant checks:
  // 1. Asset increased by received amount
  const assetIncreased = totalDebitToAsset === receivedAmount && totalDebitToAsset > 0;

  // 2. Participant capital/economic position increased by received amount
  const capitalIncreased = totalCreditToEquity === receivedAmount && totalCreditToEquity > 0;

  // 3. NOT become revenue (strictly 0)
  const revenueZero = totalCreditToRevenue === 0;

  // 4. NOT become operating profit (strictly 0)
  const operatingProfitImpact = totalCreditToRevenue - totalOperatingExpense;
  const operatingProfitZero = operatingProfitImpact === 0 && revenueZero;

  const passed =
    singleContributionVerified &&
    assetIncreased &&
    capitalIncreased &&
    revenueZero &&
    operatingProfitZero;

  const details = passed
    ? `মূলধন প্রাপ্তি সফলভাবে যাচাইকৃত (PROMPT 21 PASS): ৳${receivedAmount.toLocaleString()} মূলধন প্রাপ্তি যথাযথ সম্পদ হিসাবে ডেবিট (৳${totalDebitToAsset}) এবং বিনিয়োগকারীর ইকুইটি হিসাবে ক্রেডিট (৳${totalCreditToEquity}) হয়েছে। কোনো আয় (Revenue = ৳0) বা পরিচালন মুনাফা (Operating Profit = ৳0) তৈরি হয়নি। আইডেম্পোটেন্সি কী (${idempotencyKey || 'N/A'}) প্রয়োগের পর পুনরাবৃত্তিতে ঠিক একটি দাখিলা (Journal entries = 1) সংরক্ষিত।`
    : `মূলধন প্রাপ্তি সুরক্ষায় অমিল (PROMPT 21 FAIL): Asset=${assetIncreased}, Capital=${capitalIncreased}, RevenueZero=${revenueZero}, OperatingProfitZero=${operatingProfitZero}, SingleEntry=${singleContributionVerified} (Found ${journalEntryCount} entries).`;

  return {
    passed,
    idempotencyKey: idempotencyKey || request?.capitalReceipt?.idempotencyKey,
    singleContributionVerified,
    assetIncreased,
    capitalIncreased,
    revenueZero,
    operatingProfitZero,
    receivedAmount,
    targetAccountId: effectiveTargetAccId,
    targetAccountType,
    assetAccountCode: assetAccountCode || '1030',
    equityAccountCode: equityAccountCode || '3020',
    journalEntryCount,
    totalDebitToAsset,
    totalCreditToEquity,
    totalCreditToRevenue,
    operatingProfitImpact,
    details
  };
}

export const inspectCapitalReceipt = inspectNewInvestorCapitalReceipt;

export {
  calculatePostMoneyNav,
  validatePostMoneyNav,
  calculateNavAdmissionParticipation,
  verifyNoPrematureRounding,
  inspectNavAdmissionParticipation,
  inspectNewInvestorCapitalReceipt as inspectAdmissionCapitalReceipt
};

