CREATE TABLE "recommendation_states" (
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"rec_key" text NOT NULL,
	"status" text NOT NULL,
	"snoozed_until" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_states_workspace_id_ad_account_id_rec_key_pk" PRIMARY KEY("workspace_id","ad_account_id","rec_key")
);
--> statement-breakpoint
ALTER TABLE "recommendation_states" ADD CONSTRAINT "recommendation_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_states" ADD CONSTRAINT "recommendation_states_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_states" ADD CONSTRAINT "recommendation_states_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;