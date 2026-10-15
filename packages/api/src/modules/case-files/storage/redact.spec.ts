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
import { REDACT_CONFIG, type RedactConfig, redact, redactText } from "./redact.js";

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
			const out = await redact(purpose, corpusFor(purpose));
			if ("error" in out) throw new Error(out.error);
			const text = out.redacted.toString("utf8");
			for (const secret of RAW_SECRET_VALUES) expect(text).not.toContain(secret);
		}
	});

	it("blanks env values, keeps names and valueFrom, drops managedFields and last-applied", async () => {
		const out = await redact("deployments", Buffer.from(JSON.stringify(DEPLOYMENTS)));
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
		expect(await redact("events", Buffer.from("{}"), throwing)).toEqual({ error: "text pass failed (Error)" });
		expect(await redact("pods", Buffer.from('{"items": ['))).toEqual({
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
		const out = await redact("logs-previous", Buffer.from(text));
		if ("error" in out) throw new Error(out.error);
		const redacted = out.redacted.toString("utf8");
		expect(redacted).not.toContain(secretVal);
		expect(redacted).toContain("[REDACTED:pattern]");
		expect(out.counts.pattern).toBeGreaterThanOrEqual(1);
	});

	it("handles empty buffers and overlapping patterns cleanly", async () => {
		expect(await redact("events", Buffer.alloc(0))).toEqual({ redacted: Buffer.alloc(0), counts: {} });
		const overlapping = await redactText(`Authorization: Bearer ${["xoxb", "123456789012-1234567890123-456789abcdef456789abcdef"].join("-")}`);
		if ("error" in overlapping) throw new Error(overlapping.error);
		expect(overlapping.text).toContain("[REDACTED:");

		const nonObj = await redact("pods", Buffer.from(JSON.stringify({ kind: "Pod", metadata: null, spec: null })));
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
			const out = await redact("logs-previous", Buffer.from(log));
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
		const out = await redact("pods", Buffer.from(JSON.stringify(pods)));
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
		const out = await redact("logs-previous", Buffer.from(log));
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
				const out = await redact("events", Buffer.from(JSON.stringify(doc, null, indent)));
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
			const out = await redact("events", Buffer.from(JSON.stringify(doc, null, indent)));
			if ("error" in out) throw new Error(out.error);
			expect(JSON.parse(out.redacted.toString("utf8"))).toMatchObject({ items: [{ next: "keep me" }] });
		}
	});

	it("OBJ-003: a redaction failure never echoes the input it failed on", async () => {
		const malformed = await redact("pods", Buffer.from('{"items": [hunter2'));
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
		for (const out of [await redact("events", Buffer.from("token hunter2"), quoting), await redactText("token hunter2", quoting)]) {
			expect(out).toEqual({ error: expect.any(String) });
			expect(JSON.stringify(out)).not.toContain("hunter2");
		}
	});
});
