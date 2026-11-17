#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Session boundaries and turn inputs (#1166), asserted against a running sim; exits 1 on the
// first failed assertion.
//   W=<workspace> PRISMALENS_WORKSPACE_DIR=$W node scripts/fakes/conditions/session-boundaries.mjs \
//     --url <url> --state-dir .sim/fakes-state
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { setFakeCapability } from "../fake-acp-agent.mjs";
import {
	ACTIVE,
	arg,
	connect,
	events,
	sleep,
	startThread,
	waitFor,
} from "./lib.mjs";
import { REPO_ROOT } from "./stamp.mjs";

const SESSION = "session-boundaries";
const RETRY_NOTE =
	"The model provider asked to wait; continue where you left off.";
const url = (arg("--url") ?? "").replace(/\/$/, "");
const fakes = resolve(arg("--state-dir") ?? ".sim/fakes-state");
const workspace = process.env.PRISMALENS_WORKSPACE_DIR ?? "";
/** @type {(p: string, i?: any) => Promise<any>} */
let api;
/** Every thread the run made, for the body check at the end. */
const threads = new Set();
/** When this run began: earlier prompts on the wire belong to other runs. */
let started = 0;

/** @param {string} what @param {boolean} ok @param {unknown} [seen] */
function check(what, ok, seen) {
	console.log(
		`${ok ? "PASS" : "FAIL"} ${what}${seen === undefined ? "" : ` · ${JSON.stringify(seen)}`}`,
	);
	if (!ok) throw new Error(`assertion failed: ${what}`);
}

const ended = (/** @type {string} */ id, ms = 180_000) =>
	waitFor(api, id, (r) => !ACTIVE.includes(r.status), ms, "the run's end");

/** The openings after the first `from` ones, once the run that made them ended. */
async function openingsAfter(
	/** @type {string} */ id,
	/** @type {number} */ from,
) {
	for (let i = 0; i < 360; i++) {
		const run = await api(`/investigations/${id}`);
		const evs = await events(api, id);
		const opened = evs.filter((e) => e.kind === "session_opened");
		if (opened.length > from && !ACTIVE.includes(run.status))
			return { evs, opened: opened.slice(from), run };
		await sleep(500);
	}
	throw new Error(`no new session_opened on ${id}`);
}

const openedCount = async (/** @type {string} */ id) =>
	(await events(api, id)).filter((e) => e.kind === "session_opened").length;

/** A follow-up send, then the opening it made. */
async function followUp(
	/** @type {string} */ id,
	/** @type {Record<string, unknown>} */ body,
	text = "What changed since?",
) {
	const from = await openedCount(id);
	await api(`/investigations/${id}/messages`, {
		method: "POST",
		body: { text, mode: "queue", kind: "chat", ...body },
	});
	return openingsAfter(id, from);
}

/** @param {string} id */
async function body(id, /** @type {any} */ input) {
	return api(`/investigations/${id}/turn-inputs/${input.inputId}`);
}

function cap(/** @type {Parameters<typeof setFakeCapability>[0]} */ name, on) {
	setFakeCapability(name, on, fakes);
}

async function fire() {
	const token = readFileSync(
		join(workspace, "PRISMALENS_WEBHOOK_SECRET_FILE"),
		"utf8",
	).trim();
	const labels = {
		alertname: `Session boundaries ${Date.now()} fake-session:${SESSION}`,
		severity: "warning",
		service: "simulated",
	};
	const res = await fetch(`${url}/api/webhooks/prometheus`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"user-agent": "Alertmanager/0.28.1",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			version: "4",
			groupKey: `{}:{alertname="${labels.alertname}"}`,
			truncatedAlerts: 0,
			status: "firing",
			receiver: "prismalens",
			groupLabels: { alertname: labels.alertname },
			commonLabels: labels,
			commonAnnotations: {},
			externalURL: url,
			alerts: [
				{
					status: "firing",
					labels,
					annotations: { summary: "p99 latency rose after a deploy" },
					startsAt: new Date().toISOString(),
					endsAt: "0001-01-01T00:00:00Z",
					generatorURL: url,
					fingerprint: `${SESSION}-${Date.now()}`,
				},
			],
		}),
	});
	if (res.status >= 300)
		throw new Error(`webhook ${res.status}: ${await res.text()}`);
	const { alertIds } = await res.json();
	const { incidentId } = await api(`/alerts/${alertIds[0]}`);
	let id;
	for (let i = 0; i < 10 && !id; i++) {
		const list = await api(`/investigations?incidentId=${incidentId}&limit=5`);
		id = list.data?.[0]?.id;
		if (!id) await sleep(500);
	}
	if (!id)
		({ investigationId: id } = await api(
			`/incidents/${incidentId}/investigate`,
			{
				method: "POST",
				body: {},
			},
		));
	return /** @type {string} */ (id);
}

