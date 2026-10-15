// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { generateKeyPairSync } from "node:crypto";
import { ARTIFACT_PURPOSES } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	RAW_SECRET_VALUES,
	SECRETS as FIXTURE_SECRETS,
	corpusFor,
} from "../__fixtures__/secret-corpus.js";
import { REDACT_CONFIG, type RedactConfig, redact, redactInProcess, redactText, redactUrl } from "./redact.js";
import { timestamped } from "../__fixtures__/secrets.js";

const PEM = generateKeyPairSync("rsa", { modulusLength: 1024 })
	.privateKey.export({ type: "pkcs8", format: "pem" })
	.toString();

const SECRETS = {
	awsId: "AKIA2E0A8F3B244C9986",
	awsSecret: "Zx9q2Lm4Rt7Vb1Nc8Kd3Hf6Jg0Ps5Wy2Ea7Ub4Io",
	github: ["ghp", "wWPw5k4aXcaT4fNP0UcnZwJUVFk6LO0pINUx"].join("_"),
	bearer: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJl",
	dbPassword: "hunter2",
	pgPassword: "x-pg-value",
	apiKey: "k3y-in-query",
};

const LOG = [
	`2026-10-15T10:00:00Z AWS_ACCESS_KEY_ID=${SECRETS.awsId}`,
	`2026-10-15T10:00:01Z aws_secret_access_key = ${SECRETS.awsSecret}`,
	`2026-10-15T10:00:02Z cloning with ${SECRETS.github}`,
	`2026-10-15T10:00:03Z Authorization: Bearer ${SECRETS.bearer}`,
	`2026-10-15T10:00:04Z DB_PASSWORD=${SECRETS.dbPassword}`,
	`2026-10-15T10:00:05Z config {"POSTGRES_PASSWORD": "${SECRETS.pgPassword}"}`,
	`2026-10-15T10:00:06Z GET /v1/orders?api_key=${SECRETS.apiKey}&page=2`,
	PEM,
	"-----BEGIN CERTIFICATE-----",
	"MIIBszCCAVmgAwIBAgIUQ",
	"-----END CERTIFICATE-----",
].join("\n");

const DEPLOYMENTS = {
	kind: "List",
	items: [
		{
			metadata: {
				name: "checkout",
				managedFields: [{ manager: "kubectl" }],
				annotations: {
					"kubectl.kubernetes.io/last-applied-configuration": '{"env":"SECRET"}',
					"deployment.kubernetes.io/revision": "7",
				},
			},
			spec: {
				template: {
					spec: {
						containers: [
							{
								name: "app",
								env: [
									{ name: "DATABASE_URL", value: "postgres://u:p@db/x" },
									{ name: "FROM_SECRET", valueFrom: { secretKeyRef: { name: "s", key: "k" } } },
								],
							},
						],
					},
				},
			},
		},
	],
};

