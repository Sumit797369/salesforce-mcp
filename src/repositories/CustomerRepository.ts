import { CustomerRecord } from '../types.js';

/**
 * Interface defining operations for customer data retrieval.
 * Implementations can be MockCustomerRepository, SalesforceCustomerRepository, etc.
 * Keeps data access completely decoupled from MCP tool logic.
 */
export interface CustomerRepository {
  /**
   * Retrieves all customer records from the underlying data source.
   */
  getAllCustomers(): Promise<CustomerRecord[]>;

  /**
   * Retrieves a single customer record by its ID.
   * Returns null if not found.
   */
  getCustomerById(customerId: string): Promise<CustomerRecord | null>;

  /**
   * Checks whether the underlying data store is reachable.
   */
  ping(): Promise<boolean>;

  /**
   * Returns a friendly name of the data source for telemetry/health reporting.
   */
  getSourceName(): string;
}