async function alertCase() {
	const id = await fire();
	threads.add(id);
	await ended(id);
	const evs = await events(api, id);
	const first = evs.find((e) => e.kind === "session_opened");
	check(
		"alert run: how new, cause first",
		first?.how === "new" && first?.cause === "first",
		first && { how: first.how, cause: first.cause },
	);
	const firstInput = evs.find((e) => e.kind === "turn_input");
	check(
		"alert run: session_opened before its first turn_input",
		evs.indexOf(first) < evs.indexOf(firstInput),
	);
	const b = await body(id, firstInput);
	check(
		"alert run: the first body has a non-empty system part",
		b.parts.some((p) => p.type === "system" && p.text.trim()),
		b.parts.map((p) => p.type),
	);
	const t1 = (await events(api, id)).find((e) => e.kind === "turn_input");
	check("alert run: attempt 1", t1.attempt === 1);

	let o = (await followUp(id, {})).opened[0];
	check(
		"plain follow-up: load/dedupe with replayed ≥ 1",
		o.how === "load" &&
			o.replay === "dedupe" &&
			o.replayed >= 1 &&
			o.cause === "follow_up",
		o,
	);

	cap("replayComplete", true);
	try {
		o = (await followUp(id, {})).opened[0];
	} finally {
		cap("replayComplete", false);
	}
	check(
		"replayComplete: load/marker",
		o.how === "load" && o.replay === "marker",
		o,
	);

	cap("resume", true);
	try {
		o = (await followUp(id, {})).opened[0];
	} finally {
		cap("resume", false);
	}
	check("resume capability: resume", o.how === "resume", o);

	let r = await followUp(id, { model: "claude-opus-5-5" });
	o = r.opened[0];
	const configs = r.evs.filter(
		(e) => e.kind === "session_config" && e.option === "model",
	);
	check(
		"model switch: modelFrom set, model in effect",
		o.how === "load" && !!o.modelFrom && o.model === "claude-opus-5-5",
		o,
	);
	check(
		"model switch: session_config accepted",
		configs.at(-1)?.accepted === true,
	);
	check(
		"model switch: the turn completed",
		r.run.status === "completed" && r.evs.at(-1)?.kind !== "error",
		r.run.status,
	);
	check(
		"model switch: the thread keeps the model it switched to",
		r.run.model === "claude-opus-5-5",
		r.run.model,
	);

	const from = await openedCount(id);
	await api(`/investigations/${id}/compact`, { method: "POST", body: {} });
	r = await openingsAfter(id, from);
	o = r.opened[0];
	const at = r.evs.indexOf(o);
	const after = r.evs.slice(at);
	const startedAt = after.findIndex(
		(e) => e.kind === "compaction" && e.phase === "started",
	);
	check(
		"compact only: cause compact, drawn by its own event",
		o.cause === "compact" && o.carrier === "event",
		o,
	);
	check(
		"compact only: session_opened before compaction started",
		startedAt > 0,
	);
	check(
		"compact only: no operator_message",
		!after.some((e) => e.kind === "operator_message"),
	);

	r = await followUp(id, { compact: true });
	o = r.opened[0];
	const tail = r.evs.slice(r.evs.indexOf(o));
	const cStart = tail.findIndex(
		(e) => e.kind === "compaction" && e.phase === "started",
	);
	const msg = tail.findIndex((e) => e.kind === "operator_message");
	check(
		"compact before send: opening, then compaction, then the message",
		cStart > 0 && msg > cStart && o.carrier === "event",
		{ cStart, msg, carrier: o.carrier },
	);
	check(
		"compact before send: one opening, and its message carries none (one divider)",
		tail.filter((e) => e.kind === "session_opened").length === 1 &&
			!tail[msg]?.via?.session,
	);

	await api("/settings/harness/check", {
		method: "POST",
		body: { id: "opencode" },
	});
	o = (await followUp(id, { harness: "opencode" })).opened[0];
	check(
		"handoff: how handoff, carried named",
		o.how === "handoff" && !!o.carried && o.harness === "opencode",
		o,
	);

	r = await followUp(id, { fresh: true });
	o = r.opened[0];
	const summary = r.evs
		.slice(r.evs.indexOf(o))
		.find((e) => e.kind === "compaction" && e.method === "summary");
	check("start fresh: how summary", o.how === "summary", o);
	check(
		"start fresh: compaction summary stored",
		summary?.phase === "completed" && !!summary.summary?.trim(),
	);
	const row = await api(`/investigations/${id}`);
	check(
		"start fresh: session.compaction is summary",
		row.session?.compaction === "summary",
		row.session?.compaction,
	);
	return id;
}