describe("redact", () => {
	it("removes every secret in a log and keeps the certificate", async () => {
		const out = await redact("logs-previous", Buffer.from(LOG));
		if ("error" in out) throw new Error(out.error);
		const text = out.redacted.toString("utf8");
		for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
		expect(text).not.toContain(PEM.split("\n")[1]);
		expect(text).toContain("BEGIN CERTIFICATE");
		expect(text).toContain("DB_PASSWORD=[REDACTED:pattern]");
		expect(out.counts.pattern).toBeGreaterThan(0);
	});

	it("removes the full secret corpus in __fixtures__/secret-corpus.ts across every purpose", async () => {
		for (const purpose of ARTIFACT_PURPOSES) {
			const out = await redactInProcess(purpose, corpusFor(purpose));
			if ("error" in out) throw new Error(out.error);
			const text = out.redacted.toString("utf8");
			for (const secret of RAW_SECRET_VALUES) expect(text).not.toContain(secret);
		}
	});

	it("blanks env values, keeps names and valueFrom, drops managedFields and last-applied", async () => {
		const out = await redactInProcess("deployments", Buffer.from(JSON.stringify(DEPLOYMENTS)));
		if ("error" in out) throw new Error(out.error);
		const doc = JSON.parse(out.redacted.toString("utf8"));
		const item = doc.items[0];
		expect(item.metadata.managedFields).toBeUndefined();
		expect(item.metadata.annotations).toEqual({ "deployment.kubernetes.io/revision": "7" });
		expect(item.spec.template.spec.containers[0].env).toEqual([
			{ name: "DATABASE_URL", value: "[REDACTED:env]" },
			{ name: "FROM_SECRET", valueFrom: { secretKeyRef: { name: "s", key: "k" } } },
		]);
		expect(out.counts).toMatchObject({ env: 1, "last-applied-configuration": 1 });
	});

	it("fails closed when a rule throws or the workload JSON does not parse", async () => {
		const throwing: RedactConfig = {
			rules: [
				...REDACT_CONFIG.rules,
				{
					id: "boom",
					rule: {
						messages: {},
						meta: { id: "boom", recommended: false, type: "scanner", supportedContentTypes: ["text"] },
						create: () => ({
							file() {
								throw new Error("rule exploded");
							},
						}),
					},
				},
			],
		};
		expect(await redactInProcess("events", Buffer.from("{}"), throwing)).toEqual({ error: "text pass failed (Error)" });
		expect(await redactInProcess("pods", Buffer.from('{"items": ['))).toEqual({
			error: expect.stringContaining("structural pass"),
		});
		expect(await redactText("x", throwing)).toEqual({ error: "text pass failed (Error)" });
	});

	it("redacts a stderr tail as text", async () => {
		const out = await redactText(`error: token=${SECRETS.apiKey}`);
		expect(out).toEqual({ text: "error: token=[REDACTED:pattern]", counts: { pattern: 1 } });
	});

	it("redacts a stderr tail with secrets, handling empty tails and errors", async () => {
		const tail = `error: ${"x".repeat(1000)} token=${FIXTURE_SECRETS.apiKey} github=${FIXTURE_SECRETS.github}`;
		const out = await redactText(tail);
		if ("error" in out) throw new Error(out.error);
		expect(out.text).not.toContain(FIXTURE_SECRETS.apiKey);
		expect(out.text).not.toContain(FIXTURE_SECRETS.github);
		expect(out.text).toContain("[REDACTED:pattern]");
		expect(out.text).toContain("[REDACTED:github]");
		expect(await redactText("")).toEqual({ text: "", counts: {} });
	});

	it("redacts 8 MiB of synthetic log in under 10 seconds", async () => {
		const line = "2026-10-15T10:00:00.000Z [info] request handled method=GET path=/api/orders status=200 duration=15ms\n";
		const count = Math.ceil((8 * 1024 * 1024) / line.length);
		const buf = Buffer.from(line.repeat(count).slice(0, 8 * 1024 * 1024));
		const start = Date.now();
		const out = await redact("logs-previous", buf);
		const durationMs = Date.now() - start;
		if ("error" in out) throw new Error(out.error);
		expect(out.redacted.length).toBe(buf.length);
		expect(durationMs).toBeLessThan(10_000);
	});

	it("redacts a secret straddling a 64 KiB window boundary", async () => {
		const secretKey = "DB_PASSWORD=";
		const secretVal = "hunter2";
		const fullSecret = secretKey + secretVal;
		const boundary = 64 * 1024;
		const paddingBefore = "a".repeat(boundary - secretKey.length);
		const paddingAfter = "b".repeat(1024);
		const text = paddingBefore + fullSecret + paddingAfter;
		const out = await redactInProcess("logs-previous", Buffer.from(text));
		if ("error" in out) throw new Error(out.error);
		const redacted = out.redacted.toString("utf8");
		expect(redacted).not.toContain(secretVal);
		expect(redacted).toContain("[REDACTED:pattern]");
		expect(out.counts.pattern).toBeGreaterThanOrEqual(1);
	});

	it("handles empty buffers and overlapping patterns cleanly", async () => {
		expect(await redactInProcess("events", Buffer.alloc(0))).toEqual({ redacted: Buffer.alloc(0), counts: {} });
		const overlapping = await redactText(`Authorization: Bearer ${["xoxb", "123456789012-1234567890123-456789abcdef456789abcdef"].join("-")}`);
		if ("error" in overlapping) throw new Error(overlapping.error);
		expect(overlapping.text).toContain("[REDACTED:");

		const nonObj = await redactInProcess("pods", Buffer.from(JSON.stringify({ kind: "Pod", metadata: null, spec: null })));
		if ("error" in nonObj) throw new Error(nonObj.error);
	});
});

