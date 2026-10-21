import dotenv from 'dotenv';

// Load environment variables from .env if present
dotenv.config();

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  dataSource: 'mock' | 'salesforce';
  transport: 'sse' | 'streamable_http' | 'stdio';
  defaultInactivityDays: number;
  salesforce: {
    loginUrl: string;
    clientId?: string;
    clientSecret?: string;
    username?: string;
    password?: string;
    securityToken?: string;
    instanceUrl?: string;
    refreshToken?: string;
    redirectUri?: string;
    // Object and Field Mappings
    mappings: {
      customerObject: string;
      fieldCustomerId: string;
      fieldCustomerName: string;
      fieldOutstandingBalance: string;
      fieldDueDate: string;
      fieldLastOrderDate: string;
      fieldTotalOrders: string;
    };
  };
}

/**
 * Loads and sanitizes configuration from environment variables.
 */
export function loadConfig(): ServerConfig {
  // Primary data source is Salesforce Developer Edition
  const rawDataSource = process.env.DATA_SOURCE?.toLowerCase();
  const dataSource = rawDataSource === 'mock' ? 'mock' : 'salesforce';
  const transportEnv = process.env.TRANSPORT?.toLowerCase();
  const transport = (transportEnv === 'stdio' || transportEnv === 'streamable_http')
    ? transportEnv
    : 'sse';

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    dataSource,
    transport,
    defaultInactivityDays: parseInt(process.env.DEFAULT_INACTIVITY_DAYS || '60', 10),
    salesforce: {
      loginUrl: process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com',
      clientId: process.env.SALESFORCE_CLIENT_ID,
      clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
      username: process.env.SALESFORCE_USERNAME,
      password: process.env.SALESFORCE_PASSWORD,
      securityToken: process.env.SALESFORCE_SECURITY_TOKEN,
      instanceUrl: process.env.SALESFORCE_INSTANCE_URL,
      refreshToken: process.env.SALESFORCE_REFRESH_TOKEN,
      redirectUri: process.env.SALESFORCE_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
      mappings: {
        customerObject: process.env.SF_OBJECT_CUSTOMER || 'Account',
        fieldCustomerId: process.env.SF_FIELD_CUSTOMER_ID || 'Id',
        fieldCustomerName: process.env.SF_FIELD_CUSTOMER_NAME || 'Name',
        fieldOutstandingBalance: process.env.SF_FIELD_OUTSTANDING_BALANCE || 'Outstanding_Balance__c',
        fieldDueDate: process.env.SF_FIELD_DUE_DATE || 'Payment_Due_Date__c',
        fieldLastOrderDate: process.env.SF_FIELD_LAST_ORDER_DATE || 'Last_Order_Date__c',
        fieldTotalOrders: process.env.SF_FIELD_TOTAL_ORDERS || 'Total_Orders__c',
      },
    },
  };
}

export const config = loadConfig();
