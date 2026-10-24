// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The real `ProxyPort` (#848, 06): vendor MCP servers through a plain proxy. The credential
 * stays here; agents see `<name>__<tool>` names and the tools' own results.
 */
import { randomBytes } from "node:crypto";
import {
	auth,
	extractWWWAuthenticateParams,
} from "@modelcontextprotocol/client";
import { Injectable } from "@nestjs/common";
import {
	allocateOfferedNames,
	type SourceCredential,
} from "@prismalens/contracts/schemas";
import {
	credentialSecrets,
	type ProxyCallResult,
	type ProxyPort,
	type ProxySnapshot,
} from "@prismalens/integrations";
import { PrismaService } from "../../../core/prisma/prisma.service.js";
import { CredentialsService } from "../../integrations/crypto/credentials.service.js";
import { IntegrationsService } from "../../integrations/integrations.service.js";
import {
	type SourceConnection,
	scrubSecrets,
} from "../../integrations/source-request.js";
import {
	CALL_TIMEOUT_MS,
	errorResult,
	failureText,
	needsPermission,
	scrubResult,
} from "./forward.js";
import {
	authFetch,
	lockedAuthProvider,
	type McpOAuthCredential,
	McpOAuthProvider,
	NEEDS_SIGN_IN,
	type PendingSignIn,
} from "./mcp-oauth-provider.js";
import {
	LIMITS,
	listBounded,
	newMeter,
	type SnapshotConnection,
	unreachableReason,
	withinRunBudget,
} from "./snapshot.js";
import { type McpConnection, openUpstream, type Upstream } from "./upstream.js";

export const MCP_TEMPLATE = "mcp-server";

interface RunState {
	snapshot: ProxySnapshot;
	upstreams: Map<string, Upstream>;
	connections: Map<string, McpConnection>;
	byOffered: Map<string, { connectionId: string; upstream: string }>;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
	Promise.race([
		p,
		new Promise<T>((_, reject) =>
			setTimeout(() => {
				const e = new Error("timed out");
				e.name = "TimeoutError";
				reject(e);
			}, ms).unref(),
		),
	]);

@Injectable()
export class McpProxy implements ProxyPort {
	private readonly runs = new Map<string, RunState>();
	/** Test seam: fake servers on plain http. */
	fetchImpl?: typeof fetch;

	constructor(
		private readonly prisma: PrismaService,
		private readonly integrations: IntegrationsService,
		private readonly credentials: CredentialsService,
	) {}

	/** Every non-revoked vendor MCP connection, in name order. */
	async connections(): Promise<McpConnection[]> {
		const rows = await this.prisma.connection.findMany({
			where: {
				status: { not: "REVOKED" },
				integration: { templateId: MCP_TEMPLATE },
			},
			select: { id: true, connectionConfigEnc: true },
		});
		const out: McpConnection[] = [];
		for (const r of rows) {
			const c = await this.connection(r.id, r.connectionConfigEnc);
			if (c) out.push(c);
		}
		return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	}

	private async connection(
		id: string,
		configEnc: Uint8Array | null,
	): Promise<McpConnection | null> {
		let config: Record<string, string> = {};
		try {
			if (configEnc) config = this.credentials.decrypt(Buffer.from(configEnc));
		} catch {
			return null;
		}
		const row = await this.integrations.storedRow(id);
		if (!config.baseUrl || !config.name || !row?.stored.credential.ok)
			return null;
		return {
			id,
			name: config.name,
			description: config.description ?? "",
			url: config.baseUrl,
			credential: row.stored.credential.credential,
			connection: this.integrations.sourceConnection(id),
		};
	}

	private open(c: McpConnection, signal?: AbortSignal): Promise<Upstream> {
		const held = new Set<string>();
		return openUpstream(c, {
			meter: newMeter(),
			held,
			fetch: this.fetchImpl,
			signal,
			authProvider: (usedToken) =>
				lockedAuthProvider({
					connectionId: c.id,
					load: async () => (await c.connection.load()) as McpOAuthCredential,
					save: (next) => {
						for (const t of [
							next.tokens?.access_token,
							next.tokens?.refresh_token,
						])
							if (t) held.add(t);
						return c.connection.save(next);
					},
					usedToken,
					fetch: this.fetchImpl,
					onNeedsSignIn: () =>
						c.connection.report?.({
							kind: "sign-in-expired",
							message: NEEDS_SIGN_IN,
						}) ?? Promise.resolve(),
				}),
		});
	}