describe("redaction holds against captured text (#842)", () => {
	const SECRET = "SYNTHETIC_SECRET_7zQ9";
	const leaked = (text: string, values: readonly string[]) => values.filter((v) => text.includes(v));

	it("OBJ-001: a disable directive inside captured text does not switch redaction off", async () => {
		for (const log of [
			"2026-10-15T10:00:00Z // secretlint-disable\n2026-10-15T10:00:01Z DB_PASSWORD=hunter2",
			"2026-10-15T10:00:00Z # secretlint-disable-next-line\n2026-10-15T10:00:01Z DB_PASSWORD=hunter2",
			"2026-10-15T10:00:01Z DB_PASSWORD=hunter2 // secretlint-disable-line",
			`2026-10-15T10:00:00Z /* secretlint-disable @secretlint/secretlint-rule-pattern */ token=hunter2 ${FIXTURE_SECRETS.github}`,
		]) {
			const out = await redactInProcess("logs-previous", Buffer.from(log));
			if ("error" in out) throw new Error(out.error);
			expect(leaked(out.redacted.toString("utf8"), ["hunter2", FIXTURE_SECRETS.github])).toEqual([]);
		}
	});

	it("OBJ-002: removes every component of secrets in a pod's command, args and exec probes", async () => {
		const pods = {
			items: [
				{
					metadata: { name: "checkout-7d9f" },
					spec: {
						initContainers: [{ name: "migrate", args: ["db", "postgres://app:Ur1Cred3ntial@db:5432/shop"] }],
						containers: [
							{
								name: "app",
								image: "shop/checkout:1.4.2",
								command: ["sh", "-c", "exec app --password 'Qsp4ceAlpha Qsp4ceBravo'"],
								args: ["--password", SECRET, "--db-pass=plainEq9"],
								livenessProbe: { exec: { command: ["mysql", "-phunter2", "-e", "select 1"] } },
							},
						],
					},
				},
			],
		};
		const out = await redactInProcess("pods", Buffer.from(JSON.stringify(pods)));
		if ("error" in out) throw new Error(out.error);
		const text = out.redacted.toString("utf8");
		expect(leaked(text, [SECRET, "Qsp4ceAlpha", "Qsp4ceBravo", "Ur1Cred3ntial", "plainEq9", "hunter2"])).toEqual([]);
		const container = JSON.parse(text).items[0].spec.containers[0];
		expect(container).toMatchObject({ name: "app", image: "shop/checkout:1.4.2" });
		expect(out.counts.argv).toBeGreaterThan(0);
	});

	it("OBJ-002: removes split flags, quoted values with spaces and URL credentials from text", async () => {
		const log = [
			`2026-10-15T10:00:00Z exec app --password ${SECRET}`,
			`2026-10-15T10:00:01Z exec app --password="Qsp4ceAlpha Qsp4ceBravo"`,
			`2026-10-15T10:00:02Z exec app --api-token 'Qsp4ceCharlie Qsp4ceDelta'`,
			`2026-10-15T10:00:03Z DB_PASSWORD="Qsp4ceEcho Qsp4ceFoxtrot"`,
			`2026-10-15T10:00:04Z dialing redis://:R3disPositional@cache:6379/0 and amqp://app:Amqp.p4ss@mq/`,
		].join("\n");
		const out = await redactInProcess("logs-previous", Buffer.from(log));
		if ("error" in out) throw new Error(out.error);
		expect(
			leaked(out.redacted.toString("utf8"), [
				SECRET,
				"Qsp4ceAlpha",
				"Qsp4ceBravo",
				"Qsp4ceCharlie",
				"Qsp4ceDelta",
				"Qsp4ceEcho",
				"Qsp4ceFoxtrot",
				"R3disPositional",
				"Amqp.p4ss",
			]),
		).toEqual([]);
		expect(out.redacted.toString("utf8")).toContain("exec app --password");
	});

	it("OBJ-002: removes a split flag written as a JSON array in an artifact with no structural pass", async () => {
		const events = { items: [{ message: `Error: exec ["app","--password","${SECRET}","--token", "Qsp4ceAlpha Qsp4ceBravo"]` }] };
		const escaped = { items: [{ message: 'run --password="Qsp4ceCharlie Qsp4ceDelta"' }] };
		const rawArray = { items: [{ args: ["--password", "Qsp4ceEcho Qsp4ceFoxtrot"] }] };
		for (const doc of [events, escaped, rawArray]) {
			for (const indent of [undefined, 4]) {
				const out = await redactInProcess("events", Buffer.from(JSON.stringify(doc, null, indent)));
				if ("error" in out) throw new Error(out.error);
				const text = out.redacted.toString("utf8");
				expect(
					leaked(text, [SECRET, "Qsp4ceAlpha", "Qsp4ceBravo", "Qsp4ceCharlie", "Qsp4ceDelta", "Qsp4ceEcho", "Qsp4ceFoxtrot"]),
				).toEqual([]);
				expect(() => JSON.parse(text)).not.toThrow();
			}
		}
	});

	it("keeps redacted JSON parseable when a key=value or flag ends a string", async () => {
		const doc = { items: [{ note: "DB_PASSWORD=", flag: "--token", next: "keep me", list: ["--secret", "", "tail"] }] };
		for (const indent of [undefined, 4]) {
			const out = await redactInProcess("events", Buffer.from(JSON.stringify(doc, null, indent)));
			if ("error" in out) throw new Error(out.error);
			expect(JSON.parse(out.redacted.toString("utf8"))).toMatchObject({ items: [{ next: "keep me" }] });
		}
	});

	it("OBJ-003: a redaction failure never echoes the input it failed on", async () => {
		const malformed = await redactInProcess("pods", Buffer.from('{"items": [hunter2'));
		expect(malformed).toEqual({ error: expect.any(String) });
		expect(JSON.stringify(malformed)).not.toContain("hunter2");

		const quoting: RedactConfig = {
			rules: [
				{
					id: "quoting",
					rule: {
						messages: {},
						meta: { id: "quoting", recommended: false, type: "scanner", supportedContentTypes: ["text"] },
						create: () => ({
							file(source) {
								throw new Error(`cannot scan ${source.content}`);
							},
						}),
					},
				},
			],
		};
		for (const out of [await redactInProcess("events", Buffer.from("token hunter2"), quoting), await redactText("token hunter2", quoting)]) {
			expect(out).toEqual({ error: expect.any(String) });
			expect(JSON.stringify(out)).not.toContain("hunter2");
		}
	});
});

