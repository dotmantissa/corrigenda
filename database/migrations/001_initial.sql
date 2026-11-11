CREATE TABLE IF NOT EXISTS identities (
 id text PRIMARY KEY, address text NOT NULL UNIQUE, encrypted_key text NOT NULL,
 listing_consumer text, deployment_consumer text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operations (
 id text PRIMARY KEY, identity_id text REFERENCES identities(id), kind text NOT NULL,
 payload jsonb NOT NULL, payload_digest text NOT NULL, target text, method text, args jsonb,
 status text NOT NULL DEFAULT 'PENDING', transaction_hash text, signed_transaction text,
 error_code text, attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
 lease_until timestamptz, lease_id text, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), receipt jsonb
);
CREATE INDEX IF NOT EXISTS operations_ready ON operations(status,created_at);
CREATE TABLE IF NOT EXISTS chain_events (
 contract text NOT NULL, sequence bigint NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(contract,sequence)
);
CREATE TABLE IF NOT EXISTS indexed_records (
 kind text NOT NULL, id text NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(kind,id)
);
CREATE TABLE IF NOT EXISTS index_cursors (contract text PRIMARY KEY, cursor bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS worker_leases (name text PRIMARY KEY, lease_id text NOT NULL, lease_until timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS usage_ledger (operation_id text PRIMARY KEY REFERENCES operations(id), identity_id text REFERENCES identities(id), unit text NOT NULL, quantity integer NOT NULL CHECK (quantity>0), created_at timestamptz NOT NULL DEFAULT now());
