import {
  CustomerRecord,
  OverdueCustomerInsight,
  InactiveCustomerInsight,
  BothOverdueAndInactiveInsight,
  CustomerInsightReport,
  CustomerDetailView,
  OverdueFilterOptions,
  InactiveFilterOptions,
  ReportFilterOptions,
  Clock,
} from '../types.js';

/**
 * Service encapsulating pure business logic for customer financial and engagement insights.
 * Designed with dependency injection for time (Clock) so all calculations are 100% deterministic.
 */
export class CustomerInsightsService {
  private clock: Clock;

  constructor(clock: Clock = () => new Date()) {
    this.clock = clock;
  }

  /**
   * Helper to normalize a date string or Date object to midnight UTC timestamp for day-accurate math.
   */
  private normalizeDate(dateInput: string | Date): Date {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date encountered: ${dateInput}`);
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  /**
   * Calculates calendar days elapsed between two dates.
   * Returns positive integer if targetDate is before baseDate.
   */
  public calculateDaysElapsed(targetDateInput: string | Date, baseDateInput: Date): number {
    const target = this.normalizeDate(targetDateInput);
    const base = this.normalizeDate(baseDateInput);
    const msDiff = base.getTime() - target.getTime();
    return Math.floor(msDiff / (1000 * 60 * 60 * 24));
  }

  /**
   * Business Rule 1: A payment is overdue ONLY when outstanding balance > 0
   * AND its due date is strictly before the evaluation date.
   */
  public isOverdue(customer: CustomerRecord, asOfDate: Date = this.clock()): boolean {
    if (!customer.outstandingAmount || customer.outstandingAmount <= 0) {
      return false;
    }
    const days = this.calculateDaysElapsed(customer.dueDate, asOfDate);
    return days > 0;
  }

  /**
   * Computes the number of days a customer's payment is overdue.
   * Returns 0 if payment is not overdue or has no balance.
   */
  public getDaysOverdue(customer: CustomerRecord, asOfDate: Date = this.clock()): number {
    if (!this.isOverdue(customer, asOfDate)) {
      return 0;
    }
    return Math.max(0, this.calculateDaysElapsed(customer.dueDate, asOfDate));
  }

  /**
   * Business Rule 2: A customer is inactive when lastOrderDate is at least
   * inactivityDays before the evaluation date, or has never ordered.
   */
  public getInactivityEvaluation(
    customer: CustomerRecord,
    inactivityDays: number = 60,
    asOfDate: Date = this.clock()
  ): {
    isInactive: boolean;
    status: 'active' | 'inactive' | 'never_ordered';
    daysSinceLastOrder: number | null;
  } {
    if (!customer.lastOrderDate) {
      // Explicitly handle missing order date
      return {
        isInactive: true,
        status: 'never_ordered',
        daysSinceLastOrder: null,
      };
    }

    const daysSince = this.calculateDaysElapsed(customer.lastOrderDate, asOfDate);

    // If order was placed today or in the past within threshold, they are active
    if (daysSince < inactivityDays) {
      return {
        isInactive: false,
        status: 'active',
        daysSinceLastOrder: Math.max(0, daysSince),
      };
    }

    return {
      isInactive: true,
      status: 'inactive',
      daysSinceLastOrder: daysSince,
    };
  }

  /**
   * Filters and returns overdue customers with calculated insights.
   */
  public getOverdueCustomers(
    customers: CustomerRecord[],
    options: OverdueFilterOptions = {}
  ): OverdueCustomerInsight[] {
    const asOfDate = options.asOfDate || this.clock();
    const minAmount = options.minAmount ?? 0;

    const overdueList: OverdueCustomerInsight[] = [];

    for (const cust of customers) {
      if (this.isOverdue(cust, asOfDate) && cust.outstandingAmount >= minAmount) {
        overdueList.push({
          customerId: cust.customerId,
          customerName: cust.customerName,
          outstandingAmount: cust.outstandingAmount,
          dueDate: cust.dueDate,
          daysOverdue: this.getDaysOverdue(cust, asOfDate),
          totalOrders: cust.totalOrders,
          lastOrderDate: cust.lastOrderDate,
        });
      }
    }

    // Sort by days overdue descending (most urgent first), then amount descending
    overdueList.sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstandingAmount - a.outstandingAmount);

    if (options.limit && options.limit > 0) {
      return overdueList.slice(0, options.limit);
    }

    return overdueList;
  }

  /**
   * Filters and returns inactive customers based on configured threshold.
   */
  public getInactiveCustomers(
    customers: CustomerRecord[],
    options: InactiveFilterOptions = {}
  ): InactiveCustomerInsight[] {
    const asOfDate = options.asOfDate || this.clock();
    const inactivityDays = options.inactivityDays ?? 60;

    const inactiveList: InactiveCustomerInsight[] = [];

    for (const cust of customers) {
      const evaluation = this.getInactivityEvaluation(cust, inactivityDays, asOfDate);
      if (evaluation.isInactive) {
        inactiveList.push({
          customerId: cust.customerId,
          customerName: cust.customerName,
          lastOrderDate: cust.lastOrderDate,
          daysSinceLastOrder: evaluation.daysSinceLastOrder,
          totalOrders: cust.totalOrders,
          outstandingAmount: cust.outstandingAmount,
          status: evaluation.status === 'never_ordered' ? 'never_ordered' : 'inactive',
        });
      }
    }

    // Sort: never_ordered first, then by daysSinceLastOrder descending
    inactiveList.sort((a, b) => {
      if (a.status === 'never_ordered' && b.status !== 'never_ordered') return -1;
      if (a.status !== 'never_ordered' && b.status === 'never_ordered') return 1;
      return (b.daysSinceLastOrder ?? 0) - (a.daysSinceLastOrder ?? 0);
    });

    if (options.limit && options.limit > 0) {
      return inactiveList.slice(0, options.limit);
    }

    return inactiveList;
  }

  /**
   * Generates a complete executive management insight report.
   * Ensures no customer is double-counted in combined counts, and sums overdue amounts safely.
   */
  public generateCustomerReport(
    customers: CustomerRecord[],
    options: ReportFilterOptions = {}
  ): CustomerInsightReport {
    const asOfDate = options.asOfDate || this.clock();
    const inactivityDays = options.inactivityDays ?? 60;

    const overdueCustomers = this.getOverdueCustomers(customers, { asOfDate });
    const inactiveCustomers = this.getInactiveCustomers(customers, { asOfDate, inactivityDays });

    // Build lookup sets for fast matching
    const overdueMap = new Map(overdueCustomers.map((c) => [c.customerId, c]));
    const inactiveMap = new Map(inactiveCustomers.map((c) => [c.customerId, c]));

    const customersMatchingBoth: BothOverdueAndInactiveInsight[] = [];
    let totalOverdueAmount = 0;

    for (const overdue of overdueCustomers) {
      // Sum outstanding amounts safely (cents-precision arithmetic)
      totalOverdueAmount = Math.round((totalOverdueAmount + overdue.outstandingAmount) * 100) / 100;

      const inactiveMatch = inactiveMap.get(overdue.customerId);
      if (inactiveMatch) {
        customersMatchingBoth.push({
          customerId: overdue.customerId,
          customerName: overdue.customerName,
          outstandingAmount: overdue.outstandingAmount,
          dueDate: overdue.dueDate,
          daysOverdue: overdue.daysOverdue,
          lastOrderDate: inactiveMatch.lastOrderDate,
          daysSinceLastOrder: inactiveMatch.daysSinceLastOrder,
          totalOrders: overdue.totalOrders,
        });
      }
    }

    // Sort both-conditions list by risk (highest overdue amount first)
    customersMatchingBoth.sort((a, b) => b.outstandingAmount - a.outstandingAmount);

    // Compute healthy customers: not overdue AND not inactive
    let healthyCount = 0;
    for (const cust of customers) {
      const isCustOverdue = overdueMap.has(cust.customerId);
      const isCustInactive = inactiveMap.has(cust.customerId);
      if (!isCustOverdue && !isCustInactive) {
        healthyCount++;
      }
    }

    return {
      reportDate: asOfDate.toISOString().split('T')[0],
      inactivityDaysThreshold: inactivityDays,
      summary: {
        totalCustomersEvaluated: customers.length,
        overdueCustomerCount: overdueCustomers.length,
        totalOverdueAmount,
        inactiveCustomerCount: inactiveCustomers.length,
        bothOverdueAndInactiveCount: customersMatchingBoth.length,
        healthyCustomerCount: healthyCount,
      },
      overdueCustomers,
      inactiveCustomers,
      customersMatchingBoth,
    };
  }

  /**
   * Generates a comprehensive detail view for a single customer.
   */
  public getCustomerDetailView(
    customer: CustomerRecord,
    options: { asOfDate?: Date; inactivityDays?: number } = {}
  ): CustomerDetailView {
    const asOfDate = options.asOfDate || this.clock();
    const inactivityDays = options.inactivityDays ?? 60;

    const isOverdue = this.isOverdue(customer, asOfDate);
    const daysOverdue = this.getDaysOverdue(customer, asOfDate);
    const inactivityEval = this.getInactivityEvaluation(customer, inactivityDays, asOfDate);
    const matchesBoth = isOverdue && inactivityEval.isInactive;

    return {
      customer,
      evaluationDate: asOfDate.toISOString().split('T')[0],
      isOverdue,
      daysOverdue,
      isInactive: inactivityEval.isInactive,
      daysSinceLastOrder: inactivityEval.daysSinceLastOrder,
      inactivityStatus: inactivityEval.status,
      matchesBothConditions: matchesBoth,
    };
  }
}