describe("round 2 (#842)", () => {
	const leaked = (text: string, values: readonly string[]) => values.filter((v) => text.includes(v));

	it("OBJ-011: removes colon, YAML and mysql -p forms, multiline and truncated, from logs and event JSON", async () => {
		const values = [
			"C0lonPassw0rd",
			"PassW0rdTwo",
			"PwdC0lonValue",
			"ApiKeySp4ced",
			"Tok3nAlpha",
			"Tok3nBravo",
			"Yam1BlockValue",
			"NextL1neValue",
			"MysqlSp4ced",
			"MysqlAtt4ched",
			"Multil1neSecret",
			"EndTrunc4ted",
			"SecretKeyValue",
		];
		const log = [
			"2026-10-15T10:00:00Z auth failed, password: C0lonPassw0rd",
			"2026-10-15T10:00:00Z Password:PassW0rdTwo",
			"2026-10-15T10:00:01Z pwd: PwdC0lonValue api key: ApiKeySp4ced",
			"2026-10-15T10:00:02Z token: Tok3nAlpha Tok3nBravo",
			"db:",
			"  password: |",
			"    Yam1BlockValue",
			"  secret:",
			"    NextL1neValue",
			"2026-10-15T10:00:03Z mysql -u root -p MysqlSp4ced -e 'select 1'",
			"2026-10-15T10:00:03Z mysql -u root -pMysqlAtt4ched shop",
			"secret key: SecretKeyValue",
			'2026-10-15T10:00:04Z retrying with password: "EndTrunc4ted',
		].join("\n");
		const logs = await redactInProcess("logs-previous", Buffer.from(log));
		if ("error" in logs) throw new Error(logs.error);
		expect(leaked(logs.redacted.toString("utf8"), values)).toEqual([]);

		const events = {
			items: [
				{ type: "Warning", reason: "FailedAuth", message: `auth failed, password: C0lonPassw0rd\nsecret: Multil1neSecret` },
				{ type: "Warning", reason: "Exec", message: log },
				{ type: "Normal", reason: "Counted", count: 3, passed: true, tokenCount: 7, note: "keep me" },
			],
		};
		for (const indent of [undefined, 4]) {
			const out = await redactInProcess("events", Buffer.from(JSON.stringify(events, null, indent)));
			if ("error" in out) throw new Error(out.error);
			const text = out.redacted.toString("utf8");
			expect(leaked(text, values)).toEqual([]);
			expect(JSON.parse(text)).toMatchObject({ items: [{}, {}, { note: "keep me" }] });
		}
	});

	const dense = (bytes: number) => Buffer.from("token=a ".repeat(Math.ceil(bytes / 8)).slice(0, bytes));

	it("OBJ-012: dense input never holds the event loop for more than 100 ms", async () => {
		// Async rules run as microtasks, so the gap is read once more after the call returns.
		let last = performance.now();
		let maxGap = 0;
		const sample = setInterval(() => {
			const now = performance.now();
			maxGap = Math.max(maxGap, now - last);
			last = now;
		}, 5);
		const out = await redact("events", dense(256 * 1024));
		maxGap = Math.max(maxGap, performance.now() - last);
		clearInterval(sample);
		if ("error" in out) throw new Error(out.error);
		expect(out.redacted.toString("utf8")).not.toContain("token=a ");
		expect(maxGap).toBeLessThan(100);
	}, 60_000);

	it("OBJ-012: a redaction past its deadline fails closed with the reason recorded", async () => {
		const started = Date.now();
		const out = await redact("logs-previous", dense(1024 * 1024), { deadlineMs: 200 });
		expect(out).toEqual({ error: "redaction deadline exceeded (200 ms)" });
		expect(Date.now() - started).toBeLessThan(2_000);
	}, 60_000);
});

