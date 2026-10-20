// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Sign-in end to end (#848, 04): start → loopback callback → save → reload → retest →
 * adapter read → rotated refresh → clone token, for GitLab, GitHub and Bitbucket.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-sign-in-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { CredentialsService } = await import("../integrations/crypto/credentials.service.js");
const { IntegrationsService } = await import("../integrations/integrations.service.js");
const { readHostToken } = await import("../integrations/host-token.js");
const { SourcesService } = await import("./sources.service.js");
const { SignIns } = await import("./sign-in.js");
const { OAuthLoopback } = await import("./oauth-loopback.js");
const { forgetOAuthCache } = await import("@prismalens/integrations");
const { needsDisclosure, sourceType } = await import("@prismalens/contracts/schemas");

const PORT = 46475;
const ORIGIN = "http://127.0.0.1:6473";

interface Vendor {
	host: string;
	tokenPath: string;
	/** What each token request looked like. */
	tokenCalls: { body: URLSearchParams; authorization: string | null }[];
	apiCalls: { path: string; authorization: string | null }[];
	refresh: boolean;
	scope: string;
	expiresIn?: number;
	live: string;
	generation: number;
	challenges: Map<string, string>;
}

function vendor(host: string, tokenPath: string, o: Partial<Vendor> = {}): Vendor {
	return {
		host,
		tokenPath,
		tokenCalls: [],
		apiCalls: [],
		refresh: true,
		scope: "",
		live: "R0",
		generation: 0,
		challenges: new Map(),
		...o,
	};
}

const vendors: Vendor[] = [];
const realFetch = globalThis.fetch;

/** Every https request in this file lands on a mock vendor. */
function installFetch() {
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		if (url.protocol !== "https:") return realFetch(input, init);
		const v = vendors.find((x) => x.host === url.host);
		if (!v) return new Response("unknown host", { status: 404 });
		const headers = new Headers(init?.headers);
		const json = (b: unknown, status = 200) =>
			new Response(JSON.stringify(b), {
				status,
				headers: { "content-type": "application/json" },
			});
		if (url.pathname === v.tokenPath) {
			const body = new URLSearchParams(String(init?.body ?? ""));
			v.tokenCalls.push({ body, authorization: headers.get("authorization") });
			const grant = body.get("grant_type");
			if (grant === "authorization_code") {
				const sent = createHash("sha256")
					.update(body.get("code_verifier") ?? "")
					.digest("base64url");
				if (v.challenges.get(body.get("code") ?? "") !== sent)
					return json({ error: "invalid_grant" }, 400);
			} else if (grant === "refresh_token") {
				if (body.get("refresh_token") !== v.live)
					return json({ error: "invalid_grant" }, 400);
				v.live = `R${++v.generation}`;
			}
			v.generation += grant === "authorization_code" ? 0 : 0;
			const access = `${v.host}-A${v.tokenCalls.length}`;
			return json({
				access_token: access,
				token_type: "bearer",
				...(v.refresh && grant !== "client_credentials"
					? { refresh_token: v.live, expires_in: v.expiresIn ?? 3600 }
					: { expires_in: v.expiresIn ?? 3600 }),
				...(v.scope ? { scope: v.scope } : {}),
			});
		}
		v.apiCalls.push({ path: url.pathname, authorization: headers.get("authorization") });
		if (!headers.get("authorization")?.startsWith("Bearer "))
			return json({ message: "no" }, 401);
		if (url.pathname.endsWith("/user")) return json({ login: "amy", username: "amy" });
		return json([{ id: 1 }]);
	});
}

let prisma: InstanceType<typeof PrismaService>;
let credentials: InstanceType<typeof CredentialsService>;
let integrations: InstanceType<typeof IntegrationsService>;
let sources: InstanceType<typeof SourcesService>;
let signIns: InstanceType<typeof SignIns>;

beforeAll(async () => {
	const { resolveMigrationsDir, runMigrations } = await import(
		"@prismalens/database/migrator"
	);
	await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
	prisma = new PrismaService();
	await prisma.$connect();
	credentials = new CredentialsService({
		get: (k: string) =>
			k === "PRISMALENS_ENCRYPTION_KEY" ? "ab".repeat(32) : undefined,
	} as never);
	integrations = new IntegrationsService(prisma, credentials, {
		capture: async () => {},
	} as never);
	signIns = new SignIns();
	signIns.loopback = new OAuthLoopback(
		async (p) => "connectionId" in (await signIns.complete(p)),
		{ port: PORT },
	);
	sources = new SourcesService(
		prisma,
		integrations,
		credentials,
		{} as never,
		signIns,
		{} as never,
	);
});

afterAll(async () => {
	signIns.onModuleDestroy();
	await prisma.$disconnect();
});

beforeEach(() => {
	vi.restoreAllMocks();
	vendors.splice(0);
	forgetOAuthCache();
	installFetch();
});

