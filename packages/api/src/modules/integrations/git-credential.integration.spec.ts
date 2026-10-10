// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * End-to-end integration scenarios for git clone credentials (#673, plan §1.9, W8):
 * S1–S8, S8b, S11, S13 over the local GitHttpServer fixture and a real temp SQLite database.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-git-cred-integ-"));
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pl-git-home-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	process.env.HOME = home;
	return { root, home };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { CredentialsService } = await import("./crypto/credentials.service.js");
const { IntegrationsService } = await import("./integrations.service.js");
const { GitCredentialService } = await import("./git-credential.service.js");
const { RepositoriesService } = await import("../repositories/repositories.service.js");
const { RepoSourceService } = await import("../../core/harness/repo-source.service.js");
const { TelemetryService } = await import("../../core/telemetry/telemetry.service.js");
import type { GitHttpServer } from "../../core/harness/__fixtures__/git-http-server.js";
const { startGitHttpServer } = await import(
	"../../core/harness/__fixtures__/git-http-server.js"
);
const { GitFailure } = await import("../../core/harness/git-failure.js");
const { GitCredentialAmbiguousError } = await import("./git-credential.service.js");
const { pickOf } = await import("./host-token.js");

const FIXTURE_GIT_ENV = {
	...process.env,
	GIT_TERMINAL_PROMPT: "0",
};

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, env: FIXTURE_GIT_ENV }).toString().trim();
}

