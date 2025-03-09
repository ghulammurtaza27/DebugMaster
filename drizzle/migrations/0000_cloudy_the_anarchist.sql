CREATE TABLE "code_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"target_id" integer NOT NULL,
	"type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "code_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fixes" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"pr_url" text,
	"pr_number" integer,
	"status" text NOT NULL,
	"files" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"sentry_id" text NOT NULL,
	"title" text NOT NULL,
	"stacktrace" text NOT NULL,
	"status" text NOT NULL,
	"context" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"issues_processed" integer NOT NULL,
	"fixes_attempted" integer NOT NULL,
	"fixes_succeeded" integer NOT NULL,
	"avg_processing_time" integer NOT NULL,
	"date" timestamp DEFAULT now(),
	"validation_data" jsonb
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"sentry_dsn" text NOT NULL,
	"sentry_token" text NOT NULL,
	"sentry_org" text NOT NULL,
	"sentry_project" text NOT NULL,
	"github_token" text NOT NULL,
	"github_owner" text NOT NULL,
	"github_repo" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"status" text NOT NULL,
	"tier" text NOT NULL,
	"current_period_start" timestamp NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text DEFAULT 'inactive',
	"subscription_tier" text DEFAULT 'free',
	"trial_ends_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_source_id_code_nodes_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."code_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_target_id_code_nodes_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."code_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;