describe("round 3 (#842)", () => {
	const body = PEM.split("\n").filter((l) => l !== "" && !l.startsWith("-----"));
	const leaked = (text: string, values: readonly string[]) => values.filter((v) => text.includes(v));
	const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z /;

	it("OBJ-014: a timestamped PEM body, whole, without its END, or without its BEGIN, loses every body line", async () => {
		const lines = PEM.trimEnd().split("\n");
		for (const pem of [lines, lines.slice(0, -2).concat(lines.at(-2)?.slice(0, 20) ?? ""), lines.slice(3)]) {
			const log = timestamped(["starting vault-client", ...pem, "listening on :8080"].join("\n"));
			const out = await redactInProcess("logs-previous", Buffer.from(log));
			if ("error" in out) throw new Error(out.error);
			const text = out.redacted.toString("utf8");
			expect(leaked(text, body.map((l) => l.slice(0, 16)))).toEqual([]);
			// The timestamps stay, one per line, and the lines around the key are kept.
			expect(text.split("\n").every((l) => TS.test(l))).toBe(true);
			expect(text).toContain("listening on :8080");
		}
	});

	it("OBJ-014: a timestamped YAML block or next-line value is removed", async () => {
		const log = timestamped(["db:", "  password: |", "    Yam1BlockValue", "  secret:", "    NextL1neValue", "done"].join("\n"));
		const out = await redactInProcess("logs-previous", Buffer.from(log));
		if ("error" in out) throw new Error(out.error);
		expect(leaked(out.redacted.toString("utf8"), ["Yam1BlockValue", "NextL1neValue"])).toEqual([]);
	});

	it("OBJ-016: removes generic key names, Basic auth, cookies and bare JWTs, raw and encoded", async () => {
		const basic = Buffer.from("svc:BasicPassw0rd").toString("base64");
		const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1bm5hbWVkIn0.c2lnbmF0dXJlLWJhcmU";
		const values = ["EncKeyV4lue9", "SignKeyV4lue9", "DbCredV4lue9", "AuthV4lue9", "SessV4lue9", "C00kieSess1on", "SetC00kieSid", basic, jwt];
		const log = timestamped(
			[
				"ENCRYPTION_KEY=EncKeyV4lue9 SIGNING_KEY=SignKeyV4lue9",
				"DB_CREDENTIALS=DbCredV4lue9 AUTH=AuthV4lue9 session_id=SessV4lue9",
				`GET /orders Authorization: Basic ${basic}`,
				"Cookie: session=C00kieSess1on; theme=dark",
				"Set-Cookie: sid=SetC00kieSid; Path=/; HttpOnly",
				`issued ${jwt} to checkout`,
			].join("\n"),
		);
		const encoded = (v: string) => [v, Buffer.from(v).toString("base64"), encodeURIComponent(v)];
		const out = await redactInProcess("logs-previous", Buffer.from(log));
		if ("error" in out) throw new Error(out.error);
		expect(leaked(out.redacted.toString("utf8"), values.flatMap(encoded))).toEqual([]);

		const events = { items: [{ type: "Warning", message: log }, { headers: { cookie: "sid=SetC00kieSid", "x-auth": "AuthV4lue9" }, note: "keep me" }] };
		const json = await redactInProcess("events", Buffer.from(JSON.stringify(events, null, 4)));
		if ("error" in json) throw new Error(json.error);
		expect(leaked(json.redacted.toString("utf8"), values.flatMap(encoded))).toEqual([]);
		expect(JSON.parse(json.redacted.toString("utf8"))).toMatchObject({ items: [{}, { note: "keep me" }] });
	});

	it("redactUrl drops userinfo, query and fragment, and fails closed on what it cannot parse", () => {
		expect(redactUrl("https://127.0.0.1:6443")).toBe("https://127.0.0.1:6443");
		expect(redactUrl("https://admin:hunter2@k8s.example:6443/x?token=abc#frag")).toBe("https://k8s.example:6443/x");
		expect(redactUrl("not a url hunter2")).toBe("[REDACTED:url]");
	});
});

