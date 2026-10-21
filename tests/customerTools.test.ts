import { describe, it, expect } from 'vitest';
import { createCustomerInsightsServer } from '../src/server.js';
import { MockCustomerRepository } from '../src/repositories/MockCustomerRepository.js';
import { CustomerInsightsService } from '../src/services/CustomerInsightsService.js';

describe('MCP Customer Insights Tools', () => {
  const fixedDate = new Date('2026-10-21T00:00:00Z');
  const service = new CustomerInsightsService(() => fixedDate);
  const repository = new MockCustomerRepository(undefined, () => fixedDate);
  const mcpServer = createCustomerInsightsServer(repository, service);

  // Helper to access registered tool handler
  function getToolHandler(toolName: string) {
    const tool = (mcpServer as any)._registeredTools[toolName];
    if (!tool) {
      throw new Error(`Tool ${toolName} not registered on McpServer`);
    }
    return tool.handler;
  }

  describe('Tool 1: get_overdue_customers', () => {
    it('should return overdue customers with balance, due date, and days overdue', async () => {
      const handler = getToolHandler('get_overdue_customers');
      const response = await handler({ limit: 10, asOfDate: '2026-10-21' });

      expect(response).toBeDefined();
      expect(response.content).toHaveLength(2); // Markdown table + JSON block

      const textOutput = response.content[0].text;
      const jsonOutput = JSON.parse(response.content[1].text);

      expect(textOutput).toContain('Overdue Customers Report');
      expect(textOutput).toContain('CUST-1001'); // Acme Industrial
      expect(textOutput).toContain('CUST-1005'); // Delta Horizon

      expect(jsonOutput.summary.count).toBe(2);
      expect(jsonOutput.summary.totalOverdueAmount).toBeGreaterThan(0);
      expect(jsonOutput.customers).toHaveLength(2);
      expect(jsonOutput.customers[0].daysOverdue).toBeGreaterThan(0);
    });

    it('should filter by minAmount', async () => {
      const handler = getToolHandler('get_overdue_customers');
      const response = await handler({ minAmount: 10000, asOfDate: '2026-10-21' });
      const jsonOutput = JSON.parse(response.content[1].text);

      // CUST-1001 is $14,250.75, CUST-1005 is $9,820.50
      expect(jsonOutput.summary.count).toBe(1);
      expect(jsonOutput.customers[0].customerId).toBe('CUST-1001');
    });
  });

  describe('Tool 2: get_inactive_customers', () => {
    it('should return customers exceeding the inactivity threshold', async () => {
      const handler = getToolHandler('get_inactive_customers');
      const response = await handler({ inactivityDays: 60, asOfDate: '2026-10-21' });

      expect(response).toBeDefined();
      const textOutput = response.content[0].text;
      const jsonOutput = JSON.parse(response.content[1].text);

      expect(textOutput).toContain('Inactive Customers Report');
      expect(jsonOutput.summary.inactivityDaysThreshold).toBe(60);
      expect(jsonOutput.summary.totalInactive).toBe(3); // CUST-1004, CUST-1005, CUST-1006
      expect(jsonOutput.summary.neverOrderedCount).toBe(1); // CUST-1006

      const neverOrdered = jsonOutput.customers.find((c: any) => c.status === 'never_ordered');
      expect(neverOrdered).toBeDefined();
      expect(neverOrdered.customerId).toBe('CUST-1006');
    });
  });

  describe('Tool 3: get_customer_report', () => {
    it('should generate a complete executive management report', async () => {
      const handler = getToolHandler('get_customer_report');
      const response = await handler({ inactivityDays: 60, asOfDate: '2026-10-21' });

      expect(response).toBeDefined();
      const textOutput = response.content[0].text;
      const jsonOutput = JSON.parse(response.content[1].text);

      expect(textOutput).toContain('Executive Customer Insights & Management Report');
      expect(textOutput).toContain('Portfolio Health Summary');
      expect(textOutput).toContain('Critical Attention: Customers Matching BOTH Conditions');

      expect(jsonOutput.summary.totalCustomersEvaluated).toBe(6);
      expect(jsonOutput.summary.overdueCustomerCount).toBe(2);
      expect(jsonOutput.summary.inactiveCustomerCount).toBe(3);
      expect(jsonOutput.summary.bothOverdueAndInactiveCount).toBe(1);
      expect(jsonOutput.summary.healthyCustomerCount).toBe(2);
      expect(jsonOutput.customersMatchingBoth[0].customerId).toBe('CUST-1005');
    });
  });

  describe('Tool 4: get_customer_details', () => {
    it('should return detailed profile and risk analysis for a valid customer', async () => {
      const handler = getToolHandler('get_customer_details');
      const response = await handler({ customerId: 'CUST-1005', asOfDate: '2026-10-21' });

      expect(response).toBeDefined();
      expect(response.isError).toBeUndefined();

      const textOutput = response.content[0].text;
      const jsonOutput = JSON.parse(response.content[1].text);

      expect(textOutput).toContain('HIGH RISK (Overdue & Inactive)');
      expect(jsonOutput.customer.customerId).toBe('CUST-1005');
      expect(jsonOutput.isOverdue).toBe(true);
      expect(jsonOutput.isInactive).toBe(true);
      expect(jsonOutput.matchesBothConditions).toBe(true);
    });

    it('should return error response if customer is not found', async () => {
      const handler = getToolHandler('get_customer_details');
      const response = await handler({ customerId: 'UNKNOWN-XYZ' });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Customer 'UNKNOWN-XYZ' was not found");
    });
  });
});
