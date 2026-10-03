// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { installFakeAgent } from "../../../../../scripts/fakes/fake-acp-agent.mjs";

// Set at import, before anything reads the config: a spec that imports app code
// first would otherwise open ~/.prismalens. `boot()` refuses if that happened.
const WORKSPACE = mkdtempSync(join(tmpdir(), "pl-scenario-"));
const DATA_DIR = join(WORKSPACE, "data");
process.env.PRISMALENS_WORKSPACE_DIR = DATA_DIR;

export interface Incident {
	id: string;
	number: number;
	status: string;
	title: string;
	alerts?: Array<{ id: string; externalId: string | null; status: string }>;
}

export interface Investigation {
	id: string;
	incidentId: string;
	status: string;
	report?: { rootCause: string | null } | null;
	error?: string | null;
}

/** PrismaLens on an empty workspace: real SQLite and HTTP, the fake agent on PATH. */
export class ScenarioApp {
	readonly workspace = WORKSPACE;
	private app: INestApplication | null = null;
	private cookie = "";
	url = "";

	constructor() {
		const bin = join(this.workspace, "harness-bin");
		mkdirSync(bin);
		installFakeAgent(bin, { session: "success" });
		Object.assign(process.env, {
			PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
			PRISMALENS_TELEMETRY: "off",
			PRISMALENS_LOG_CONSOLE: "quiet",
		});
		// Boot pull and the post-webhook listing are skipped under CI (#605); a scenario is a real box.
		delete process.env.CI;
		delete process.env.PRISMALENS_SEED_DEMO;
	}

	async boot(): Promise<void> {
		const { getConfig } = await import("@prismalens/config");
		if (!getConfig().PRISMALENS_DB_URL.includes(DATA_DIR)) {
			throw new Error(
				`refusing to boot: the config was read before the scenario workspace was set (${getConfig().PRISMALENS_DB_URL})`,
			);
		}
		const { runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ log: () => {} });
		const { NestFactory } = await import("@nestjs/core");
		const { AppModule } = await import("../../../src/app.module.js");
		const { API_GLOBAL_PREFIX, API_GLOBAL_PREFIX_EXCLUDE } = await import(
			"../../../src/shared/constants/routes.js"
		);
		const app = await NestFactory.create(AppModule, {
			bodyParser: false,
			forceCloseConnections: true,
			logger: ["error"],
		});
		app.setGlobalPrefix(API_GLOBAL_PREFIX, {
			exclude: API_GLOBAL_PREFIX_EXCLUDE,
		});
		await app.listen(0, "127.0.0.1");
		const { port } = app.getHttpServer().address() as { port: number };
		this.url = `http://127.0.0.1:${port}`;
		this.app = app;
		if (!this.cookie) await this.pair();
	}

	async stop(): Promise<void> {
		await this.app?.close();
		this.app = null;
	}

	async dispose(): Promise<void> {
		await this.stop();
		rmSync(this.workspace, { recursive: true, force: true });
	}

	async postWebhookListing(): Promise<void> {
		if (!this.app) throw new Error("PrismaLens is not running");
		const { AlertPullService } = await import(
			"../../../src/modules/alerts/alert-pull.service.js"
		);
		await this.app.get(AlertPullService).onWebhook();
	}

	get webhookUrl(): string {
		return `${this.url}/api/webhooks/prometheus`;
	}

	get webhookToken(): string {
		return readFileSync(
			join(DATA_DIR, "PRISMALENS_WEBHOOK_SECRET_FILE"),
			"utf8",
		).trim();
	}

	async api<T>(
		path: string,
		init: { method?: string; body?: unknown } = {},
	): Promise<T> {
		const res = await fetch(`${this.url}/api${path}`, {
			method: init.method ?? "GET",
			headers: {
				"content-type": "application/json",
				origin: this.url,
				cookie: this.cookie,
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
		const text = await res.text();
		if (!res.ok)
			throw new Error(
				`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`,
			);
		return (text ? JSON.parse(text) : undefined) as T;
	}

	private async pair(): Promise<void> {
		const { createPairingLink, OPERATOR_SCOPES, prismaPairingStore } =
			await import("@prismalens/auth");
		const { PrismaService } = await import(
			"../../../src/core/prisma/prisma.service.js"
		);
		if (!this.app) throw new Error("PrismaLens is not running");
		const link = await createPairingLink(
			prismaPairingStore(this.app.get(PrismaService)),
			{
				label: "scenario",
				scopes: OPERATOR_SCOPES,
			},
		);
		const res = await fetch(`${this.url}/api/pairing/redeem`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: this.url },
			body: JSON.stringify({ token: link.token, name: "scenario" }),
		});
		const cookie = res.headers
			.getSetCookie()
			.find((c) => c.startsWith("prismalens.device."));
		if (res.status !== 200 || !cookie)
			throw new Error(`pairing failed: ${res.status}`);
		this.cookie = cookie.split(";")[0];
	}

	async serviceWithRepo(name: string): Promise<{ id: string }> {
		const repo = join(this.workspace, `repo-${name}`);
		mkdirSync(repo);
		writeFileSync(join(repo, "README.md"), `# ${name}\n`);
		const git = (...args: string[]) =>
			execFileSync(
				"git",
				["-c", "user.name=t", "-c", "user.email=t@t", ...args],
				{ cwd: repo },
			);
		git("init", "-q", "-b", "main");
		git("add", ".");
		git("commit", "-q", "-m", "init");
		const service = await this.api<{ id: string }>("/services", {
			method: "POST",
			body: { name },
		});
		await this.api("/repositories/source", {
			method: "POST",
			body: { serviceId: service.id, source: repo },
		});
		return service;
	}

	async connect(
		templateId: "alertmanager" | "prometheus",
		baseUrl: string,
	): Promise<void> {
		const integration = await this.api<{ id: string }>("/integrations", {
			method: "POST",
			body: { templateId, label: templateId },
		});
		await this.api("/integrations/connections", {
			method: "POST",
			body: {
				integrationId: integration.id,
				label: "lab",
				credentials: {},
				connectionConfig: { baseUrl },
			},
		});
	}

	async incidents(): Promise<Incident[]> {
		const body = await this.api<{ data: Incident[] }>("/incidents?limit=100");
		return body.data;
	}

	async incidentFor(fingerprint: string): Promise<Incident[]> {
		return (await this.incidents()).filter((i) =>
			(i.alerts ?? []).some((a) => a.externalId === fingerprint),
		);
	}

	async investigations(incidentId: string): Promise<Investigation[]> {
		const body = await this.api<{ data: Investigation[] }>(
			"/investigations?limit=100",
		);
		return body.data.filter((i) => i.incidentId === incidentId);
	}

	async investigation(id: string): Promise<Investigation> {
		const body = await this.api<
			{ investigation?: Investigation } & Investigation
		>(`/investigations/${id}`);
		return body.investigation ?? body;
	}
}

const POLL_MS = 500;

export async function eventually<T>(
	read: () => Promise<T>,
	ok: (value: T) => boolean,
	what: string,
	timeoutMs = 15_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let last: T | undefined;
	while (Date.now() < deadline) {
		last = await read();
		if (ok(last)) return last;
		// One oRPC handler serves a whole contract, so polls share its 10/s throttle
		// bucket with the test's next call; 100ms polling tripped 429s on macOS CI.
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	throw new Error(
		`timed out after ${timeoutMs}ms waiting for ${what}; last: ${JSON.stringify(last)}`,
	);
}
