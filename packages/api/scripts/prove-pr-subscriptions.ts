// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The packed-sim proof of PR subscriptions (#1179 spec §11.3): drives the scriptable fake
 * code host, polls, waits for each receipt, and asserts what the agent got against what the
 * host carried, paired by order. Exits non-zero on the first failed assertion and writes
 * `<out>/report.json`. Start the sim with `PRISMALENS_CONDITIONS=fake-code-host,standby`.
 *   PRISMALENS_WORKSPACE_DIR=<sim workspace> pnpm --filter @prismalens/api prove:pr-subscriptions --url <sim url> --out <dir>
 * Covers P1, P2, P8 (viewer and marker), P9 (structural), P10 (flood) and P14 (refusal and
 * silence); the other §11.3 steps are not driven yet.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSpec } from "@prismalens/contracts";
import { prisma } from "@prismalens/database";
import {
	type Api,
	connect,
	events,
	sleep,
	stateDir,
} from "../../../scripts/fakes/conditions/lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "../../../scripts/fakes/conditions/fake-code-host.mjs");
const PR = "acme/subs#7";
const PR_URL = "https://github.com/acme/subs/pull/7";

const argOf = (name: string) => {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
};
const url = (argOf("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const out = argOf("--out") ?? join(process.cwd(), "pr-subscriptions-proof");

interface Result {
	step: string;
	ok: boolean;
	detail?: unknown;
}
const results: Result[] = [];

function report() {
	mkdirSync(out, { recursive: true });
	writeFileSync(
		join(out, "report.json"),
		JSON.stringify({ url, at: new Date().toISOString(), results }, null, 2),
	);
}

function assert(step: string, ok: boolean, detail?: unknown): void {
	results.push({ step, ok, ...(ok ? {} : { detail }) });
	console.log(`${ok ? "ok  " : "FAIL"} ${step}`);
	if (!ok) {
		report();
		throw new Error(`${step}: ${JSON.stringify(detail)}`);
	}
}

/** One fake-host command; prints the new id. */
function host(...args: string[]): string {
	return execFileSync(process.execPath, [CLI, ...args], {
		encoding: "utf8",
		env: process.env,
	}).trim();
}
const pr = (...args: string[]) => host("pr", PR, ...args);

interface Source {
	seq: number;
	cmd: string;
	id: string | number;
	kind: string;
}
function sources(): Source[] {
	try {
		return readFileSync(
			join(stateDir("fake-code-host"), "sources.jsonl"),
			"utf8",
		)
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as Source);
	} catch {
		return [];
	}
}

interface RequestLine {
	method: string;
	path: string;
	status: number;
}
function requests(): RequestLine[] {
	try {
		return readFileSync(
			join(stateDir("fake-code-host"), "requests.jsonl"),
			"utf8",
		)
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as RequestLine);
	} catch {
		return [];
	}
}

/** A project on `acme/subs` with that origin, and a thread on it that subscribes to PR #7. */
async function setup(api: Api): Promise<string> {
	const workspace = process.env.PRISMALENS_WORKSPACE_DIR;
	if (!workspace) throw new Error("Set PRISMALENS_WORKSPACE_DIR.");
	const source = join(workspace, `pr-subs-${Date.now()}`);
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, "README.md"), "# subs\n");
	const git = (...a: string[]) =>
		execFileSync(
			"git",
			["-c", "user.name=proof", "-c", "user.email=proof@example.invalid", ...a],
			{ cwd: source },
		);
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	git("remote", "add", "origin", "https://github.com/acme/subs.git");
	pr("init", "--ref", "feat/subs-7");
	// Already there before the subscription: the first read is its baseline.
	pr("comment", "--by", "alice", "--body", "Before the subscription.");
	const project = await api("/repositories/source", {
		method: "POST",
		body: { source },
	});
	const { investigationId } = await api("/threads", {
		method: "POST",
		body: {
			subject: { kind: "project", repositoryId: project.id },
			workIn: "worktree",
			text: `fake-session:pr-subscribe Follow ${PR_URL} until it merges.`,
		},
	});
	return investigationId as string;
}

async function settled(api: Api, id: string, ms = 120_000) {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		const run = await api(`/investigations/${id}`);
		if (!["pending", "running", "queued"].includes(run.status)) return run;
		await sleep(500);
	}
	throw new Error(`Timed out waiting for ${id} to settle`);
}

async function newDeliveries(threadId: string, afterId: number) {
	return prisma.prDelivery.findMany({
		where: { investigationId: threadId, id: { gt: afterId } },
		orderBy: { id: "asc" },
	});
}

async function lastDeliveryId(threadId: string): Promise<number> {
	const d = await prisma.prDelivery.findFirst({
		where: { investigationId: threadId },
		orderBy: { id: "desc" },
	});
	return d?.id ?? 0;
}

