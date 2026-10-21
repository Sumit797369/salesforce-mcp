import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CustomerRepository } from '../repositories/CustomerRepository.js';
import { CustomerInsightsService } from '../services/CustomerInsightsService.js';

/**
 * Registers all read-only Customer Insights tools onto the McpServer instance.
 */
export function registerCustomerTools(
  server: McpServer,
  repository: CustomerRepository,
  service: CustomerInsightsService = new CustomerInsightsService()
): void {
  /**
   * Tool 1: get_overdue_customers
   * Retrieves customers whose payments are overdue and still have an outstanding balance.
   */
  server.tool(
    'get_overdue_customers',
    'Retrieve all customers with overdue payments and an outstanding balance (> $0.00). Returns customer name, outstanding amount, due date, and days overdue.',
    {
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe('Maximum number of overdue customers to return (default: 50)'),
      minAmount: z
        .number()
        .nonnegative()
        .optional()
        .describe('Minimum outstanding balance filter in dollars (e.g., 500)'),
      asOfDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional()
        .describe('Evaluation date for overdue calculation (defaults to current system date)'),
    },
    async ({ limit, minAmount, asOfDate }) => {
      const parsedDate = asOfDate ? new Date(`${asOfDate}T00:00:00Z`) : undefined;
      const customers = await repository.getAllCustomers();
      const overdueList = service.getOverdueCustomers(customers, {
        limit: limit ?? 50,
        minAmount,
        asOfDate: parsedDate,
      });

      const totalOverdue = overdueList.reduce((sum, c) => sum + c.outstandingAmount, 0);
      const roundedTotal = Math.round(totalOverdue * 100) / 100;

      const summaryText = [
        `### Overdue Customers Report`,
        `- **Data Source**: ${repository.getSourceName()}`,
        `- **Evaluation Date**: ${asOfDate || new Date().toISOString().split('T')[0]}`,
        `- **Overdue Customer Count**: ${overdueList.length}`,
        `- **Total Overdue Amount**: $${roundedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        '',
        overdueList.length === 0
          ? 'No customers currently have overdue payments matching the criteria.'
          : [
              '| Customer ID | Customer Name | Outstanding Balance | Due Date | Days Overdue | Total Orders |',
              '| :--- | :--- | :--- | :--- | :--- | :--- |',
              ...overdueList.map(
                (c) =>
                  `| ${c.customerId} | ${c.customerName} | $${c.outstandingAmount.toFixed(2)} | ${c.dueDate} | ${c.daysOverdue} days | ${c.totalOrders} |`
              ),
            ].join('\n'),
      ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text: summaryText,
          },
          {
            type: 'text',
            text: JSON.stringify(
              {
                summary: {
                  count: overdueList.length,
                  totalOverdueAmount: roundedTotal,
                  asOfDate: asOfDate || new Date().toISOString().split('T')[0],
                  dataSource: repository.getSourceName(),
                },
                customers: overdueList,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /**
   * Tool 2: get_inactive_customers
   * Retrieves customers who have not placed a repeat order within a configurable threshold.
   */
  server.tool(
    'get_inactive_customers',
    'Retrieve customers who have not placed an order within a configurable number of days (default 60 days). Explicitly flags customers who have never ordered.',
    {
      inactivityDays: z
        .number()
        .int()
        .positive()
        .max(3650)
        .optional()
        .describe('Inactivity threshold in days (default: 60)'),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe('Maximum number of inactive customers to return (default: 50)'),
      asOfDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional()
        .describe('Evaluation date for inactivity calculation (defaults to current system date)'),
    },
    async ({ inactivityDays, limit, asOfDate }) => {
      const parsedDate = asOfDate ? new Date(`${asOfDate}T00:00:00Z`) : undefined;
      const daysThreshold = inactivityDays ?? 60;
      const customers = await repository.getAllCustomers();
      const inactiveList = service.getInactiveCustomers(customers, {
        inactivityDays: daysThreshold,
        limit: limit ?? 50,
        asOfDate: parsedDate,
      });

      const neverOrderedCount = inactiveList.filter((c) => c.status === 'never_ordered').length;
      const dormantCount = inactiveList.filter((c) => c.status === 'inactive').length;

      const summaryText = [
        `### Inactive Customers Report`,
        `- **Data Source**: ${repository.getSourceName()}`,
        `- **Inactivity Threshold**: >= ${daysThreshold} days without orders`,
        `- **Total Inactive Accounts**: ${inactiveList.length} (Dormant: ${dormantCount}, Never Ordered: ${neverOrderedCount})`,
        '',
        inactiveList.length === 0
          ? 'All customers have active order activity within the specified timeframe.'
          : [
              '| Customer ID | Customer Name | Status | Last Order Date | Days Since Order | Total Orders | Balance |',
              '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
              ...inactiveList.map((c) => {
                const daysStr = c.daysSinceLastOrder !== null ? `${c.daysSinceLastOrder} days` : 'N/A';
                const dateStr = c.lastOrderDate ?? 'None (Never Ordered)';
                return `| ${c.customerId} | ${c.customerName} | ${c.status} | ${dateStr} | ${daysStr} | ${c.totalOrders} | $${c.outstandingAmount.toFixed(2)} |`;
              }),
            ].join('\n'),
      ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text: summaryText,
          },
          {
            type: 'text',
            text: JSON.stringify(
              {
                summary: {
                  inactivityDaysThreshold: daysThreshold,
                  totalInactive: inactiveList.length,
                  dormantCount,
                  neverOrderedCount,
                  asOfDate: asOfDate || new Date().toISOString().split('T')[0],
                  dataSource: repository.getSourceName(),
                },
                customers: inactiveList,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /**
   * Tool 3: get_customer_report
   * Generates a complete structured executive summary for daily management reporting.
   */
  server.tool(
    'get_customer_report',
    'Generate an executive management report identifying overdue customers, inactive customers, customers matching both risk conditions, and total overdue balances without double-counting.',
    {
      inactivityDays: z
        .number()
        .int()
        .positive()
        .max(3650)
        .optional()
        .describe('Inactivity threshold in days for the report (default: 60)'),
      asOfDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional()
        .describe('Evaluation date for the report (defaults to current system date)'),
    },
    async ({ inactivityDays, asOfDate }) => {
      const parsedDate = asOfDate ? new Date(`${asOfDate}T00:00:00Z`) : undefined;
      const daysThreshold = inactivityDays ?? 60;
      const customers = await repository.getAllCustomers();
      const report = service.generateCustomerReport(customers, {
        inactivityDays: daysThreshold,
        asOfDate: parsedDate,
      });

      const briefing = [
        `# Executive Customer Insights & Management Report`,
        `**Report Date**: ${report.reportDate} | **Inactivity Threshold**: ${report.inactivityDaysThreshold} days`,
        `**Data Source**: ${repository.getSourceName()}`,
        '',
        `## 1. Portfolio Health Summary`,
        `- **Total Customers Evaluated**: ${report.summary.totalCustomersEvaluated}`,
        `- **Healthy Accounts (Active & Paid)**: ${report.summary.healthyCustomerCount}`,
        `- **Overdue Payment Accounts**: ${report.summary.overdueCustomerCount}`,
        `- **Total Overdue Outstanding Balance**: $${report.summary.totalOverdueAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        `- **Inactive Customer Accounts**: ${report.summary.inactiveCustomerCount}`,
        `- **High-Risk Accounts (BOTH Overdue & Inactive)**: ${report.summary.bothOverdueAndInactiveCount}`,
        '',
        `## 2. Critical Attention: Customers Matching BOTH Conditions`,
        `These customers have outstanding overdue payments AND haven't placed an order recently (highest churn/bad-debt risk):`,
        report.customersMatchingBoth.length === 0
          ? '_None! No customers currently match both risk conditions._'
          : [
              '| Customer ID | Customer Name | Overdue Balance | Days Overdue | Days Since Order | Lifetime Orders |',
              '| :--- | :--- | :--- | :--- | :--- | :--- |',
              ...report.customersMatchingBoth.map(
                (c) =>
                  `| ${c.customerId} | ${c.customerName} | $${c.outstandingAmount.toFixed(2)} | ${c.daysOverdue} days | ${c.daysSinceLastOrder !== null ? `${c.daysSinceLastOrder} days` : 'Never'} | ${c.totalOrders} |`
              ),
            ].join('\n'),
      ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text: briefing,
          },
          {
            type: 'text',
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
    }
  );

  /**
   * Tool 4: get_customer_details
   * Retrieves single customer summary and full risk evaluation by customerId.
   */
  server.tool(
    'get_customer_details',
    'Retrieve a single customer detail summary by Customer ID, including contact info, overdue payment status, days overdue, last order date, days since last order, and combined risk assessment.',
    {
      customerId: z
        .string()
        .min(1)
        .describe('Customer ID (e.g. CUST-1001 or Salesforce 18-digit Account Id)'),
      inactivityDays: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Inactivity threshold in days (default: 60)'),
      asOfDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional()
        .describe('Evaluation date for calculations (defaults to current system date)'),
    },
    async ({ customerId, inactivityDays, asOfDate }) => {
      const customer = await repository.getCustomerById(customerId);

      if (!customer) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Customer '${customerId}' was not found in the ${repository.getSourceName()}. Please verify the customer ID and try again.`,
            },
          ],
        };
      }

      const parsedDate = asOfDate ? new Date(`${asOfDate}T00:00:00Z`) : undefined;
      const detail = service.getCustomerDetailView(customer, {
        asOfDate: parsedDate,
        inactivityDays: inactivityDays ?? 60,
      });

      const statusBadge = detail.matchesBothConditions
        ? '⚠️ HIGH RISK (Overdue & Inactive)'
        : detail.isOverdue
          ? '⏳ OVERDUE BALANCE'
          : detail.isInactive
            ? '💤 INACTIVE ACCOUNT'
            : '✅ HEALTHY & ACTIVE';

      const detailText = [
        `### Customer Insight: ${customer.customerName} (${customer.customerId})`,
        `- **Account Health Status**: ${statusBadge}`,
        `- **Outstanding Balance**: $${customer.outstandingAmount.toFixed(2)}`,
        `- **Payment Due Date**: ${customer.dueDate} (${detail.isOverdue ? `${detail.daysOverdue} days overdue` : 'Current / Not Overdue'})`,
        `- **Last Order Date**: ${customer.lastOrderDate ?? 'None (Never Ordered)'} (${detail.daysSinceLastOrder !== null ? `${detail.daysSinceLastOrder} days ago` : 'N/A'})`,
        `- **Total Lifetime Orders**: ${customer.totalOrders}`,
        customer.contactEmail ? `- **Contact Email**: ${customer.contactEmail}` : '',
        `- **Data Source**: ${repository.getSourceName()}`,
      ]
        .filter(Boolean)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: detailText,
          },
          {
            type: 'text',
            text: JSON.stringify(detail, null, 2),
          },
        ],
      };
    }
  );
}
