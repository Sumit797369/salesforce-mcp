import express from 'express';
import cors from 'cors';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { CustomerRepository } from './repositories/CustomerRepository.js';
import { MockCustomerRepository } from './repositories/MockCustomerRepository.js';
import { SalesforceCustomerRepository } from './repositories/SalesforceCustomerRepository.js';
import { createCustomerInsightsServer } from './server.js';
import { CustomerInsightsService } from './services/CustomerInsightsService.js';

/**
 * Initializes the appropriate repository based on environment configuration.
 * Always defaults to MockCustomerRepository unless explicitly set to 'salesforce'.
 */
function createRepository(isStdio: boolean = false): CustomerRepository {
  const logger = isStdio ? console.error : console.log;

  if (config.dataSource === 'salesforce') {
    const sf = config.salesforce;
    const hasOAuth = Boolean(sf.clientId && sf.refreshToken && sf.instanceUrl);
    const hasPasswordAuth = Boolean(sf.username && sf.password);

    if (!hasOAuth && !hasPasswordAuth) {
      logger('\n================================================================');
      logger('❌ SALESFORCE SETUP REQUIRED: Missing credentials in .env');
      logger('================================================================');
      logger('This project is configured in SALESFORCE-FIRST mode.');
      logger('No mock data will be used.\n');
      logger('Follow these setup steps:');
      logger('  1. Create a free Salesforce Developer Edition org at:');
      logger('     https://developer.salesforce.com/signup');
      logger('  2. Copy .env.example to .env:');
      logger('     cp .env.example .env');
      logger('  3. Enter your SALESFORCE_USERNAME, SALESFORCE_PASSWORD, and');
      logger('     SALESFORCE_SECURITY_TOKEN in .env');
      logger('  4. Test your connection:');
      logger('     npm run test:sf');
      logger('================================================================\n');
      process.exit(1);
    }

    logger('🔌 Data Source configured: SALESFORCE DEVELOPER EDITION');
    return new SalesforceCustomerRepository(config.salesforce);
  }

  logger('📦 Data Source configured: MOCK (In-Memory Dataset - Testing Only)');
  return new MockCustomerRepository();
}

async function startServer(): Promise<void> {
  // If --stdio flag is passed or TRANSPORT=stdio, run in stdio mode
  const isStdio = process.argv.includes('--stdio') || config.transport === 'stdio';
  const repository = createRepository(isStdio);
  const service = new CustomerInsightsService();

  if (isStdio) {
    console.error('🚀 Starting Customer Insights MCP Server in STDIO mode...');
    const mcpServer = createCustomerInsightsServer(repository, service);
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error('✅ Stdio transport connected and listening for JSON-RPC messages.');
    return;
  }

  // HTTP + SSE Mode (Standard for MCP Inspector and Web Clients)
  const app = express();

  // Enable CORS for MCP Inspector running on another local port (e.g. 5173, 8080)
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
    })
  );

  // Active SSE transports mapped by session ID
  const sseTransports = new Map<string, SSEServerTransport>();

  /**
   * Health endpoint for uptime monitors, containers, and inspection.
   */
  app.get('/health', async (_req, res) => {
    try {
      const isReachable = await repository.ping();
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        dataSource: {
          name: repository.getSourceName(),
          reachable: isReachable,
        },
        tools: [
          'get_overdue_customers',
          'get_inactive_customers',
          'get_customer_report',
          'get_customer_details',
        ],
        transport: 'sse',
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'degraded',
        error: err.message,
      });
    }
  });

  /**
   * Root welcome endpoint with instructions
   */
  app.get('/', (_req, res) => {
    res.json({
      name: 'Customer Insights MCP Server for Salesforce + ChatGPT',
      version: '1.0.0',
      status: 'running',
      dataSource: repository.getSourceName(),
      endpoints: {
        health: '/health',
        sse: '/sse',
        messages: '/messages?sessionId=:sessionId',
      },
      documentation: 'Use MCP Inspector or ChatGPT to interact with tools.',
    });
  });

  /**
   * SSE endpoint: Clients initiate connection here.
   */
  app.get('/sse', async (_req, res) => {
    console.log('📡 New SSE client connection initiated');

    // Create a new McpServer instance for this session to ensure isolated protocol state
    const sessionServer = createCustomerInsightsServer(repository, service);
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    sseTransports.set(sessionId, transport);

    transport.onclose = () => {
      console.log(`🔌 SSE session closed: ${sessionId}`);
      sseTransports.delete(sessionId);
    };

    transport.onerror = (err) => {
      console.error(`⚠️ SSE transport error for session ${sessionId}:`, err);
      sseTransports.delete(sessionId);
    };

    await sessionServer.connect(transport);
    console.log(`✅ SSE transport connected for session: ${sessionId}`);
  });

  /**
   * Messages endpoint: Clients send JSON-RPC messages to their specific session.
   */
  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).json({ error: 'Missing required sessionId query parameter' });
      return;
    }

    const transport = sseTransports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: `Session not found: ${sessionId}` });
      return;
    }

    try {
      await transport.handlePostMessage(req, res);
    } catch (err: any) {
      console.error(`Error handling message for session ${sessionId}:`, err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error processing MCP message' });
      }
    }
  });

  const server = app.listen(config.port, () => {
    console.log('================================================================');
    console.log('🚀 Customer Insights MCP Server is RUNNING');
    console.log(`📍 Port:             ${config.port}`);
    console.log(`📊 Data Source:      ${repository.getSourceName()}`);
    console.log(`🩺 Health check:     http://localhost:${config.port}/health`);
    console.log(`📡 SSE Endpoint:     http://localhost:${config.port}/sse`);
    console.log(`📬 Message Endpoint: http://localhost:${config.port}/messages`);
    console.log('================================================================');
    console.log('🛠️ Registered MCP Tools:');
    console.log('   1. get_overdue_customers   (Filter overdue payments & balances)');
    console.log('   2. get_inactive_customers  (Identify accounts without recent orders)');
    console.log('   3. get_customer_report     (Executive management briefing & metrics)');
    console.log('   4. get_customer_details    (In-depth profile for specific customer)');
    console.log('================================================================');
    console.log('💡 Quick Test with MCP Inspector:');
    console.log(`   npx @modelcontextprotocol/inspector`);
    console.log(`   Then connect via SSE to: http://localhost:${config.port}/sse`);
    console.log('================================================================');
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('\n🛑 Graceful shutdown signal received. Closing connections...');
    for (const [id, transport] of sseTransports.entries()) {
      try {
        transport.close();
      } catch {}
      sseTransports.delete(id);
    }
    server.close(() => {
      console.log('✅ HTTP server closed. Goodbye!');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('❌ Fatal error starting Customer Insights MCP Server:', err);
  process.exit(1);
});
