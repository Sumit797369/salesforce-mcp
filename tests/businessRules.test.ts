import { describe, it, expect } from 'vitest';
import { CustomerInsightsService } from '../src/services/CustomerInsightsService.js';
import { CustomerRecord } from '../src/types.js';

describe('CustomerInsightsService - Business Logic & Rules', () => {
  // Fixed deterministic clock: 2026-10-21T00:00:00Z
  const frozenDate = new Date('2026-10-21T00:00:00Z');
  const service = new CustomerInsightsService(() => frozenDate);

  const testCustomers: CustomerRecord[] = [
    {
      // 1. Overdue: balance > 0, due 15 days ago, ordered 5 days ago
      customerId: 'CUST-001',
      customerName: 'Alpha Corp',
      outstandingAmount: 5000.0,
      dueDate: '2026-10-06',
      lastOrderDate: '2026-10-16',
      totalOrders: 10,
    },
    {
      // 2. Paid: balance = 0, due 20 days ago (Paid on time), ordered 10 days ago
      customerId: 'CUST-002',
      customerName: 'Beta LLC',
      outstandingAmount: 0.0,
      dueDate: '2026-10-01',
      lastOrderDate: '2026-10-11',
      totalOrders: 5,
    },
    {
      // 3. Upcoming: balance > 0, due 10 days in future, ordered 2 days ago
      customerId: 'CUST-003',
      customerName: 'Gamma Inc',
      outstandingAmount: 3200.5,
      dueDate: '2026-10-31',
      lastOrderDate: '2026-10-19',
      totalOrders: 20,
    },
    {
      // 4. Inactive only: balance = 0, due 80 days ago, ordered 90 days ago (> 60 days)
      customerId: 'CUST-004',
      customerName: 'Delta Systems',
      outstandingAmount: 0.0,
      dueDate: '2026-08-02',
      lastOrderDate: '2026-07-23',
      totalOrders: 3,
    },
    {
      // 5. BOTH overdue & inactive: balance > 0, due 30 days ago, ordered 100 days ago
      customerId: 'CUST-005',
      customerName: 'Epsilon Tech',
      outstandingAmount: 7500.25,
      dueDate: '2026-09-21',
      lastOrderDate: '2026-07-13',
      totalOrders: 8,
    },
    {
      // 6. Never ordered: balance = 0, due in future, lastOrderDate = null
      customerId: 'CUST-006',
      customerName: 'Zeta Innovations',
      outstandingAmount: 0.0,
      dueDate: '2026-11-01',
      lastOrderDate: null,
      totalOrders: 0,
    },
  ];

  describe('Rule 1: Overdue Payment Filtering', () => {
    it('should identify customers whose payments are strictly overdue and balance > 0', () => {
      const overdue = service.getOverdueCustomers(testCustomers);

      expect(overdue).toHaveLength(2); // CUST-001 and CUST-005
      const ids = overdue.map((c) => c.customerId);
      expect(ids).toContain('CUST-001');
      expect(ids).toContain('CUST-005');
    });

    it('should exclude paid customers ($0.00 balance) even if due date is in the past', () => {
      const overdue = service.getOverdueCustomers(testCustomers);
      const paidCustomer = overdue.find((c) => c.customerId === 'CUST-002');
      expect(paidCustomer).toBeUndefined();
    });

    it('should exclude upcoming payments where due date is in the future', () => {
      const overdue = service.getOverdueCustomers(testCustomers);
      const upcomingCustomer = overdue.find((c) => c.customerId === 'CUST-003');
      expect(upcomingCustomer).toBeUndefined();
    });

    it('should calculate accurate days overdue', () => {
      const overdue = service.getOverdueCustomers(testCustomers);
      const cust1 = overdue.find((c) => c.customerId === 'CUST-001')!;
      // 2026-10-06 to 2026-10-21 = 15 days
      expect(cust1.daysOverdue).toBe(15);
      expect(cust1.outstandingAmount).toBe(5000.0);

      const cust5 = overdue.find((c) => c.customerId === 'CUST-005')!;
      // 2026-09-21 to 2026-10-21 = 30 days
      expect(cust5.daysOverdue).toBe(30);
    });

    it('should filter by minimum outstanding amount when minAmount is provided', () => {
      const overdue = service.getOverdueCustomers(testCustomers, { minAmount: 6000 });
      expect(overdue).toHaveLength(1);
      expect(overdue[0].customerId).toBe('CUST-005');
    });

    it('should respect the limit option', () => {
      const overdue = service.getOverdueCustomers(testCustomers, { limit: 1 });
      expect(overdue).toHaveLength(1);
      // Most overdue first (CUST-005: 30 days)
      expect(overdue[0].customerId).toBe('CUST-005');
    });
  });

  describe('Rule 2: Inactivity Thresholds & Handling Missing Dates', () => {
    it('should identify customers who have not ordered within default 60 days', () => {
      const inactive = service.getInactiveCustomers(testCustomers, { inactivityDays: 60 });

      // CUST-004 (90 days), CUST-005 (100 days), CUST-006 (never ordered)
      expect(inactive).toHaveLength(3);
      const ids = inactive.map((c) => c.customerId);
      expect(ids).toContain('CUST-004');
      expect(ids).toContain('CUST-005');
      expect(ids).toContain('CUST-006');
    });

    it('should explicitly flag customers who have never ordered', () => {
      const inactive = service.getInactiveCustomers(testCustomers, { inactivityDays: 60 });
      const neverOrdered = inactive.find((c) => c.customerId === 'CUST-006')!;

      expect(neverOrdered).toBeDefined();
      expect(neverOrdered.status).toBe('never_ordered');
      expect(neverOrdered.lastOrderDate).toBeNull();
      expect(neverOrdered.daysSinceLastOrder).toBeNull();
    });

    it('should exclude active customers who ordered within threshold', () => {
      const inactive = service.getInactiveCustomers(testCustomers, { inactivityDays: 60 });
      const ids = inactive.map((c) => c.customerId);

      expect(ids).not.toContain('CUST-001'); // 5 days ago
      expect(ids).not.toContain('CUST-002'); // 10 days ago
      expect(ids).not.toContain('CUST-003'); // 2 days ago
    });

    it('should adjust results dynamically with custom inactivity threshold', () => {
      // Threshold 95 days: CUST-004 (90 days) should now be ACTIVE!
      const inactive = service.getInactiveCustomers(testCustomers, { inactivityDays: 95 });
      const ids = inactive.map((c) => c.customerId);

      expect(ids).not.toContain('CUST-004');
      expect(ids).toContain('CUST-005'); // 100 days
      expect(ids).toContain('CUST-006'); // never ordered
    });
  });

  describe('Rule 3 & 4: Combined Conditions and Total Calculations', () => {
    it('should accurately detect customers matching BOTH overdue and inactive conditions', () => {
      const report = service.generateCustomerReport(testCustomers, { inactivityDays: 60 });

      expect(report.customersMatchingBoth).toHaveLength(1);
      expect(report.customersMatchingBoth[0].customerId).toBe('CUST-005');
      expect(report.customersMatchingBoth[0].customerName).toBe('Epsilon Tech');
      expect(report.customersMatchingBoth[0].outstandingAmount).toBe(7500.25);
      expect(report.customersMatchingBoth[0].daysOverdue).toBe(30);
    });

    it('should calculate total overdue amount accurately without floating point rounding artifacts', () => {
      const report = service.generateCustomerReport(testCustomers);

      // CUST-001 ($5000.00) + CUST-005 ($7500.25) = $12500.25
      expect(report.summary.totalOverdueAmount).toBe(12500.25);
    });

    it('should ensure summary counts do NOT double-count customers across categories', () => {
      const report = service.generateCustomerReport(testCustomers, { inactivityDays: 60 });

      expect(report.summary.totalCustomersEvaluated).toBe(6);
      expect(report.summary.overdueCustomerCount).toBe(2); // CUST-001, CUST-005
      expect(report.summary.inactiveCustomerCount).toBe(3); // CUST-004, CUST-005, CUST-006
      expect(report.summary.bothOverdueAndInactiveCount).toBe(1); // CUST-005
      expect(report.summary.healthyCustomerCount).toBe(2); // CUST-002, CUST-003

      // Partition equation: total = healthy + overdue + inactive - both
      const partitionedSum =
        report.summary.healthyCustomerCount +
        report.summary.overdueCustomerCount +
        report.summary.inactiveCustomerCount -
        report.summary.bothOverdueAndInactiveCount;

      expect(partitionedSum).toBe(report.summary.totalCustomersEvaluated);
    });
  });

  describe('Single Customer Detail View', () => {
    it('should return complete detail view for a high-risk customer', () => {
      const cust5 = testCustomers.find((c) => c.customerId === 'CUST-005')!;
      const detail = service.getCustomerDetailView(cust5, { inactivityDays: 60 });

      expect(detail.isOverdue).toBe(true);
      expect(detail.daysOverdue).toBe(30);
      expect(detail.isInactive).toBe(true);
      expect(detail.matchesBothConditions).toBe(true);
      expect(detail.inactivityStatus).toBe('inactive');
    });

    it('should return healthy status for paid, active customer', () => {
      const cust2 = testCustomers.find((c) => c.customerId === 'CUST-002')!;
      const detail = service.getCustomerDetailView(cust2, { inactivityDays: 60 });

      expect(detail.isOverdue).toBe(false);
      expect(detail.daysOverdue).toBe(0);
      expect(detail.isInactive).toBe(false);
      expect(detail.matchesBothConditions).toBe(false);
      expect(detail.inactivityStatus).toBe('active');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should throw an error for unparseable dates', () => {
      expect(() => {
        service.calculateDaysElapsed('invalid-date-string', frozenDate);
      }).toThrow('Invalid date encountered');
    });
  });
});
