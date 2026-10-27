// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The API's gateway for the scripted-model runs (#848, #914): the API's own tool
 * declarations, views and MCP server over fixed data, behind the run's bearer, with a
 * real findings ledger. `PL_TOOL_SEARCH=on` gives the run a core plus `tools_search`.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Artifact, RecordedFinding } from "@prismalens/contracts/schemas";
import {
	type HarnessCall,
	type HarnessTool,
	harnessMcpServer,
	harnessPromptLine,
	runView,
} from "@prismalens/integrations/harness";
import {
	type EvidenceInput,
	FindingsLedger,
	type HypothesisInput,
} from "../src/run/findings.js";
import {
	type GatewayCall,
	type GatewayCallCount,
	type GatewayEntry,
	newGatewayServerName,
} from "../src/run/gateway.js";

/** Words a row's fixture looks for in a tool's result to prove the real tool answered. */
export const STUB_FACTS = {
	incident: "ScenarioIncident",
	past: "ScenarioPastCause",
	runbook: "ScenarioRunbookStep",
	threadSummary: "ScenarioPriorSummary",
	threadCause: "ScenarioThreadCause",
	timeline: "ScenarioTimelineNote",
	team: "ScenarioTeamPlatform",
	change: "ScenarioDeploy",
	repo: "ScenarioRepo",
} as const;

const STUB_THREAD = "00000000-0000-4000-8000-0000000000c1";

/** The API's `gatewayTools`, loaded by path: the engine's build cannot import the api package. */
type GatewayTools = (data: unknown) => readonly HarnessTool[];
const API_TOOLS = new URL(
	"../../../api/src/modules/gateway/tools/index.ts",
	import.meta.url,
).href;

export interface StubGateway {
	entry: GatewayEntry;
	/** Every call, as the run will record it. */
	harnessCalls: () => HarnessCall[];
	count: () => number;
	close: () => Promise<void>;
}