	async snapshot(runId: string, budgetMs: number): Promise<ProxySnapshot> {
		const deadline = AbortSignal.timeout(budgetMs);
		const conns = await this.connections();
		const opened = await Promise.all(
			conns.map((c) =>
				withTimeout(this.open(c, deadline), budgetMs).then(
					(up) => ({ c, up }) as const,
					(e: unknown) => ({ c, error: e }) as const,
				),
			),
		);
		const state: RunState = {
			snapshot: { connections: [] },
			upstreams: new Map(),
			connections: new Map(conns.map((c) => [c.id, c])),
			byOffered: new Map(),
		};
		const listed = await Promise.all(
			opened.map(async (o) => {
				if ("error" in o) return unreachable(o.c, unreachableReason(o.error));
				try {
					return await withTimeout(
						listBounded(o.c, o.up, { tools: 0, bytes: 0 }, deadline),
						Math.max(1, budgetMs),
					);
				} catch (e) {
					return unreachable(o.c, unreachableReason(e));
				}
			}),
		);
		const budget = { tools: 0, bytes: 0 };
		const names = new Set<string>();
		// Run totals fill connection by connection in name order (06).
		for (const [i, o] of opened.entries()) {
			let view: SnapshotConnection;
			// A name already offered never routes a second instance's calls (OBJ-026).
			const taken = names.has(o.c.name.toLowerCase());
			names.add(o.c.name.toLowerCase());
			if (taken) {
				view = unreachable(o.c, "another MCP connection has this name");
				if (!("error" in o)) void o.up.close();
			} else if ("error" in o)
				view = unreachable(o.c, unreachableReason(o.error));
			else {
				state.upstreams.set(o.c.id, o.up);
				view = withinRunBudget(listed[i] as SnapshotConnection, budget);
			}
			if (!taken && !("error" in o)) o.up.meter.active = false;
			for (const t of view.tools)
				state.byOffered.set(t.offered, {
					connectionId: o.c.id,
					upstream: t.upstream,
				});
			state.snapshot.connections.push(view);
		}
		this.close(runId);
		this.runs.set(runId, state);
		return state.snapshot;
	}

	async ping(
		runId: string,
		connectionId: string,
		timeoutMs: number,
	): Promise<{ ok: boolean; reason?: string }> {
		const up = this.runs.get(runId)?.upstreams.get(connectionId);
		if (!up)
			return { ok: false, reason: "not reached at the start of this run" };
		try {
			await up.client.ping({
				timeout: timeoutMs,
				signal: AbortSignal.timeout(timeoutMs),
			});
			return { ok: true };
		} catch (e) {
			return { ok: false, reason: unreachableReason(e) };
		}
	}

	async call(
		runId: string,
		offered: string,
		args: unknown,
		signal: AbortSignal,
	): Promise<ProxyCallResult> {
		const run = this.runs.get(runId);
		const hit = run?.byOffered.get(offered);
		const c = hit && run?.connections.get(hit.connectionId);
		const up = hit && run?.upstreams.get(hit.connectionId);
		if (!run || !hit || !c || !up)
			return errorResult("No such PrismaLens tool");
		const row = await this.prisma.connection.findUnique({
			where: { id: c.id },
			select: { status: true },
		});
		if (!row || row.status === "REVOKED")
			return errorResult("This MCP connection was removed");
		const current = await c.connection.load().catch(() => c.credential);
		const secrets = () => [
			...credentialSecrets(c.credential, c.id),
			...credentialSecrets(current, c.id),
			...up.held,
		];
		try {
			const result = (await up.client.callTool(
				{
					name: hit.upstream,
					arguments: (args ?? {}) as Record<string, unknown>,
				},
				{
					signal: AbortSignal.any([
						signal,
						AbortSignal.timeout(CALL_TIMEOUT_MS),
					]),
					timeout: CALL_TIMEOUT_MS,
				},
			)) as ProxyCallResult;
			return scrubResult(result, secrets());
		} catch (e) {
			// A challenge's scope is upstream text too: the same exact-value check (OBJ-035).
			const text = scrubSecrets(failureText(c.name, e), secrets());
			if (text.includes("needs permission"))
				await c.connection.report?.({
					kind: "needs-permission",
					message: text
						.slice(c.name.length + 2)
						.replace(/ — sign in again$/, ""),
				});
			return errorResult(text);
		}
	}

	close(runId: string): void {
		const run = this.runs.get(runId);
		if (!run) return;
		this.runs.delete(runId);
		for (const up of run.upstreams.values()) void up.close();
	}

