import { AmortizationScheduleItem } from '../types';

/**
 * Calculates the exact date 1 calendar month after the given YYYY-MM-DD date.
 * Accurately handles month length differences (e.g., Jan 31 -> Feb 28/29).
 */
export function addMonthsToDate(dateStr: string, monthsToAdd: number): string {
  if (!dateStr || !dateStr.includes('-')) {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }
  const parts = dateStr.split('-').map(Number);
  const origYear = parts[0];
  const origMonth = parts[1]; // 1-indexed (1-12)
  const origDay = parts[2];

  const totalMonths = (origYear * 12 + (origMonth - 1)) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1; // 1-indexed

  const daysInTargetMonth = new Date(targetYear, targetMonth, 0).getDate();
  const targetDay = Math.min(origDay, daysInTargetMonth);

  return `${targetYear.toString().padStart(4, '0')}-${targetMonth.toString().padStart(2, '0')}-${targetDay.toString().padStart(2, '0')}`;
}

/**
 * Generates an amortization schedule using reducing-balance method (standard EMI).
 * If interest rate is 0%, straightforward straight-line distribution is used.
 * 
 * @param principal Principal loan amount
 * @param annualRatePercent Annual interest rate (e.g. 9 for 9%)
 * @param termMonths Number of installment months (e.g. 12)
 * @param startDate Starting/disbursement date (YYYY-MM-DD)
 */
export function generateAmortizationSchedule(
  principal: number,
  annualRatePercent: number,
  termMonths: number,
  startDate?: string
): AmortizationScheduleItem[] {
  const p = Math.max(0, Number(principal) || 0);
  const rAnnual = Math.max(0, Number(annualRatePercent) || 0);
  const n = Math.max(1, Math.round(Number(termMonths) || 12));
  const baseDate = startDate || new Date().toISOString().split('T')[0];

  if (p <= 0) {
    return [];
  }

  const schedule: AmortizationScheduleItem[] = [];
  const monthlyRate = rAnnual > 0 ? (rAnnual / 100) / 12 : 0;

  // Monthly installment (EMI) for reducing balance:
  // EMI = P * r * (1+r)^n / ((1+r)^n - 1)
  let emi = 0;
  if (monthlyRate > 0) {
    const compound = Math.pow(1 + monthlyRate, n);
    emi = (p * monthlyRate * compound) / (compound - 1);
  } else {
    emi = p / n;
  }

  let remaining = p;

  for (let i = 1; i <= n; i++) {
    const installmentDate = addMonthsToDate(baseDate, i);
    let interestPortion = 0;
    let principalPortion = 0;

    if (monthlyRate > 0) {
      interestPortion = Math.round(remaining * monthlyRate * 100) / 100;
      if (i === n) {
        // Last month: principal clears remaining balance
        principalPortion = remaining;
      } else {
        principalPortion = Math.round((emi - interestPortion) * 100) / 100;
        if (principalPortion > remaining) {
          principalPortion = remaining;
        }
      }
    } else {
      // 0% interest: Straight-line
      if (i === n) {
        principalPortion = remaining;
      } else {
        principalPortion = Math.round((p / n) * 100) / 100;
      }
      interestPortion = 0;
    }

    const totalPayment = Math.round((principalPortion + interestPortion) * 100) / 100;
    remaining = Math.max(0, Math.round((remaining - principalPortion) * 100) / 100);

    schedule.push({
      installmentNumber: i,
      date: installmentDate,
      principalPortion,
      interestPortion,
      totalPayment,
      remainingBalance: remaining,
      isPaid: false
    });
  }

  return schedule;
}