/** Plays the user: reads the authorization URL, approves, and follows the loopback redirect. */
async function approve(v: Vendor, authorizationUrl: string): Promise<Response> {
	const u = new URL(authorizationUrl);
	const code = `code-${v.challenges.size}`;
	v.challenges.set(code, u.searchParams.get("code_challenge") ?? "");
	expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:6474/callback");
	return realFetch(
		`http://127.0.0.1:${PORT}/callback?code=${code}&state=${u.searchParams.get("state")}`,
	);
}

async function rowOf(templateId: string) {
	const rows = await prisma.connection.findMany({
		where: { integration: { templateId } },
		include: { integration: true },
		orderBy: { createdAt: "desc" },
	});
	const row = rows[0];
	if (!row) throw new Error(`no ${templateId} row`);
	return { row, blob: credentials.decrypt<Record<string, unknown>>(Buffer.from(row.credentialsEnc)) };
}

describe("GitLab self-managed with your own app (OBJ-009)", () => {
	it("callback → save → reload → retest → adapter read → rotated refresh → clone token", async () => {
		const v = vendor("gitlab.acme.test", "/oauth/token", {
			scope: "read_api read_repository",
		});
		vendors.push(v);
		const { authorizationUrl } = await sources.oauthStart(
			{
				draft: {
					type: "gitlab-token",
					url: "https://gitlab.acme.test/api/v4",
					credential: { clientId: "byo-client" },
				},
			},
			ORIGIN,
		);
		expect(new URL(authorizationUrl).origin).toBe("https://gitlab.acme.test");
		expect(new URL(authorizationUrl).searchParams.get("scope")).toBe(
			"read_api read_repository",
		);
		const page = await approve(v, authorizationUrl);
		expect(await page.text()).toContain("Signed in");

		const { row, blob } = await rowOf("gitlab-token");
		expect(blob).toMatchObject({
			kind: "oauth",
			refreshToken: "R0",
			redirectUri: "http://127.0.0.1:6474/callback",
			baseUrl: "https://gitlab.acme.test/api/v4",
		});
		expect(JSON.parse(row.grantedScopes)).toEqual(["read_api", "read_repository"]);
		// GitLab's public client: PKCE and no secret.
		expect(v.tokenCalls[0]?.body.get("client_secret")).toBeNull();
		expect(v.tokenCalls[0]?.body.get("code_verifier")).toBeTruthy();

		forgetOAuthCache();
		const report = await sources.retest(row.id);
		expect(report.ok).toBe(true);
		const refreshed = v.tokenCalls.at(-1)?.body;
		expect(refreshed?.get("grant_type")).toBe("refresh_token");
		expect(refreshed?.get("redirect_uri")).toBe("http://127.0.0.1:6474/callback");

		const res = await integrations.createRequestFn(row.id)("GET", "/projects");
		expect(res.ok).toBe(true);
		expect(v.apiCalls.at(-1)?.authorization).toMatch(/^Bearer gitlab\.acme\.test-A/);

		// Rotated refresh token written back, baseUrl kept.
		const after = await rowOf("gitlab-token");
		expect(after.blob).toMatchObject({
			refreshToken: "R1",
			baseUrl: "https://gitlab.acme.test/api/v4",
		});

		const clone = await readHostToken(
			after.row,
			credentials,
			integrations.authorizeHost,
		);
		expect(clone).toMatchObject({ host: "gitlab.acme.test", username: "oauth2" });
		expect(clone?.token).toMatch(/^gitlab\.acme\.test-A/);
		expect(needsDisclosure(sourceType("gitlab-token") ?? {}, ["read_api", "read_repository"])).toBe(false);
	});

	it("a legacy bearer row is read and kept byte for byte", async () => {
		const integration = await integrations.createIntegration({
			templateId: "gitlab-token",
			label: "GitLab legacy",
		}).catch(async () => prisma.integration.findFirstOrThrow({ where: { templateId: "gitlab-token" } }));
		const legacy = { apiKey: "glpat-legacy", baseUrl: "https://gitlab.acme.test/api/v4" };
		const conn = await integrations.createConnection({
			integrationId: integration.id,
			label: "legacy",
			credentials: legacy,
		});
		vendors.push(vendor("gitlab.acme.test", "/oauth/token"));
		expect((await sources.retest(conn.id)).ok).toBe(true);
		const row = await prisma.connection.findUniqueOrThrow({ where: { id: conn.id } });
		expect(JSON.stringify(credentials.decrypt(Buffer.from(row.credentialsEnc)))).toBe(
			JSON.stringify(legacy),
		);
	});

	it("a wrong state is refused and nothing is saved", async () => {
		const before = await prisma.connection.count();
		expect(await signIns.complete(new URLSearchParams({ code: "x", state: "forged" }))).toEqual({
			error: "state",
		});
		expect(await prisma.connection.count()).toBe(before);
	});
});

