// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Proves the #1179 migration on an installed database's shape (spec §11.3, P19): every
 * migration before it applied in order, live and stopped PR feeds and three agent watches
 * inserted, then the new migration. Asserts the subscriptions, the legacy delivery, the
 * stopped feed left behind, the loop-guard pause cleared, the first poll's cursor
 * translation (D20) and each migrated watch's condition (D22). Exits non-zero on a failure.
 *   pnpm --filter @prismalens/api exec tsx scripts/prove-pr-subscriptions-migration.ts
 */
import "reflect-metadata";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	defaultSpec,
	oneShotSpec,
	type PrWatchUntil,
	type PullRequest,
} from "@prismalens/contracts";
import {
	derive,
	legacyWatch,
	type PollSnapshot,
	translateFeedCursor,
} from "../src/modules/threads/pr-subscriptions/derive.js";

const here = dirname(fileURLToPath(import.meta.url));
const dbPackage = join(here, "../../@prismalens/database");
const schemaDir = join(dbPackage, "prisma/sqlite/schema");
const MIGRATION = "20261118100000_pr_subscriptions";

interface Statement {
	run(...params: unknown[]): unknown;
	all(...params: unknown[]): Record<string, unknown>[];
	get(...params: unknown[]): Record<string, unknown> | undefined;
}
interface Db {
	exec(sql: string): void;
	prepare(sql: string): Statement;
	pragma(sql: string): unknown;
	close(): void;
}
type DbCtor = new (file: string) => Db;
const Database = createRequire(join(dbPackage, "package.json"))(
	"better-sqlite3",
) as DbCtor;

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
	results.push({
		name,
		ok,
		...(ok ? {} : { detail: JSON.stringify(detail) }),
	});
	console.log(
		`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`,
	);
}

