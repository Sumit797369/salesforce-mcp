import jsforce from 'jsforce';
import { CustomerRecord } from '../types.js';
import { CustomerRepository } from './CustomerRepository.js';
import { ServerConfig } from '../config.js';

export interface FieldInspectionResult {
  objectName: string;
  totalFieldsFound: number;
  customFieldsStatus: {
    outstandingBalance: { fieldName: string; exists: boolean };
    dueDate: { fieldName: string; exists: boolean };
    lastOrderDate: { fieldName: string; exists: boolean };
    totalOrders: { fieldName: string; exists: boolean };
  };
  missingCustomFields: string[];
}

/**
 * Salesforce implementation of CustomerRepository.
 * Uses jsforce to connect to Salesforce REST API via OAuth 2.0 or Username-Password flow.
 * Supports configurable object and field mappings, with dynamic schema detection so it works
 * even before custom fields are added in Salesforce Setup.
 */
export class SalesforceCustomerRepository implements CustomerRepository {
  private config: ServerConfig['salesforce'];
  private connection: jsforce.Connection | null = null;
  private authenticated: boolean = false;
  private availableFieldsCache: Set<string> | null = null;
  private warnedMissingFields: Set<string> = new Set();

  constructor(salesforceConfig: ServerConfig['salesforce']) {
    this.config = salesforceConfig;
  }

