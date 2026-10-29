/**
 * Local Webhook Simulation Script
 * Demonstrates:
 * 1. Health check
 * 2. Creating a message
 * 3. Processing SENT webhook
 * 4. Processing DELIVERED webhook
 * 5. Processing Duplicate webhook (Idempotency test)
 * 6. Processing Out-of-Order SENT event after READ (Prevent backward regression)
 * 7. Querying conversation with cursor pagination
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function jsonFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      console.error(`\n[ERROR] Cannot connect to server at ${BASE_URL} (Connection Refused).`);
      console.error(`\nThe API server is not running yet. Please start the server first in a separate terminal:`);
      console.error(`   npm start   (or: npm run dev)\n`);
      process.exit(1);
    }
    throw err;
  }
}

async function runSimulation() {
  console.log('=== Starting Webhook & Messaging Simulation ===\n');

  // 1. Check Health
  console.log('1. Checking service health...');
  const health = await jsonFetch(`${BASE_URL}/health`);
  console.log(`-> Health status: [${health.status}]`, JSON.stringify(health.data), '\n');

  if (!health.ok) {
    console.error('Service is not healthy. Make sure the server is running on', BASE_URL);
    process.exit(1);
  }

  // 2. Create Message
  console.log('2. Creating message for tenant-a in conversation conv-sim-01...');
  const createRes = await jsonFetch(`${BASE_URL}/api/v1/messages`, {
    method: 'POST',
    headers: { 'x-tenant-id': 'tenant-a' },
    body: JSON.stringify({
      tenantId: 'tenant-a',
      conversationId: 'conv-sim-01',
      to: '+919876543210',
      text: 'Your order #45892 has been dispatched!',
    }),
  });
  console.log(`-> Created message [${createRes.status}]:`, createRes.data);
  const messageId = createRes.data?.data?.id;
  if (!messageId) {
    console.error('Failed to create message');
    process.exit(1);
  }
  console.log(`-> Target messageId: ${messageId}\n`);

  // 3. Provider Webhook - SENT
  console.log('3. Simulating external provider webhook: SENT...');
  const sentRes = await jsonFetch(`${BASE_URL}/api/v1/webhooks/provider`, {
    method: 'POST',
    body: JSON.stringify({
      eventId: `evt-${Date.now()}-1`,
      messageId,
      status: 'SENT',
      occurredAt: new Date(Date.now() - 60000).toISOString(),
    }),
  });
  console.log(`-> Webhook SENT response [${sentRes.status}]:`, sentRes.data, '\n');

  // 4. Provider Webhook - DELIVERED
  const deliveredEventId = `evt-${Date.now()}-2`;
  console.log(`4. Simulating external provider webhook: DELIVERED (eventId: ${deliveredEventId})...`);
  const delivRes = await jsonFetch(`${BASE_URL}/api/v1/webhooks/provider`, {
    method: 'POST',
    body: JSON.stringify({
      eventId: deliveredEventId,
      messageId,
      status: 'DELIVERED',
      occurredAt: new Date(Date.now() - 30000).toISOString(),
    }),
  });
  console.log(`-> Webhook DELIVERED response [${delivRes.status}]:`, delivRes.data, '\n');

  // 5. Provider Webhook - RETRY / DUPLICATE
  console.log(`5. Simulating provider retry of the exact same DELIVERED event (Idempotency test)...`);
  const retryRes = await jsonFetch(`${BASE_URL}/api/v1/webhooks/provider`, {
    method: 'POST',
    body: JSON.stringify({
      eventId: deliveredEventId,
      messageId,
      status: 'DELIVERED',
      occurredAt: new Date(Date.now() - 30000).toISOString(),
    }),
  });
  console.log(`-> Duplicate retry response [${retryRes.status}]:`, retryRes.data);
  console.log(`   Duplicate safely ignored: ${retryRes.data?.data?.duplicate === true}\n`);

  // 6. Provider Webhook - READ
  console.log('6. Simulating recipient READ event...');
  const readRes = await jsonFetch(`${BASE_URL}/api/v1/webhooks/provider`, {
    method: 'POST',
    body: JSON.stringify({
      eventId: `evt-${Date.now()}-3`,
      messageId,
      status: 'READ',
      occurredAt: new Date().toISOString(),
    }),
  });
  console.log(`-> Webhook READ response [${readRes.status}]:`, readRes.data, '\n');

  // 7. Provider Webhook - Out-of-Order SENT event arriving AFTER READ
  console.log('7. Simulating out-of-order delayed SENT event arriving AFTER message is already READ...');
  const oooRes = await jsonFetch(`${BASE_URL}/api/v1/webhooks/provider`, {
    method: 'POST',
    body: JSON.stringify({
      eventId: `evt-${Date.now()}-delayed`,
      messageId,
      status: 'SENT',
      occurredAt: new Date(Date.now() - 120000).toISOString(),
    }),
  });
  console.log(`-> Out-of-order response [${oooRes.status}]:`, oooRes.data);
  console.log(`   Notice status did NOT regress to SENT: status=${oooRes.data?.data?.messageStatus}\n`);

  // 8. Fetch Final Message Details
  console.log('8. Retrieving final message details & historical webhook events...');
  const finalMsg = await jsonFetch(`${BASE_URL}/api/v1/messages/${messageId}`, {
    headers: { 'x-tenant-id': 'tenant-a' },
  });
  console.log(`-> Final message state:`, JSON.stringify(finalMsg.data, null, 2), '\n');

  // 9. Query Conversation History
  console.log('9. Querying conversation messages with tenant isolation...');
  const convRes = await jsonFetch(`${BASE_URL}/api/v1/conversations/conv-sim-01/messages?limit=5`, {
    headers: { 'x-tenant-id': 'tenant-a' },
  });
  console.log(`-> Conversation response:`, JSON.stringify(convRes.data, null, 2), '\n');

  console.log('=== Simulation Completed Successfully! ===');
}

runSimulation().catch((err) => {
  console.error('Simulation error:', err);
  process.exit(1);
});