export async function startStubGateway(
	opts: { incidentTitle?: string; search?: boolean } = {},
): Promise<StubGateway> {
	const { gatewayTools } = (await import(API_TOOLS)) as {
		gatewayTools: GatewayTools;
	};
	const token = randomBytes(24).toString("hex");
	const serverName = newGatewayServerName();
	const search = opts.search ?? process.env.PL_TOOL_SEARCH === "on";
	const title = opts.incidentTitle ?? STUB_FACTS.incident;
	let connected = false;
	let open = true;
	const waiters = new Set<(ok: boolean) => void>();
	const listeners = new Set<(c: GatewayCall) => void>();
	const found = new Set<(f: RecordedFinding) => void>();
	const published = new Set<(a: Artifact) => void>();
	let pages = 0;
	const counts = new Map<string, GatewayCallCount>();
	const seen: HarnessCall[] = [];
	const ledger = new FindingsLedger();
	const tell = (f: RecordedFinding) => {
		for (const l of [...found]) l(f);
	};
	const NOT_LIVE = {
		error: "This run is not live, so nothing can be recorded on it",
	};
	const tools = gatewayTools({
		searchInvestigations: async () => [
			{
				investigationId: "00000000-0000-4000-8000-0000000000b2",
				incident: {
					number: 7,
					title: "Checkout timeouts",
					service: "scenario",
				},
				completedAt: "2026-01-01T00:00:00.000Z",
				agentFinding: { summary: null, rootCause: null, category: null },
				operatorRecordedCause: { cause: STUB_FACTS.past, category: "deploy" },
			},
		],
		incident: async () => ({
			number: 1,
			title,
			status: "investigating",
			severity: "warning",
			service: "scenario",
			triggeredAt: "2026-01-01T00:00:00.000Z",
			description: null,
			alerts: [
				{
					title,
					severity: "warning",
					labels: { alertname: title },
					triggeredAt: "2026-01-01T00:00:00.000Z",
				},
			],
			changes: [],
		}),
		threads: {
			list: async () => ({
				threads: [
					{
						id: STUB_THREAD,
						kind: "investigation",
						status: "completed",
						startedAt: "2026-01-01T00:00:00.000Z",
						finishedAt: "2026-01-01T00:05:00.000Z",
						agent: "claude-code",
						model: null,
						summary: STUB_FACTS.threadSummary,
					},
				],
			}),
			read: async (_run: string, threadId: string) =>
				threadId === STUB_THREAD
					? {
							id: STUB_THREAD,
							kind: "investigation",
							status: "completed",
							report: {
								summary: STUB_FACTS.threadSummary,
								rootCause: STUB_FACTS.threadCause,
								hypotheses: [],
								nextSteps: [],
								culprit: null,
							},
							steps: [],
							error: null,
						}
					: null,
		},
		incidentRecord: {
			timeline: async () => ({
				incident: 1,
				total: 1,
				entries: [
					{
						type: "note",
						source: "operator",
						text: STUB_FACTS.timeline,
						at: "2026-01-01T00:01:00.000Z",
					},
				],
			}),
			scope: async () => ({
				number: 1,
				triggeredAt: "2026-01-01T00:00:00.000Z",
				services: ["scenario"],
			}),
			changes: async () => ({
				unknown: [],
				changes: [
					{
						type: "deploy",
						source: "scenario",
						at: "2026-01-01T00:00:00.000Z",
						service: "scenario",
						description: STUB_FACTS.change,
						environment: "production",
						version: "v1",
					},
				],
			}),
		},
		service: async (name: string) =>
			name === "scenario"
				? {
						name,
						displayName: null,
						type: "service",
						tier: "tier_1",
						team: STUB_FACTS.team,
						slackChannel: null,
						tags: [],
						repos: [],
						dependsOn: [],
						dependedOnBy: [],
					}
				: null,
		runStatus: async () => ({
			status: "running",
			usage: null,
			secondsLeft: 600,
			accessLevel: "supervised",
			repos: [
				{
					name: STUB_FACTS.repo,
					subPath: null,
					branch: "main",
					commit: "0000000000000000000000000000000000000001",
					services: ["scenario"],
				},
			],
		}),
		runbooks: {
			list: async () => [
				{
					title: "Scenario restart",
					path: "scenario/runbooks/restart.md",
					service: "scenario",
					matchedBy: "runbooks/",
					origin: "repo",
				},
			],
			read: async (_run: string, path: string, service: string) =>
				path === "scenario/runbooks/restart.md" && service === "scenario"
					? { ok: true, path, markdown: `# Restart\n\n${STUB_FACTS.runbook}` }
					: { ok: false, error: `"${path}" is not a listed runbook` },
		},
		artifacts: {
			publish: async (_run: string, page: { title: string; html: string }) => {
				if (!open) return { ...NOT_LIVE, ended: true as const };
				const artifact: Artifact = {
					id: `a${++pages}`,
					...page,
					at: new Date().toISOString(),
				};
				for (const l of [...published]) l(artifact);
				return { id: artifact.id };
			},
		},
		findings: {
			recordEvidence: async (_run: string, input: EvidenceInput) => {
				if (!open) return NOT_LIVE;
				const r = ledger.addEvidence(input, null, new Date().toISOString());
				if (!("error" in r)) tell({ type: "evidence", ...r });
				return r;
			},
			recordHypothesis: async (_run: string, input: HypothesisInput) => {
				if (!open) return NOT_LIVE;
				const r = ledger.addHypothesis(input, new Date().toISOString());
				if (!("error" in r)) tell({ type: "hypothesis", ...r });
				return r;
			},
		},
	});
	const view = runView(tools, { search });
	const handler = createMcpHandler(
		() =>
			harnessMcpServer({
				runId: "stub",
				view,
				version: "0.0.0",
				onCall: (call) => {
					seen.push(call);
					const known = counts.get(call.name);
					counts.set(
						call.name,
						known
							? { ...known, count: known.count + 1 }
							: { name: call.name, firstCalledAt: call.at, count: 1 },
					);
					for (const l of [...listeners]) l(call);
				},
			}),
		{ responseMode: "json" },
	);
	const toRequest = (req: IncomingMessage): Request => {
		const headers = new Headers();
		for (const [name, value] of Object.entries(req.headers))
			if (typeof value === "string") headers.set(name, value);
		const hasBody = req.method !== "GET" && req.method !== "HEAD";
		return new Request(`http://gateway${req.url ?? "/"}`, {
			method: req.method,
			headers,
			...(hasBody
				? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" }
				: {}),
		} as RequestInit);
	};
	const http = createServer((req, res) => {
		void (async () => {
			if (req.headers.authorization !== `Bearer ${token}`) {
				res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end();
				return;
			}
			if (!connected) {
				connected = true;
				for (const done of waiters) done(true);
			}
			const response = await handler.fetch(toRequest(req), {
				authInfo: { token, clientId: "stub", scopes: [] },
			});
			res.statusCode = response.status;
			response.headers.forEach((value, name) => {
				res.setHeader(name, value);
			});
			if (!response.body) res.end();
			else Readable.fromWeb(response.body as never).pipe(res);
		})().catch(() => {
			if (!res.headersSent) res.writeHead(500);
			res.end();
		});
	});
	await new Promise<void>((resolve) =>
		http.listen(0, "127.0.0.1", () => resolve()),
	);
	const { port } = http.address() as AddressInfo;
	return {
		entry: {
			url: `http://127.0.0.1:${port}/mcp`,
			token,
			serverName,
			promptLine: harnessPromptLine(view, serverName),
			tools: [...view.direct, ...view.deferred].map((t) => t.name),
			connected: () => connected,
			waitConnected: (ms) =>
				connected
					? Promise.resolve(true)
					: new Promise<boolean>((resolve) => {
							const done = (ok: boolean) => {
								clearTimeout(timer);
								waiters.delete(done);
								resolve(ok);
							};
							const timer = setTimeout(() => done(false), ms);
							waiters.add(done);
						}),
			onCall: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			calls: () => [...counts.values()].map((c) => ({ ...c })),
			sawOutput: (toolCallId, text) => ledger.sawOutput(toolCallId, text),
			onFinding: (listener) => {
				found.add(listener);
				return () => found.delete(listener);
			},
			findings: () => ledger.snapshot(),
			onArtifact: (listener) => {
				published.add(listener);
				return () => published.delete(listener);
			},
		},
		harnessCalls: () => [...seen],
		count: () => seen.length,
		close: () => {
			open = false;
			return new Promise<void>((resolve) => {
				http.closeAllConnections();
				http.close(() => resolve());
			});
		},
	};
}
