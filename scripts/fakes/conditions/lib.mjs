// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What the condition simulators share: arguments, a paired API client on a running
// PrismaLens, and a thread started on a scripted fake session (#1101).
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** @param {string} name */
export function arg(name) {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
}

export const sleep = (/** @type {number} */ ms) =>
	new Promise((r) => setTimeout(r, ms));

/** Per-simulator state that outlives one command (a proxy's pid, a clock's offset). */
export function stateDir(/** @type {string} */ name) {
	return join(
		process.env.PRISMALENS_CONDITIONS_STATE ??
			join(tmpdir(), "prismalens-conditions"),
		name,
	);
}

/**
 * Pairs as the host's own browser does (`pl pair --operator`) and returns a JSON client.
 * @param {string} url
 */
export async function connect(url) {
	if (!process.env.PRISMALENS_WORKSPACE_DIR)
		throw new Error("Set PRISMALENS_WORKSPACE_DIR to the server's workspace.");
	const out = execSync(
		"pnpm --silent --filter prismalens dev pair --operator",
		{ encoding: "utf8", env: process.env },
	);
	const token = out.match(/\/pair#([^\s#]+)/)?.[1];
	if (!token) throw new Error(`No pairing link in:\n${out}`);
	const redeemed = await fetch(`${url}/api/pairing/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: url },
		body: JSON.stringify({ token, name: "condition simulator" }),
	});
	const cookie = redeemed.headers
		.getSetCookie()
		.find((c) => c.startsWith("prismalens.device."))
		?.split(";")[0];
	if (!redeemed.ok || !cookie)
		throw new Error(
			`Pairing failed: ${redeemed.status} ${await redeemed.text()}`,
		);
	/**
	 * @param {string} path
	 * @param {{ method?: string, body?: unknown, ok?: number[] }} [init]
	 * @returns {Promise<any>}
	 */
	const api = async (path, init = {}) => {
		const res = await fetch(`${url}/api${path}`, {
			method: init.method ?? "GET",
			headers: { "content-type": "application/json", origin: url, cookie },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
		const text = await res.text();
		if (!res.ok && !init.ok?.includes(res.status))
			throw new Error(
				`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`,
			);
		return text ? JSON.parse(text) : undefined;
	};
	// The fake agents answer as Claude Code; a server with no agent chosen takes it.
	await api("/settings/harness/check", {
		method: "POST",
		body: { id: "claude-code" },
	});
	const harness = await api("/settings/harness");
	if (!harness.harness)
		await api("/settings/harness", {
			method: "PATCH",
			body: { harness: "claude-code" },
		});
	return { api, cookie };
}

/**
 * Starts a thread whose fake agent plays `session`, titled for a reader.
 * @param {(path: string, init?: { method?: string, body?: unknown }) => Promise<any>} api
 * @param {string} session
 * @param {string} title
 * @param {Record<string, unknown>} [subject]
 */
export async function startThread(api, session, title, subject) {
	const { investigationId: id } = await api("/threads", {
		method: "POST",
		body: {
			subject: subject ?? { kind: "none" },
			text: `fake-session:${session} ${title}`,
			...(subject?.kind === "project" ? { workIn: "worktree" } : {}),
		},
	});
	await api(`/threads/${id}/title`, { method: "POST", body: { title } });
	return /** @type {string} */ (id);
}

/**
 * Polls `GET /investigations/:id` until `done(run)`; throws after `ms`.
 * @param {(path: string) => Promise<any>} api
 * @param {string} id
 * @param {(run: any) => boolean} done
 */
export async function waitFor(api, id, done, ms = 60_000, what = "the run") {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		const run = await api(`/investigations/${id}`);
		if (done(run)) return run;
		await sleep(500);
	}
	throw new Error(`Timed out after ${ms} ms waiting for ${what} of ${id}`);
}

export const ACTIVE = ["pending", "running", "queued"];

/** Every durable event of a thread, oldest first. @param {(p: string) => Promise<any>} api @param {string} id */
export async function events(api, id) {
	const out = await api(`/investigations/${id}/events`);
	return /** @type {any[]} */ (
		Array.isArray(out) ? out : (out.events ?? out.data ?? [])
	);
}
