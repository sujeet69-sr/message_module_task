# Multi-Tenant Messaging Platform API

A robust, production-grade REST API for a multi-tenant messaging platform built with Node.js, TypeScript, Express, and persistent SQLite (with zero external runtime dependencies). The service models message lifecycles, guarantees event deduplication (idempotency), deterministically resolves out-of-order provider webhooks without backward state regression, enforces tenant isolation, and features an in-process persistent worker queue with exponential backoff and a Dead-Letter Queue (DLQ).

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Prerequisites & Quick Start](#prerequisites--quick-start)
3. [API Reference & Specifications](#api-reference--specifications)
4. [Database Schema & Migrations](#database-schema--migrations)
5. [Design Note](#design-note)
   - [A. Idempotency Strategy](#a-idempotency-strategy)
   - [B. Status Transition Engine & Out-of-Order Handling](#b-status-transition-engine--out-of-order-handling)
   - [C. Multi-Tenant Isolation](#c-multi-tenant-isolation)
   - [D. Scaling for Production & High Throughput](#d-scaling-for-production--high-throughput)
6. [Stretch Goals & Advanced Features](#stretch-goals--advanced-features)
   - [Worker Queue with Exponential Backoff & DLQ](#worker-queue-with-exponential-backoff--dlq)
   - [Concurrency Control & Optimistic Locking](#concurrency-control--optimistic-locking)
   - [Structured Logging, Correlation IDs & Redaction](#structured-logging-correlation-ids--redaction)
   - [Docker & Docker Compose](#docker--docker-compose)
7. [Automated Testing Suite](#automated-testing-suite)
8. [Trade-offs and Limitations](#trade-offs-and-limitations)

---

## Architecture Overview

```
                          ┌─────────────────────────────┐
                          │ External Provider / Clients │
                          └──────────────┬──────────────┘
                                         │
                   HTTP REST / Webhook   ▼
              ┌─────────────────────────────────────────────────┐
              │                   Express API                   │
              │  ┌─────────────────┐   ┌─────────────────────┐  │
              │  │ Correlation ID  │   │  Tenant Extraction  │  │
              │  │  (x-request-id) │   │    (x-tenant-id)    │  │
              │  └────────┬────────┘   └──────────┬──────────┘  │
              │           │                       │             │
              │  ┌────────▼───────────────────────▼──────────┐  │
              │  │   Zod Schema Validation & Error Handling  │  │
              │  └────────┬───────────────────────┬──────────┘  │
              │           │                       │             │
              │  ┌────────▼──────────┐ ┌──────────▼──────────┐  │
              │  │  Message Service  │ │   Webhook Service   │  │
              │  └────────┬──────────┘ └──────────┬──────────┘  │
              │           │                       │             │
              │  ┌────────▼───────────────────────▼──────────┐  │
              │  │  Repository Layer & State Machine Engine  │  │
              │  └───────────────────┬───────────────────────┘  │
              └──────────────────────┼──────────────────────────┘
                                     │
           SQLite Transactions       ▼       In-process Worker
         (BEGIN IMMEDIATE / WAL) ┌───────┐   (Exponential Backoff & DLQ)
        ┌───────────────────────►│  DB   │◄─────────────────────────────┐
        │                        └───────┘                              │
┌───────┴────────┐            ┌─────────────┐               ┌───────────┴──────────┐
│    messages    │            │  webhook_   │               │     worker_jobs      │
│  (Tenancy,     │            │   events    │               │ (Retry schedule,     │
│   Lifecycle,   │            │ (Unique     │               │  Attempts, DLQ)      │
│   Versioning)  │            │  eventId)   │               └──────────────────────┘
└────────────────┘            └─────────────┘
```

---

## Prerequisites & Quick Start

### Prerequisites
- **Node.js**: v20+ or v22+ (tested and built on Node v24 LTS)
- **npm**: v10+
- **Docker** *(Optional, for containerized run)*

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd Interview
npm install
```

### 2. Environment Configuration
Copy the sample environment file with placeholder values:
```bash
cp .env.example .env
```
Default configuration values in `.env`:
```env
PORT=3000
NODE_ENV=development
DATABASE_PATH=./data/messaging.db
LOG_LEVEL=info
WORKER_ENABLED=true
WORKER_CONCURRENCY=2
WORKER_POLL_INTERVAL_MS=500
WORKER_MAX_RETRIES=3
WORKER_BACKOFF_BASE_MS=1000
```

### 3. Run Database Migrations
Database migrations are reproducible and can be executed via:
```bash
npm run migrate
```
*(Note: The server also auto-runs pending migrations on startup if not already applied).*

### 4. Build the Project
Compile TypeScript into production JavaScript:
```bash
npm run build
```

### 5. Start the Application
- **Production mode**:
  ```bash
  npm start
  ```
- **Development mode (hot-reloading)**:
  ```bash
  npm run dev
  ```
The server will start listening at `http://localhost:3000`.

### 6. Run Automated Tests
Execute the full test suite (31 unit & integration tests covering success paths, edge cases, out-of-order events, idempotency, restart persistence, and concurrency):
```bash
npm test
```

### 7. Run the Local Webhook Simulation Script
While the server is running, execute the automated simulation script to simulate real-world webhook events locally:
```bash
npm run simulate
```

---

## API Reference & Specifications

### 1. Create Message
- **Endpoint**: `POST /api/v1/messages`
- **Headers**:
  - `Content-Type: application/json`
  - `x-tenant-id: <tenantId>` *(optional, if provided must match payload `tenantId`)*
- **Request Body**:
  ```json
  {
    "tenantId": "tenant-a",
    "conversationId": "conv-100",
    "to": "+919876543210",
    "text": "Your Order has shipped"
  }
  ```
- **Validation**:
  - `tenantId`: string, alphanumeric with hyphens/underscores, 1–64 characters.
  - `conversationId`: string, 1–128 characters.
  - `to`: string, valid E.164 phone format (e.g. `+919876543210`), 3–32 characters.
  - `text`: string, 1–4096 characters.
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "data": {
      "id": "msg-4b8a1e2f9c31",
      "tenantId": "tenant-a",
      "conversationId": "conv-100",
      "to": "+919876543210",
      "text": "Your Order has shipped",
      "status": "QUEUED",
      "createdAt": "2026-10-29T10:00:00.000Z",
      "updatedAt": "2026-10-29T10:00:00.000Z",
      "timestamps": {
        "queuedAt": "2026-10-29T10:00:00.000Z",
        "sentAt": null,
        "deliveredAt": null,
        "readAt": null,
        "failedAt": null
      },
      "failureReason": null
    }
  }
  ```

---

### 2. Retrieve Message Details
- **Endpoint**: `GET /api/v1/messages/:messageId`
- **Headers**:
  - `x-tenant-id: <tenantId>` *(optional, if provided enforces tenant isolation)*
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "id": "msg-4b8a1e2f9c31",
      "tenantId": "tenant-a",
      "conversationId": "conv-100",
      "to": "+919876543210",
      "text": "Your Order has shipped",
      "status": "DELIVERED",
      "createdAt": "2026-10-29T10:00:00.000Z",
      "updatedAt": "2026-10-29T10:01:30.000Z",
      "timestamps": {
        "queuedAt": "2026-10-29T10:00:00.000Z",
        "sentAt": "2026-10-29T10:01:00.000Z",
        "deliveredAt": "2026-10-29T10:01:30.000Z",
        "readAt": null,
        "failedAt": null
      },
      "history": [
        {
          "eventId": "evt-001",
          "messageId": "msg-4b8a1e2f9c31",
          "status": "SENT",
          "occurredAt": "2026-10-29T10:01:00.000Z",
          "receivedAt": "2026-10-29T10:01:02.000Z",
          "outcome": "APPLIED"
        },
        {
          "eventId": "evt-002",
          "messageId": "msg-4b8a1e2f9c31",
          "status": "DELIVERED",
          "occurredAt": "2026-10-29T10:01:30.000Z",
          "receivedAt": "2026-10-29T10:01:32.000Z",
          "outcome": "APPLIED"
        }
      ]
    }
  }
  ```

---

### 3. Retrieve Conversation Messages (Paginated & Tenant-Isolated)
- **Endpoint**: `GET /api/v1/conversations/:conversationId/messages?limit=20&cursor=...`
- **Headers**:
  - `x-tenant-id: <tenantId>` *(Required for tenant isolation)*
- **Query Parameters**:
  - `limit`: Integer (1 to 100, default: 20).
  - `cursor`: Opaque base64 URL-encoded cursor returned from previous page.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "msg-4b8a1e2f9c31",
        "tenantId": "tenant-a",
        "conversationId": "conv-100",
        "to": "+919876543210",
        "text": "Your Order has shipped",
        "status": "DELIVERED",
        "createdAt": "2026-10-29T10:00:00.000Z",
        "updatedAt": "2026-10-29T10:01:30.000Z",
        "timestamps": {
          "queuedAt": "2026-10-29T10:00:00.000Z",
          "sentAt": "2026-10-29T10:01:00.000Z",
          "deliveredAt": "2026-10-29T10:01:30.000Z",
          "readAt": null,
          "failedAt": null
        }
      }
    ],
    "pagination": {
      "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTI5VDEwOjAwOjAwLjAwMFoiLCJpZCI6Im1zZy00YjhhMWUyZjljMzEifQ",
      "hasMore": true,
      "limit": 20
    }
  }
  ```

---

### 4. Idempotent Provider Webhook
- **Endpoint**: `POST /api/v1/webhooks/provider`
- **Request Body**:
  ```json
  {
    "eventId": "evt-001",
    "messageId": "msg-4b8a1e2f9c31",
    "status": "DELIVERED",
    "occurredAt": "2026-10-29T10:01:30.000Z"
  }
  ```
- **Allowed Statuses**: `SENT`, `DELIVERED`, `READ`, `FAILED`.
- **Response Shapes**:
  - **First time event received** (`200 OK`):
    ```json
    {
      "success": true,
      "data": {
        "eventId": "evt-001",
        "messageId": "msg-4b8a1e2f9c31",
        "status": "DELIVERED",
        "outcome": "APPLIED",
        "duplicate": false,
        "messageStatus": "DELIVERED",
        "notes": "Forward status progression from SENT to DELIVERED"
      }
    }
    ```
  - **Retried event with same eventId** (`200 OK` - Idempotent):
    ```json
    {
      "success": true,
      "data": {
        "eventId": "evt-001",
        "messageId": "msg-4b8a1e2f9c31",
        "status": "DELIVERED",
        "outcome": "IGNORED_DUPLICATE",
        "duplicate": true,
        "messageStatus": "DELIVERED",
        "notes": "Event already processed previously"
      }
    }
    ```
  - **Out-of-order event (e.g. SENT arrives after READ)** (`200 OK`):
    ```json
    {
      "success": true,
      "data": {
        "eventId": "evt-004",
        "messageId": "msg-4b8a1e2f9c31",
        "status": "SENT",
        "outcome": "IGNORED_OUT_OF_ORDER",
        "duplicate": false,
        "messageStatus": "READ",
        "notes": "Out-of-order event: current status READ (rank 3) >= incoming SENT (rank 1). Status preserved."
      }
    }
    ```
  - **Unknown message ID** (`404 Not Found`):
    ```json
    {
      "success": false,
      "error": "NOT_FOUND",
      "message": "Message with ID msg-nonexistent was not found"
    }
    ```
    *(Event is safely persisted in the database with outcome `UNMATCHED_MESSAGE` for asynchronous reconciliation).*

---

### 5. Health Check & Metrics
- `GET /health`:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-10-29T10:05:00.000Z",
    "uptime": 128.45,
    "database": {
      "status": "connected",
      "engine": "sqlite"
    },
    "version": "1.0.0"
  }
  ```
  *(Returns `503 Service Unavailable` if database connectivity is lost).*
- `GET /metrics`:
  ```json
  {
    "success": true,
    "data": {
      "uptimeSeconds": 128,
      "messagesCreated": 42,
      "webhooksTotal": 68,
      "webhooksDuplicatesIgnored": 12,
      "webhooksOutOfOrderHandled": 5,
      "webhooksUnmatched": 1,
      "webhooksApplied": 50,
      "workerQueue": {
        "PENDING": 0,
        "PROCESSING": 0,
        "COMPLETED": 42,
        "FAILED": 0,
        "DEAD_LETTER": 0
      }
    }
  }
  ```

---

## Database Schema & Migrations

The database setup uses SQLite in **Write-Ahead Logging (WAL)** mode with immediate transactions to guarantee crash safety, reproducible persistence across restarts, and high-concurrency support.

### Tables & Indexes

```sql
-- Schema Migrations Tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Core Messages Table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    recipient_to TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    sent_at TEXT,
    delivered_at TEXT,
    read_at TEXT,
    failed_at TEXT,
    failure_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1
);

-- Composite index for fast tenant-scoped, cursor-based pagination
CREATE INDEX idx_messages_tenant_conv_created 
ON messages (tenant_id, conversation_id, created_at ASC, id ASC);

CREATE INDEX idx_messages_tenant_id 
ON messages (tenant_id);

-- Webhook Events Table (Enforces unique eventId for idempotency)
CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SENT', 'DELIVERED', 'READ', 'FAILED')),
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    payload TEXT NOT NULL,
    outcome TEXT NOT NULL,
    notes TEXT
);

CREATE INDEX idx_webhook_events_message_id ON webhook_events (message_id);

-- Persistent Asynchronous Worker Queue & Dead Letter Queue (DLQ)
CREATE TABLE IF NOT EXISTS worker_jobs (
    id TEXT PRIMARY KEY,
    queue TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_run_at TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_worker_jobs_poll ON worker_jobs (queue, status, next_run_at);
```

---

## Design Note

### A. Idempotency Strategy
External webhook providers (e.g. WhatsApp, Meta, Twilio, Stripe) use at-least-once delivery, which guarantees duplicate transmissions when acknowledgments are lost or network connections reset.

1. **Unique Deduplication Key**: The database schema declares `event_id TEXT PRIMARY KEY` on `webhook_events`.
2. **Transaction-Safe Deduplication**: When a webhook arrives, the service first queries `webhook_events` by `event_id`. If found, processing immediately short-circuits, increments the `webhooksDuplicatesIgnored` metric, and returns `HTTP 200 OK` with `outcome: "IGNORED_DUPLICATE"` and `duplicate: true`.
3. **No Duplicate Business Side-Effects**: Message statuses are never re-evaluated and timestamps are not altered on repeated events.
4. **Provider-Friendly Acknowledgment**: Returning `HTTP 200` signals to the external webhook dispatcher that the event was received and recorded, causing the provider to cease further retries.

---

### B. Status Transition Engine & Out-of-Order Handling

In asynchronous telecommunication networks, delivery receipts and read receipts frequently arrive out of order (e.g. carrier delay on `SENT` receipt causes the user's `READ` event to arrive first).

#### Status Hierarchy & Monotonic Ranking
Statuses are assigned progressive ordinal weights:
- `QUEUED`: 0
- `SENT`: 1
- `DELIVERED`: 2
- `READ`: 3
- `FAILED`: -1 *(Terminal state)*

```
       ┌───────────┐
       │  QUEUED   │
       └───┬───┬───┘
           │   │
   SENT    ▼   │ FAILED
       ┌───────┐
       │ SENT  │
       └───┬───┴──────────┐
 DELIVERED │              │
       ┌───▼───────┐      │
       │ DELIVERED │      │ FAILED
       └───┬───────┘      │
      READ │              │
       ┌───▼───┐      ┌───▼────┐
       │ READ  │      │ FAILED │ (Terminal)
       └───────┘      └────────┘
```

#### Transition Rules:
1. **Forward Monotonicity**: A status update is applied only if `Rank(Incoming) > Rank(Current)`. For instance, moving `SENT` -> `DELIVERED` -> `READ` succeeds.
2. **Backward Regression Prevention**: If `Rank(Incoming) <= Rank(Current)` (e.g., incoming `SENT` arrives for a message currently at `READ`), the message status **remains unchanged at `READ`**. The event is saved with outcome `IGNORED_OUT_OF_ORDER`.
3. **Timestamp Reconciliation**: Even when an older event cannot advance the message's main status, its `occurredAt` timestamp is backfilled into `sentAt` if that timestamp was previously missing. This ensures the message retains an accurate historical timeline.
4. **Terminal Failure Protection**:
   - If a message is `FAILED`, it cannot be transitioned to `SENT`, `DELIVERED`, or `READ`.
   - If a message has already reached `DELIVERED` or `READ`, an incoming `FAILED` event is rejected because physical delivery has already succeeded.
5. **Handling Unknown Message IDs**: If a webhook references an unknown `messageId`, the service logs a warning, records the event in `webhook_events` under `outcome: "UNMATCHED_MESSAGE"` for asynchronous dead-letter reconciliation, and returns `404 Not Found`.

---

### C. Multi-Tenant Isolation

1. **Authentication Header Assumption**:
   - In production platforms with API Gateway layers (e.g., Kong, AWS API Gateway), incoming tenant JWTs are validated and decrypted at the edge, injecting the authenticated tenant ID into the `x-tenant-id` header.
   - For this exercise, `x-tenant-id` acts as the verified authenticated identity.
2. **Scope Enforcement on Data Access**:
   - `GET /api/v1/conversations/:conversationId/messages`: Requires `x-tenant-id`. The SQL query filters strictly by `WHERE tenant_id = ? AND conversation_id = ?`. Even if Tenant A discovers Tenant B's `conversationId`, Tenant A only accesses messages belonging to Tenant A.
   - `GET /api/v1/messages/:messageId`: If `x-tenant-id` is supplied and belongs to another tenant, the API responds with `404 Not Found` rather than `403 Forbidden` to prevent leaking the existence of IDs across tenants.
   - `POST /api/v1/messages`: If `x-tenant-id` is provided in the header, the service validates that `header.x-tenant-id === body.tenantId`, rejecting any spoofing attempts with `403 Forbidden`.

---

### D. Scaling for Production & High Throughput

To scale from thousands of requests per second to millions:

```
                            ┌───────────────────────────────────┐
                            │    Cloudflare / Edge API Gateway  │
                            │   (Rate Limiting, Tenant JWT Auth)│
                            └─────────────────┬─────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
             ┌─────────────────┐                             ┌─────────────────┐
             │ API Pod 1 (K8s) │                             │ API Pod 2 (K8s) │
             └────────┬────────┘                             └────────┬────────┘
                      │                                               │
                      ▼                                               ▼
     ┌─────────────────────────────────────────────────────────────────────────────────┐
     │                     Distributed Message Broker (Apache Kafka)                   │
     │   Topics: 'webhooks.raw', 'messages.dispatch'                                   │
     │   Partition Key: tenant_id + conversation_id                                    │
     │   *Guarantees strict FIFO ordering per conversation while scaling horizontally* │
     └────────────────────────────────────────┬────────────────────────────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
             ┌──────────────────┐                            ┌──────────────────┐
             │ Consumer Group 1 │                            │ Consumer Group 2 │
             └────────┬─────────┘                            └────────┬─────────┘
                      │                                               │
                      ▼                                               ▼
     ┌─────────────────────────────────────────────────────────────────────────────────┐
     │                     Distributed Clustered Database                              │
     │         (CockroachDB / PostgreSQL + Citus / AWS Aurora Serverless)              │
     │   Sharded by: tenant_id (Tenant Isolation & Horizontal Database Scaling)        │
     │   Redis Cluster: Hot Conversation Cache & Distributed Event Deduplication Lock  │
     └─────────────────────────────────────────────────────────────────────────────────┘
```

1. **Partitioned Messaging Broker (Kafka / Pulsar)**:
   - Webhook endpoints accept incoming events, persist raw receipts to Kafka (`webhooks.raw`), and return `202 Accepted` or `200 OK` in `< 5ms`.
   - **Partitioning Key**: Events are keyed by `tenant_id:conversation_id`. This guarantees **strict linear ordering** for events of the same conversation while allowing massive horizontal parallel consumption across partitions.
2. **Distributed Distributed Database Sharding**:
   - Multi-tenant data is horizontally sharded by `tenant_id` using Citus or CockroachDB. Queries for a tenant's conversation execute locally on a single shard, completely avoiding cross-node distributed joins.
3. **Transactional Outbox Pattern**:
   - Outbound dispatch events are written to a database `outbox` table in the same transaction as message creation, then streamed to Kafka by a Debezium CDC (Change Data Capture) connector.

---

## Stretch Goals & Advanced Features

### Worker Queue with Exponential Backoff & DLQ
- An in-process transactional worker queue models background dispatching and webhook retries.
- **Exponential Backoff Formula**: $\text{Delay} = \text{baseMs} \times 2^{\text{attempt}} + \text{jitter}$.
- **Dead-Letter Queue (DLQ)**: Jobs failing more than `max_attempts` (default: 3) transition to `status = 'DEAD_LETTER'` with full error logging for inspection.

### Concurrency Control & Optimistic Locking
- SQLite operations utilize `BEGIN IMMEDIATE` to acquire a write lock before reading, preventing concurrent deadlock.
- `messages` rows maintain an atomic `version` column. Status updates execute:
  ```sql
  UPDATE messages 
  SET status = ?, version = version + 1 
  WHERE id = ? AND version = ?
  ```
  Guarantees zero lost updates or race conditions during high-concurrency bursts.

### Structured Logging, Correlation IDs & Redaction
- Every request is tagged with a correlation ID via `x-request-id` (propagated from caller or generated as UUID).
- **Security & PII Redaction**: Structured JSON logs automatically mask phone numbers (e.g. `+9198****210`), redact sensitive message text lengths (`[REDACTED_TEXT len=22]`), and scrub auth tokens and secrets.

### Docker & Docker Compose
A multi-stage `Dockerfile` and `docker-compose.yml` are included for containerized deployment:
```bash
docker compose up --build -d
```
Inspect logs and health:
```bash
docker compose logs -f
curl http://localhost:3000/health
```

---

## Automated Testing Suite

The repository includes a comprehensive automated test suite (31 tests across 9 suites) executed via `npm test`:

| Test Suite | Purpose & Coverage |
| :--- | :--- |
| `tests/unit/stateMachine.test.ts` | Complete permutation testing of forward rank progression, backward prevention, terminal state rules, and timestamp backfilling. |
| `tests/unit/pagination.test.ts` | Cursor round-trip encoding/decoding, corrupt base64 rejection, and input validation. |
| `tests/integration/messageApi.test.ts` | `POST /messages` creation, `GET /messages/:id` retrieval, tenant mismatch protection, and 400 validation error formatting. |
| `tests/integration/webhookApi.test.ts` | Normal status progression, idempotent duplicate deduplication (`eventId`), out-of-order event handling, and 404 unmatched event logging. |
| `tests/integration/conversationPagination.test.ts` | Strict multi-tenant isolation, cursor pagination over 25+ messages with stable ordering. |
| `tests/integration/persistence.test.ts` | Simulates server crash/restart by closing and re-opening database file; verifies data integrity. |
| `tests/integration/concurrency.test.ts` | Dispatches 10 simultaneous concurrent webhook updates to stress-test transaction locking and optimistic versioning. |
| `tests/integration/workerQueue.test.ts` | Job execution, exponential retry backoff, and Dead-Letter Queue (DLQ) routing. |
| `tests/integration/health.test.ts` | Health check endpoint, database live check, and telemetry metrics counter verification. |

Run tests:
```bash
npm test
```

---

## Trade-offs and Limitations

1. **In-Process Worker vs. External Broker**:
   - *Current Implementation*: Uses persistent SQLite table `worker_jobs` with polling.
   - *Trade-off*: Zero external dependencies and fast setup, but throughput is limited by single-instance compute. In large clusters, a dedicated broker (Kafka/RabbitMQ) should be used.
2. **Tenant Authentication via Headers**:
   - *Current Implementation*: Relies on `x-tenant-id` header assuming trusted upstream API Gateway.
   - *Trade-off*: Simplifies local testing without requiring OAuth2/OIDC servers, but requires an API Gateway in front of the service in production to avoid client header forgery.
3. **SQLite Concurrency Model**:
   - *Current Implementation*: Configured with WAL mode and `busy_timeout = 5000ms`.
   - *Trade-off*: Handles thousands of concurrent reads and serialized high-throughput writes on a single node without external database setup. For multi-node horizontal scaling, PostgreSQL or CockroachDB is required.
