// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Is the PrismaLens at a URL this workspace's own? A live lock pid alone can be
 * a reused pid, and /health alone can be another instance on the port (#763).
 * Accident prevention, not authentication: the instance id is public.
 */

export type IdentityOutcome =
	| { kind: "ok" }
	| { kind: "not-running" }
	| { kind: "unreachable"; reason: string }
	| { kind: "forbidden-host" }
	| { kind: "different-instance"; instanceId: string | null };

export interface ProbeOptions {
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

export function instanceUrl(base: string): string {
	return `${base.replace(/\/+$/, "")}/api/instance`;
}

/** Ask `<base>/api/instance` whether it is `expectedId`. */
export async function probeInstance(
	base: string,
	expectedId: string,
	{ fetchImpl = fetch, timeoutMs = 3_000 }: ProbeOptions = {},
): Promise<IdentityOutcome> {
	let res: Response;
	try {
		res = await fetchImpl(instanceUrl(base), {
			redirect: "manual",
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (e) {
		const cause = (e as { cause?: { code?: string } }).cause?.code;
		return {
			kind: "unreachable",
			reason: cause ?? (e instanceof Error ? e.message : String(e)),
		};
	}
	if (res.status === 403) return { kind: "forbidden-host" };
	if (!res.ok) {
		return { kind: "unreachable", reason: `HTTP ${res.status}` };
	}
	let id: unknown;
	try {
		id = ((await res.json()) as { instanceId?: unknown }).instanceId;
	} catch {
		return { kind: "different-instance", instanceId: null };
	}
	return id === expectedId
		? { kind: "ok" }
		: {
				kind: "different-instance",
				instanceId: typeof id === "string" ? id : null,
			};
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** The lock owner's pid is alive and the URL answers with this workspace's id. */
export async function checkIdentity(
	input: { pid: number | null; base: string; instanceId: string },
	options: ProbeOptions & { isAlive?: (pid: number) => boolean } = {},
): Promise<IdentityOutcome> {
	const alive = options.isAlive ?? pidAlive;
	if (input.pid === null || !alive(input.pid)) return { kind: "not-running" };
	return probeInstance(input.base, input.instanceId, options);
}

/** One line for an outcome other than ok. */
export function describeOutcome(
	outcome: IdentityOutcome,
	base: string,
): string {
	switch (outcome.kind) {
		case "ok":
			return `${base} is this workspace's PrismaLens`;
		case "not-running":
			return "no PrismaLens process holds this workspace";
		case "unreachable":
			return `${base} did not answer (${outcome.reason})`;
		case "forbidden-host": {
			const host = new URL(base).hostname.replace(/^\[|\]$/g, "");
			return `${base} refused the host name. Add this line to the environment of \`pl up\` and restart it:\n\n  PRISMALENS_ALLOWED_HOSTS=${host}\n`;
		}
		case "different-instance":
			return `${base} is a different PrismaLens${outcome.instanceId ? ` (instance ${outcome.instanceId})` : ""}, not this workspace's`;
	}
}

/** The loopback URL a lock's bind is reached at. */
export function lockBase(lock: { host?: string; port: number }): string {
	const host = lock.host ?? "127.0.0.1";
	const reach =
		host === "0.0.0.0" || host === "::"
			? "127.0.0.1"
			: host.includes(":")
				? `[${host}]`
				: host;
	return `http://${reach}:${lock.port}`;
}
