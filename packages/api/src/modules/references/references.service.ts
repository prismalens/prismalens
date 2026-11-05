// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isAbsolute, relative, sep } from "node:path";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
	type AgentCommand,
	AgentCommandsSchema,
	CanonicalEventSchema,
	type JobMessageContext,
	type Quote,
	quoteMarkdown,
	REFERENCE_KINDS,
	REFERENCE_SNAPSHOTS_MAX_CHARS,
	type ReferenceKind,
	type ReferenceRef,
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
import { rank, refKey } from "./ranking.js";
import { RecordsProvider } from "./records.provider.js";
import {
	REFERENCE_PROVIDERS,
	type ReferenceCandidate,
	type ReferenceContext,
	type ReferenceProvider,
	SourceUnavailable,
} from "./reference-provider.js";

/** PrismaLens's own `/` actions; the agent's advertised commands join them, marked apart. */
export const APP_COMMANDS: { name: string; description: string }[] = [
	{ name: "investigate", description: "Investigate: the run owes a report" },
	{ name: "ask", description: "Ask: the run owes an answer" },
	{ name: "note", description: "Note: add a note to the thread, no run" },
];

export const agentCommandsKey = (harness: string) =>
	`agents.commands.${harness}`;

interface Resolved {
	threadId: string | null;
	repositoryId: string | null;
	incidentId: string | null;
	root: string | null;
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
		const ctx = await this.resolve(input.threadId, input.scope);
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
		if (kinds.includes("command")) candidates.push(...this.commands(ctx));
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
		const truncated = ctx.root
			? (await files.list(ctx.root).catch(() => null))?.truncated === true &&
				kinds.some((k) => k === "file" || k === "folder")
			: false;
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
		const at = { threadId: ctx.threadId, root: ctx.root };
		const out: ReferenceSnapshot[] = [];
		for (const ref of refs) {
			if (ref.kind === "command") continue;
			const provider = this.providers.find((p) => p.kinds.includes(ref.kind));
			const snap = await provider?.snapshot(ref, at).catch(() => null);
			out.push(
				snap ?? {
					ref,
					text: `${ref.label} (could not be read when the message was sent).`,
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

	private commands(ctx: Resolved): ReferenceCandidate[] {
		return [
			...APP_COMMANDS.map((c) => ({
				ref: { kind: "command" as const, id: c.name, label: `/${c.name}` },
				detail: c.description,
				source: "app" as const,
				group: "PrismaLens",
			})),
			...ctx.commands.list.map((c) => ({
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
				source: "agent" as const,
				group: "Agent",
			})),
		];
	}

	/** The thread or new-thread scope a search or a send runs in. */
	private async resolve(threadId?: string, scope?: string): Promise<Resolved> {
		const id = threadId ?? (scope ? scopeThreadId(scope) : null);
		const empty: Resolved = {
			threadId: null,
			repositoryId: null,
			incidentId: null,
			root: null,
			commands: { list: [], fromLastRun: false },
			agentTouched: new Set(),
		};
		if (id) {
			const run = await this.prisma.investigation.findUnique({
				where: { id },
				select: {
					id: true,
					incidentId: true,
					repositoryId: true,
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
				root,
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
				...empty,
				repositoryId: repo?.id ?? null,
				root: repo?.sourceKind === "folder" ? repo.url : null,
			};
		}
		if (scope?.startsWith("new:incident:"))
			return { ...empty, incidentId: scope.slice("new:incident:".length) };
		return empty;
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
			if (e.kind === "harness_tool_call" && e.name === "thread_read") {
				const t = (e.input as { threadId?: unknown } | undefined)?.threadId;
				if (typeof t === "string") keys.add(refKey({ kind: "thread", id: t }));
			}
		}
		return keys;
	}
}
