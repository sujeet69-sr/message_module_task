-- Initial PostgreSQL Schema for Multi-Tenant Messaging Service

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    conversation_id VARCHAR(128) NOT NULL,
    recipient_to VARCHAR(32) NOT NULL,
    text TEXT NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
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

CREATE INDEX IF NOT EXISTS idx_messages_tenant_conv_created 
ON messages (tenant_id, conversation_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_messages_tenant_id 
ON messages (tenant_id);

CREATE INDEX IF NOT EXISTS idx_messages_status 
ON messages (status);

CREATE TABLE IF NOT EXISTS webhook_events (
    event_id VARCHAR(128) PRIMARY KEY,
    message_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('SENT', 'DELIVERED', 'READ', 'FAILED')),
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    payload TEXT NOT NULL,
    outcome VARCHAR(64) NOT NULL,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_message_id 
ON webhook_events (message_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_occurred_at 
ON webhook_events (occurred_at);

CREATE TABLE IF NOT EXISTS worker_jobs (
    id VARCHAR(64) PRIMARY KEY,
    queue VARCHAR(64) NOT NULL,
    payload TEXT NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_run_at TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worker_jobs_poll 
ON worker_jobs (queue, status, next_run_at);
