// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
import {
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit,
} from "@nestjs/common";
import {
	DEFAULT_RUN_WORKSPACE_SETTINGS,
	type KeptWorkspace,
	type RunWorkspaceGlobal,
	type RunWorkspaceOverride,
	RunWorkspaceOverrideSchema,
	type RunWorkspaceSettings,
	RunWorkspaceSettingsSchema,
	resolveRunWorkspaceSettings,
	type ServiceWorkspace,
	type WorkspaceRemoval,
	WorkspaceRemovalSchema,
} from "@prismalens/contracts";
import { z } from "zod";
import {
	defaultMirrorRoot,
	setMirrorLocations,
	sweepOldMirrors,
} from "../../core/harness/mirror-location.js";
import {
	defaultWorktreeRoot,
	keptWorkspaces,
	removeKeptWorkspace,
	setRunWorkspaceSource,
	sweepRunWorktrees,
} from "../../core/harness/run-worktree.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";

const GLOBAL_KEY = "runWorkspace.global";
const OVERRIDE_PREFIX = "runWorkspace.service.";
const REMOVALS_KEY = "runWorkspace.removals";
const LOCATIONS_KEY = "runWorkspace.locations";
const COPIES_KEY = "runWorkspace.copies";
const CopiesSchema = z.object({
	location: z.string().nullable(),
	previous: z.array(z.string()),
});
const REMOVALS_KEPT = 100;
const HOUR_MS = 60 * 60_000;

export class RunWorkspaceNotFoundError extends Error {}

/**
 * Run workspace settings (#925): the global ones and each service's override, held in
 * memory for the run path and the sweeps, which read them synchronously. Sweeps at boot
 * (from dispatch, once these are loaded) and hourly.
 */