describe("reference key names (#842)", () => {
	const podSpec = {
		nodeSelector: { "payments.example.com/tier": "gold" },
		tolerations: [{ key: "dedicated-secret-nodes", operator: "Equal", value: "payments", effect: "NoSchedule" }],
		affinity: {
			nodeAffinity: {
				requiredDuringSchedulingIgnoredDuringExecution: {
					nodeSelectorTerms: [{ matchExpressions: [{ key: "topology.kubernetes.io/zone", operator: "In", values: ["a"] }] }],
				},
			},
		},
		topologySpreadConstraints: [{ topologyKey: "kubernetes.io/hostname", maxSkew: 1 }],
		volumes: [{ name: "creds", secret: { secretName: "payments-db", items: [{ key: "tls.key", path: "tls.key" }] } }],
		containers: [
			{
				name: "app",
				env: [
					{ name: "DB_PASSWORD", valueFrom: { secretKeyRef: { name: "payments-db", key: "DB_PASSWORD" } } },
					{ name: "UPSTREAM_URL", valueFrom: { configMapKeyRef: { name: "upstream", key: "UPSTREAM_URL" } } },
					{ name: "API_KEY", value: "Lit3ralApiKey" },
				],
				envFrom: [{ secretRef: { name: "payments-db" } }, { configMapRef: { name: "upstream" } }],
			},
		],
	};
	const deployment = {
		kind: "Deployment",
		metadata: {
			name: "payments",
			labels: { "app.kubernetes.io/part-of": "payments" },
			annotations: { "example.com/session-note": "token=Ann0tSecret" },
		},
		spec: { selector: { matchLabels: { "app.kubernetes.io/part-of": "payments" } }, template: { metadata: { labels: { "app.kubernetes.io/part-of": "payments" } }, spec: podSpec } },
	};

	it("keeps the key names a workload reads and still redacts every value", async () => {
		for (const [purpose, doc] of [
			["deployments", { kind: "List", items: [deployment] }],
			["pods", { kind: "List", items: [{ kind: "Pod", metadata: deployment.metadata, spec: podSpec }] }],
		] as const) {
			const out = await redactInProcess(purpose, Buffer.from(JSON.stringify(doc)));
			if ("error" in out) throw new Error(out.error);
			const text = out.redacted.toString("utf8");
			const item = JSON.parse(text).items[0];
			const spec = purpose === "deployments" ? item.spec.template.spec : item.spec;
			expect(spec.containers[0].env.slice(0, 2)).toEqual(podSpec.containers[0].env.slice(0, 2));
			expect(spec.containers[0].envFrom).toEqual(podSpec.containers[0].envFrom);
			expect(spec.tolerations).toEqual(podSpec.tolerations);
			expect(spec.nodeSelector).toEqual(podSpec.nodeSelector);
			expect(spec.affinity).toEqual(podSpec.affinity);
			expect(spec.topologySpreadConstraints).toEqual(podSpec.topologySpreadConstraints);
			expect(spec.volumes).toEqual(podSpec.volumes);
			expect(item.metadata.labels).toEqual({ "app.kubernetes.io/part-of": "payments" });
			if (purpose === "deployments") expect(item.spec.selector.matchLabels).toEqual({ "app.kubernetes.io/part-of": "payments" });
			// Values are still values.
			expect(text).not.toContain("Lit3ralApiKey");
			expect(text).not.toContain("Ann0tSecret");
		}
	});

	it("does not keep a reference field whose value has a secret's shape", async () => {
		const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1bm5hbWVkIn0.c2lnbmF0dXJlLWJhcmU";
		const doc = { kind: "Pod", spec: { tolerations: [{ key: jwt }, { key: "token=Inl1neValue" }], nodeSelector: { "secret-tier": "a b=Spac3dValue" } } };
		const out = await redactInProcess("pods", Buffer.from(JSON.stringify(doc)));
		if ("error" in out) throw new Error(out.error);
		const text = out.redacted.toString("utf8");
		for (const v of [jwt, "Inl1neValue", "Spac3dValue"]) expect(text).not.toContain(v);
	});
});