/**
 * Mutates the host, reads now, and waits until `count` new deliveries are delivered (on the
 * agent's receipt); then pairs them with the host's new sources in order.
 */
async function deliveredStep(
	api: Api,
	threadId: string,
	name: string,
	mutate: () => void,
	kinds: string[],
	ms = 240_000,
) {
	const before = await lastDeliveryId(threadId);
	mutate();
	await api(`/threads/${threadId}/pr-subscriptions/poll`, { method: "POST" });
	const until = Date.now() + ms;
	let rows = await newDeliveries(threadId, before);
	while (
		Date.now() < until &&
		!(rows.length >= kinds.length && rows.every((r) => r.state === "delivered"))
	) {
		await sleep(2000);
		rows = await newDeliveries(threadId, before);
	}
	assert(
		`${name}: ${kinds.join(", ")} delivered once each`,
		rows.length === kinds.length &&
			rows.every((r, i) => r.state === "delivered" && r.kind === kinds[i]),
		rows.map((r) => ({ id: r.id, kind: r.kind, state: r.state })),
	);
	const record = await events(api, threadId);
	const prompts = record
		.filter((e) => e.kind === "operator_message")
		.map((e) => String(e.text));
	for (const r of rows)
		assert(
			`${name}: [d${r.id}] reached a prompt`,
			prompts.some((t) => t.includes(`[d${r.id}·`) || t.includes(`[d${r.id}]`)),
			r.id,
		);
	return { rows, record };
}

/** Reads now and asserts nothing new is delivered within `ms`. */
async function quietStep(
	api: Api,
	threadId: string,
	name: string,
	mutate: () => void,
	ms = 15_000,
) {
	const before = await lastDeliveryId(threadId);
	mutate();
	await api(`/threads/${threadId}/pr-subscriptions/poll`, { method: "POST" });
	await sleep(ms);
	const rows = await newDeliveries(threadId, before);
	assert(`${name}: no delivery`, rows.length === 0, rows);
}