  /**
   * Initializes and authenticates the Salesforce connection.
   */
  public async getAuthenticatedConnection(): Promise<jsforce.Connection> {
    if (this.connection && this.authenticated) {
      return this.connection;
    }

    const { loginUrl, clientId, clientSecret, redirectUri, refreshToken, instanceUrl, username, password, securityToken } =
      this.config;

    // Flow 1: OAuth Refresh Token Flow (External Client App / Connected App)
    if (clientId && refreshToken && instanceUrl) {
      this.connection = new jsforce.Connection({
        oauth2: {
          clientId,
          clientSecret: clientSecret || '',
          redirectUri: redirectUri || 'http://localhost:3000/oauth/callback',
          loginUrl,
        },
        instanceUrl,
        refreshToken,
      });

      try {
        await (this.connection.oauth2 as any).authenticate({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        });
        this.authenticated = true;
        return this.connection;
      } catch (err: any) {
        throw new Error(
          `Salesforce OAuth refresh failed. Please verify Client ID and Refresh Token. Details: ${err.message}`
        );
      }
    }

    // Flow 2: Modern OAuth 2.0 Client Credentials Flow (Preferred for External Client Apps)
    if (clientId && clientSecret) {
      const endpointBase = instanceUrl || loginUrl;
      const tokenUrl = `${endpointBase.replace(/\/$/, '')}/services/oauth2/token`;

      try {
        const params = new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        });

        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        const data: any = await res.json();
        if (data.access_token && data.instance_url) {
          this.connection = new jsforce.Connection({
            instanceUrl: data.instance_url,
            accessToken: data.access_token,
          });
          this.authenticated = true;
          return this.connection;
        }

        if (data.error_description?.includes('no client credentials user enabled')) {
          // Keep note so we can guide user if needed
        }
      } catch {
        // Continue to username/password flow
      }
    }

    // Flow 3: Username / Password + Security Token (with OAuth 2.0 if Client ID/Secret provided)
    if (username && password) {
      const connOptions: any = { loginUrl };
      if (clientId && clientSecret) {
        connOptions.oauth2 = {
          clientId,
          clientSecret,
          loginUrl,
        };
      }
      this.connection = new jsforce.Connection(connOptions);

      const fullPassword = securityToken ? `${password}${securityToken}` : password;

      try {
        await this.connection.login(username, fullPassword);
        this.authenticated = true;
        return this.connection;
      } catch (err: any) {
        const safeMessage = err.message || 'Unknown authentication failure';
        throw new Error(
          `Salesforce login failed for user '${username}'. Please verify credentials, security token, and login URL. Error: ${safeMessage}`
        );
      }
    }

    throw new Error(
      'Salesforce credentials not provided in environment variables (.env). Please set SALESFORCE_USERNAME, SALESFORCE_PASSWORD, and SALESFORCE_SECURITY_TOKEN, or configure OAuth credentials.'
    );
  }

  /**
   * Introspects the Salesforce object to discover which fields currently exist.
   * Caches result to avoid repeated metadata API round-trips.
   */
  public async getAvailableFields(): Promise<Set<string>> {
    if (this.availableFieldsCache) {
      return this.availableFieldsCache;
    }

    const conn = await this.getAuthenticatedConnection();
    try {
      const meta = await conn.describe(this.config.mappings.customerObject);
      this.availableFieldsCache = new Set(meta.fields.map((f: any) => f.name.toLowerCase()));
      return this.availableFieldsCache;
    } catch (err: any) {
      // If describe fails, fall back to empty set so basic query is attempted
      return new Set();
    }
  }

  /**
   * Inspects the customer object and reports which custom fields exist vs which need to be created.
   */
  public async inspectFields(): Promise<FieldInspectionResult> {
    const available = await this.getAvailableFields();
    const { mappings } = this.config;

    const status = {
      outstandingBalance: {
        fieldName: mappings.fieldOutstandingBalance,
        exists: available.has(mappings.fieldOutstandingBalance.toLowerCase()),
      },
      dueDate: {
        fieldName: mappings.fieldDueDate,
        exists: available.has(mappings.fieldDueDate.toLowerCase()),
      },
      lastOrderDate: {
        fieldName: mappings.fieldLastOrderDate,
        exists: available.has(mappings.fieldLastOrderDate.toLowerCase()),
      },
      totalOrders: {
        fieldName: mappings.fieldTotalOrders,
        exists: available.has(mappings.fieldTotalOrders.toLowerCase()),
      },
    };

    const missingCustomFields: string[] = [];
    if (!status.outstandingBalance.exists) missingCustomFields.push(mappings.fieldOutstandingBalance);
    if (!status.dueDate.exists) missingCustomFields.push(mappings.fieldDueDate);
    if (!status.lastOrderDate.exists) missingCustomFields.push(mappings.fieldLastOrderDate);
    if (!status.totalOrders.exists) missingCustomFields.push(mappings.fieldTotalOrders);

    return {
      objectName: mappings.customerObject,
      totalFieldsFound: available.size,
      customFieldsStatus: status,
      missingCustomFields,
    };
  }

  /**
   * Synchronous static SOQL query builder using configured mappings.
   */
  public buildSoqlQuery(whereClause?: string): string {
    const { mappings } = this.config;
    const fields = [
      mappings.fieldCustomerId,
      mappings.fieldCustomerName,
      mappings.fieldOutstandingBalance,
      mappings.fieldDueDate,
      mappings.fieldLastOrderDate,
      mappings.fieldTotalOrders,
    ];
    const uniqueFields = Array.from(new Set(fields)).join(', ');
    let query = `SELECT ${uniqueFields} FROM ${mappings.customerObject}`;
    if (whereClause) {
      query += ` WHERE ${whereClause}`;
    }
    return query;
  }

  /**
   * Builds the SOQL SELECT statement dynamically based on fields that ACTUALLY exist
   * in the Salesforce org. Never crashes on missing custom fields.
   */
  public async buildDynamicSoqlQuery(whereClause?: string): Promise<string> {
    const available = await this.getAvailableFields();
    const { mappings } = this.config;

    const selectedFields: string[] = [mappings.fieldCustomerId, mappings.fieldCustomerName];

    // Standard fields if available
    const standardAdditions = ['Phone', 'Type', 'Industry', 'AnnualRevenue', 'CreatedDate'];
    for (const std of standardAdditions) {
      if (available.has(std.toLowerCase())) {
        selectedFields.push(std);
      }
    }

    // Custom fields - only include if they exist in the org!
    const customCandidates = [
      mappings.fieldOutstandingBalance,
      mappings.fieldDueDate,
      mappings.fieldLastOrderDate,
      mappings.fieldTotalOrders,
    ];

    for (const customField of customCandidates) {
      if (available.size === 0 || available.has(customField.toLowerCase())) {
        selectedFields.push(customField);
      } else if (!this.warnedMissingFields.has(customField)) {
        this.warnedMissingFields.add(customField);
        console.warn(
          `ℹ️ Notice: Custom field '${customField}' was not found on Salesforce object '${mappings.customerObject}'. Default value will be used until created in Salesforce Setup.`
        );
      }
    }

    const uniqueFields = Array.from(new Set(selectedFields)).join(', ');
    let query = `SELECT ${uniqueFields} FROM ${mappings.customerObject}`;

    if (whereClause) {
      query += ` WHERE ${whereClause}`;
    }

    return query;
  }

  /**
   * Maps a raw Salesforce record into a clean CustomerRecord domain model.
   */
  public mapRecordToCustomer(record: any): CustomerRecord {
    const { mappings } = this.config;

    const rawBalance = record[mappings.fieldOutstandingBalance];
    const outstandingAmount =
      typeof rawBalance === 'number'
        ? rawBalance
        : typeof rawBalance === 'string'
          ? parseFloat(rawBalance) || 0
          : 0;

    const rawDueDate = record[mappings.fieldDueDate];
    let dueDate = '';
    if (rawDueDate) {
      dueDate = String(rawDueDate).split('T')[0];
    } else {
      dueDate = new Date().toISOString().split('T')[0];
    }

    const rawLastOrder = record[mappings.fieldLastOrderDate];
    const lastOrderDate = rawLastOrder ? String(rawLastOrder).split('T')[0] : null;

    const rawOrders = record[mappings.fieldTotalOrders];
    const totalOrders =
      typeof rawOrders === 'number'
        ? rawOrders
        : typeof rawOrders === 'string'
          ? parseInt(rawOrders, 10) || 0
          : 0;

    const rawRevenue = record.AnnualRevenue;
    const annualRevenue =
      typeof rawRevenue === 'number'
        ? rawRevenue
        : typeof rawRevenue === 'string'
          ? parseFloat(rawRevenue) || undefined
          : undefined;

    return {
      customerId: String(record[mappings.fieldCustomerId] || record.Id || ''),
      customerName: String(record[mappings.fieldCustomerName] || record.Name || 'Unknown Account'),
      outstandingAmount: Math.max(0, outstandingAmount),
      dueDate,
      lastOrderDate,
      totalOrders: Math.max(0, totalOrders),
      contactEmail: record.BillingEmail || undefined,
      phone: record.Phone || undefined,
      type: record.Type || undefined,
      industry: record.Industry || undefined,
      annualRevenue,
    };
  }

  /**
   * Retrieves all customers with automatic pagination handling via jsforce autoFetch.
   */
  public async getAllCustomers(): Promise<CustomerRecord[]> {
    try {
      const conn = await this.getAuthenticatedConnection();
      const soql = await this.buildDynamicSoqlQuery();

      const result = await conn
        .query<any>(soql)
        .autoFetch(true)
        .maxFetch(5000)
        .execute();

      return result.records.map((r) => this.mapRecordToCustomer(r));
    } catch (err: any) {
      if (err.errorCode === 'INVALID_SESSION_ID') {
        this.authenticated = false;
        this.connection = null;
        throw new Error('Salesforce session expired. Next request will attempt automatic reconnection.');
      }

      if (err.errorCode === 'INVALID_FIELD') {
        throw new Error(
          `Salesforce field error: One or more requested fields do not exist on '${this.config.mappings.customerObject}'. Details: ${err.message}`
        );
      }

      if (err.errorCode === 'INVALID_TYPE') {
        throw new Error(
          `Salesforce object '${this.config.mappings.customerObject}' was not found. Please verify SF_OBJECT_CUSTOMER in .env. Details: ${err.message}`
        );
      }

      throw new Error(`Failed to query Salesforce customer data: ${err.message}`);
    }
  }

  /**
   * Retrieves a single customer by Salesforce record ID.
   */
  public async getCustomerById(customerId: string): Promise<CustomerRecord | null> {
    try {
      const conn = await this.getAuthenticatedConnection();
      const sanitizedId = customerId.replace(/'/g, "\\'");
      const soql = await this.buildDynamicSoqlQuery(
        `${this.config.mappings.fieldCustomerId} = '${sanitizedId}'`
      );

      const result = await conn.query<any>(soql).execute();
      if (!result.records || result.records.length === 0) {
        return null;
      }

      return this.mapRecordToCustomer(result.records[0]);
    } catch (err: any) {
      throw new Error(`Failed to query customer '${customerId}' in Salesforce: ${err.message}`);
    }
  }

  /**
   * Health ping to verify Salesforce connectivity.
   */
  public async ping(): Promise<boolean> {
    try {
      const conn = await this.getAuthenticatedConnection();
      await conn.identity();
      return true;
    } catch {
      return false;
    }
  }

  public getSourceName(): string {
    const org = this.config.instanceUrl || this.config.loginUrl;
    return `Salesforce REST API (${org}) [Object: ${this.config.mappings.customerObject}]`;
  }
}
