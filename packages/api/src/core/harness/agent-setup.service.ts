// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What loads into each agent, and the one PrismaLens set beside its own (#1180 §3.1, §3.3).
 * Every shared server lives whole in one encrypted row; no route returns an argument, a URL
 * path or a value once approved.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { Injectable } from "@nestjs/common";
import {
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import {
	type AgentLoadout,
	type AgentLoadoutInput,
	AgentLoadoutReportSchema,
	type ApproveSharedServerInput,
	type LoadedItem,
	type LoadoutProfile,
	type RevealSharedRowInput,
	type SharedMcpServerStored,
	SharedMcpServerStoredSchema,
	type SharedMcpServerView,
	type SharedServerPreview,
	type SharedSet,
	type SharedSource,
	type UpdateSharedSetInput,
} from "@prismalens/contracts/schemas";
import type { Prisma } from "@prismalens/database";
import {
	allOnDisk,
	bindFiles,
	configFingerprint,
	deliverShared,
	layoutOf,
	mcpSourceHash,
	type RunShared,
	readAgentLoadout,
	readMcpSource,
	readOnDisk,
	refuseValueFiles,
	sharedServerHash,
	sharedServerName,
	valueNamesOf,
} from "@prismalens/engine";
import { z } from "zod";
import { CredentialsService } from "../../modules/integrations/crypto/credentials.service.js";
import * as clock from "../clock.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { HarnessService } from "./harness.service.js";
import { HarnessModelsService } from "./harness-models.service.js";

export const SHARED_SERVERS_KEY = "AGENT_SHARED_SERVERS";
export const SHARED_SET_KEY = "AGENT_SHARED_SET";

const SetRowSchema = z.object({
	decided: z.enum(["as-is", "shared"]).nullable().default(null),
	instructions: z.string().default(""),
	instructionsFor: z.array(z.string()).default([]),
	revision: z.string().default("none"),
});
type SetRow = z.infer<typeof SetRowSchema>;

export class AgentSetupError extends Error {
	constructor(
		readonly code: "BAD_REQUEST" | "NOT_FOUND",
		message: string,
	) {
		super(message);
		this.name = "AgentSetupError";
	}
}

const isAgent = (id: string): id is HarnessId =>
	(HARNESS_IDS as readonly string[]).includes(id);

/** `SharedSetSchema` holds at most this many servers. */
const MAX_SHARED_SERVERS = 32;

const sourceChanged = () =>
	new AgentSetupError(
		"BAD_REQUEST",
		"The source changed since it was shown; open it again",
	);

type Db = Pick<Prisma.TransactionClient, "setting">;

/** Each delivered server as `name:hash`: what changes when a delivery or a definition does. */
function deliveredIds(
	stored: SharedMcpServerStored[],
	shared: { servers: { name: string }[] },
): string[] {
	const sent = new Set(shared.servers.map((m) => m.name));
	return stored
		.filter((s) => sent.has(sharedServerName(s.name)))
		.map((s) => `${s.name}:${s.hash}`)
		.sort();
}

@Injectable()
export class AgentSetupService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly harness: HarnessService,
		private readonly credentials: CredentialsService,
		private readonly models: HarnessModelsService,
	) {}

	/** Whether the agent's last check said it takes HTTP MCP servers; unknown sends them. */
	private takesHttp(id: HarnessId): boolean {
		return this.models.checked(id)?.mcpHttp !== false;
	}

	// ------------------------------------------------------------ storage

	/** The client as a transaction's is typed; the extended client takes the same calls. */
	private get db(): Db {
		return this.prisma as unknown as Db;
	}

	private writes: Promise<unknown> = Promise.resolve();
	/** One read-modify-write of the set's rows at a time, so no change undoes another. */
	private serial<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.writes.then(fn, fn);
		this.writes = run.catch(() => undefined);
		return run;
	}

	/** The encrypted servers row, whole; never returned by a route. */
	async storedServers(db: Db = this.db): Promise<SharedMcpServerStored[]> {
		const row = await db.setting.findUnique({
			where: { key: SHARED_SERVERS_KEY },
		});
		if (!row?.value) return [];
		const parsed = z
			.array(SharedMcpServerStoredSchema)
			.safeParse(this.credentials.decryptFromBase64<unknown>(row.value));
		return parsed.success ? parsed.data : [];
	}

	private async saveServers(
		servers: SharedMcpServerStored[],
		db: Db = this.db,
	): Promise<void> {
		const value = this.credentials.encryptToBase64(servers);
		await db.setting.upsert({
			where: { key: SHARED_SERVERS_KEY },
			update: { value, type: "encrypted" },
			create: {
				key: SHARED_SERVERS_KEY,
				value,
				type: "encrypted",
				category: "ai",
			},
		});
	}

	private async setRow(db: Db = this.db): Promise<SetRow> {
		const row = await db.setting.findUnique({
			where: { key: SHARED_SET_KEY },
		});
		try {
			return SetRowSchema.parse(row?.value ? JSON.parse(row.value) : {});
		} catch {
			return SetRowSchema.parse({});
		}
	}

	private async saveSetRow(next: SetRow, db: Db = this.db): Promise<void> {
		const value = JSON.stringify(next);
		await db.setting.upsert({
			where: { key: SHARED_SET_KEY },
			update: { value, type: "json" },
			create: { key: SHARED_SET_KEY, value, type: "json", category: "ai" },
		});
	}

	/** The agent's planned env as its own config reads it: the host's, then Settings'. */
	private async envOf(id: HarnessId): Promise<Record<string, string>> {
		const runtime = await this.harness.runtimeFor(id);
		const host = Object.fromEntries(
			Object.entries(process.env).filter(
				(e): e is [string, string] => typeof e[1] === "string",
			),
		);
		return { ...host, ...runtime.env };
	}

	// ------------------------------------------------------------ views

	private view(
		s: SharedMcpServerStored,
		changed: boolean,
	): SharedMcpServerView {
		const names = valueNamesOf(s.def);
		const bound = s.valuesFor === s.hash;
		return {
			name: s.name,
			transport: s.def.type,
			command: s.def.type === "stdio" ? basename(s.def.command) : null,
			argCount: s.def.type === "stdio" ? s.def.args.length : 0,
			host: s.def.type === "http" ? new URL(s.def.url).host : null,
			valueNames: names,
			missingValues: names.filter((n) => !bound || !(n in s.values)),
			recipients: s.recipients,
			changedInSource: changed,
			fromAgent: s.from?.agent ?? null,
			fromSource: s.from
				? { agent: s.from.agent, path: s.from.path, key: s.from.key }
				: null,
		};
	}

	/** Whether the source entry a server was copied from now hashes differently. */
	private async changedInSource(s: SharedMcpServerStored): Promise<boolean> {
		if (!s.from || !isAgent(s.from.agent)) return false;
		const env = await this.envOf(s.from.agent);
		const now = readMcpSource(s.from.agent, env, s.from.path, s.from.key);
		return mcpSourceHash(now) !== s.from.sourceHash;
	}

	async sharedSet(): Promise<SharedSet> {
		const [row, servers] = await Promise.all([
			this.setRow(),
			this.storedServers(),
		]);
		const views: SharedMcpServerView[] = [];
		for (const s of servers)
			views.push(this.view(s, await this.changedInSource(s)));
		return {
			decided: row.decided,
			instructions: row.instructions,
			instructionsFor: row.instructionsFor,
			revision: row.revision,
			servers: views,
		};
	}

	async updateSharedSet(patch: UpdateSharedSetInput): Promise<SharedSet> {
		await this.serial(async () => {
			const row = await this.setRow();
			const instructions = patch.instructions ?? row.instructions;
			await this.saveSetRow({
				decided: patch.decided ?? row.decided,
				instructions,
				instructionsFor: (patch.instructionsFor ?? row.instructionsFor).filter(
					isAgent,
				),
				revision:
					instructions === row.instructions ? row.revision : randomUUID(),
			});
		});
		return this.sharedSet();
	}

	/**
	 * The whole server replaced. Values entered in this request bind to the new hash; a changed
	 * definition drops every value not entered again (§3.3).
	 */
	async approveSharedServer(
		input: ApproveSharedServerInput,
	): Promise<SharedSet> {
		if (input.def.type === "http") {
			const u = new URL(input.def.url);
			if (u.username || u.password || u.search || u.hash)
				throw new AgentSetupError(
					"BAD_REQUEST",
					"The URL holds only its origin and path; a query part is a value",
				);
		}
		const source = input.from;
		let env: Record<string, string> = Object.fromEntries(
			Object.entries(process.env).filter(
				(e): e is [string, string] => typeof e[1] === "string",
			),
		);
		let sourceHash: string | null = null;
		if (source) {
			if (!isAgent(source.agent))
				throw new AgentSetupError("BAD_REQUEST", "Unknown agent");
			env = await this.envOf(source.agent);
			sourceHash = mcpSourceHash(
				readMcpSource(source.agent, env, source.path, source.key),
			);
			if (sourceHash !== source.revision) throw sourceChanged();
		}
		let bound: Awaited<ReturnType<typeof bindFiles>>;
		try {
			bound = await bindFiles(input.def, env);
		} catch (err) {
			throw new AgentSetupError(
				"BAD_REQUEST",
				err instanceof Error ? err.message : String(err),
			);
		}
		const hash = sharedServerHash(bound.def, bound.files);
		const names = valueNamesOf(bound.def);
		await this.serial(async () => {
			const servers = await this.storedServers();
			const existing = servers.find((s) => s.name === input.name);
			if (!existing && servers.length >= MAX_SHARED_SERVERS)
				throw new AgentSetupError(
					"BAD_REQUEST",
					`The PrismaLens set holds at most ${MAX_SHARED_SERVERS} servers`,
				);
			const kept =
				existing && existing.hash === hash && existing.valuesFor === hash
					? existing.values
					: {};
			const values = Object.fromEntries(
				Object.entries({ ...kept, ...input.values }).filter(([n]) =>
					names.includes(n),
				),
			);
			try {
				refuseValueFiles(bound.def, values);
			} catch (err) {
				throw new AgentSetupError(
					"BAD_REQUEST",
					err instanceof Error ? err.message : String(err),
				);
			}
			const entered =
				Object.keys(input.values).length > 0 ||
				names.length === 0 ||
				Object.keys(kept).length > 0;
			const next: SharedMcpServerStored = {
				name: input.name,
				def: bound.def,
				files: bound.files,
				values,
				hash,
				valuesFor: entered ? hash : null,
				recipients: input.recipients.filter(isAgent),
				from:
					source && sourceHash
						? {
								agent: source.agent,
								path: source.path,
								key: source.key,
								sourceHash,
							}
						: null,
			};
			await this.saveServers([
				...servers.filter((s) => s.name !== input.name),
				next,
			]);
		});
		return this.sharedSet();
	}

	async removeSharedServer(name: string): Promise<SharedSet> {
		await this.serial(async () => {
			const servers = await this.storedServers();
			await this.saveServers(servers.filter((s) => s.name !== name));
		});
		return this.sharedSet();
	}

	/** `agent.useSharedSet`: the agent's membership in every server's recipients and the instructions. */
	async setMembership(id: string, member: boolean): Promise<SharedSet> {
		if (!isAgent(id)) throw new AgentSetupError("BAD_REQUEST", "Unknown agent");
		const toggle = (list: string[]) =>
			member ? [...new Set([...list, id])] : list.filter((a) => a !== id);
		// Servers and instructions change together, or neither does.
		await this.serial(() =>
			this.prisma.$transaction(async (tx) => {
				const servers = await this.storedServers(tx);
				const row = await this.setRow(tx);
				await this.saveServers(
					servers.map((s) => ({ ...s, recipients: toggle(s.recipients) })),
					tx,
				);
				await this.saveSetRow(
					{ ...row, instructionsFor: toggle(row.instructionsFor) },
					tx,
				);
			}),
		);
		return this.sharedSet();
	}

	/** Both rows from one snapshot, so one run never mixes two versions of the set. */
	private rows(): Promise<[SetRow, SharedMcpServerStored[]]> {
		return this.prisma.$transaction(
			async (tx) =>
				[await this.setRow(tx), await this.storedServers(tx)] as [
					SetRow,
					SharedMcpServerStored[],
				],
		);
	}

	// ------------------------------------------------------------ sources

	/** User-scope MCP servers in installed agents' own config; a repo's belong to that repo. */
	async sharedSources(): Promise<
		(SharedSource & {
			transport: NonNullable<LoadedItem["transport"]> | null;
		})[]
	> {
		const out: (SharedSource & {
			transport: NonNullable<LoadedItem["transport"]> | null;
		})[] = [];
		for (const id of await this.harness.installedIds()) {
			const env = await this.envOf(id);
			for (const i of readOnDisk(id, env, null))
				if (
					i.kind === "mcp" &&
					i.scope === "global" &&
					i.state !== "failed" &&
					i.path &&
					i.name !== "prismalens" &&
					!i.name.startsWith("pl-")
				)
					out.push({
						agent: id,
						path: i.path,
						key: i.name,
						transport: i.transport ?? null,
					});
		}
		return out;
	}

	private async source(src: SharedSource) {
		if (!isAgent(src.agent))
			throw new AgentSetupError("BAD_REQUEST", "Unknown agent");
		const listed = (await this.sharedSources()).some(
			(s) => s.agent === src.agent && s.path === src.path && s.key === src.key,
		);
		const found = listed
			? readMcpSource(src.agent, await this.envOf(src.agent), src.path, src.key)
			: null;
		if (!found) throw new AgentSetupError("NOT_FOUND", "No such server");
		return found;
	}

	/** Every argument and the URL path masked; userinfo, query and fragment never returned. */
	async preview(src: SharedSource): Promise<SharedServerPreview> {
		const s = await this.source(src);
		let origin: string | null = null;
		let hasPath = false;
		const removed: SharedServerPreview["removed"] = [];
		if (s.url) {
			const u = new URL(s.url);
			origin = u.origin;
			hasPath = u.pathname !== "/" && u.pathname !== "";
			if (u.username || u.password) removed.push("sign-in");
			if (u.search) removed.push("query");
			if (u.hash) removed.push("fragment");
		}
		return {
			source: src,
			transport: s.transport,
			command: s.command,
			args: s.args.map(() => null),
			origin,
			hasPath,
			removed,
			env: s.env,
			headers: s.headers,
			revision: mcpSourceHash(s),
		};
	}

	async reveal(input: RevealSharedRowInput): Promise<{ value: string }> {
		const s = await this.source(input.source);
		if (mcpSourceHash(s) !== input.revision) throw sourceChanged();
		if (input.row === "path") {
			if (!s.url) throw new AgentSetupError("NOT_FOUND", "No URL path");
			return { value: new URL(s.url).pathname };
		}
		const value = s.args[input.row];
		if (value === undefined)
			throw new AgentSetupError("NOT_FOUND", "No such argument");
		return { value };
	}

	/** The set as one run on `id` in `cwd` receives it: servers, values to hide, instructions, fingerprint. */
	async forRun(id: HarnessId, cwd: string): Promise<RunShared> {
		const [env, [row, stored]] = await Promise.all([
			this.envOf(id),
			this.rows(),
		]);
		const shared = await this.deliver(id, env, cwd, stored);
		const member = row.instructionsFor.includes(id);
		return {
			servers: shared.servers,
			hidden: shared.hidden,
			...(shared.runFile ? { runFile: shared.runFile } : {}),
			revision: row.revision,
			instructions: member && row.instructions.trim() ? row.instructions : null,
			fingerprint: configFingerprint(id, env, cwd, {
				profile: "own",
				isolation: null,
				sharedRevision: row.revision,
				member,
				sharedServers: deliveredIds(stored, shared),
			}),
			profile: "own",
		};
	}

	/** The set's servers as `id` receives them in `cwd`; runs and What loads share these options. */
	private deliver(
		id: HarnessId,
		env: Record<string, string>,
		cwd: string | null,
		stored: SharedMcpServerStored[],
	) {
		const ownNames = allOnDisk(id, env, cwd)
			.filter((i) => i.kind === "mcp")
			.map((i) => i.name);
		return deliverShared(stored, id, {
			http: this.takesHttp(id),
			ownNames,
			cwd,
			...(HARNESS_REGISTRY[id].gatewayDelivery === "mcp-config-file"
				? { runFile: true }
				: {}),
		});
	}

	// ------------------------------------------------------------ what loads

	private async repoRoot(repositoryId: string | undefined) {
		if (!repositoryId) return null;
		const repo = await this.prisma.repository.findUnique({
			where: { id: repositoryId },
			select: { url: true, subPath: true },
		});
		if (!repo) throw new AgentSetupError("NOT_FOUND", "No such project");
		if (!isAbsolute(repo.url) || !existsSync(repo.url)) return null;
		return repo.subPath ? join(repo.url, repo.subPath) : repo.url;
	}

	/**
	 * Disk items, the PrismaLens set's rows, and the reported items of the newest session whose
	 * agent, project, profile and fingerprint equal this view's.
	 */
	async loadout(input: AgentLoadoutInput): Promise<AgentLoadout> {
		if (!isAgent(input.id))
			throw new AgentSetupError("BAD_REQUEST", "Unknown agent");
		const id = input.id;
		const profile: LoadoutProfile = input.profile ?? "own";
		const [env, root, [row, stored], runtime] = await Promise.all([
			this.envOf(id),
			this.repoRoot(input.repositoryId),
			this.rows(),
			this.harness.runtimeFor(id),
		]);
		const disk = readOnDisk(id, env, root);
		// An agent that answers before any run (Codex's app-server) is asked as the section opens.
		const agentSaid =
			(await readAgentLoadout(id, runtime, root).catch(() => null)) ?? [];
		const shared = await this.deliver(id, env, root, stored);
		const member = row.instructionsFor.includes(id);
		const ours: LoadedItem[] = [...shared.items];
		if (row.instructions.trim())
			ours.unshift({
				kind: "instructions",
				name: "PrismaLens instructions",
				scope: "prismalens",
				path: null,
				disk: false,
				reported: null,
				state: member ? "loads" : "not-sent",
				layer:
					HARNESS_REGISTRY[id].facts?.systemPromptVia?.value === "claude-meta"
						? "system"
						: "first-message",
				...(member ? {} : { note: "Not a recipient" }),
			});
		const fingerprint = configFingerprint(id, env, root, {
			profile,
			isolation: profile === "clean" ? "cleanProfile" : null,
			sharedRevision: row.revision,
			member,
			sharedServers: deliveredIds(stored, shared),
		});
		// The match is looked up by its fingerprint before any limit, so newer other setups never hide it.
		const reports = (contains: string, take: number) =>
			this.prisma.investigationEvent.findMany({
				where: {
					event: { contains },
					investigation: {
						harness: id,
						repositoryId: input.repositoryId ?? null,
					},
				},
				orderBy: { createdAt: "desc" },
				take,
				select: { event: true, createdAt: true, investigationId: true },
			});
		const [matching, recent] = await Promise.all([
			reports(`"fingerprint":${JSON.stringify(fingerprint)}`, 5),
			reports('"kind":"agent_loadout"', 20),
		]);
		const parse = (e: (typeof recent)[number]) => {
			try {
				const parsed = AgentLoadoutReportSchema.safeParse(JSON.parse(e.event));
				return parsed.success && parsed.data.profile === profile
					? parsed.data
					: null;
			} catch {
				return null;
			}
		};
		let report: AgentLoadout["report"] = null;
		let staleReport: AgentLoadout["staleReport"] = null;
		let reported: LoadedItem[] = [];
		for (const e of matching) {
			const data = parse(e);
			if (data?.fingerprint !== fingerprint) continue;
			const at = e.createdAt.toISOString();
			report = { at, threadId: e.investigationId };
			reported = data.items.map((i) => ({ ...i, reported: at }));
			break;
		}
		if (!report)
			for (const e of recent)
				if (parse(e)) {
					staleReport = {
						at: e.createdAt.toISOString(),
						threadId: e.investigationId,
					};
					break;
				}
		const key = (i: LoadedItem) =>
			`${i.kind}\0${i.name}\0${i.scope}\0${i.path ?? ""}`;
		reported = [...reported, ...agentSaid];
		const byKey = new Map(reported.map((i) => [key(i), i]));
		// Claude's init names servers and skills without a path: matched by kind, name and scope,
		// and only to a row no other row shares that with.
		const pathless = (i: LoadedItem) => `${i.kind}\0${i.name}\0${i.scope}`;
		const rows = [...disk, ...ours];
		const twins = new Map<string, number>();
		for (const i of rows)
			twins.set(pathless(i), (twins.get(pathless(i)) ?? 0) + 1);
		const byName = new Map(
			reported
				.filter((i) => i.path === null && twins.get(pathless(i)) === 1)
				.map((i) => [pathless(i), i]),
		);
		const merged = rows.map((i) => {
			const r = byKey.get(key(i)) ?? byName.get(pathless(i));
			if (!r) return i;
			byKey.delete(key(r));
			byName.delete(pathless(r));
			return { ...i, reported: r.reported, state: r.state };
		});
		const left = [...byKey.values()];
		const items = [
			...merged,
			...left.map((i) => ({ ...i, disk: false })),
		].slice(0, 500);
		return {
			agent: id,
			repositoryId: input.repositoryId ?? null,
			profile,
			readAt: clock.date().toISOString(),
			readable: layoutOf(id) !== null,
			report,
			staleReport: report ? null : staleReport,
			items,
		};
	}
}
