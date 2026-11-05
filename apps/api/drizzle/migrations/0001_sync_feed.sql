CREATE TABLE "changes" (
	"change_seq" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"entity_key" text NOT NULL,
	"op" text NOT NULL,
	"rev" integer NOT NULL,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changes_entity_type" CHECK ("changes"."entity_type" IN ('note', 'collection', 'tag', 'note_tag', 'attachment')),
	CONSTRAINT "changes_op" CHECK ("changes"."op" IN ('upsert', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "op_receipts" (
	"op_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"status" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "op_receipts_status" CHECK ("op_receipts"."status" IN ('applied', 'conflict', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "op_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_state_server" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"horizon_seq" bigint DEFAULT 0 NOT NULL,
	"compacted_at" timestamp with time zone,
	CONSTRAINT "sync_state_server_single_row" CHECK ("sync_state_server"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_receipts" ADD CONSTRAINT "op_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_receipts" ADD CONSTRAINT "op_receipts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changes_user_seq_idx" ON "changes" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "changes_user_entity_idx" ON "changes" USING btree ("user_id","entity_type","entity_key");--> statement-breakpoint
CREATE INDEX "op_receipts_created_idx" ON "op_receipts" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "changes_owner" ON "changes" AS PERMISSIVE FOR ALL TO public USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());--> statement-breakpoint
CREATE POLICY "op_receipts_owner" ON "op_receipts" AS PERMISSIVE FOR ALL TO public USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());--> statement-breakpoint
-- ===== Hand-written: grants and initial state for the sync feed =====
INSERT INTO sync_state_server (id, horizon_seq) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON changes, op_receipts TO nexus_api;--> statement-breakpoint
GRANT SELECT ON sync_state_server TO nexus_api;--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO nexus_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON changes, op_receipts, sync_state_server TO nexus_maint;--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO nexus_maint;--> statement-breakpoint
GRANT SELECT ON changes, op_receipts, sync_state_server TO nexus_readonly;--> statement-breakpoint
-- Let the API read the migration journal for GET /readyz.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'drizzle') THEN
    GRANT USAGE ON SCHEMA drizzle TO nexus_api, nexus_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO nexus_api, nexus_readonly;
  END IF;
END $$;

/* ===== down (manual rollback: psql -f) =====
DROP TABLE IF EXISTS op_receipts, changes, sync_state_server CASCADE;
*/