describe("round 4 (#842)", () => {
	const leaked = (text: string, values: readonly string[]) => values.filter((v) => text.includes(v));

	it("OBJ-017: only reference fields under their own parents keep their value, and a secret-shaped one never does", async () => {
		const jwt = "x.eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1bm5hbWVkIn0.c2lnbmF0dXJlLWJhcmU";
		const pod = {
			kind: "Pod",
			metadata: {
				name: "checkout",
				labels: { "api-token": "abc123def456ghi", app: "checkout" },
				annotations: { key: "S3cr3tValue123", secretName: "Ann0tS3cretName", "session-token": "3f9a8b7c6d5e4f3a2b1c" },
			},
			spec: {
				tolerations: [{ key: jwt }, { key: "MixedCase16Chars9xQ" }, { key: "dedicated" }],
				nodeSelector: { "secret-tier": "Zq8Wv7Ut6Sr5Qp4On" },
				containers: [{ name: "app", env: [{ name: "X", valueFrom: { secretKeyRef: { name: "payments-db", key: "DB_PASSWORD" } } }] }],
			},
		};
		const out = await redactInProcess("pods", Buffer.from(JSON.stringify(pod)));
		if ("error" in out) throw new Error(out.error);
		const text = out.redacted.toString("utf8");
		expect(
			leaked(text, ["S3cr3tValue123", "abc123def456ghi", "Ann0tS3cretName", "3f9a8b7c6d5e4f3a2b1c", "eyJhbGciOiJSUzI1NiJ9", "MixedCase16Chars9xQ", "Zq8Wv7Ut6Sr5Qp4On"]),
		).toEqual([]);
		const item = JSON.parse(text);
		expect(item.metadata.labels.app).toBe("checkout");
		expect(item.spec.tolerations[2]).toEqual({ key: "dedicated" });
		expect(item.spec.containers[0].env[0].valueFrom.secretKeyRef).toEqual({ name: "payments-db", key: "DB_PASSWORD" });
	});

	it("OBJ-019: a timestamped multi-line YAML block loses every line until the indent returns", async () => {
		const log = timestamped(["config:", "  password: |", "    BlockL1neOne", "    BlockL1neTwo", "    BlockL1neThree", "  user: app", "secret: >-", "  Fold3dOne", "  Fold3dTwo", "done"].join("\n"));
		const out = await redactInProcess("logs-previous", Buffer.from(log));
		if ("error" in out) throw new Error(out.error);
		const text = out.redacted.toString("utf8");
		expect(leaked(text, ["BlockL1neOne", "BlockL1neTwo", "BlockL1neThree", "Fold3dOne", "Fold3dTwo"])).toEqual([]);
		expect(text).toContain("  user: app");
		expect(text).toContain(" done");
	});

	it("OBJ-019: a timestamped OpenSSH key body wrapped at 70 with its BEGIN cut loses every body line", async () => {
		const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
		const bodyLine = (i: number) => Array.from({ length: 70 }, (_, j) => alphabet[(i * 7 + j * 13) % 64]).join("");
		const body = [...Array.from({ length: 6 }, (_, i) => bodyLine(i)), "AAAAAAAAAAECAwQF"];
		const key = ["-----BEGIN OPENSSH PRIVATE KEY-----", ...body, "-----END OPENSSH PRIVATE KEY-----"];
		for (const lines of [key.slice(2), key.slice(2, -1)]) {
			const out = await redactInProcess("logs-previous", Buffer.from(timestamped(["boot", ...lines, "ready"].join("\n"))));
			if ("error" in out) throw new Error(out.error);
			const text = out.redacted.toString("utf8");
			expect(leaked(text, body.slice(1, -1))).toEqual([]);
			expect(text).toContain(" ready");
		}
	});
});

