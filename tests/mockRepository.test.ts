import { describe, it, expect } from 'vitest';
import { MockCustomerRepository } from '../src/repositories/MockCustomerRepository.js';

describe('MockCustomerRepository', () => {
  const fixedClock = () => new Date('2026-10-21T00:00:00Z');

  it('should initialize with default fictional customers covering all business scenarios', async () => {
    const repo = new MockCustomerRepository(undefined, fixedClock);
    const customers = await repo.getAllCustomers();

    expect(customers.length).toBeGreaterThanOrEqual(5);

    const ids = customers.map((c) => c.customerId);
    expect(ids).toContain('CUST-1001'); // Overdue
    expect(ids).toContain('CUST-1002'); // Paid
    expect(ids).toContain('CUST-1003'); // Upcoming
    expect(ids).toContain('CUST-1004'); // Inactive
    expect(ids).toContain('CUST-1005'); // Both
    expect(ids).toContain('CUST-1006'); // Never ordered
  });

  it('should find customer by ID (case-insensitive)', async () => {
    const repo = new MockCustomerRepository(undefined, fixedClock);
    const customer = await repo.getCustomerById('cust-1001');

    expect(customer).not.toBeNull();
    expect(customer?.customerId).toBe('CUST-1001');
    expect(customer?.customerName).toBe('Acme Industrial Supplies');
  });

  it('should return null when customer ID is not found', async () => {
    const repo = new MockCustomerRepository(undefined, fixedClock);
    const customer = await repo.getCustomerById('NON-EXISTENT-ID');

    expect(customer).toBeNull();
  });

  it('should return immutable clones of data so internal state cannot be modified externally', async () => {
    const repo = new MockCustomerRepository(undefined, fixedClock);
    const customers1 = await repo.getAllCustomers();
    customers1[0].outstandingAmount = 999999;

    const customers2 = await repo.getAllCustomers();
    expect(customers2[0].outstandingAmount).not.toBe(999999);
  });

  it('should report healthy ping and descriptive source name', async () => {
    const repo = new MockCustomerRepository(undefined, fixedClock);
    expect(await repo.ping()).toBe(true);
    expect(repo.getSourceName()).toContain('Mock Customer Repository');
  });
});