async function chatCase() {
	const id = await startThread(api, SESSION, "Session boundaries chat");
	threads.add(id);
	await ended(id);
	const evs = await events(api, id);
	const o = evs.find((e) => e.kind === "session_opened");
	const m = evs.find((e) => e.kind === "operator_message");
	check(
		"chat: how new, carried by its first message",
		o?.how === "new" &&
			o.carrier === "message" &&
			m?.via?.session?.how === "new",
		o,
	);
	const b = await body(
		id,
		evs.find((e) => e.kind === "turn_input"),
	);
	check(
		"chat: no system part",
		!b.parts.some((p) => p.type === "system"),
		b.parts.map((p) => p.type),
	);
}

/** The thread page's send with another agent picked: a handoff with the full seed, the level kept. */
async function agentSwitchCase() {
	const id = await startThread(api, "success", "Switch agent in place");
	threads.add(id);
	await ended(id);
	await followUp(id, {}, "First follow-up");
	await followUp(id, {}, "Second follow-up");
	const before = await api(`/investigations/${id}`);
	await api("/settings/harness/check", {
		method: "POST",
		body: { id: "opencode" },
	});
	const r = await followUp(id, { harness: "opencode" }, "Over to you");
	const o = r.opened[0];
	check(
		"agent switch: handoff to the other agent",
		o.how === "handoff" &&
			o.harness === "opencode" &&
			o.harness !== before.harness,
		{ how: o.how, from: before.harness, to: o.harness },
	);
	const input = r.evs
		.slice(r.evs.indexOf(o))
		.find((e) => e.kind === "turn_input");
	const b = await body(id, input);
	const text = b.parts
		.filter((p) => p.type === "text")
		.map((p) => p.text)
		.join(" ");
	check(
		"agent switch: the full seed",
		text.includes("You are taking over") &&
			text.includes("all of them") &&
			text.includes("First follow-up") &&
			text.includes("Second follow-up"),
	);
	check(
		"agent switch: the access level is unchanged",
		r.run.accessLevel === before.accessLevel,
		{ before: before.accessLevel, after: r.run.accessLevel },
	);
}

async function brokenLoadCase() {
	const id = await startThread(api, "success", "Broken load");
	threads.add(id);
	await ended(id);
	cap("brokenLoad", true);
	let o;
	try {
		o = (await followUp(id, {})).opened[0];
	} finally {
		cap("brokenLoad", false);
	}
	check(
		"broken load: load_broken with what it carried",
		o.how === "load_broken" && !!o.carried,
		o,
	);
}

async function brokenLoadModelCase() {
	const id = await startThread(api, SESSION, "Broken load model switch");
	threads.add(id);
	await ended(id);
	const model = "claude-opus-5-5";
	const first = (await events(api, id)).find(
		(e) => e.kind === "session_opened",
	);
	const before = (await api(`/investigations/${id}`)).model ?? null;
	check(
		"broken load + model switch: the thread starts on another model",
		before !== model && (first?.model ?? null) !== model,
		{ stored: before, opened: first?.model ?? null },
	);
	cap("brokenLoad", true);
	let r;
	try {
		r = await followUp(id, { model });
	} finally {
		cap("brokenLoad", false);
	}
	let o = r.opened[0];
	check(
		"broken load + model switch: load_broken opens on the new model",
		o.how === "load_broken" && o.model === model,
		o,
	);
	check(
		"broken load + model switch: the thread stores the new model",
		(await api(`/investigations/${id}`)).model === model,
	);
	r = await followUp(id, {}, "And after that?");
	o = r.opened[0];
	check(
		"broken load + model switch: the next follow-up, with no model, opens on it",
		o.how === "load" && o.model === model,
		o,
	);
	check(
		"broken load + model switch: the next follow-up completed on the thread's model",
		r.run.status === "completed" && r.run.model === model,
		r.run.model,
	);
}

