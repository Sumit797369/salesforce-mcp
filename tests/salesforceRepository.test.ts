import { describe, it, expect } from 'vitest';
import { SalesforceCustomerRepository } from '../src/repositories/SalesforceCustomerRepository.js';
import { MockCustomerRepository } from '../src/repositories/MockCustomerRepository.js';
import { CustomerRepository } from '../src/repositories/CustomerRepository.js';
import { ServerConfig } from '../src/config.js';

describe('SalesforceCustomerRepository & Data Source Switching', () => {
  const dummySalesforceConfig: ServerConfig['salesforce'] = {
    loginUrl: 'https://test.salesforce.com',
    mappings: {
      customerObject: 'Account',
      fieldCustomerId: 'Id',
      fieldCustomerName: 'Name',
      fieldOutstandingBalance: 'Outstanding_Balance__c',
      fieldDueDate: 'Payment_Due_Date__c',
      fieldLastOrderDate: 'Last_Order_Date__c',
      fieldTotalOrders: 'Total_Orders__c',
    },
  };

  it('should implement the CustomerRepository interface contract', () => {
    const mockRepo: CustomerRepository = new MockCustomerRepository();
    const sfRepo: CustomerRepository = new SalesforceCustomerRepository(dummySalesforceConfig);

    expect(typeof mockRepo.getAllCustomers).toBe('function');
    expect(typeof mockRepo.getCustomerById).toBe('function');
    expect(typeof mockRepo.ping).toBe('function');
    expect(typeof mockRepo.getSourceName).toBe('function');

    expect(typeof sfRepo.getAllCustomers).toBe('function');
    expect(typeof sfRepo.getCustomerById).toBe('function');
    expect(typeof sfRepo.ping).toBe('function');
    expect(typeof sfRepo.getSourceName).toBe('function');
  });

  it('should safely fail with descriptive error when credentials are not configured', async () => {
    const repo = new SalesforceCustomerRepository(dummySalesforceConfig);

    await expect(repo.getAllCustomers()).rejects.toThrow(
      'Salesforce credentials not provided'
    );
  });

  it('should report unreachable when pinging without credentials', async () => {
    const repo = new SalesforceCustomerRepository(dummySalesforceConfig);
    const isReachable = await repo.ping();
    expect(isReachable).toBe(false);
  });

  it('should build SOQL queries accurately with custom field mappings', () => {
    const customConfig: ServerConfig['salesforce'] = {
      loginUrl: 'https://login.salesforce.com',
      mappings: {
        customerObject: 'Client__c',
        fieldCustomerId: 'External_ID__c',
        fieldCustomerName: 'Company_Name__c',
        fieldOutstandingBalance: 'Arrears_Amount__c',
        fieldDueDate: 'Due__c',
        fieldLastOrderDate: 'Recent_Purchase__c',
        fieldTotalOrders: 'Purchase_Count__c',
      },
    };

    const repo = new SalesforceCustomerRepository(customConfig);
    const soql = (repo as any).buildSoqlQuery();

    expect(soql).toContain('FROM Client__c');
    expect(soql).toContain('External_ID__c');
    expect(soql).toContain('Company_Name__c');
    expect(soql).toContain('Arrears_Amount__c');
    expect(soql).toContain('Due__c');
    expect(soql).toContain('Recent_Purchase__c');
    expect(soql).toContain('Purchase_Count__c');
  });

  it('should map raw Salesforce records properly handling missing fields and string numbers', () => {
    const repo = new SalesforceCustomerRepository(dummySalesforceConfig);

    const rawRecord = {
      Id: '001xx000003DGb2AAG',
      Name: 'Global Media Corp',
      Outstanding_Balance__c: '4500.50', // string format from some REST responses
      Payment_Due_Date__c: '2026-10-15T00:00:00.000Z',
      Last_Order_Date__c: null, // missing last order
      Total_Orders__c: '15',
      BillingEmail: 'billing@globalmedia.example.com',
    };

    const mapped = (repo as any).mapRecordToCustomer(rawRecord);

    expect(mapped.customerId).toBe('001xx000003DGb2AAG');
    expect(mapped.customerName).toBe('Global Media Corp');
    expect(mapped.outstandingAmount).toBe(4500.5);
    expect(mapped.dueDate).toBe('2026-10-15');
    expect(mapped.lastOrderDate).toBeNull();
    expect(mapped.totalOrders).toBe(15);
    expect(mapped.contactEmail).toBe('billing@globalmedia.example.com');
  });
});
