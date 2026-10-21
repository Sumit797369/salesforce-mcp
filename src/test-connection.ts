import { loadConfig } from './config.js';
import { SalesforceCustomerRepository } from './repositories/SalesforceCustomerRepository.js';

async function testSalesforceConnection() {
  console.log('================================================================');
  console.log('🔍 Testing Salesforce Developer Edition Connection...');
  console.log('================================================================');

  const config = loadConfig();
  const sfConfig = config.salesforce;

  const hasOAuth = Boolean(sfConfig.clientId && sfConfig.refreshToken && sfConfig.instanceUrl);
  const hasPasswordFlow = Boolean(sfConfig.username && sfConfig.password);

  if (!hasOAuth && !hasPasswordFlow) {
    console.error('❌ Configuration missing in .env!');
    console.log('\nAapke .env file me Salesforce credentials nahi mile.');
    console.log('\nFollow these simple steps:');
    console.log('1. Agar aapke paas Salesforce Developer account nahi hai, toh yahan banayein:');
    console.log('   👉 https://developer.salesforce.com/signup (Free Lifetime Account)');
    console.log('2. .env.example ko copy karke .env banayein:');
    console.log('   👉 cp .env.example .env');
    console.log('3. .env me yeh 3 fields bharein:');
    console.log('   SALESFORCE_USERNAME=your_username@example.com');
    console.log('   SALESFORCE_PASSWORD=your_password');
    console.log('   SALESFORCE_SECURITY_TOKEN=your_token (Salesforce me "Reset My Security Token" se milta hai)');
    console.log('================================================================');
    process.exitCode = 1;
    return;
  }

  console.log(`Connecting to: ${sfConfig.loginUrl}`);
  console.log(`Username:      ${sfConfig.username || '(OAuth Client)'}`);

  const repository = new SalesforceCustomerRepository(sfConfig);

  try {
    const conn = await repository.getAuthenticatedConnection();
    const identity: any = await conn.identity();

    console.log('\n✅ CONNECTION SUCCESSFUL! 🎉');
    console.log('----------------------------------------------------------------');
    console.log(`Connected User:    ${identity.display_name} (${identity.username})`);
    console.log(`Organization ID:   ${identity.organization_id}`);
    console.log(`Instance URL:      ${conn.instanceUrl}`);
    console.log('----------------------------------------------------------------');

    // 1. Inspect Accounts
    const countResult: any = await conn.query('SELECT COUNT() FROM Account');
    console.log(`📊 Total Accounts in your Salesforce Org: ${countResult.totalSize}`);

    // 2. Inspect Fields
    console.log('\n🔍 Inspecting Custom Fields on Account Object...');
    const inspection = await repository.inspectFields();

    console.log(`Target Object: ${inspection.objectName} (Total fields: ${inspection.totalFieldsFound})`);
    console.log('\nCustom Insights Fields Status:');
    for (const [key, fieldInfo] of Object.entries(inspection.customFieldsStatus)) {
      const icon = fieldInfo.exists ? '✅ Installed' : '⚠️ Missing (Not yet created)';
      console.log(`   - ${fieldInfo.fieldName.padEnd(28)} : ${icon}`);
    }

    if (inspection.missingCustomFields.length > 0) {
      console.log('\n💡 Notice:');
      console.log('   Abhi aapke Account object par yeh custom fields nahi hain:');
      console.log('   ' + inspection.missingCustomFields.join(', '));
      console.log('\n   Fikar mat kijiye! Hamara MCP server standard Account fields (Name, Phone, etc.)');
      console.log('   ke saath bina kisi error ke chalega. Next step me hum Salesforce Setup me');
      console.log('   jakar yeh fields manually create karenge.');
    } else {
      console.log('\n🎉 Fantastic! All required custom insight fields are installed in your org!');
    }

    // 3. Show sample accounts
    console.log('\n📋 Sample Real Accounts from your Salesforce Org:');
    const sampleAccounts = await repository.getAllCustomers();
    if (sampleAccounts.length === 0) {
      console.log('   No accounts found yet. Create one manually in Salesforce Lightning!');
    } else {
      sampleAccounts.slice(0, 3).forEach((acc, idx) => {
        console.log(`   ${idx + 1}. [${acc.customerId}] ${acc.customerName} - Phone: ${acc.phone || 'N/A'}`);
      });
    }

    console.log('\n================================================================');
    console.log('🚀 Ready to start MCP Server with your real Salesforce data!');
    console.log('   Run: npm start');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('\n❌ Connection Failed:');
    console.error(err.message);
    console.log('\nTroubleshooting Checklist:');
    console.log('1. Password aur Security Token combine hoke check hote hain.');
    console.log('   Agar aapne password change kiya hai, toh naya security token generate karein.');
    console.log('2. Make sure SALESFORCE_LOGIN_URL is https://login.salesforce.com (for Developer Edition).');
    console.log('================================================================');
    process.exitCode = 1;
    return;
  }
}

testSalesforceConnection();
