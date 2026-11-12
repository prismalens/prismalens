// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isAbsolute, relative, sep } from "node:path";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { HARNESS_IDS, HARNESS_REGISTRY } from "@prismalens/config/harness";
import {
	type AgentCommand,
	AgentCommandsSchema,
	CanonicalEventSchema,
	type JobMessageContext,
	plToolName,
	type Quote,
	quoteMarkdown,
	REFERENCE_KINDS,
	REFERENCE_SNAPSHOTS_MAX_CHARS,
	type ReferenceKind,
	type ReferenceRef,
	type ReferenceResolution,
	type ReferenceSearchInput,
	type ReferenceSearchResult,
	type ReferenceSnapshot,
	RunWorkspaceSchema,
	referenceKey,
	referenceNumber,
	scopeThreadId,
	TRIGGER_KINDS,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { compactCommandOf, registryFacts } from "../wakes/session.js";
import { FILE_LIST_TIMED_OUT } from "./file-list.js";
import { rank, refKey } from "./ranking.js";
import { RecordsProvider } from "./records.provider.js";
import {
	REFERENCE_PROVIDERS,
	type ReferenceCandidate,
	type ReferenceContext,
	type ReferenceProvider,
	SourceUnavailable,
} from "./reference-provider.js";

/**
 * PrismaLens's own `/` actions, each with five words or fewer (sheet §0.3); the agent's advertised commands join them, marked apart.
 * `needs: "thread"` lists one only in a thread; `"compact"` only where the agent compacts.
 */
export const APP_COMMANDS: {
	name: string;
	description: string;
	needs?: "thread" | "compact";
}[] = [
	{ name: "investigate", description: "Ends in a report" },
	{ name: "ask", description: "Ends in an answer" },
	{ name: "note", description: "A note, no run" },
	{
		name: "compact",
		description: "Summarize to free context",
		needs: "compact",
	},
	{
		name: "new",
		description: "Linked thread, same agent",
		needs: "thread",
	},
	{
		name: "model",
		description: "Set model",
	},
	{
		name: "effort",
		description: "Set effort",
	},
	{
		name: "context",
		description: "What fills the context",
		needs: "thread",
	},
];

/** Agent commands never listed: they sign in or out on a terminal, which a run has none of. */
export const HIDDEN_AGENT_COMMANDS: ReadonlySet<string> = new Set([
	"login",
	"logout",
]);

/** A pasted link's whole read, per link (#1024). */
export const RESOLVE_TIMEOUT_MS = 5_000;

export const agentCommandsKey = (harness: string) =>
	`agents.commands.${harness}`;

interface Resolved {
	threadId: string | null;
	repositoryId: string | null;
	incidentId: string | null;
	serviceId: string | null;
	root: string | null;
	/** The thread's agent, or the new thread's chosen one. */
	harness: string | null;
	commands: { list: AgentCommand[]; fromLastRun: boolean };
	agentTouched: Set<string>;
}

/** Where a workspace path sits relative to the root, with `/` separators; null outside it. */
function relativeTo(root: string, path: string): string | null {
	const rel = isAbsolute(path) ? relative(root, path) : path;
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	return rel.split(sep).join("/");
}

const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path"] as const;

/**
 * `GET /references/search` and the send-time snapshots (#1024). Providers answer
 * together; one that fails shows as a line and never blocks the rest.
 */
/** Menu groups are named by type, never by brand (sheet §5). */
const APP_COMMANDS_GROUP = "Commands";
function agentCommandsGroup(harness: string | null): string {
	const id = HARNESS_IDS.find((h) => h === harness);
	return id ? `${HARNESS_REGISTRY[id].label} commands` : "Agent commands";
}

@Injectable()
export class ReferencesService {
	readonly records: RecordsProvider;
	private readonly providers: ReferenceProvider[];

	constructor(
		private readonly prisma: PrismaService,
		@Optional()
		@Inject(REFERENCE_PROVIDERS)
		extra: ReferenceProvider[] | null = null,
	) {
		this.records = new RecordsProvider(prisma);
		this.providers = [this.records, ...(extra ?? [])];
	}

	async search(input: ReferenceSearchInput): Promise<ReferenceSearchResult> {
		const ctx = await this.resolve(input.threadId, input.scope, input.harness);
		const kinds: readonly ReferenceKind[] = input.trigger
			? TRIGGER_KINDS[input.trigger]
			: REFERENCE_KINDS;
		const base: ReferenceContext = {
			...(ctx.threadId ? { threadId: ctx.threadId } : {}),
			...(ctx.repositoryId ? { repositoryId: ctx.repositoryId } : {}),
			...(ctx.incidentId ? { incidentId: ctx.incidentId } : {}),
			root: ctx.root,
			kinds,
			limit: input.limit,
		};
		const number = input.trigger === "#" ? referenceNumber(input.q) : null;
		const key = input.trigger === "#" ? referenceKey(input.q) : null;
		const q = number || key ? "" : input.q;
		const unavailable: ReferenceSearchResult["unavailable"] = [];
		const candidates: ReferenceCandidate[] = [];
		if (kinds.includes("command")) {
			candidates.push(...this.commands(ctx));
			// An agent that has reported no commands says so in one row (#1101 6.3).
			if (ctx.harness && ctx.commands.list.length === 0)
				unavailable.push({
					source: agentCommandsGroup(ctx.harness),
					message: "none reported yet",
				});
		}
		const results = await Promise.allSettled(
			this.providers
				.filter((p) => p.kinds.some((k) => kinds.includes(k)))
				.map((p) =>
					(number
						? (p.byNumber?.(number.n, {
								...base,
								mergeRequest: number.mergeRequest,
							}) ?? Promise.resolve([]))
						: key
							? (p.byKey?.(key, base) ?? Promise.resolve([]))
							: p.search(q, base)
					).then((hits) =>
						hits
							.filter((h) => kinds.includes(h.ref.kind))
							.map((h) => ({ ...h, group: h.group ?? p.source })),
					),
				),
		);
		const used = this.providers.filter((p) =>
			p.kinds.some((k) => kinds.includes(k)),
		);
		results.forEach((r, i) => {
			if (r.status === "fulfilled") candidates.push(...r.value);
			else
				unavailable.push({
					source:
						r.reason instanceof SourceUnavailable
							? r.reason.source
							: (used[i]?.source ?? "A source"),
					message: (r.reason instanceof Error
						? r.reason.message
						: String(r.reason)
					).slice(0, 300),
				});
		});
		const uses = await this.prisma.referenceUse.findMany({
			where: { kind: { in: [...kinds] } },
			orderBy: { lastUsedAt: "desc" },
			take: 500,
		});
		const hits = rank(candidates, q, {
			used: new Map(uses.map((u) => [`${u.kind}:${u.key}`, u])),
			agent: ctx.agentTouched,
			...(input.open ? { open: input.open } : {}),
		});
		const files = this.records.files;
		const wantsFiles = kinds.some((k) => k === "file" || k === "folder");
		const list =
			ctx.root && wantsFiles
				? await files.list(ctx.root).catch(() => null)
				: null;
		const truncated = list?.truncated === true;
		if (list?.timedOut)
			unavailable.push({ source: "Files", message: FILE_LIST_TIMED_OUT });
		return { hits: hits.slice(0, input.limit), truncated, unavailable };
	}

	/** The user picked a reference: it ranks higher next time (frecency, #1024). */
	async use(refs: { kind: string; id: string }[]): Promise<void> {
		const now = new Date();
		for (const r of refs)
			await this.prisma.referenceUse.upsert({
				where: { kind_key: { kind: r.kind, key: r.id } },
				create: { kind: r.kind, key: r.id, count: 1, lastUsedAt: now },
				update: { count: { increment: 1 }, lastUsedAt: now },
			});
	}

	/** Each reference as its bounded snapshot, by the provider that serves its kind. */
	async snapshots(
		refs: ReferenceRef[],
		run: { threadId: string | null; scope?: string | null },
	): Promise<ReferenceSnapshot[]> {
		const ctx = await this.resolve(
			run.threadId ?? undefined,
			run.scope ?? undefined,
		);
		const at = {
			threadId: ctx.threadId,
			root: ctx.root,
			incidentId: ctx.incidentId,
			repositoryId: ctx.repositoryId,
			serviceId: ctx.serviceId,
		};
		const out: ReferenceSnapshot[] = [];
		for (const ref of refs) {
			if (ref.kind === "command") continue;
			// Several sources serve one kind (stored and live alerts): the first that knows the id answers.
			let snap: ReferenceSnapshot | null = null;
			for (const provider of this.providers.filter((p) =>
				p.kinds.includes(ref.kind),
			)) {
				snap = await provider.snapshot(ref, at).catch(() => null);
				if (snap) break;
			}
			// A host's issue or PR title is anyone's words: the message names it by number alone.
			const named = hostWorkItem(ref);
			out.push(
				snap
					? { ...snap, ref: named }
					: {
							ref: named,
							text: `${named.label} (could not be read when the message was sent).`,
							outOfScope: true,
						},
			);
		}
		return out;
	}

	/**
	 * What a message carries for the agent (#1024): each quote as a Markdown blockquote
	 * with its source line, then each reference's snapshot, within 20,000 characters.
	 */
	async compose(
		input: { quotes?: Quote[]; references?: ReferenceRef[] },
		run: { threadId: string | null; scope?: string | null },
	): Promise<JobMessageContext | undefined> {
		const quotes = input.quotes ?? [];
		const references = input.references ?? [];
		if (!quotes.length && !references.length) return undefined;
		const parts: string[] = [];
		for (const q of quotes)
			parts.push(quoteMarkdown(q, await this.quoteSource(q)));
		const snaps = await this.snapshots(references, run);
		let budget = REFERENCE_SNAPSHOTS_MAX_CHARS;
		const lines: string[] = [];
		for (const s of snaps) {
			const tool = s.readTool ? ` For more, call ${s.readTool}.` : "";
			const scope = s.outOfScope
				? " (outside this run's scope: this snapshot only)"
				: "";
			const line = `- ${s.ref.kind} "${s.ref.label}"${scope}:\n${s.text}${tool}`;
			if (line.length > budget) {
				lines.push(
					`- ${s.ref.kind} "${s.ref.label}": left out, the message's references passed 20,000 characters.`,
				);
				continue;
			}
			budget -= line.length;
			lines.push(line);
		}
		if (lines.length) parts.push(`Referenced:\n${lines.join("\n")}`);
		await this.use(references.filter((r) => r.kind !== "command")).catch(
			() => {},
		);
		return {
			...(quotes.length ? { quotes } : {}),
			...(references.length ? { references } : {}),
			addendum: parts.join("\n\n"),
		};
	}

	private async quoteSource(q: Quote): Promise<string> {
		const t = await this.prisma.investigation.findUnique({
			where: { id: q.source.threadId },
			select: { title: true },
		});
		const where = {
			transcript: "the conversation",
			report: "the report",
			tool_output: "a tool's output",
		}[q.source.kind];
		return `from ${where} of thread "${t?.title ?? q.source.threadId}"${q.source.seq !== undefined ? `, event ${q.source.seq}` : ""}`;
	}

	/**
	 * The app's commands, then the agent's under its own name. The agent's compact is the
	 * app's `/compact` routed to it, so it is one row; any other shared name keeps both rows.
	 */
	private commands(ctx: Resolved): ReferenceCandidate[] {
		const compact = ctx.threadId
			? compactCommandOf(
					registryFacts(ctx.harness),
					ctx.commands.list.map((c) => c.name),
				)
			: null;
		const group = agentCommandsGroup(ctx.harness);
		return [
			...APP_COMMANDS.filter((c) =>
				c.needs === "compact"
					? !!compact
					: c.needs === "thread"
						? !!ctx.threadId
						: true,
			).map((c) => ({
				ref: { kind: "command" as const, id: c.name, label: `/${c.name}` },
				detail: c.description,
				source: "app" as const,
				group: APP_COMMANDS_GROUP,
			})),
			...ctx.commands.list
				.filter((c) => !HIDDEN_AGENT_COMMANDS.has(c.name) && c.name !== compact)
				.map((c) => ({
					ref: {
						kind: "command" as const,
						id: `agent:${c.name}`,
						label: `/${c.name}`,
					},
					detail:
						`${c.description}${ctx.commands.fromLastRun ? " (from the last run)" : ""}`.slice(
							0,
							300,
						),
					...(c.inputHint !== undefined ? { inputHint: c.inputHint } : {}),
					source: "agent" as const,
					group,
				})),
		];
	}

	/**
	 * `POST /references/resolve`: each pasted link, in order, as the hit the first source
	 * that recognises it reads through its saved connection, or why none did (#1024).
	 */
	async resolveUrls(
		urls: string[],
	): Promise<{ results: ReferenceResolution[] }> {
		const resolvers = this.providers.filter((p) => p.resolveUrl);
		const results = await Promise.all(
			urls.map((raw) => this.resolveUrl(raw, resolvers)),
		);
		return { results };
	}

	private async resolveUrl(
		raw: string,
		resolvers: ReferenceProvider[],
	): Promise<ReferenceResolution> {
		const url = raw.slice(0, 2048);
		let parsed: URL;
		try {
			parsed = new URL(raw.trim());
		} catch {
			return { url, reason: "Not a link." };
		}
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
			return { url, reason: "Not a web link." };
		const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
		// A source that ignores the signal is still cut off at the limit.
		const late = new Promise<never>((_, reject) =>
			signal.addEventListener("abort", () =>
				reject(new Error("it did not answer in 5 s")),
			),
		);
		late.catch(() => {});
		for (const p of resolvers) {
			const read = p.resolveUrl?.bind(p);
			if (!read) continue;
			try {
				const hit = await Promise.race([read(parsed, signal), late]);
				if (!hit) continue;
				const { active: _active, at: _at, ...c } = hit;
				return {
					...c,
					group: c.group ?? p.source,
					why: "match",
					score: 1,
					url,
				};
			} catch (e) {
				const source = e instanceof SourceUnavailable ? e.source : p.source;
				const message = e instanceof Error ? e.message : String(e);
				return { url, reason: `${source}: ${message}`.slice(0, 300) };
			}
		}
		return { url, reason: "No connected source recognises this link." };
	}

	/** The thread or new-thread scope a search or a send runs in. */
	private async resolve(
		threadId?: string,
		scope?: string,
		harness?: string,
	): Promise<Resolved> {
		const id = threadId ?? (scope ? scopeThreadId(scope) : null);
		const empty: Resolved = {
			threadId: null,
			repositoryId: null,
			incidentId: null,
			serviceId: null,
			root: null,
			harness: null,
			commands: { list: [], fromLastRun: false },
			agentTouched: new Set(),
		};
		// Before a run exists, the chosen agent's commands from its last run (#1024).
		const fresh: Resolved = harness
			? {
					...empty,
					harness,
					commands: {
						list: await this.lastCommands(harness),
						fromLastRun: true,
					},
				}
			: empty;
		if (id) {
			const run = await this.prisma.investigation.findUnique({
				where: { id },
				select: {
					id: true,
					incidentId: true,
					repositoryId: true,
					serviceId: true,
					workspace: true,
					harness: true,
					agentCommands: true,
				},
			});
			if (!run) return empty;
			const ws = run.workspace
				? RunWorkspaceSchema.safeParse(JSON.parse(run.workspace))
				: null;
			const root = ws?.success ? ws.data.cwd : null;
			const own = run.agentCommands
				? AgentCommandsSchema.safeParse(JSON.parse(run.agentCommands))
				: null;
			const commands = own?.success
				? { list: own.data, fromLastRun: false }
				: run.harness
					? { list: await this.lastCommands(run.harness), fromLastRun: true }
					: empty.commands;
			return {
				threadId: run.id,
				repositoryId: run.repositoryId,
				incidentId: run.incidentId,
				serviceId: run.serviceId,
				root,
				harness: run.harness,
				commands,
				agentTouched: await this.touched(run.id, root),
			};
		}
		if (scope?.startsWith("new:project:")) {
			const repo = await this.prisma.repository.findUnique({
				where: { id: scope.slice("new:project:".length) },
				select: { id: true, sourceKind: true, url: true },
			});
			return {
				...fresh,
				repositoryId: repo?.id ?? null,
				root: repo?.sourceKind === "folder" ? repo.url : null,
			};
		}
		if (scope?.startsWith("new:incident:"))
			return { ...fresh, incidentId: scope.slice("new:incident:".length) };
		if (scope?.startsWith("new:service:"))
			return { ...fresh, serviceId: scope.slice("new:service:".length) };
		return fresh;
	}

	private async lastCommands(harness: string): Promise<AgentCommand[]> {
		const row = await this.prisma.setting.findUnique({
			where: { key: agentCommandsKey(harness) },
		});
		const parsed = row
			? AgentCommandsSchema.safeParse(JSON.parse(row.value))
			: null;
		return parsed?.success ? parsed.data : [];
	}

	/** Files the agent's tool calls named, and threads it read, in this thread (`why: agent`). */
	private async touched(
		threadId: string,
		root: string | null,
	): Promise<Set<string>> {
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: threadId,
				OR: [
					{ event: { contains: '"kind":"agent_step"' } },
					{ event: { contains: '"kind":"harness_tool_call"' } },
				],
			},
			orderBy: { seq: "desc" },
			take: 400,
			select: { event: true },
		});
		const keys = new Set<string>();
		for (const row of rows) {
			const p = CanonicalEventSchema.safeParse(JSON.parse(row.event));
			if (!p.success) continue;
			const e = p.data;
			if (e.kind === "agent_step" && root)
				for (const call of e.toolCalls)
					for (const k of PATH_KEYS) {
						const v = call.args[k];
						const rel = typeof v === "string" ? relativeTo(root, v) : null;
						if (rel) keys.add(refKey({ kind: "file", id: rel }));
					}
			if (
				e.kind === "harness_tool_call" &&
				plToolName(e.name) === "pl_thread_read"
			) {
				const t = (e.input as { threadId?: unknown } | undefined)?.threadId;
				if (typeof t === "string") keys.add(refKey({ kind: "thread", id: t }));
			}
		}
		return keys;
	}
}

/** An issue or pull request as the message names it: its number, never the title the client sent back. */
function hostWorkItem(ref: ReferenceRef): ReferenceRef {
	if (ref.kind !== "issue" && ref.kind !== "pull_request") return ref;
	const n = Number(ref.id.split(":")[2]);
	if (!Number.isInteger(n) || n <= 0) return { ...ref, label: ref.kind };
	return {
		...ref,
		label: `${ref.kind === "issue" ? "Issue" : "Pull request"} #${n}`,
	};
}
