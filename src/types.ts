/**
 * Data structures and domain models for Customer Insights MCP Server.
 */

/**
 * Raw customer record representation from a data store (Mock or Salesforce).
 */
export interface CustomerRecord {
  /** Unique customer identifier (e.g., CUST-1001 or Salesforce Account 18-char Id) */
  customerId: string;
  /** Name of customer / company */
  customerName: string;
  /** Current outstanding unpaid balance (currency). Must be >= 0 */
  outstandingAmount: number;
  /** Due date for payment in ISO format (YYYY-MM-DD or full ISO 8601) */
  dueDate: string;
  /** Date of most recent placed order, or null if customer has never ordered */
  lastOrderDate: string | null;
  /** Total count of lifetime orders placed */
  totalOrders: number;
  /** Optional customer email / contact for communication */
  contactEmail?: string;
  phone?: string;
  type?: string;
  industry?: string;
  annualRevenue?: number;
}

/**
 * Detailed insight for a customer with an overdue payment.
 */
export interface OverdueCustomerInsight {
  customerId: string;
  customerName: string;
  outstandingAmount: number;
  dueDate: string;
  daysOverdue: number;
  totalOrders: number;
  lastOrderDate: string | null;
}

/**
 * Detailed insight for an inactive customer.
 */
export interface InactiveCustomerInsight {
  customerId: string;
  customerName: string;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  totalOrders: number;
  outstandingAmount: number;
  status: 'inactive' | 'never_ordered';
}

/**
 * Insight for a customer matching BOTH overdue and inactive conditions.
 */
export interface BothOverdueAndInactiveInsight {
  customerId: string;
  customerName: string;
  outstandingAmount: number;
  dueDate: string;
  daysOverdue: number;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  totalOrders: number;
}

/**
 * High-level executive management summary report.
 */
export interface CustomerInsightReport {
  reportDate: string;
  inactivityDaysThreshold: number;
  summary: {
    totalCustomersEvaluated: number;
    overdueCustomerCount: number;
    totalOverdueAmount: number;
    inactiveCustomerCount: number;
    bothOverdueAndInactiveCount: number;
    healthyCustomerCount: number;
  };
  overdueCustomers: OverdueCustomerInsight[];
  inactiveCustomers: InactiveCustomerInsight[];
  customersMatchingBoth: BothOverdueAndInactiveInsight[];
}

/**
 * Detailed view for an individual customer.
 */
export interface CustomerDetailView {
  customer: CustomerRecord;
  evaluationDate: string;
  isOverdue: boolean;
  daysOverdue: number;
  isInactive: boolean;
  daysSinceLastOrder: number | null;
  inactivityStatus: 'active' | 'inactive' | 'never_ordered';
  matchesBothConditions: boolean;
}

/**
 * Options for filtering overdue customers.
 */
export interface OverdueFilterOptions {
  limit?: number;
  minAmount?: number;
  asOfDate?: Date;
}

/**
 * Options for filtering inactive customers.
 */
export interface InactiveFilterOptions {
  inactivityDays?: number;
  limit?: number;
  asOfDate?: Date;
}

/**
 * Options for generating customer reports.
 */
export interface ReportFilterOptions {
  inactivityDays?: number;
  asOfDate?: Date;
}

/**
 * Clock provider interface for deterministic testing.
 */
export type Clock = () => Date;
