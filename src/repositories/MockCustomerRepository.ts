import { CustomerRecord, Clock } from '../types.js';
import { CustomerRepository } from './CustomerRepository.js';

/**
 * Helper to compute an ISO date string (YYYY-MM-DD) offset by days relative to a base date.
 */
function offsetDateStr(days: number, baseDate: Date): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Creates deterministic fictional customer records relative to a reference base date.
 * Covers all required business permutations:
 * 1. Overdue only (balance > 0, due in past, recent order)
 * 2. Paid / Zero balance (outstanding = 0, recent order)
 * 3. Upcoming due date (balance > 0, due in future)
 * 4. Inactive only (balance = 0, no orders > 60 days)
 * 5. Both conditions (balance > 0, due in past, no orders > 60 days)
 * 6. Edge case: Never ordered (lastOrderDate = null, totalOrders = 0)
 */
export function generateMockCustomers(baseDate: Date = new Date()): CustomerRecord[] {
  return [
    {
      customerId: 'CUST-1001',
      customerName: 'Acme Industrial Supplies',
      outstandingAmount: 14250.75,
      dueDate: offsetDateStr(-28, baseDate), // Overdue by 28 days
      lastOrderDate: offsetDateStr(-14, baseDate), // Ordered 14 days ago (Active)
      totalOrders: 24,
      contactEmail: 'billing@acmeindustrial.example.com',
    },
    {
      customerId: 'CUST-1002',
      customerName: 'Apex Global Logistics',
      outstandingAmount: 0.0, // Paid in full
      dueDate: offsetDateStr(-5, baseDate),
      lastOrderDate: offsetDateStr(-7, baseDate), // Ordered 7 days ago (Active)
      totalOrders: 48,
      contactEmail: 'finance@apexlogistics.example.com',
    },
    {
      customerId: 'CUST-1003',
      customerName: 'Beacon Health Systems',
      outstandingAmount: 6400.0, // Balance due, but in the future
      dueDate: offsetDateStr(15, baseDate), // Due in 15 days (Upcoming)
      lastOrderDate: offsetDateStr(-18, baseDate), // Ordered 18 days ago (Active)
      totalOrders: 12,
      contactEmail: 'ap@beaconhealth.example.com',
    },
    {
      customerId: 'CUST-1004',
      customerName: 'Cascade Creative Studio',
      outstandingAmount: 0.0, // Zero balance
      dueDate: offsetDateStr(-90, baseDate),
      lastOrderDate: offsetDateStr(-115, baseDate), // Inactive (> 60 days)
      totalOrders: 6,
      contactEmail: 'accounts@cascadecreative.example.com',
    },
    {
      customerId: 'CUST-1005',
      customerName: 'Delta Horizon Retail',
      outstandingAmount: 9820.5, // Overdue balance
      dueDate: offsetDateStr(-42, baseDate), // Overdue by 42 days
      lastOrderDate: offsetDateStr(-98, baseDate), // Inactive (> 60 days)
      totalOrders: 8,
      contactEmail: 'operations@deltahorizon.example.com',
    },
    {
      customerId: 'CUST-1006',
      customerName: 'Echo Tech Dynamics',
      outstandingAmount: 0.0,
      dueDate: offsetDateStr(10, baseDate),
      lastOrderDate: null, // Never ordered
      totalOrders: 0,
      contactEmail: 'lead@echotech.example.com',
    },
  ];
}

/**
 * In-memory Mock Customer Repository for local development, tests, and demonstration.
 * Requires no external Salesforce connection or secrets.
 */
export class MockCustomerRepository implements CustomerRepository {
  private customers: CustomerRecord[];
  private clock: Clock;

  constructor(customDataset?: CustomerRecord[], clock: Clock = () => new Date()) {
    this.clock = clock;
    this.customers = customDataset ? [...customDataset] : generateMockCustomers(this.clock());
  }

  public async getAllCustomers(): Promise<CustomerRecord[]> {
    // Return a clone to prevent mutation
    return this.customers.map((c) => ({ ...c }));
  }

  public async getCustomerById(customerId: string): Promise<CustomerRecord | null> {
    const found = this.customers.find((c) => c.customerId.toLowerCase() === customerId.toLowerCase());
    return found ? { ...found } : null;
  }

  public async ping(): Promise<boolean> {
    return true;
  }

  public getSourceName(): string {
    return 'Mock Customer Repository (Fictional In-Memory Dataset)';
  }
}