async function retryCase() {
	const id = await startThread(
		api,
		"api-rate-limit-short",
		"Retry inside a turn",
	);
	threads.add(id);
	await ended(id);
	const inputs = (await events(api, id)).filter((e) => e.kind === "turn_input");
	check(
		"retry: attempts 1 then 2",
		inputs.map((e) => e.attempt).join() === "1,2",
		inputs.map((e) => e.attempt),
	);
	const b = await body(id, inputs[1]);
	const text = b.parts.find((p) => p.type === "text");
	check(
		"retry: attempt 2 starts with the retry note",
		text?.text.startsWith(RETRY_NOTE),
	);
}

async function limitCase() {
	const id = await startThread(api, "limit-mid-turn", "Limit then resume");
	threads.add(id);
	await ended(id);
	await api(`/investigations/${id}/auto-resume`, {
		method: "PUT",
		body: { on: true },
	});
	// The limit's wake is written just after the run ends.
	await waitFor(
		api,
		id,
		(r) => !!r.session?.limit?.nextAttemptAt,
		30_000,
		"the limit's wake",
	);
	const from = await openedCount(id);
	await api(`/investigations/${id}/retry-now`, { method: "POST", body: {} });
	const o = (await openingsAfter(id, from)).opened[0];
	check("limit resume: cause limit", o.cause === "limit", o);
}

async function snapshotCase() {
	const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
		execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" });
	const root = join(workspace, `session-boundaries-${Date.now()}`);
	const source = join(root, "shop");
	mkdirSync(join(source, "src"), { recursive: true });
	writeFileSync(join(source, "README.md"), "# shop\n");
	writeFileSync(join(source, "src", "app.txt"), "timeout = 5\n");
	git(root, "init", "-q", "--bare", "-b", "main", join(root, "origin.git"));
	git(source, "init", "-q", "-b", "main");
	git(source, "add", ".");
	git(
		source,
		"-c",
		"user.name=sim",
		"-c",
		"user.email=sim@example.invalid",
		"commit",
		"-q",
		"-m",
		"init",
	);
	git(source, "remote", "add", "origin", join(root, "origin.git"));
	git(source, "push", "-q", "origin", "main");
	const project = await api("/repositories/source", {
		method: "POST",
		body: { source },
	});
	const id = await startThread(
		api,
		"diff-turns",
		"Raise the checkout timeout",
		{
			kind: "project",
			repositoryId: project.id,
		},
	);
	threads.add(id);
	await ended(id);
	const first = (await events(api, id)).find(
		(e) => e.kind === "turn_input" && e.attempt === 1,
	);
	const changes = await api(
		`/investigations/${id}/changes?scope=all&patch=none`,
	);
	const turns = (changes.repos ?? [])
		.flatMap((r) => r.scoped?.turns ?? [])
		.map((t) => t.seq);
	check(
		"snapshot: attempt 1's seq is a snapshot turn",
		turns.includes(first?.seq),
		{ seq: first?.seq, turns },
	);
}

async function restartCase() {
	await api("/settings/harness", {
		method: "PATCH",
		body: { resumeAfterRestart: false },
	});
	// A cap is read at `initialize`: each agent must be past it before the cap changes.
	const working = async (/** @type {string} */ id) => {
		for (let i = 0; i < 120; i++) {
			if ((await events(api, id)).some((e) => e.kind === "tool_result")) return;
			await sleep(500);
		}
		throw new Error(`${id} never reached its tool call`);
	};
	const load = await startThread(api, "live-stuck", "Restart then reload");
	await working(load);
	cap("noLoad", true);
	let handoff;
	try {
		handoff = await startThread(api, "live-stuck", "Restart then hand off");
		await working(handoff);
	} finally {
		cap("noLoad", false);
	}
	threads.add(load);
	threads.add(handoff);
	await sleep(3000);
	execFileSync(
		process.execPath,
		[join(REPO_ROOT, "scripts/sim/sim.mjs"), "restart"],
		{
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: process.env,
		},
	);
	({ api } = await connect(url));
	for (const [id, how] of [
		[load, "load"],
		[handoff, "handoff"],
	]) {
		await waitFor(
			api,
			id,
			(r) => !ACTIVE.includes(r.status),
			120_000,
			"the interrupted end",
		);
		const from = await openedCount(id);
		await api(`/investigations/${id}/resume`, { method: "POST", body: {} });
		let o;
		for (let i = 0; i < 120 && !o; i++) {
			o = (await events(api, id)).filter((e) => e.kind === "session_opened")[
				from
			];
			if (!o) await sleep(500);
		}
		check(
			`restart: how ${how}, cause restart`,
			o?.how === how && o?.cause === "restart",
			o,
		);
		const m = (await events(api, id)).find(
			(e) => e.kind === "operator_message" && e.via?.restart,
		);
		check(
			`restart (${how}): its message carries the opening`,
			m?.via?.session?.cause === "restart",
		);
		await api(`/investigations/${id}/cancel`, {
			method: "POST",
			body: {},
			ok: [404, 409],
		});
		await ended(id, 60_000);
	}
}

