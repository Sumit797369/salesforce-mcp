import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CustomerRepository } from './repositories/CustomerRepository.js';
import { CustomerInsightsService } from './services/CustomerInsightsService.js';
import { registerCustomerTools } from './tools/customerTools.js';

/**
 * Creates and configures the McpServer instance with registered customer insight tools.
 */
export function createCustomerInsightsServer(
  repository: CustomerRepository,
  service?: CustomerInsightsService
): McpServer {
  const server = new McpServer({
    name: 'salesforce-customer-insights-mcp',
    version: '1.0.0',
  });

  registerCustomerTools(server, repository, service);

  return server;
}