/** Inserts a row, filling every other NOT NULL column without a default. */
function insert(db: Db, table: string, values: Record<string, unknown>) {
	const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as {
		name: string;
		type: string;
		notnull: number;
		dflt_value: unknown;
		pk: number;
	}[];
	const row: Record<string, unknown> = { ...values };
	for (const c of cols) {
		if (c.name in row || !c.notnull || c.dflt_value !== null) continue;
		const t = c.type.toUpperCase();
		row[c.name] =
			t.includes("INT") || t.includes("REAL") || t.includes("BOOLEAN")
				? 0
				: t.includes("DATETIME")
					? new Date().toISOString()
					: `${c.name}-filler`;
	}
	const keys = Object.keys(row);
	db.prepare(
		`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
	).run(...keys.map((k) => row[k]));
}

const sameJson = (a: unknown, b: unknown) =>
	JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(sortKeys);
	if (v && typeof v === "object")
		return Object.fromEntries(
			Object.entries(v)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, x]) => [k, sortKeys(x)]),
		);
	return v;
}

function prView(over: Partial<PullRequest>): PullRequest {
	return {
		state: "open",
		review: "none",
		fetchedAt: new Date().toISOString(),
		checks: { state: "pending", failed: 0, passed: 0, pending: 1, total: 1 },
		...over,
	} as PullRequest;
}

function main() {
	const dir = mkdtempSync(join(tmpdir(), "pl-pr-subs-migration-"));
	const db = new Database(join(dir, "prismalens.db"));
	try {
		db.pragma("foreign_keys = OFF");
		const folders = readdirSync(schemaDir)
			.filter((f) => /^\d{14}_/.test(f))
			.sort();
		for (const f of folders.filter((x) => x < MIGRATION))
			db.exec(readFileSync(join(schemaDir, f, "migration.sql"), "utf8"));
		check(
			"every earlier migration applies",
			folders.includes(MIGRATION),
			folders.at(-1),
		);

		const now = new Date();
		const later = new Date(now.getTime() + 6 * 3600_000).toISOString();
		const past = new Date(now.getTime() - 3600_000).toISOString();
		const head = "a".repeat(40);
		for (const id of ["t-user", "t-auto", "t-stop", "t-agent", "t-guard"])
			insert(db, "investigations", {
				id,
				status: "completed",
				...(id === "t-guard"
					? { autoPause: '{"reason":"loop_guard","at":"x"}' }
					: {}),
			});
		const prs = [
			["pr-user", "t-user", 1],
			["pr-auto", "t-auto", 2],
			["pr-stop", "t-stop", 3],
			["pr-w1", "t-agent", 4],
			["pr-w2", "t-agent", 5],
			["pr-w3", "t-agent", 6],
		] as const;
		for (const [id, thread, n] of prs)
			insert(db, "pull_requests", {
				id,
				investigationId: thread,
				url: `https://github.com/acme/subs/pull/${n}`,
				repo: "acme/subs",
				number: n,
				host: "github",
			});
		const feedCursor = JSON.stringify({
			checks: { "app:1/lint": { sha: head, state: "passing", exec: "11" } },
			seen: { issue_comment: 100 },
			verdict: null,
			conflicts: false,
			headSha: head,
			guard: null,
		});
		insert(db, "pr_feed", {
			prId: "pr-user",
			investigationId: "t-user",
			auto: 0,
			state: "watching",
			cursor: feedCursor,
			pending: JSON.stringify({
				lines: ["Check lint failed on aaaaaaa"],
				since: now.toISOString(),
			}),
			updatedAt: now.toISOString(),
		});
		insert(db, "pr_feed", {
			prId: "pr-auto",
			investigationId: "t-auto",
			auto: 1,
			state: "watching",
			updatedAt: now.toISOString(),
		});
		insert(db, "pr_feed", {
			prId: "pr-stop",
			investigationId: "t-stop",
			auto: 0,
			state: "stopped",
			updatedAt: now.toISOString(),
		});
		const watches: [string, PrWatchUntil, string][] = [
			["pr-w1", "checks_done", later],
			["pr-w2", "review", later],
			["pr-w3", "merged", past],
		];
		for (const [prId, until, expiresAt] of watches)
			insert(db, "pr_watches", {
				prId,
				investigationId: "t-agent",
				until,
				expiresAt,
			});

		db.exec(readFileSync(join(schemaDir, MIGRATION, "migration.sql"), "utf8"));
		check("the new migration applies", true);

		const subs = db
			.prepare(
				`SELECT "id","prId","createdBy","spec","state","legacyUntil","expiresAt" FROM "pr_subscriptions" ORDER BY "prId"`,
			)
			.all();
		check("5 subscriptions", subs.length === 5, subs.length);
		const by = (prId: string) => subs.find((s) => s.prId === prId);
		const spec = (prId: string): unknown =>
			JSON.parse(String(by(prId)?.spec ?? "null"));
		check(
			"the user feed's spec is defaultSpec(user)",
			by("pr-user")?.createdBy === "user" &&
				sameJson(spec("pr-user"), defaultSpec("user")),
			by("pr-user"),
		);
		check(
			"the auto feed's spec is defaultSpec(auto)",
			by("pr-auto")?.createdBy === "auto" &&
				sameJson(spec("pr-auto"), defaultSpec("auto")),
			by("pr-auto"),
		);
		for (const [prId, until] of watches)
			check(
				`the ${until} watch is a one-shot agent subscription`,
				by(prId)?.createdBy === "agent" &&
					by(prId)?.legacyUntil === until &&
					sameJson(spec(prId), oneShotSpec(until)),
				by(prId),
			);
		check("the stopped feed is not migrated", !by("pr-stop"), by("pr-stop"));
		check(
			"every migrated subscription is active",
			subs.every((s) => s.state === "active"),
			subs.map((s) => s.state),
		);

		const deliveries = db
			.prepare(
				`SELECT "id","investigationId","kind","state","payload" FROM "pr_deliveries"`,
			)
			.all();
		const members = db
			.prepare(
				`SELECT "deliveryId","subscriptionId","state" FROM "pr_delivery_members"`,
			)
			.all();
		check(
			"1 legacy delivery, queued, for the user feed's thread",
			deliveries.length === 1 &&
				deliveries[0]?.kind === "legacy" &&
				deliveries[0]?.state === "queued" &&
				deliveries[0]?.investigationId === "t-user",
			deliveries,
		);
		check(
			"1 member, the user feed's subscription",
			members.length === 1 &&
				members[0]?.subscriptionId === by("pr-user")?.id &&
				members[0]?.deliveryId === deliveries[0]?.id,
			members,
		);
		const guard = db
			.prepare(`SELECT "autoPause" FROM "investigations" WHERE "id" = ?`)
			.get("t-guard");
		check(
			"a loop-guard pause is cleared",
			guard?.autoPause === null,
			guard?.autoPause,
		);

		// D20: the feed's cursor seeds the first poll; a newer comment and a changed check are events.
		const cursor = translateFeedCursor(feedCursor);
		const snap: PollSnapshot = {
			prUrl: "https://github.com/acme/subs/pull/1",
			host: "github",
			state: "open",
			title: "Change 1",
			headSha: head,
			conflicts: false,
			baseRef: "main",
			items: [100, 101].map((id) => ({
				source: "ic",
				id,
				login: "alice",
				bot: false,
				association: "COLLABORATOR",
				body: `Comment ${id}`,
				createdAt: now.toISOString(),
				link: `https://github.com/acme/subs/pull/1#issuecomment-${id}`,
			})),
			issueEvents: [],
			checks: [
				{
					key: "app:1/lint",
					name: "lint",
					state: "failing",
					exec: "12",
					url: null,
				},
			],
			threads: null,
			push: null,
			reviewsFull: false,
			lists: {},
			floors: {},
		};
		check("the feed cursor translates", cursor !== null);
		const unchanged = derive(
			cursor,
			{
				...snap,
				items: snap.items.slice(0, 1),
				checks: [
					{
						key: "app:1/lint",
						name: "lint",
						state: "passing",
						exec: "11",
						url: null,
					},
				],
			},
			now,
		);
		check(
			"an unchanged PR after upgrade: no event",
			unchanged.events.length === 0,
			unchanged.events.map((e) => e.dedupeKey),
		);
		// The check's change also completes the head failing: the summary is the third event.
		const first = derive(cursor, snap, now);
		const kinds = first.events.map((e) => e.kind).sort();
		check(
			"a newer comment and a changed check after upgrade are events, not a baseline",
			sameJson(kinds, ["check", "checks_done", "comment"]),
			first.events.map((e) => e.dedupeKey),
		);

		// D22: each migrated watch on its condition.
		const fire = (
			pr: PullRequest | null,
			until: PrWatchUntil,
			expires: string | null,
		) =>
			legacyWatch(
				pr,
				until,
				expires ? new Date(expires) : null,
				now,
				"acme/subs#4",
			);
		const done = fire(
			prView({
				checks: {
					state: "passing",
					failed: 0,
					passed: 3,
					pending: 0,
					total: 3,
				},
			} as Partial<PullRequest>),
			"checks_done",
			later,
		);
		check(
			"checks_done with checks finished fires once",
			done?.end === "once",
			done,
		);
		const none = fire(
			prView({
				checks: { state: "none", failed: 0, passed: 0, pending: 0, total: 0 },
			} as Partial<PullRequest>),
			"checks_done",
			later,
		);
		check(
			"checks_done with checks none, once read, fires",
			none?.end === "once",
			none,
		);
		check(
			"review with no review waits",
			fire(prView({}), "review", later) === null,
		);
		const approved = fire(prView({ review: "approved" }), "review", later);
		check("review approved fires once", approved?.end === "once", approved);
		const expired = fire(prView({}), "merged", past);
		check(
			"a watch past its 12 hours ends expired",
			expired?.end === "expired" && /12 hours/.test(expired.text),
			expired,
		);
	} finally {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	}
	const failed = results.filter((r) => !r.ok);
	console.log(
		`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((f) => f.name).join("; ")}` : ""}`,
	);
	if (failed.length) process.exitCode = 1;
}

main();