/**
 * Every stored body against its own prompt on the wire: bodies in event order, each paired with
 * the first prompt the agent received after it (the thread namer's skipped), `chars` its text length.
 */
async function bodiesCase() {
	const wire = existsSync(join(fakes, "prompts.jsonl"))
		? readFileSync(join(fakes, "prompts.jsonl"), "utf8")
				.split(/\r?\n/)
				.filter(Boolean)
				.map((l) => JSON.parse(l))
				.filter(
					(w) =>
						w.at >= started &&
						!String(w.prompt?.[0]?.text ?? "").startsWith("You name threads."),
				)
				.sort((a, b) => a.at - b.at)
		: [];
	const asWire = (/** @type {any[]} */ blocks) =>
		JSON.stringify(
			blocks.map((b) =>
				b.type === "text"
					? { type: "text", text: b.text }
					: b.type === "resource_link" || b.type === "link"
						? { type: "link", name: b.name, uri: b.uri }
						: { type: "image", mimeType: b.mimeType },
			),
		);
	/** @type {{ id: string, e: any, at: number }[]} */
	const inputs = [];
	for (const id of threads)
		for (const e of (await events(api, id)).filter(
			(x) => x.kind === "turn_input",
		))
			inputs.push({ id, e, at: Date.parse(e.ts) });
	inputs.sort((a, b) => a.at - b.at);
	const used = new Set();
	for (const { id, e, at } of inputs) {
		const name = `body ${id.slice(0, 8)}/${e.seq}`;
		check(`${name}: recorded`, e.recorded !== false);
		const b = await body(id, e);
		const chars = b.parts.reduce((n, p) => n + (p.text?.length ?? 0), 0);
		check(
			`${name}: chars is the text length`,
			chars === b.chars && b.chars === e.chars,
			{
				chars,
				stored: b.chars,
				event: e.chars,
			},
		);
		const k = wire.findIndex((w, i) => !used.has(i) && w.at >= at - 200);
		used.add(k);
		const own = asWire(b.parts.filter((p) => p.type !== "system"));
		check(
			`${name}: equals its own prompt on the wire`,
			k >= 0 && asWire(wire[k].prompt) === own,
		);
	}
	return inputs.length;
}

function dbSize() {
	const db = join(workspace, "prismalens.db");
	return ["", "-wal"].reduce(
		(n, s) => n + (existsSync(db + s) ? statSync(db + s).size : 0),
		0,
	);
}

async function main() {
	if (!url) throw new Error("Pass --url <the sim's app URL>.");
	if (!workspace) throw new Error("Set PRISMALENS_WORKSPACE_DIR.");
	({ api } = await connect(url));
	started = Date.now();
	// Claude Code takes the brief as its system prompt, so the alert case can see a system part.
	await api("/settings/harness/check", {
		method: "POST",
		body: { id: "claude-code" },
	});
	await api("/settings/harness", {
		method: "PATCH",
		body: { harness: "claude-code" },
	});
	const before = dbSize();
	await alertCase();
	await chatCase();
	await agentSwitchCase();
	await brokenLoadCase();
	await brokenLoadModelCase();
	await retryCase();
	await limitCase();
	await snapshotCase();
	await restartCase();
	const rows = await bodiesCase();
	console.log(
		JSON.stringify({
			turnInputRows: rows,
			dbBytesBefore: before,
			dbBytesAfter: dbSize(),
		}),
	);
	console.log(
		"Not driven: a wake's resume (wakeup.json waits 600 s through the gateway) and idle compaction.",
	);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