describe("GitHub with your own app", () => {
	it("sends PKCE plus client_secret, shows the disclosure for repo, clones as x-access-token", async () => {
		const v = vendor("github.com", "/login/oauth/access_token", {
			refresh: false,
			scope: "repo",
		});
		vendors.push(v, vendor("api.github.com", "/none"));
		const { authorizationUrl } = await sources.oauthStart(
			{
				draft: {
					type: "github-token",
					url: "https://api.github.com",
					credential: { clientId: "gh-client", clientSecret: "gh-secret" },
				},
			},
			ORIGIN,
		);
		expect(new URL(authorizationUrl).searchParams.get("scope")).toBe("repo");
		expect(await (await approve(v, authorizationUrl)).text()).toContain("Signed in");
		const exchange = v.tokenCalls[0]?.body;
		expect(exchange?.get("client_secret")).toBe("gh-secret");
		expect(exchange?.get("code_verifier")).toBeTruthy();
		const { row, blob } = await rowOf("github-token");
		// Non-expiring shape: the access token is stored (OBJ-022).
		expect(blob).toMatchObject({ kind: "oauth", accessToken: "github.com-A1" });
		expect(needsDisclosure(sourceType("github-token") ?? {}, JSON.parse(row.grantedScopes))).toBe(true);
		const clone = await readHostToken(row, credentials, integrations.authorizeHost);
		expect(clone).toMatchObject({ host: "github.com", username: "x-access-token", token: "github.com-A1" });
	});
});

describe("GitHub Enterprise Server with your own app", () => {
	it("authorizes and exchanges at the GHE host, and github.com sees nothing", async () => {
		const ghe = vendor("ghe.acme.test", "/login/oauth/access_token", {
			refresh: false,
			scope: "repo",
		});
		const dotcom = vendor("github.com", "/login/oauth/access_token");
		vendors.push(ghe, dotcom);
		const { authorizationUrl } = await sources.oauthStart(
			{
				draft: {
					type: "github-token",
					url: "https://ghe.acme.test/api/v3",
					credential: { clientId: "ghe-client", clientSecret: "ghe-secret" },
				},
			},
			ORIGIN,
		);
		expect(new URL(authorizationUrl).origin).toBe("https://ghe.acme.test");
		await approve(ghe, authorizationUrl);
		expect(ghe.tokenCalls[0]?.body.get("client_secret")).toBe("ghe-secret");
		expect(dotcom.tokenCalls).toHaveLength(0);
		const { blob } = await rowOf("github-token");
		expect(blob).toMatchObject({
			tokenUrl: "https://ghe.acme.test/login/oauth/access_token",
			baseUrl: "https://ghe.acme.test/api/v3",
		});
	});
});

describe("Bitbucket", () => {
	it("signs in with HTTP Basic client authentication and clones as x-token-auth", async () => {
		const v = vendor("bitbucket.org", "/site/oauth2/access_token");
		vendors.push(v, vendor("api.bitbucket.org", "/none"));
		const { authorizationUrl } = await sources.oauthStart(
			{
				draft: {
					type: "bitbucket-token",
					url: "https://api.bitbucket.org/2.0",
					credential: { clientId: "bb-key", clientSecret: "bb-secret" },
				},
			},
			ORIGIN,
		);
		// Bitbucket ignores requested scopes, so none are sent.
		expect(new URL(authorizationUrl).searchParams.get("scope")).toBeNull();
		await approve(v, authorizationUrl);
		// RFC 6749 §2.3.1: each part form-encoded, then Basic.
		const basic = v.tokenCalls[0]?.authorization ?? "";
		expect(basic.startsWith("Basic ")).toBe(true);
		expect(
			Buffer.from(basic.slice(6), "base64")
				.toString()
				.split(":")
				.map(decodeURIComponent),
		).toEqual(["bb-key", "bb-secret"]);
		expect(v.tokenCalls[0]?.body.get("client_secret")).toBeNull();
		const { row } = await rowOf("bitbucket-token");
		expect(needsDisclosure(sourceType("bitbucket-token") ?? {}, null)).toBe(true);
		const clone = await readHostToken(row, credentials, integrations.authorizeHost);
		expect(clone).toMatchObject({ host: "bitbucket.org", username: "x-token-auth" });
	});

	it("client credentials are cached per connection and fetched once under the lock", async () => {
		const v = vendor("bitbucket.org", "/site/oauth2/access_token", { refresh: false });
		vendors.push(v, vendor("api.bitbucket.org", "/none"));
		const draft = {
			type: "bitbucket-token",
			url: "https://api.bitbucket.org/2.0",
			credential: {
				kind: "oauth-client",
				tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
				clientId: "bb-key",
				clientSecret: "bb-secret",
			},
		};
		const { connectionId } = await sources.connect(draft);
		const grants = () =>
			v.tokenCalls.filter((c) => c.body.get("grant_type") === "client_credentials");
		expect(grants()).toHaveLength(1);
		// The draft's probe and the saved connection are two cache keys; two concurrent retests share one fetch.
		await Promise.all([sources.retest(connectionId), sources.retest(connectionId)]);
		expect(grants()).toHaveLength(2);
		await sources.retest(connectionId);
		expect(grants()).toHaveLength(2);
		const row = await prisma.connection.findUniqueOrThrow({
			where: { id: connectionId },
			include: { integration: true },
		});
		const clone = await readHostToken(row, credentials, integrations.authorizeHost);
		expect(clone?.username).toBe("x-token-auth");
	});
});
