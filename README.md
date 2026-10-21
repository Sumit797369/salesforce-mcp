# Customer Insights MCP Server for Salesforce + ChatGPT

A production-grade, read-only **Model Context Protocol (MCP)** server built in TypeScript that connects **ChatGPT** (and other MCP clients) to customer financial and engagement data.

The server allows AI agents to inspect:
1. **Overdue payments** and outstanding balances.
2. **Inactive customers** who have not placed a repeat order within a configurable window.
3. **High-risk accounts** matching **both** overdue and inactive conditions.
4. **Portfolio health summaries** and total overdue balances without double-counting.
5. **Customer detail drill-downs** for single accounts.

---

## 📑 Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Quick Start (Mock Data - Zero Credentials Required)](#2-quick-start-mock-data---zero-credentials-required)
- [3. Running the Server](#3-running-the-server)
- [4. Testing with MCP Inspector](#4-testing-with-mcp-inspector)
- [5. MCP Tools Reference](#5-mcp-tools-reference)
- [6. Automated Test Suite](#6-automated-test-suite)
- [7. Phase C: Salesforce Developer Edition Integration](#7-phase-c-salesforce-developer-edition-integration)
- [8. Phase F: Connecting to ChatGPT](#8-phase-f-connecting-to-chatgpt)
- [9. Phase G: AWS Deployment Architecture Guide](#9-phase-g-aws-deployment-architecture-guide)
- [10. Troubleshooting](#10-troubleshooting)

---

## 1. Architecture Overview

The system strictly follows a **Clean Architecture** pattern to guarantee that business logic and MCP tools remain 100% decoupled from the data storage layer:

```
┌────────────────────────────────────────────────────────┐
│             AI Client (ChatGPT / MCP Inspector)        │
└───────────────────────────┬────────────────────────────┘
                            │ (JSON-RPC over SSE or Stdio)
┌───────────────────────────▼────────────────────────────┐
│                  McpServer (Tools Layer)               │
│  - get_overdue_customers     - get_inactive_customers  │
│  - get_customer_report       - get_customer_details    │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│         CustomerInsightsService (Pure Domain Logic)    │
│  - Overdue calculations (balance > 0 & due < asOfDate) │
│  - Inactivity window evaluation & missing date handling│
│  - Double-count prevention across risk segments        │
│  - Injected Clock for 100% deterministic time-travel   │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│              CustomerRepository Interface              │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
┌──────────────▼──────────┐    ┌──────────▼──────────────┐
│  MockCustomerRepository │    │SalesforceCustomerRepo   │
│  (Default Fictional)    │    │(REST API via jsforce)   │
└─────────────────────────┘    └─────────────────────────┘
```

### Safety & Guardrails
- **Read-Only**: The server never updates or mutates customer records, payments, or orders.
- **Default Mock Mode**: Starts immediately with realistic fictional records. No Salesforce account or API keys are required to develop or demonstrate.
- **Secrets Isolation**: Secrets are loaded strictly from `.env` and excluded from git. Access tokens are never logged.

---

## 2. Quick Start (Mock Data - Zero Credentials Required)

### Prerequisites
- **Node.js**: v20+ or v24 LTS
- **npm**: v10+

### Installation

Clone the repository and install dependencies:
```bash
npm install
```

Copy the example environment configuration:
```bash
cp .env.example .env
```
*(On Windows PowerShell: `Copy-Item .env.example .env`)*

By default, `.env` is set to `DATA_SOURCE=mock`, meaning no Salesforce credentials are required.

---

## 3. Running the Server

### Build TypeScript
```bash
npm run build
```

### Option A: HTTP + Server-Sent Events (SSE) Mode (Default)
Ideal for **MCP Inspector**, browser tools, and HTTP gateways:
```bash
npm start
```
Output:
```
📦 Data Source configured: MOCK (In-Memory Fictional Records)
================================================================
🚀 Customer Insights MCP Server is RUNNING
📍 Port:             3000
📊 Data Source:      Mock Customer Repository (Fictional In-Memory Dataset)
🩺 Health check:     http://localhost:3000/health
📡 SSE Endpoint:     http://localhost:3000/sse
📬 Message Endpoint: http://localhost:3000/messages
================================================================
```

Verify the health endpoint:
```bash
curl http://localhost:3000/health
```

### Option B: Development Mode (Hot Reload)
```bash
npm run dev
```

### Option C: Stdio Mode
For desktop MCP clients (such as Claude Desktop or CLI pipes):
```bash
npm start -- --stdio
```
Or set `TRANSPORT=stdio` in `.env`.

---

## 4. Testing with MCP Inspector

The official MCP Inspector provides an interactive web UI to test and call tools directly.

1. Start your server in one terminal:
   ```bash
   npm start
   ```

2. In a second terminal, launch the MCP Inspector:
   ```bash
   npx @modelcontextprotocol/inspector
   ```

3. In the Inspector UI:
   - **Transport Type**: Select **SSE**.
   - **URL**: Enter `http://localhost:3000/sse`.
   - Click **Connect**.
4. Navigate to the **Tools** tab to test:
   - `get_customer_report`: Click **Run Tool** (leave arguments empty to use defaults).
   - `get_overdue_customers`: Run with optional `minAmount: 5000`.
   - `get_inactive_customers`: Run with `inactivityDays: 60`.
   - `get_customer_details`: Run with `customerId: "CUST-1005"`.

---

## 5. MCP Tools Reference

All tools validate inputs with **Zod** and return structured Markdown tables alongside parseable JSON payloads.

### 1. `get_overdue_customers`
Returns accounts with positive unpaid balances where the due date is strictly before the evaluation date.
- **Arguments**:
  - `limit` *(integer, optional, default: 50)*: Max records to return.
  - `minAmount` *(number, optional)*: Minimum balance filter in dollars.
  - `asOfDate` *(string, optional, format: YYYY-MM-DD)*: Target evaluation date.
- **Fields Returned**: `customerId`, `customerName`, `outstandingAmount`, `dueDate`, `daysOverdue`, `totalOrders`.

### 2. `get_inactive_customers`
Returns accounts that have not placed an order within a configurable threshold.
- **Arguments**:
  - `inactivityDays` *(integer, optional, default: 60)*: Inactivity threshold in days.
  - `limit` *(integer, optional, default: 50)*: Max records to return.
  - `asOfDate` *(string, optional, format: YYYY-MM-DD)*: Target evaluation date.
- **Fields Returned**: `customerId`, `customerName`, `lastOrderDate`, `daysSinceLastOrder`, `status` (`inactive` or `never_ordered`), `totalOrders`.

### 3. `get_customer_report`
Generates an executive briefing and portfolio health summary.
- **Arguments**:
  - `inactivityDays` *(integer, optional, default: 60)*
  - `asOfDate` *(string, optional, format: YYYY-MM-DD)*
- **Fields Returned**:
  - Summary metrics: `totalCustomersEvaluated`, `healthyCustomerCount`, `overdueCustomerCount`, `totalOverdueAmount`, `inactiveCustomerCount`, `bothOverdueAndInactiveCount`.
  - Detailed lists for overdue, inactive, and both-conditions accounts.
  - Strict double-counting prevention: `healthy + overdue + inactive - both === total`.

### 4. `get_customer_details`
Retrieves single customer profile and risk diagnosis.
- **Arguments**:
  - `customerId` *(string, required)*: E.g., `CUST-1001` or Salesforce 18-digit Account ID.
  - `inactivityDays` *(integer, optional, default: 60)*
  - `asOfDate` *(string, optional, format: YYYY-MM-DD)*
- **Fields Returned**: Customer details, risk badge, `isOverdue`, `daysOverdue`, `isInactive`, `daysSinceLastOrder`, and `matchesBothConditions`.

---

## 6. Automated Test Suite

We use **Vitest** for deterministic, fast testing. Time is injected via a `Clock` function to guarantee tests never break over time.

Run the test suite:
```bash
npm test
```

### Coverage Overview:
- `tests/businessRules.test.ts`:
  - Overdue filtering (`outstandingAmount > 0` and `dueDate < asOfDate`).
  - Exclusion of paid accounts (`$0.00` balance).
  - Exclusion of future/upcoming due dates.
  - Inactivity window calculations.
  - Explicit handling of accounts that never ordered (`lastOrderDate: null`).
  - Detection of accounts matching both risk conditions.
  - Safe currency addition avoiding floating-point precision artifacts.
  - Verification that summary counts do not double-count customers.
- `tests/mockRepository.test.ts`:
  - Default dataset covering all business cases.
  - Case-insensitive customer ID lookups.
  - Non-existent customer handling.
  - Repository immutability.
- `tests/customerTools.test.ts`:
  - Full end-to-end execution of all 4 registered MCP tools.
  - Zod validation and structured JSON/Markdown responses.
- `tests/salesforceRepository.test.ts`:
  - Decoupling of data sources.
  - Dynamic SOQL query construction with custom field mappings.
  - Record mapping handling string numbers and null dates.
  - Missing credential error safety and session management.

---

## 7. Phase C: Salesforce Developer Edition Integration

When you are ready to connect a real Salesforce environment, follow these steps.

### Step 1: Create a Salesforce Developer Edition Org
1. Sign up for a free developer account at: [developer.salesforce.com/signup](https://developer.salesforce.com/signup).
2. Never use production or employer data during integration testing.

### Step 2: Understand Objects and Fields
Standard Salesforce `Account` objects typically do not contain payment aging or e-commerce order summaries out of the box. You have two options:

#### Option A: Custom Fields on `Account` (Recommended for simplicity)
Create the following custom fields on the `Account` object in Setup > Object Manager > Account > Fields & Relationships:
| Field Label | API Name | Data Type | Description |
| :--- | :--- | :--- | :--- |
| Outstanding Balance | `Outstanding_Balance__c` | Currency (16, 2) | Current unpaid balance |
| Payment Due Date | `Payment_Due_Date__c` | Date | Date payment was due |
| Last Order Date | `Last_Order_Date__c` | Date | Most recent order date |
| Total Orders | `Total_Orders__c` | Number (6, 0) | Lifetime order count |

#### Option B: Map Existing Custom Objects / Fields
If your organization stores this in custom objects (e.g., `Invoice__c`, `Client__c`), configure the mappings in `.env` without modifying any code:
```env
SF_OBJECT_CUSTOMER=Client__c
SF_FIELD_CUSTOMER_ID=Id
SF_FIELD_CUSTOMER_NAME=Name
SF_FIELD_OUTSTANDING_BALANCE=Arrears_Amount__c
SF_FIELD_DUE_DATE=Due_Date__c
SF_FIELD_LAST_ORDER_DATE=Latest_Order__c
SF_FIELD_TOTAL_ORDERS=Order_Count__c
```

### Step 3: Configure Salesforce Authentication
Salesforce supports two flows:
1. **External Client App / Connected App (OAuth 2.0)**:
   - In Salesforce Setup, create an **External Client App** (recommended) or **Connected App**.
   - Enable OAuth Settings with scopes: `api`, `refresh_token`, `offline_access`.
   - Callback URL: `http://localhost:3000/oauth/callback`.
2. **Developer Credentials (Username + Password + Security Token)**:
   - For fast local testing in a Developer Edition org, you can use your Salesforce developer username, password, and security token.

### Step 4: Enable Salesforce Mode in `.env`
Update `.env`:
```env
DATA_SOURCE=salesforce
SALESFORCE_LOGIN_URL=https://login.salesforce.com
SALESFORCE_USERNAME=your_username@example.com
SALESFORCE_PASSWORD=your_salesforce_password
SALESFORCE_SECURITY_TOKEN=your_security_token
```

Restart the server:
```bash
npm start
```

---

## 8. Phase F: Connecting to ChatGPT

### Understanding Connectivity Models

| Model | How it Works | Suitable For |
| :--- | :--- | :--- |
| **Local Stdio / SSE** | Runs on `localhost:3000`. Direct access on the local machine. | Local MCP Inspector, Claude Desktop. |
| **Secure Tunnel (ngrok / Cloudflare Tunnel)** | Exposes local server via HTTPS URL to the internet with an auth token. | Quick ChatGPT demo testing before cloud deployment. |
| **Cloud Deployment (AWS ECS / ALB)** | Production container behind HTTPS domain with OAuth/API key authentication. | Company-wide ChatGPT Custom GPT / Enterprise integration. |

### ChatGPT Account & Permissions Checklist
To connect ChatGPT to a custom MCP or Actions endpoint:
1. **ChatGPT Plan**: Requires **ChatGPT Plus**, **Team**, or **Enterprise**.
2. **Workspace Permissions**: If using ChatGPT Enterprise or Team, an Admin must permit "Custom Actions / External Integrations" in Workspace Settings.

### Connecting via ChatGPT Custom GPT
1. In ChatGPT, click **Explore GPTs** > **Create a GPT**.
2. Go to the **Configure** tab.
3. Under **Actions**, click **Create new action**.
4. Import your OpenAPI schema pointing to your HTTPS endpoint (via ngrok or AWS ALB).
5. Specify authentication (API Key or Bearer Token).
6. Test prompts:
   - *"Show me all customers with overdue payments."*
   - *"Which accounts haven't placed an order in 60 days?"*
   - *"Generate the daily executive customer risk report."*

> [!NOTE]
> Connecting ChatGPT to an MCP server gives ChatGPT on-demand querying capabilities when a user asks a question. It does **not** automatically trigger scheduled emails or background tasks on its own. For scheduled daily reports, see Phase G.

---

## 9. Phase G: AWS Deployment Architecture Guide

To deploy this MCP server in production and deliver automated daily reports, use the following AWS architecture:

```
┌────────────────────────────────────────────────────────┐
│                   ChatGPT / Web Client                 │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS (Port 443)
┌───────────────────────────▼────────────────────────────┐
│         AWS Application Load Balancer (ALB)            │
│  - ACM SSL Certificate (HTTPS encryption)              │
│  - WAF (Rate limiting, IP allowlist)                   │
│  - Target Group health checks (/health)                │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│           AWS ECS Fargate (Container Task)             │
│  - Node.js LTS container running Customer Insights MCP │
│  - Private VPC Subnet (No public IP)                   │
│  - Secrets fetched from AWS Secrets Manager            │
│  - Logs forwarded to CloudWatch Logs                   │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│         Automated Scheduled Daily Management Report    │
│                                                        │
│  ┌───────────────────────┐                             │
│  │ Amazon EventBridge    │ (Trigger every day at 08:00)│
│  └───────────┬───────────┘                             │
│              ▼                                         │
│  ┌───────────────────────┐                             │
│  │ AWS Lambda Function   │ (Invokes get_customer_report│
│  └───────────┬───────────┘  via internal HTTP endpoint)│
│              ▼                                         │
│  ┌───────────────────────┐                             │
│  │ Amazon SES / Slack    │ (Sends formatted management │
│  └───────────────────────┘  briefing to executive team)│
└────────────────────────────────────────────────────────┘
```

### Key Production Configuration Elements:
1. **Execution**: **AWS ECS with Fargate** is recommended over API Gateway + Lambda for SSE/Streamable HTTP transports, because SSE requires persistent HTTP connections.
2. **Secrets Management**: Store Salesforce credentials and client secrets in **AWS Secrets Manager** or **AWS Systems Manager Parameter Store** (encrypted with KMS). The ECS task definition injects them into environment variables at runtime.
3. **Least Privilege IAM**:
   - ECS Task Execution Role: `secretsmanager:GetSecretValue` on specific secret ARN only.
   - CloudWatch Logs: `logs:CreateLogStream`, `logs:PutLogEvents`.
4. **Automated Daily Reports**:
   - An **Amazon EventBridge Scheduler** rule triggers at 8:00 AM UTC.
   - It invokes a lightweight Lambda worker or container task that calls `get_customer_report`.
   - The formatted summary is emailed to leadership via **Amazon SES** or posted to a designated Slack channel.

---

## 10. Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `Cannot find module dist/...` | TypeScript has not been compiled | Run `npm run build`. |
| Port 3000 already in use | Another service is using port 3000 | Set `PORT=3001` in `.env`. |
| MCP Inspector connection timeout | Incorrect URL or missing SSE endpoint | Use `http://localhost:3000/sse` (not `/`). |
| `INVALID_FIELD` on Salesforce query | Configured field does not exist on Salesforce object | Verify field API names in `.env` or create custom fields. |
| `INVALID_SESSION_ID` | Salesforce session expired | The repository automatically re-authenticates on the next request. |
| Stdio output corrupted | Non-JSON text printed to stdout | Ensure all diagnostic logs write to `console.error` in stdio mode. |
