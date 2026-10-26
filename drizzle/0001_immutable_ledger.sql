CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER markets_no_update BEFORE UPDATE ON markets BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER markets_no_delete BEFORE DELETE ON markets BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER offers_no_update BEFORE UPDATE ON offers BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER offers_no_delete BEFORE DELETE ON offers BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER quote_snapshots_no_update BEFORE UPDATE ON quote_snapshots BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER quote_snapshots_no_delete BEFORE DELETE ON quote_snapshots BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER predictions_no_update BEFORE UPDATE ON predictions BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER predictions_no_delete BEFORE DELETE ON predictions BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER result_revisions_no_update BEFORE UPDATE ON result_revisions BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER result_revisions_no_delete BEFORE DELETE ON result_revisions BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER collections_no_update BEFORE UPDATE ON collections BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER collections_no_delete BEFORE DELETE ON collections BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER evaluations_no_update BEFORE UPDATE ON evaluations BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
--> statement-breakpoint
CREATE TRIGGER evaluations_no_delete BEFORE DELETE ON evaluations BEGIN SELECT RAISE(ABORT, 'immutable ledger'); END;
