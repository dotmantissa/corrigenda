CREATE TABLE IF NOT EXISTS admission_buckets (scope text NOT NULL, minute timestamptz NOT NULL, used integer NOT NULL CHECK (used BETWEEN 1 AND 30), PRIMARY KEY(scope,minute));
ALTER TABLE operations ADD COLUMN IF NOT EXISTS reconcile_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE operations ADD COLUMN IF NOT EXISTS receipt_checks integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS operations_reconcile ON operations(reconcile_at,created_at) WHERE transaction_hash IS NOT NULL;