describe("Git Credential Integration Scenarios (S1-S8, S8b, S11, S13)", () => {
	let server: GitHttpServer;
	let prisma: InstanceType<typeof PrismaService>;
	let credentialsService: InstanceType<typeof CredentialsService>;
	let integrationsService: InstanceType<typeof IntegrationsService>;
	let gitCredentialService: InstanceType<typeof GitCredentialService>;
	let repoSourceService: InstanceType<typeof RepoSourceService>;
	let repositoriesService: InstanceType<typeof RepositoriesService>;
	let telemetryService: InstanceType<typeof TelemetryService>;

	let testServiceId: string;
	const tempDirs: string[] = [];

	function mktemp(prefix: string): string {
		const d = mkdtempSync(join(tmpdir(), prefix));
		tempDirs.push(d);
		return d;
	}

	async function snapshotWith(
		ref: { sourceKind: "folder" | "url"; url: string; connectionId: string | null },
		dest: string,
	) {
		const row =
			ref.sourceKind === "url"
				? await prisma.repository.findFirst({
						where: { url: ref.url },
						select: { metadata: true, defaultBranch: true },
					})
				: null;
		return gitCredentialService.withCredential(
			{
				sourceKind: ref.sourceKind,
				url: ref.url,
				connectionId: ref.connectionId,
				pick: pickOf(row?.metadata),
			},
			(cred) =>
				repoSourceService.snapshot(
					{
						kind: ref.sourceKind,
						source: ref.url,
						defaultBranch: row?.defaultBranch,
						credential: cred,
					},
					dest,
				),
		);
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });

		prisma = new PrismaService();
		await prisma.$connect();

		// Configure mock ConfigService for CredentialsService with encryption key
		const mockConfigService = {
			get: (key: string) => {
				if (key === "PRISMALENS_ENCRYPTION_KEY")
					return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
				return undefined;
			},
		};
		credentialsService = new CredentialsService(mockConfigService as any);

		telemetryService = {
			capture: vi.fn(async () => {}),
		} as unknown as InstanceType<typeof TelemetryService>;

		integrationsService = new IntegrationsService(
			prisma,
			credentialsService,
			telemetryService,
		);
		integrationsService.onModuleInit();

		gitCredentialService = new GitCredentialService(
			prisma,
			credentialsService,
			integrationsService,
		);

		repoSourceService = new RepoSourceService();

		repositoriesService = new RepositoriesService(
			prisma,
			repoSourceService,
			gitCredentialService,
			telemetryService,
		);

		// Start local TLS git server
		server = await startGitHttpServer({ tls: true });

		// Trust the self-signed certificate in $HOME/.gitconfig
		if (server.caFile) {
			writeFileSync(
				join(env.home, ".gitconfig"),
				`[http]\n\tsslCAInfo = ${server.caFile}\n`,
			);
		}

		// Create a test service in SQLite
		const svc = await prisma.service.create({
			data: {
				name: "Integration Test Service",
			},
		});
		testServiceId = svc.id;
	});

	afterAll(async () => {
		await server.close();
		await prisma.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
		rmSync(env.home, { recursive: true, force: true });
		for (const d of tempDirs) {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("S1: Clean env, public URL -> Code: public, branch and sha synced, snapshot succeeds with source: none", async () => {
		const repoUrl = server.addRepo("public-repo", { kind: "anonymous" });
		const head = server.headOf("public-repo");

		const repo = await repositoriesService.addSource({
			serviceId: testServiceId,
			source: repoUrl,
		});

		expect(repo.syncBranch).toBe("main");
		expect(repo.syncHead).toBe(head);
		expect(repo.syncError).toBeNull();

		const preview = await repositoriesService.credentialFor(repo);
		expect(preview.source).toBe("none");
		expect(preview.label).toBe("public");

		const dest = join(mktemp("s1-dest-"), "work");
		const { credential, result: snap } = await snapshotWith(
			{ sourceKind: "url", url: repoUrl, connectionId: repo.connectionId },
			dest,
		);

		expect(credential.source).toBe("none");
		expect(credential.label).toBe("public");
		expect(snap.head).toBe(head);
	});

	it("S2: Clean env, private URL, no connection -> fails with no-credential in syncError", async () => {
		const repoUrl = server.addRepo("private-repo-no-conn", { kind: "reject-401" });

		const repo = await repositoriesService.addSource({
			serviceId: testServiceId,
			source: repoUrl,
		});

		expect(repo.syncError).toMatch(/No credential for/);
		expect(repo.syncError).toMatch(/Add a Git host token in Settings/);

		const preview = await repositoriesService.credentialFor(repo);
		expect(preview.source).toBe("none");
		expect(preview.label).toBe("public");
	});

	it("S3: Add token A for host, testConnection succeeds, re-save S2 repo -> Code: token A", async () => {
		const u = new URL(server.url);
		const host = u.host; // host:port

		const integration = await prisma.integration.create({
			data: {
				templateId: "git-host-token",
				label: "Host Token Integration",
			},
		});

		const connection = await integrationsService.createConnection({
			integrationId: integration.id,
			label: "Token A",
			credentials: { token: "secret-token-a" },
			connectionConfig: { host },
		});

		// Configure the server to accept basic auth with user x-access-token and pass secret-token-a
		server.setMode("private-repo-no-conn", {
			kind: "basic",
			user: "x-access-token",
			pass: "secret-token-a",
		});

		// testConnection runs ls-remote against repositories on that host
		const testResult = await integrationsService.testConnection(connection.id);
		expect(testResult.success).toBe(true);

		gitCredentialService.invalidate();
		const repoUrl = `${server.url}/private-repo-no-conn.git`;
		const repo = await repositoriesService.addSource({
			serviceId: testServiceId,
			source: repoUrl,
		});

		expect(repo.syncError).toBeNull();
		expect(repo.syncBranch).toBe("main");

		gitCredentialService.invalidate();
		const preview = await repositoriesService.credentialFor(repo);
		expect(preview.source).toBe("connection");
		expect(preview.label).toBe("token Token A");

		const dest = join(mktemp("s3-dest-"), "work");
		const { credential, result: snap } = await snapshotWith(
			{ sourceKind: "url", url: repoUrl, connectionId: repo.connectionId },
			dest,
		);
		expect(credential.source).toBe("connection");
		expect(credential.label).toBe("token Token A");
		expect(snap.head).toBe(server.headOf("private-repo-no-conn"));
	});

	it("S4: Add missing-404 repo path -> no-access taxonomy message naming repo", async () => {
		const repoUrl = server.addRepo("missing-repo", { kind: "missing-404" });

		const repo = await repositoriesService.addSource({
			serviceId: testServiceId,
			source: repoUrl,
		});

		expect(repo.syncError).toMatch(/can't see missing-repo: it doesn't exist or the token has no access to it/);
	});

	it("S5: Revoke token on server (mode reject-401) -> run triggers token-rejected and records Connection.status = ERROR", async () => {
		const repoUrl = `${server.url}/private-repo-no-conn.git`;
		server.setMode("private-repo-no-conn", { kind: "reject-401" });

		const dest = join(mktemp("s5-dest-"), "work");
		await expect(
			snapshotWith(
				{ sourceKind: "url", url: repoUrl, connectionId: null },
				dest,
			),
		).rejects.toThrow(/rejected token "Token A"/);

		const conn = await prisma.connection.findFirst({
			where: { label: "Token A" },
		});
		expect(conn?.status).toBe("ERROR");
		expect(conn?.lastErrorMessage).toMatch(/rejected token "Token A"/);
	});

	it("S6: tokenExpiresAt in the past -> fails with token-expired before network call", async () => {
		const past = new Date(Date.now() - 3600_000);
		const conn = await prisma.connection.findFirst({
			where: { label: "Token A" },
		});
		await prisma.connection.update({
			where: { id: conn!.id },
			data: { tokenExpiresAt: past, status: "ACTIVE" },
		});

		const repoUrl = `${server.url}/private-repo-no-conn.git`;
		const dest = join(mktemp("s6-dest-"), "work");

		await expect(
			snapshotWith(
				{ sourceKind: "url", url: repoUrl, connectionId: null },
				dest,
			),
		).rejects.toThrow(/Token "Token A" expired on/);
	});

	it("S7: Second token for host without pick -> ambiguous; picking token resolves and snapshot succeeds", async () => {
		// Restore Token A to valid state
		const connA = await prisma.connection.findFirst({
			where: { label: "Token A" },
		});
		await prisma.connection.update({
			where: { id: connA!.id },
			data: { tokenExpiresAt: null, status: "ACTIVE" },
		});

		// Create Token B for the same host
		const integration = await prisma.integration.findFirst({
			where: { templateId: "git-host-token" },
		});
		const connB = await integrationsService.createConnection({
			integrationId: integration!.id,
			label: "Token B",
			credentials: { token: "secret-token-b" },
			connectionConfig: { host: new URL(server.url).host },
		});

		const repoUrl = server.addRepo("ambig-repo", {
			kind: "basic",
			user: "x-access-token",
			pass: "secret-token-a",
		});

		const repo = await repositoriesService.addSource({
			serviceId: testServiceId,
			source: repoUrl,
		});

		// Preview should show ambiguous problem
		gitCredentialService.invalidate();
		const preview = await repositoriesService.credentialFor(repo);
		expect(preview.problem?.code).toBe("ambiguous");

		// Without pick, snapshotWith throws GitCredentialAmbiguousError
		const dest = join(mktemp("s7-dest-"), "work");
		await expect(
			snapshotWith(
				{ sourceKind: "url", url: repoUrl, connectionId: repo.connectionId },
				dest,
			),
		).rejects.toThrow(GitCredentialAmbiguousError);

		// Pick Token A
		const updated = await repositoriesService.setCredential(repo.id, connA!.id);
		const previewAfterPick = await repositoriesService.credentialFor(updated);
		expect(previewAfterPick.source).toBe("connection");
		expect(previewAfterPick.label).toBe("token Token A");

		// Snapshot with Token A succeeds
		const { credential, result: snap } = await snapshotWith(
			{ sourceKind: "url", url: repoUrl, connectionId: repo.connectionId },
			dest,
		);
		expect(credential.label).toBe("token Token A");
		expect(snap.head).toBe(server.headOf("ambig-repo"));
	});

	it("S8: Fake credential helper in .gitconfig -> machine git resolves; token unused unless picked", async () => {
		const helperScript = join(env.home, "fake-helper.sh");
		writeFileSync(
			helperScript,
			`#!/bin/sh\necho "username=machineuser"\necho "password=machinepass"\n`,
			{ mode: 0o755 },
		);

		// Add helper to .gitconfig
		writeFileSync(
			join(env.home, ".gitconfig"),
			`[http]\n\tsslCAInfo = ${server.caFile}\n[credential]\n\thelper = ${helperScript}\n`,
		);

		const repoUrl = server.addRepo("helper-repo", {
			kind: "basic",
			user: "machineuser",
			pass: "machinepass",
		});

		const repo = await repositoriesService.addSource({
			serviceId: testServiceId,
			source: repoUrl,
		});

		gitCredentialService.invalidate();
		const preview = await repositoriesService.credentialFor(repo);
		expect(preview.source).toBe("machine");
		expect(preview.label).toMatch(/machine git \(.*machineuser\)/);

		const dest = join(mktemp("s8-dest-"), "work");
		const { credential } = await snapshotWith(
			{ sourceKind: "url", url: repoUrl, connectionId: repo.connectionId },
			dest,
		);
		expect(credential.source).toBe("machine");
		expect(credential.label).toMatch(/machine git \(.*machineuser\)/);
	});

	it("S8b: Helper rejected by server, but exactly one matching token exists -> withCredential retries with token (fallback: true)", async () => {
		// Remove Token B so exactly one token (Token A) matches the host
		const connB = await prisma.connection.findFirst({
			where: { label: "Token B" },
		});
		if (connB) {
			await integrationsService.deleteConnection(connB.id);
		}

		// Server requires Token A credentials, rejecting the machine helper's credentials
		const repoUrl = server.addRepo("fallback-repo", {
			kind: "basic",
			user: "x-access-token",
			pass: "secret-token-a",
		});

		gitCredentialService.invalidate();
		const repo = await repositoriesService.addSource({
			serviceId: testServiceId,
			source: repoUrl,
		});

		// Preview still expects machine git
		const preview = await repositoriesService.credentialFor(repo);
		expect(preview.source).toBe("machine");

		// Running snapshotWith causes machine to be refused, falls back to Token A
		const dest = join(mktemp("s8b-dest-"), "work");
		const { credential, result: snap } = await snapshotWith(
			{ sourceKind: "url", url: repoUrl, connectionId: repo.connectionId },
			dest,
		);
		expect(credential.source).toBe("connection");
		expect(credential.label).toBe("token Token A");
		expect(credential.fallback).toBe(true);
		expect(snap.head).toBe(server.headOf("fallback-repo"));
	});

	it("S11: Self-hosted server with port -> host normalization works and matches host:port", async () => {
		const u = new URL(server.url);
		const hostWithPort = u.host; // e.g. 127.0.0.1:<port>

		const integration = await prisma.integration.findFirst({
			where: { templateId: "git-host-token" },
		});

		const connPort = await integrationsService.createConnection({
			integrationId: integration!.id,
			label: "Port Token",
			credentials: { token: "port-secret" },
			// typed as full URL with scheme, upper/lowercase, trailing slash
			connectionConfig: { host: `https://${hostWithPort.toUpperCase()}/` },
		});

		const decryptedConfig = credentialsService.decrypt<Record<string, string>>(
			Buffer.from(connPort.connectionConfigEnc!),
		);
		expect(decryptedConfig.host).toBe(hostWithPort.toLowerCase());
	});

	it("S13: Pinned repository, deleting the connection clears the pick and repository survives with Auto", async () => {
		const repoUrl = server.addRepo("pinned-delete-repo", { kind: "anonymous" });
		const repo = await repositoriesService.addSource({
			serviceId: testServiceId,
			source: repoUrl,
		});

		const connA = await prisma.connection.findFirst({
			where: { label: "Token A" },
		});

		// Pin Token A
		await repositoriesService.setCredential(repo.id, connA!.id);
		let pinnedRepo = await prisma.repository.findUnique({ where: { id: repo.id } });
		expect(pickOf(pinnedRepo?.metadata)).toBe(connA!.id);

		// Deletion impact preview lists the repo
		const impact = await integrationsService.getConnectionDeletionImpact(connA!.id);
		expect(impact?.repositories.some((r) => r.id === repo.id)).toBe(true);

		// Delete connection A
		await integrationsService.deleteConnection(connA!.id);

		// Repository row survives, pick is cleared
		pinnedRepo = await prisma.repository.findUnique({ where: { id: repo.id } });
		expect(pinnedRepo).not.toBeNull();
		expect(pickOf(pinnedRepo?.metadata)).toBeNull();

		// Link to service survives
		const links = await prisma.serviceRepository.findMany({
			where: { repositoryId: repo.id },
		});
		expect(links.length).toBe(1);
	});
});