@Injectable()
export class RunWorkspacesService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(RunWorkspacesService.name);
	private global: RunWorkspaceSettings = DEFAULT_RUN_WORKSPACE_SETTINGS;
	private overrides = new Map<string, RunWorkspaceOverride>();
	/** Every location a setting ever named, so a workspace left there is still swept and listed. */
	private locations = new Set<string>();
	private copies: z.infer<typeof CopiesSchema> = {
		location: null,
		previous: [],
	};
	private loaded: Promise<void> | null = null;
	private timer: NodeJS.Timeout | null = null;
	private sweeping: Promise<void> | null = null;
	private pending: WorkspaceRemoval[] = [];
	private writing: Promise<void> = Promise.resolve();

	constructor(private readonly prisma: PrismaService) {}

	onModuleInit(): Promise<void> {
		setRunWorkspaceSource({
			global: () => this.global,
			override: (id) => this.overrides.get(id),
			locations: () => [
				...this.locations,
				...[...this.overrides.values()].flatMap((o) =>
					o.location ? [o.location] : [],
				),
			],
			serviceIdOf: async (name) =>
				(
					await this.prisma.service.findUnique({
						where: { name },
						select: { id: true },
					})
				)?.id ?? null,
			record: (removals) => this.record(removals),
		});
		this.timer = setInterval(() => void this.sweep(), HOUR_MS);
		this.timer.unref();
		return this.ready();
	}

	async onModuleDestroy(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		await this.writing;
	}

	/** Settings loaded; dispatch awaits it before its boot sweep. */
	ready(): Promise<void> {
		this.loaded ??= this.load().catch((e) => {
			this.loaded = null;
			this.logger.warn(
				`Could not load the run workspace settings; the defaults apply: ${(e as Error).message}`,
			);
		});
		return this.loaded;
	}

	private async load(): Promise<void> {
		const rows = await this.prisma.setting.findMany({
			where: { key: { startsWith: "runWorkspace." } },
		});
		for (const row of rows) {
			const value = parseJson(row.value);
			if (row.key === COPIES_KEY) {
				const parsed = CopiesSchema.safeParse(value);
				if (parsed.success) this.copies = parsed.data;
			} else if (row.key === LOCATIONS_KEY) {
				const parsed = z.array(z.string()).safeParse(value);
				if (parsed.success) for (const l of parsed.data) this.locations.add(l);
			} else if (row.key === GLOBAL_KEY) {
				const parsed = RunWorkspaceSettingsSchema.safeParse({
					...DEFAULT_RUN_WORKSPACE_SETTINGS,
					...(value as object),
				});
				if (parsed.success) this.global = parsed.data;
			} else if (row.key.startsWith(OVERRIDE_PREFIX)) {
				const parsed = RunWorkspaceOverrideSchema.safeParse(value);
				if (parsed.success)
					this.overrides.set(
						row.key.slice(OVERRIDE_PREFIX.length),
						parsed.data,
					);
			}
		}
		setMirrorLocations(this.copies.location, this.copies.previous);
	}

	/** The hourly sweep; a live run's workspace is never touched, and two sweeps never overlap. */
	sweep(): Promise<void> {
		this.sweeping ??= (async () => {
			try {
				await this.ready();
				const [live, resolved] = await Promise.all([
					this.prisma.investigation.findMany({
						where: { status: { in: ["pending", "running"] } },
						select: { id: true },
					}),
					this.prisma.investigation.findMany({
						where: { incident: { status: { in: ["resolved", "closed"] } } },
						select: { id: true },
					}),
				]);
				const liveIds = new Set(live.map((r) => r.id));
				const resolvedIds = new Set(resolved.map((r) => r.id));
				await sweepRunWorktrees({
					isLive: (id) => liveIds.has(id),
					isResolved: (id) => resolvedIds.has(id),
				});
				await this.sweepCopies();
			} catch (e) {
				this.logger.warn(
					`Could not sweep run workspaces: ${(e as Error).message}`,
				);
			} finally {
				this.sweeping = null;
			}
		})();
		return this.sweeping;
	}

	async getGlobal(): Promise<Omit<RunWorkspaceGlobal, "canEdit">> {
		await this.ready();
		return {
			settings: this.global,
			defaultLocation: defaultWorktreeRoot(),
			copies: { ...this.copies, defaultLocation: defaultMirrorRoot() },
		};
	}

	/** New copies go to `location`; the folder before it is remembered until its copies are unused. */
	async setCopies(location: string | null) {
		await this.ready();
		const before = this.copies.location;
		const previous =
			before === location
				? this.copies.previous
				: [
						...new Set([
							...this.copies.previous,
							before ?? defaultMirrorRoot(),
						]),
					];
		await this.saveCopies({ location, previous });
		return this.getGlobal();
	}

	private async saveCopies(next: z.infer<typeof CopiesSchema>): Promise<void> {
		const value = JSON.stringify(next);
		await this.prisma.setting.upsert({
			where: { key: COPIES_KEY },
			create: { key: COPIES_KEY, value, type: "json", category: "runs" },
			update: { value },
		});
		this.copies = next;
		setMirrorLocations(next.location, next.previous);
	}

	/** Old copy folders are dropped once no workspace uses a copy in them. */
	private async sweepCopies(): Promise<void> {
		if (!this.copies.previous.length) return;
		const still = await sweepOldMirrors();
		if (still.length !== this.copies.previous.length)
			await this.saveCopies({ ...this.copies, previous: still });
	}

	async setGlobal(settings: RunWorkspaceSettings) {
		// Remembered first: a location the settings stop naming is still swept (#925 review).
		await this.remember(this.global.location, settings.location);
		await this.prisma.setting.upsert({
			where: { key: GLOBAL_KEY },
			create: {
				key: GLOBAL_KEY,
				value: JSON.stringify(settings),
				type: "json",
				category: "runs",
			},
			update: { value: JSON.stringify(settings) },
		});
		this.global = settings;
		return this.getGlobal();
	}

	async getService(
		serviceId: string,
	): Promise<Omit<ServiceWorkspace, "canEdit">> {
		await this.ready();
		await this.requireService(serviceId);
		const override = this.overrides.get(serviceId) ?? {};
		const { effective, inherited } = resolveRunWorkspaceSettings(
			this.global,
			override,
		);
		return { serviceId, override, effective, inherited };
	}

	async setService(serviceId: string, override: RunWorkspaceOverride) {
		await this.requireService(serviceId);
		const own = Object.fromEntries(
			Object.entries(override).filter(([, v]) => v !== undefined),
		) as RunWorkspaceOverride;
		const key = `${OVERRIDE_PREFIX}${serviceId}`;
		if (Object.keys(own).length === 0) {
			await this.remember(this.overrides.get(serviceId)?.location);
			await this.prisma.setting.deleteMany({ where: { key } });
			this.overrides.delete(serviceId);
		} else {
			await this.remember(
				this.overrides.get(serviceId)?.location,
				own.location,
			);
			await this.prisma.setting.upsert({
				where: { key },
				create: {
					key,
					value: JSON.stringify(own),
					type: "json",
					category: "runs",
				},
				update: { value: JSON.stringify(own) },
			});
			this.overrides.set(serviceId, own);
		}
		return this.getService(serviceId);
	}

	private async remember(
		...named: (string | null | undefined)[]
	): Promise<void> {
		const next = new Set(this.locations);
		for (const l of named) if (l) next.add(l);
		if (next.size === this.locations.size) return;
		const value = JSON.stringify([...next]);
		await this.prisma.setting.upsert({
			where: { key: LOCATIONS_KEY },
			create: { key: LOCATIONS_KEY, value, type: "json", category: "runs" },
			update: { value },
		});
		// Only once stored: a failed write is retried by the next save.
		this.locations = next;
	}

	private async requireService(id: string): Promise<void> {
		const found = await this.prisma.service.findUnique({
			where: { id },
			select: { id: true },
		});
		if (!found) throw new RunWorkspaceNotFoundError("Service not found");
	}

	async removals(): Promise<WorkspaceRemoval[]> {
		await this.writing;
		const row = await this.prisma.setting.findUnique({
			where: { key: REMOVALS_KEY },
		});
		const parsed = z
			.array(WorkspaceRemovalSchema)
			.safeParse(parseJson(row?.value ?? "[]"));
		return parsed.success ? parsed.data : [];
	}

	/** Newest first, the last {@link REMOVALS_KEPT}; writes are queued so none is lost. */
	private record(removals: WorkspaceRemoval[]): void {
		this.pending.push(...removals);
		this.writing = this.writing
			.then(async () => {
				const batch = this.pending.splice(0);
				if (!batch.length) return;
				const row = await this.prisma.setting.findUnique({
					where: { key: REMOVALS_KEY },
				});
				const before = z
					.array(WorkspaceRemovalSchema)
					.safeParse(parseJson(row?.value ?? "[]"));
				const value = JSON.stringify(
					[...batch.reverse(), ...(before.success ? before.data : [])].slice(
						0,
						REMOVALS_KEPT,
					),
				);
				await this.prisma.setting.upsert({
					where: { key: REMOVALS_KEY },
					create: { key: REMOVALS_KEY, value, type: "json", category: "runs" },
					update: { value },
				});
			})
			.catch((e) =>
				this.logger.warn(
					`Could not record workspace removals: ${(e as Error).message}`,
				),
			);
	}

	/** A finished run's workspaces still on disk, kept by its rule or by a guard, with the latest reason recorded. */
	async listForRun(runId: string): Promise<KeptWorkspace[]> {
		const run = await this.prisma.investigation.findUnique({
			where: { id: runId },
			select: { status: true },
		});
		if (run?.status === "pending" || run?.status === "running") return [];
		const history = await this.removals();
		return keptWorkspaces(runId, true).map((w) => ({
			dir: w.dir,
			serviceId: w.project ?? null,
			method: w.method,
			keptAt: w.keptAt ?? w.createdAt,
			reason:
				history.find((r) => r.dir === w.dir && !r.removed)?.reason ??
				keptReason(
					resolveRunWorkspaceSettings(
						this.global,
						w.project ? this.overrides.get(w.project) : undefined,
					).effective,
				),
		}));
	}

	/** Only a directory the listing names for this run; never a path the caller made up. */
	private kept(runId: string, dir: string): string {
		const found = keptWorkspaces(runId, true).find((w) => w.dir === dir);
		if (!found) throw new RunWorkspaceNotFoundError("No kept workspace there");
		return found.dir;
	}

	remove(runId: string, dir: string) {
		return removeKeptWorkspace(this.kept(runId, dir));
	}

	open(runId: string, dir: string): { opened: boolean } {
		const target = this.kept(runId, dir);
		const [cmd, args] =
			process.platform === "win32"
				? ["explorer.exe", [target]]
				: process.platform === "darwin"
					? ["open", [target]]
					: ["xdg-open", [target]];
		try {
			const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
			child.on("error", (e) =>
				this.logger.warn(`Could not open ${target}: ${e.message}`),
			);
			child.unref();
			return { opened: true };
		} catch {
			return { opened: false };
		}
	}
}

function keptReason(s: RunWorkspaceSettings): string {
	return s.retention.kind === "keep-days" ||
		s.retention.kind === "keep-until-resolved"
		? s.retention.kind
		: "changed";
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