	/** The connect form's preview: the exact names each tool would be offered under. */
	async preview(draft: {
		url: string;
		name: string;
		credential: SourceCredential;
		/** A saved connection: refresh writes back to it under its own lock (OBJ-025). */
		connection?: SourceConnection;
	}): Promise<{
		ok: boolean;
		detail: string;
		tools: { upstream: string; offered: string; shortened: boolean }[];
	}> {
		const c: McpConnection = {
			id: draft.connection?.id ?? `preview:${draft.url}`,
			name: draft.name,
			description: "",
			url: draft.url,
			credential: draft.credential,
			connection: draft.connection ?? inMemory(draft.credential),
		};
		let up: Upstream | null = null;
		const deadline = AbortSignal.timeout(10_000);
		try {
			up = await withTimeout(this.open(c, deadline), 10_000);
			const view = await withTimeout(
				listBounded(c, up, { tools: 0, bytes: 0 }, deadline),
				10_000,
			);
			const names = allocateOfferedNames(
				c.name,
				view.tools.map((t) => t.upstream),
				new Set(),
			);
			const dropped = view.dropped?.reduce((n, d) => n + d.count, 0) ?? 0;
			return {
				ok: true,
				detail: dropped
					? `offered ${view.tools.length} of ${view.tools.length + dropped} tools (limit reached)`
					: `${view.tools.length} tools`,
				tools: view.tools.map((t) => ({
					upstream: t.upstream,
					offered: names.get(t.upstream)?.offered ?? t.offered,
					shortened: names.get(t.upstream)?.shortened ?? false,
				})),
			};
		} catch (e) {
			return { ok: false, detail: unreachableReason(e), tools: [] };
		} finally {
			await up?.close();
		}
	}

	/**
	 * Starts an MCP server sign-in: discovery and registration run now, and the returned
	 * flow finishes the exchange when the callback carries `state` (OBJ-020).
	 */
	async startSignIn(p: {
		serverUrl: string;
		redirectUri: string;
		scopeOverride?: string;
		client?: { client_id: string; client_secret?: string };
		onSignedIn(credential: McpOAuthCredential): Promise<string>;
	}): Promise<{
		state: string;
		authorizationUrl: string;
		complete(
			params: URLSearchParams,
		): Promise<{ connectionId: string } | { error: "exchange" | "name" }>;
	}> {
		const store = {
			current: {
				kind: "mcp-oauth",
				serverUrl: p.serverUrl,
				redirectUri: p.redirectUri,
				...(p.client
					? { client: { ...p.client, registered: "pasted" as const } }
					: {}),
			} as McpOAuthCredential,
			save: async () => {},
		};
		const pending: PendingSignIn = {
			state: randomBytes(32).toString("base64url"),
			...(p.scopeOverride ? { scopeOverride: p.scopeOverride } : {}),
		};
		const fetchFn = authFetch(() => store.current, {
			signIn: true,
			fetch: this.fetchImpl,
		});
		// The 401 challenge's scope and resource metadata, read once before discovery.
		let resourceMetadataUrl: URL | undefined;
		try {
			const probe = await (this.fetchImpl ?? fetch)(p.serverUrl, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
				redirect: "manual",
			});
			await probe.body?.cancel();
			const ch = extractWWWAuthenticateParams(probe);
			resourceMetadataUrl = ch.resourceMetadataUrl;
			if (ch.scope) pending.challengeScope = ch.scope;
		} catch {
			// Discovery below still runs from the server's well-known paths.
		}
		const provider = new McpOAuthProvider(store, pending);
		const r = await auth(provider, {
			serverUrl: p.serverUrl,
			fetchFn,
			...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
		});
		if (r !== "REDIRECT" || !pending.authorizationUrl)
			throw new Error("The MCP server did not start a sign-in");
		return {
			state: pending.state,
			authorizationUrl: pending.authorizationUrl,
			complete: async (params) => {
				try {
					const done = await auth(provider, {
						serverUrl: p.serverUrl,
						authorizationCode: params.get("code") ?? "",
						iss: params.get("iss") ?? undefined,
						fetchFn,
					});
					if (done !== "AUTHORIZED") return { error: "exchange" };
				} catch {
					return { error: "exchange" };
				}
				try {
					return { connectionId: await p.onSignedIn(store.current) };
				} catch {
					return { error: "name" };
				}
			},
		};
	}
}

function unreachable(c: McpConnection, reason: string): SnapshotConnection {
	return {
		id: c.id,
		name: c.name,
		description: c.description,
		status: "unreachable",
		reason,
		tools: [],
	};
}

function inMemory(initial: SourceCredential): SourceConnection {
	let current = initial;
	return {
		id: "preview",
		load: async () => current,
		save: async (next) => {
			current = next;
		},
	};
}

export { LIMITS, needsPermission };
