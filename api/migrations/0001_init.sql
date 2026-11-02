-- Shared bill splitter schema.
-- Money is always stored as whole cents in INTEGER columns.

CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT members_home_id_fkey FOREIGN KEY (home_id) REFERENCES homes (id) ON DELETE CASCADE,
  CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT members_position_non_negative CHECK (position >= 0),
  CONSTRAINT members_home_position_unique UNIQUE (home_id, position)
);

CREATE INDEX members_home_id_idx ON members (home_id);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT bills_home_id_fkey FOREIGN KEY (home_id) REFERENCES homes (id) ON DELETE CASCADE,
  CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT bills_total_positive CHECK (total_cents > 0)
);

CREATE INDEX bills_home_id_idx ON bills (home_id);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  position INTEGER NOT NULL,
  paid_at TEXT,
  payment_key TEXT,
  CONSTRAINT shares_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE,
  CONSTRAINT shares_member_id_fkey FOREIGN KEY (member_id) REFERENCES members (id),
  CONSTRAINT shares_amount_non_negative CHECK (amount_cents >= 0),
  CONSTRAINT shares_position_non_negative CHECK (position >= 0),
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id),
  CONSTRAINT shares_paid_pair CHECK ((paid_at IS NULL) = (payment_key IS NULL))
);

CREATE INDEX shares_bill_id_idx ON shares (bill_id);
CREATE INDEX shares_member_id_idx ON shares (member_id);

-- One idempotency key can only ever belong to one payment.
CREATE UNIQUE INDEX shares_payment_key_unique ON shares (payment_key) WHERE payment_key IS NOT NULL;
