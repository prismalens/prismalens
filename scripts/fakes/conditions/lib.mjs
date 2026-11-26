// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What the condition simulators share: arguments, a paired API client on a running
// PrismaLens, and a thread started on a scripted fake session (#1101).
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSession } from "../fake-acp-agent.mjs";

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
	const redeemed = await sent(`${url}/api/pairing/redeem`, {
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
		const res = await sent(`${url}/api${path}`, {
			method: init.method ?? "GET",
			// As the operator's own page sends it, so the UI's dev proxy in between is no cross-site hop.
			headers: {
				"content-type": "application/json",
				origin: url,
				cookie,
				"sec-fetch-site": "same-origin",
			},
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

/** Socket errors where the server never read the request: a closed keep-alive or a refused port. */
const UNSENT = new Set([
	"ECONNRESET",
	"ECONNREFUSED",
	"UND_ERR_SOCKET",
	"EPIPE",
]);

/**
 * fetch, again on a socket the server closed under it: a clock skip (host.standby) or a
 * loaded host drops idle keep-alive sockets, and undici reuses one ("fetch failed", #1193).
 * @param {string} url @param {RequestInit} init
 */
async function sent(url, init) {
	for (let i = 1; ; i++) {
		try {
			return await fetch(url, init);
		} catch (e) {
			const code = /** @type {{ cause?: { code?: string } }} */ (e).cause?.code;
			if (i === 6 || !code || !UNSENT.has(code)) throw e;
			await sleep(1000 * i);
		}
	}
}

/**
 * Starts a thread whose fake agent plays `session`, titled for a reader.
 * @param {(path: string, init?: { method?: string, body?: unknown, ok?: number[] }) => Promise<any>} api
 * @param {string} session
 * @param {string} title
 * @param {Record<string, unknown>} [subject]
 */
export async function startThread(api, session, title, subject) {
	const { investigationId: id } = await api("/threads", {
		method: "POST",
		body: {
			subject: subject ?? { kind: "none" },
			text: loadSession(session).prompt ?? `fake-session:${session} ${title}`,
			...(subject?.kind === "project" ? { workIn: "worktree" } : {}),
		},
	});
	try {
		await api(`/threads/${id}/title`, { method: "POST", body: { title } });
	} catch (e) {
		// The thread runs already: stop it, so a caller's failure leaves no load behind.
		await retry(() =>
			api(`/investigations/${id}/cancel`, {
				method: "POST",
				body: {},
				ok: [409],
			}),
		).catch((stop) => {
			console.error(
				`thread ${id} may still be running; its cancel failed: ${stop}`,
			);
		});
		throw e;
	}
	return /** @type {string} */ (id);
}

/**
 * A busy server can drop a connection; three tries before giving up.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function retry(fn) {
	for (let i = 1; ; i++) {
		try {
			return await fn();
		} catch (e) {
			if (i === 3) throw e;
			await sleep(2000);
		}
	}
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
	// The record is paged: follow nextCursor, or a long thread reads as its first 100 events.
	/** @type {any[]} */
	const all = [];
	let cursor = null;
	do {
		const out = await api(
			`/investigations/${id}/events?limit=200${cursor === null ? "" : `&cursor=${cursor}`}`,
		);
		if (Array.isArray(out)) return out;
		all.push(...(out.events ?? out.data ?? []));
		cursor = out.nextCursor ?? null;
	} while (cursor !== null);
	return all;
}

/** A port nothing listens on now, from the OS. */
export async function freePort() {
	const { createServer } = await import("node:net");
	return new Promise((resolve, reject) => {
		const s = createServer();
		s.once("error", reject);
		s.listen(0, "127.0.0.1", () => {
			const { port } = /** @type {import("node:net").AddressInfo} */ (
				s.address()
			);
			s.close(() => resolve(port));
		});
	});
}
