// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import {
	setFakeAgentVersion,
	setFakeCapability,
} from "../../../../../scripts/fakes/fake-acp-agent.mjs";
import type { Sim } from "../bar";

/** Edit and rewind's checks (#1193): one fresh thread each, on the diff-turns seed's project. */

const ACTIVE = ["pending", "running", "queued"];
export const APP_TURN_1 =
	"line 1\nline 2\ntimeout = 5\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nretries = 2\n";
export const HAND_EDIT = "# shop\n\nEdited by hand.\n";
export const MESSAGE_2 = "Set the retries to 3";
export const MESSAGE_3 = "Set the retries to 4";

export interface Ev {
	kind: string;
	branchId: string;
	seq: number;
	text?: string;
	[k: string]: unknown;
}

const idOf = (path: string) => path.split("?")[0]?.split("/").pop() ?? "";

async function json<T>(
	page: Page,
	method: "get" | "post" | "put",
	path: string,
	data?: unknown,
): Promise<T> {
	const res = await page.request[method](`/api${path}`, {
		...(data === undefined ? {} : { data }),
	});
	if (!res.ok())
		throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
	const text = await res.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

export const apiGet = <T>(page: Page, path: string) =>
	json<T>(page, "get", path);
export const apiPost = <T>(page: Page, path: string, data: unknown) =>
	json<T>(page, "post", path, data);
export const apiPut = <T>(page: Page, path: string, data: unknown) =>
	json<T>(page, "put", path, data);

export interface Run {
	status: string;
	repositoryId?: string | null;
	workspace?: { cwd?: string; repos?: { name: string }[] } | null;
	acpSessionId?: string | null;
	agentSessions?: string | null;
}

export async function idle(page: Page, id: string, ms = 90_000): Promise<Run> {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		const run = await apiGet<Run>(page, `/investigations/${id}`);
		if (!ACTIVE.includes(run.status)) return run;
		await page.waitForTimeout(500);
	}
	throw new Error(`thread ${id} still running after ${ms} ms`);
}

/** Every visible event of a thread, oldest first. */
export async function eventsOf(page: Page, id: string): Promise<Ev[]> {
	const all: Ev[] = [];
	let cursor: number | null = null;
	do {
		const out: { events: Ev[]; nextCursor?: number | null } = await apiGet(
			page,
			`/investigations/${id}/events?limit=200${cursor === null ? "" : `&cursor=${cursor}`}`,
		);
		all.push(...out.events);
		cursor = out.nextCursor ?? null;
	} while (cursor !== null);
	return all;
}

export async function sendMessage(page: Page, id: string, text: string) {
	await apiPost(page, `/investigations/${id}/messages`, { text });
}

/** The seq of the sent message with `text`. */
export async function seqOf(
	page: Page,
	id: string,
	text: string,
): Promise<number | null> {
	const e = (await eventsOf(page, id)).find(
		(x) => x.kind === "operator_message" && x.text === text,
	);
	return e ? e.seq : null;
}

export interface Fixture {
	id: string;
	cwd: string;
	path: string;
}

/**
 * A thread on the diff-turns project, played by fake session rewind: turn 1 sets retries to
 * 2, a hand edit to README.md, then messages 2 and 3 set it to 3 and 4.
 */
export async function rewindFixture(
	page: Page,
	sim: Sim,
	opts: { messages?: string[] } = {},
): Promise<Fixture | string> {
	const seed = await apiGet<Run>(
		page,
		`/investigations/${idOf(sim.thread("huge.diff", 1))}`,
	).catch(() => null);
	if (!seed?.repositoryId) return "the diff-turns seed has no project";
	const { investigationId: id } = await apiPost<{ investigationId: string }>(
		page,
		"/threads",
		{
			subject: { kind: "project", repositoryId: seed.repositoryId },
			text: "fake-session:rewind The checkout client retries too little. Raise the retries step by step.",
			workIn: "worktree",
			// Claude Code: the one agent whose rewind can fork; an earlier check may leave another as default.
			harness: "claude-code",
		},
	);
	const first = await idle(page, id);
	const cwd = first.workspace?.cwd;
	if (!cwd) return "the fixture thread has no worktree";
	writeFileSync(join(cwd, "README.md"), HAND_EDIT);
	for (const text of opts.messages ?? [MESSAGE_2, MESSAGE_3]) {
		await sendMessage(page, id, text);
		await idle(page, id);
	}
	return { id, cwd, path: `/threads/${id}` };
}

export const fileAt = (cwd: string, p: string) => {
	try {
		return readFileSync(join(cwd, p), "utf8");
	} catch {
		return null;
	}
};

export interface Preview {
	seq: number;
	messageOrdinal: number;
	revision: number;
	block: string | null;
	turns: number;
	repos: (
		| {
				repo: string;
				state: "ok";
				head: string;
				tree: string;
				revert: { path: string; status: string }[];
				duringTurn: string[];
				kept: { path: string; why: string }[];
				commits: number;
		  }
		| { repo: string; state: "unavailable"; reason: string }
	)[];
	stays: string[];
	session: { via: string; why: string | null };
}

export const previewOf = (page: Page, id: string, seq: number) =>
	apiGet<Preview>(page, `/threads/${id}/rewind?seq=${seq}`);

/** Rewinds message `seq` to `text` through the API, bound to a fresh preview. */
export async function rewindVia(
	page: Page,
	id: string,
	seq: number,
	text: string,
): Promise<{
	state: string;
	rewindId?: string;
	sent?: boolean;
	reason?: string;
	reverted?: unknown[];
	kept?: unknown[];
}> {
	const p = await previewOf(page, id, seq);
	const repos = Object.fromEntries(
		p.repos.flatMap((r) =>
			r.state === "ok" ? [[r.repo, { head: r.head, tree: r.tree }]] : [],
		),
	);
	return apiPost(page, `/threads/${id}/rewind`, {
		id,
		seq,
		text,
		expect: { messageOrdinal: p.messageOrdinal, revision: p.revision, repos },
		include: [],
	});
}

/** What a rewind must leave as it found it, when nothing ran. */
export async function stateOf(page: Page, id: string, cwd: string) {
	const events = await eventsOf(page, id);
	const run = await apiGet<Run>(page, `/investigations/${id}`);
	return JSON.stringify({
		events: events.length,
		last: events.at(-1)?.seq ?? null,
		app: fileAt(cwd, "src/app.txt"),
		readme: fileAt(cwd, "README.md"),
		session: [run.acpSessionId ?? null, run.agentSessions ?? null],
	});
}

/** The sim's fake agents' state folder (`scripts/sim/sim.mjs`: `<sim>/fakes-state`). */
const FAKE_STATE = resolve(
	process.env.BAR_SIM_DIR ?? "../../.sim-checks",
	"fakes-state",
);

/**
 * The fakes answer `initialize` before they pick a script, so a fork needs these set first:
 * the `fork` capability and the pinned adapter version (`scripts/fakes/sessions/rewind.json`).
 */
export function fakeFork(
	on: { version?: string | null; ignoreForkPoint?: boolean } | null,
) {
	setFakeCapability("fork", on !== null, FAKE_STATE);
	setFakeCapability("ignoreForkPoint", !!on?.ignoreForkPoint, FAKE_STATE);
	setFakeAgentVersion(on ? (on.version ?? "0.109.0") : null, FAKE_STATE);
}