describe("round 5 (#842)", () => {
	const leaked = (text: string, values: readonly string[]) => values.filter((v) => text.includes(v));
	const run = async (purpose: (typeof ARTIFACT_PURPOSES)[number], text: string) => {
		const out = await redactInProcess(purpose, Buffer.from(text));
		if ("error" in out) throw new Error(out.error);
		return out.redacted.toString("utf8");
	};

	it("OBJ-017: a label whose key reads as secret, or whose value is a generated token, never keeps its value", async () => {
		const values = ["SYNTHETIC_SECRET_7zQ9", "R3alPassw0rd", "abc123-def456-ghi789"];
		const labelled = Object.fromEntries(values.map((v, i) => [`api-token-${i}`, v]));
		const metaOf = (labels: Record<string, string>) => ({ name: "checkout", labels });
		const podSpec = { nodeSelector: { "node-auth": values[0], "Session-Pool": values[1], "x.io/secret-tier": values[2] } };
		const pod = { kind: "Pod", metadata: metaOf(labelled), spec: podSpec };
		const deployment = {
			kind: "Deployment",
			metadata: metaOf(labelled),
			spec: { selector: { matchLabels: labelled }, template: { metadata: metaOf(labelled), spec: podSpec } },
		};
		for (const [purpose, doc] of [
			["pods", { kind: "List", items: [pod] }],
			["deployments", { kind: "List", items: [deployment] }],
			["replicasets", { kind: "List", items: [deployment] }],
		] as const) {
			expect(leaked(await run(purpose, JSON.stringify(doc)), values)).toEqual([]);
		}
	});

	it("OBJ-017: a mixed letter and digit run of 8 or more is redacted from any label, structural hashes stay", async () => {
		const pod = {
			kind: "Pod",
			metadata: {
				name: "checkout",
				labels: {
					app: "checkout",
					tier: "frontend",
					release: "20261014",
					build: "R3alPassw0rd",
					"pod-template-hash": "5d8f7b9c4",
					"controller-revision-hash": "6b9d8c7f5d",
				},
			},
			spec: { nodeSelector: { pool: "Zq8Wv7Ut6Sr5Qp4On", zone: "eu-west-1a" } },
		};
		const item = JSON.parse(await run("pods", JSON.stringify(pod)));
		expect(item.metadata.labels).toMatchObject({
			app: "checkout",
			tier: "frontend",
			release: "20261014",
			"pod-template-hash": "5d8f7b9c4",
			"controller-revision-hash": "6b9d8c7f5d",
		});
		expect(JSON.stringify(item)).not.toMatch(/R3alPassw0rd|Zq8Wv7Ut6Sr5Qp4On/);
		expect(item.spec.nodeSelector.zone).toBe("eu-west-1a");
	});

	it("OBJ-017: a non-label structural hash value is not exempt, only by its own key", async () => {
		const pod = { kind: "Pod", metadata: { name: "x", labels: { build: "5d8f7b9c4", "pod-template-hash": "R3alPassw0rd" } } };
		const text = await run("pods", JSON.stringify(pod));
		expect(text).not.toContain("5d8f7b9c4");
		expect(text).not.toContain("R3alPassw0rd");
	});

	const BLOCK = ["password: |", "  CanaryLine1", "  CanaryLine2", "  CanaryLine3"];
	const eventsOf = (message: string) => JSON.stringify({ items: [{ type: "Warning", reason: "FailedMount", message, count: 3 }] }, null, 4);

	it("OBJ-019: a YAML block inside a JSON string, with escaped newlines, loses every line", async () => {
		const canaries = ["CanaryLine1", "CanaryLine2", "CanaryLine3"];
		const messages = [
			BLOCK.join("\n"),
			`mount failed\n${BLOCK.join("\n")}\nretrying`,
			`mount failed\r\n${BLOCK.join("\r\n")}\r\nretrying`,
			["config:", "  secret: >-", "    CanaryLine1", "    CanaryLine2", "    CanaryLine3", "  user: app"].join("\n"),
			["password: |", "  CanaryLine1", "", "  CanaryLine2", "   ", "  CanaryLine3", "tail"].join("\n"),
			`Error: ${BLOCK.join("\n")}`,
		];
		for (const message of messages) {
			const text = await run("events", eventsOf(message));
			expect(leaked(text, canaries)).toEqual([]);
			const event = JSON.parse(text).items[0];
			expect(event).toMatchObject({ type: "Warning", reason: "FailedMount", count: 3 });
		}
		const text = await run("events", eventsOf(["config:", "  password: |", "    CanaryLine1", "  user: app", "done"].join("\n")));
		expect(JSON.parse(text).items[0].message).toContain("  user: app\ndone");
	});

	it("OBJ-019: a timestamped block keeps going over empty, whitespace-only and timestamp-only lines", async () => {
		const canaries = ["FirstSecretLine", "MiddleSecretLine", "LastSecretLine"];
		for (const gap of [[""], ["   "], ["", ""], ["", "\t", ""]]) {
			const lines = ["config:", "  password: |", "    FirstSecretLine", ...gap, "    MiddleSecretLine", ...gap, "    LastSecretLine", "  user: app", "done"];
			const text = await run("logs-previous", timestamped(lines.join("\n")));
			expect(leaked(text, canaries)).toEqual([]);
			expect(text).toContain(" user: app");
			expect(text).toContain(" done");
		}
	});

	it("OBJ-019: an untimestamped block with blank lines loses every line until the indent returns", async () => {
		const text = await run("logs-previous", ["password: |", "  FirstSecretLine", "", "  LastSecretLine", "user: app"].join("\n"));
		expect(leaked(text, ["FirstSecretLine", "LastSecretLine"])).toEqual([]);
		expect(text).toContain("user: app");
	});
});