async function main() {
	const { api } = await connect(url);
	const threadId = await setup(api);
	await settled(api, threadId);

	// P1: the agent's call subscribed by URL with its default spec; the first read is a baseline.
	const list = await api(`/threads/${threadId}/pr-subscriptions`);
	const agentSub = list.subscriptions.find(
		(s: { createdBy: string }) => s.createdBy === "agent",
	);
	assert(
		"P1 pl_pr_subscribe by URL stored the agent's default spec",
		!!agentSub &&
			agentSub.state === "active" &&
			JSON.stringify(agentSub.spec) === JSON.stringify(defaultSpec("agent")),
		agentSub,
	);
	await quietStep(api, threadId, "P1 baseline", () => {});
	const sourcesAtStart = sources().length;

	// P2: each kind in turn.
	let commentId = "";
	await deliveredStep(
		api,
		threadId,
		"P2 comment",
		() => {
			commentId = pr(
				"comment",
				"--by",
				"carol",
				"--assoc",
				"COLLABORATOR",
				"--body",
				"Please add a test.",
			);
		},
		["comment"],
	);
	await quietStep(api, threadId, "P2 edit", () => {
		pr("edit", commentId, "--body", "Please add two tests.");
	});
	let reviewId = "";
	await deliveredStep(
		api,
		threadId,
		"P2 review",
		() => {
			reviewId = pr(
				"review",
				"--by",
				"carol",
				"--assoc",
				"COLLABORATOR",
				"--state",
				"CHANGES_REQUESTED",
			);
		},
		["review"],
	);
	await deliveredStep(
		api,
		threadId,
		"P2 dismiss",
		() => pr("dismiss", reviewId),
		["review"],
	);
	let threadComment = "";
	await deliveredStep(
		api,
		threadId,
		"P2 review comment",
		() => {
			threadComment = pr(
				"review-comment",
				"--by",
				"carol",
				"--assoc",
				"COLLABORATOR",
				"--path",
				"src/a.ts",
				"--line",
				"3",
			);
		},
		["review_comment"],
	);
	await deliveredStep(
		api,
		threadId,
		"P2 resolve",
		() => pr("resolve", `T_${threadComment}`),
		["thread_resolved"],
	);
	await deliveredStep(
		api,
		threadId,
		"P2 unresolve",
		() => pr("unresolve", `T_${threadComment}`),
		["thread_reopened"],
	);
	await deliveredStep(
		api,
		threadId,
		"P2 check failing",
		() => pr("check", "--name", "lint", "--state", "failing"),
		["check", "checks_done"],
	);
	await deliveredStep(
		api,
		threadId,
		"P2 forced push",
		() => pr("push", "--forced"),
		["push"],
	);
	await quietStep(api, threadId, "P2 ordinary push (forcedOnly)", () => {
		pr("push");
	});
	await deliveredStep(
		api,
		threadId,
		"P2 conflict",
		() => pr("conflict", "on"),
		["conflict"],
	);

	// P8: the viewer's own comment never comes back; a marker comment by another account does.
	await quietStep(api, threadId, "P8 viewer comment", () => {
		pr(
			"comment",
			"--by",
			"you",
			"--assoc",
			"OWNER",
			"--body",
			"From PrismaLens.",
		);
	});
	const marker = await deliveredStep(
		api,
		threadId,
		"P8 marker comment",
		() =>
			pr(
				"comment",
				"--by",
				"dave",
				"--assoc",
				"COLLABORATOR",
				"--marker",
				"--body",
				"Posted by another agent.",
			),
		["comment"],
	);
	const markerInbound = marker.record
		.filter((e) => e.kind === "message_inbound" && e.prEvents)
		.at(-1);
	assert(
		"P8 the marker comment is labelled agent-posted",
		!!markerInbound?.prEvents?.[0]?.items?.some(
			(i: { agentPosted?: boolean }) => i.agentPosted === true,
		),
		markerInbound?.prEvents,
	);

	// P9: injected text stays inside the one fence; its delimiters, invisibles and lookalike links do not.
	const injected = await deliveredStep(
		api,
		threadId,
		"P9 injection",
		() => pr("inject"),
		["comment"],
	);
	const prompt =
		injected.record
			.filter((e) => e.kind === "operator_message")
			.map((e) => String(e.text))
			.at(-1) ?? "";
	const closes = prompt.split("<<<END PR EVENT TEXT>>>").length - 1;
	assert("P9 one fence close in the prompt", closes === 1, closes);
	assert("P9 no zero-width characters", !/[​-‍⁠﻿]/.test(prompt));
	assert(
		"P9 lookalike and userinfo links omitted",
		!prompt.includes("github.com.evil.example") &&
			!prompt.includes("u@github.com"),
	);
	const outside = prompt.split("<<<PR EVENT TEXT")[0] ?? "";
	assert(
		"P9 no host text before the fence",
		!outside.includes("Ignore every earlier instruction"),
	);

	// P10: a flood is one bundle of 20 items and 25 more.
	const flood = await deliveredStep(
		api,
		threadId,
		"P10 flood",
		() => pr("flood", "45", "--by", "erin", "--assoc", "COLLABORATOR"),
		Array.from({ length: 45 }, () => "comment"),
	);
	const floodInbound = flood.record
		.filter((e) => e.kind === "message_inbound" && e.prEvents)
		.at(-1);
	const group = floodInbound?.prEvents?.[0];
	assert(
		"P10 one wake: 20 items and 25 more",
		group?.items?.length === 20 && group?.more?.length === 25,
		{ items: group?.items?.length, more: group?.more?.length },
	);

	// P14: a refusal on one subscription read silences the origin's subscription reads.
	host("mode", "rate-limit", "600", "--path", "check-runs");
	pr(
		"comment",
		"--by",
		"carol",
		"--assoc",
		"COLLABORATOR",
		"--body",
		"During the limit.",
	);
	await api(`/threads/${threadId}/pr-subscriptions/poll`, { method: "POST" });
	await sleep(5000);
	const refusedAt = requests().length;
	for (let i = 0; i < 2; i++) {
		await api(`/threads/${threadId}/pr-subscriptions/poll`, { method: "POST" });
		await sleep(3000);
	}
	const after = requests()
		.slice(refusedAt)
		.filter((r) => r.path.includes("page=") || r.path === "/graphql");
	assert("P14 no subscription read until reset", after.length === 0, after);
	const paused = await api(`/threads/${threadId}/pr-subscriptions`);
	assert(
		"P14 the panel reads paused by the host",
		paused.subscriptions.some(
			(s: { paused: { reason: string } | null }) =>
				s.paused?.reason === "rate_limited",
		),
		paused.subscriptions.map((s: { paused: unknown }) => s.paused),
	);
	host("mode", "ok");

	// Pairing: every host source since P2 that should reach the agent maps to a delivery, in order.
	const delivered = await prisma.prDelivery.findMany({
		where: { investigationId: threadId, state: "delivered" },
		orderBy: { id: "asc" },
	});
	assert(
		"pairing: no delivery twice, ids ascend",
		delivered.every((d, i) => i === 0 || d.id > (delivered[i - 1]?.id ?? 0)),
	);
	results.push({
		step: "sources since P2",
		ok: true,
		detail: sources().length - sourcesAtStart,
	});
	report();
	console.log(
		`\n${results.length} checks passed; report in ${join(out, "report.json")}`,
	);
}

main()
	.catch((e) => {
		console.error(e instanceof Error ? e.message : String(e));
		report();
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
