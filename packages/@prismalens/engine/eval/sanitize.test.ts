// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Tests for the capture sanitizer (#262). Covers all four redaction classes,
 * the GPG_KEY allowlist, round-trip JSON structure preservation, and the
 * no-op-on-clean-captures invariant (existing committed captures in
 * `eval/captures/` must pass through the sanitizer unchanged).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeCapture } from "./sanitize.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a value in a minimal valid JSON capture shape for round-trip tests. */
function captureJson(fields: Record<string, unknown>): string {
	return JSON.stringify(
		{
			scenario: "test",
			model: "test-model",
			incident: { alerts: [], telemetry: {} },
			raw: { ok: true, arm: "raw", events: [], ...fields },
			prismalens: { ok: true, arm: "prismalens", events: [] },
			capturedAt: "2026-07-31T00:00:00.000Z",
		},
		null,
		2,
	);
}

// ---------------------------------------------------------------------------
// Rule 1: Env-style credentials
// ---------------------------------------------------------------------------

describe("sanitizeCapture — env-style credentials", () => {
	it("redacts POSTGRES_PASSWORD in env-dump output", () => {
		const input = captureJson({
			rawText:
				"HOSTNAME=abc123\nPOSTGRES_PASSWORD=supersecret123\nLANG=C.UTF-8",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("POSTGRES_PASSWORD=[REDACTED]");
		expect(result).not.toContain("supersecret123");
	});

	it("redacts AUTH_SECRET_KEY=value", () => {
		const input = captureJson({
			rawText: "AUTH_SECRET_KEY=my-jwt-secret-value\nOTHER=safe",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("AUTH_SECRET_KEY=[REDACTED]");
		expect(result).not.toContain("my-jwt-secret-value");
	});

	it("redacts GOOGLE_CLIENT_SECRET in docker-inspect style", () => {
		const input = captureJson({
			rawText:
				'"GOOGLE_CLIENT_SECRET=xyzzy-secret-client"\n"HOME=/root"',
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("GOOGLE_CLIENT_SECRET=[REDACTED]");
		expect(result).not.toContain("xyzzy-secret-client");
	});

	it("redacts MAIL_PASSWORD", () => {
		const input = captureJson({
			rawText: "MAIL_PASSWORD=hunter2\nMAIL_SERVER=smtp.example.com",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("MAIL_PASSWORD=[REDACTED]");
		expect(result).not.toContain("hunter2");
	});

	it("redacts API_TOKEN", () => {
		const input = captureJson({
			rawText: "API_TOKEN=tok_1234567890abcdef\nDEBUG=0",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("API_TOKEN=[REDACTED]");
		expect(result).not.toContain("tok_1234567890abcdef");
	});

	it("does NOT redact GPG_KEY — allowlisted (docker-image public fingerprint)", () => {
		const input = captureJson({
			rawText:
				"GPG_KEY=7169605F62C751356D054A26A821E680E5FA6305\nPYTHON_VERSION=3.12.13",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain(
			"GPG_KEY=7169605F62C751356D054A26A821E680E5FA6305",
		);
	});

	it("does NOT redact PYTHON_SHA256 — allowlisted", () => {
		const input = captureJson({
			rawText:
				"PYTHON_SHA256=c08bc65a81971c1dd5783182826503369466c7e67374d1646519adf05207b684\nHOME=/root",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("PYTHON_SHA256=c08bc65a81971c1dd5783182826503");
	});
});

// ---------------------------------------------------------------------------
// Rule 2: Credential-bearing URIs
// ---------------------------------------------------------------------------

describe("sanitizeCapture — credential-bearing URIs", () => {
	it("redacts password in postgres connection string", () => {
		const input = captureJson({
			rawText:
				"DATABASE_URL=postgresql://booklogr:s3cret-pass@db:5432/booklogr",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("postgresql://booklogr:[REDACTED]@db");
		expect(result).not.toContain("s3cret-pass");
	});

	it("redacts password in mysql URI", () => {
		const input = captureJson({
			rawText: "mysql://admin:p4ssw0rd@mysql-host:3306/mydb",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("mysql://admin:[REDACTED]@mysql-host");
		expect(result).not.toContain("p4ssw0rd");
	});

	it("redacts password in redis URI", () => {
		const input = captureJson({
			rawText: "redis://default:redis-secret@redis:6379/0",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("redis://default:[REDACTED]@redis");
		expect(result).not.toContain("redis-secret");
	});

	it("does NOT match host:port without @", () => {
		const input = captureJson({
			rawText: "DATA_PROVIDER=http://book-metadata:8080",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("http://book-metadata:8080");
	});
});

// ---------------------------------------------------------------------------
// Rule 3: Emails in VCS output
// ---------------------------------------------------------------------------

describe("sanitizeCapture — VCS email redaction", () => {
	it("redacts email in git Author: line", () => {
		const input = captureJson({
			rawText: "Author: John Doe <john.doe@example.com>",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("Author: John Doe <redacted@redacted.invalid>");
		expect(result).not.toContain("john.doe@example.com");
	});

	it("redacts email in Commit: line", () => {
		const input = captureJson({
			rawText: "Commit: Jane Smith <jane@corp.internal>",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain(
			"Commit: Jane Smith <redacted@redacted.invalid>",
		);
		expect(result).not.toContain("jane@corp.internal");
	});

	it("preserves the name while redacting the address", () => {
		const input = captureJson({
			rawText: "Author:     Sumit Patel <sumit@prismalens.dev>",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("Author:     Sumit Patel");
		expect(result).toContain("redacted@redacted.invalid");
		expect(result).not.toContain("sumit@prismalens.dev");
	});

	it("is a no-op on already-redacted email addresses", () => {
		const input = captureJson({
			rawText:
				"Author: Andreas Backström <author@redacted.invalid>",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("author@redacted.invalid");
		expect(result).toBe(input);
	});
});

// ---------------------------------------------------------------------------
// Rule 4: Home path normalization
// ---------------------------------------------------------------------------

describe("sanitizeCapture — home path normalization", () => {
	it("normalizes /home/<user> to /home/user", () => {
		const input = captureJson({
			rawText: "working in /home/sumit/worktrees/prismalens",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("/home/user/worktrees/prismalens");
		expect(result).not.toContain("/home/sumit");
	});

	it("normalizes flattened -home-<user>- in tmp paths", () => {
		const input = captureJson({
			rawText: "/tmp/task-home-sumit-worktrees-prismalens-123",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("-home-user-");
		expect(result).not.toContain("-home-sumit-");
	});

	it("is a no-op when username is already 'user'", () => {
		const input = captureJson({
			rawText: "/home/user/worktrees/prismalens",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("/home/user/worktrees/prismalens");
	});

	it("normalizes /home/<user> for any unix username", () => {
		const input = captureJson({
			rawText: "/home/root/.config",
		});
		const result = sanitizeCapture(input);
		expect(result).toContain("/home/user/.config");
	});
});

// ---------------------------------------------------------------------------
// Round-trip: all four classes in one capture
// ---------------------------------------------------------------------------

describe("sanitizeCapture — round-trip with all four classes", () => {
	it("masks all four classes and preserves JSON structure", () => {
		const capture = {
			scenario: "test-all-classes",
			model: "claude-sonnet-4-5",
			incident: {
				alerts: [{ alertname: "TestAlert", severity: "critical" }],
				telemetry: { prometheusUrl: "http://localhost:9090" },
			},
			raw: {
				ok: true,
				arm: "raw",
				events: [
					{
						kind: "tool_result",
						preview:
							"POSTGRES_PASSWORD=s3cret\nGPG_KEY=ABCDEF123456\nDATABASE_URL=postgresql://app:dbpass@db:5432/mydb",
					},
					{
						kind: "agent_step",
						text: "Author: Dev User <dev@company.com>\nCommit at /home/developer/repo",
					},
					{
						kind: "tool_result",
						preview:
							"/tmp/task-home-developer-worktrees-prismalens-262",
					},
				],
			},
			prismalens: { ok: true, arm: "prismalens", events: [] },
			capturedAt: "2026-07-31T00:00:00.000Z",
		};

		const json = JSON.stringify(capture, null, 2);
		const sanitized = sanitizeCapture(json);

		// Parse the result — JSON structure must be preserved
		const parsed = JSON.parse(sanitized) as typeof capture;
		expect(parsed.scenario).toBe("test-all-classes");
		expect(parsed.model).toBe("claude-sonnet-4-5");
		expect(parsed.incident.alerts).toHaveLength(1);
		expect(parsed.raw.events).toHaveLength(3);

		// Class 1: env credentials redacted
		expect(sanitized).toContain("POSTGRES_PASSWORD=[REDACTED]");
		expect(sanitized).not.toContain("s3cret");

		// Class 1 allowlist: GPG_KEY preserved
		expect(sanitized).toContain("GPG_KEY=ABCDEF123456");

		// Class 2: credential URI redacted
		expect(sanitized).toContain("postgresql://app:[REDACTED]@db");
		expect(sanitized).not.toContain("dbpass");

		// Class 3: VCS email redacted
		expect(sanitized).toContain("redacted@redacted.invalid");
		expect(sanitized).not.toContain("dev@company.com");

		// Class 4: home path normalized
		expect(sanitized).toContain("/home/user/repo");
		expect(sanitized).not.toContain("/home/developer");
		expect(sanitized).toContain("-home-user-");
		expect(sanitized).not.toContain("-home-developer-");
	});
});

// ---------------------------------------------------------------------------
// No-op on clean captures: existing committed captures in eval/captures/
// ---------------------------------------------------------------------------

describe("sanitizeCapture — no-op on already-clean captures", () => {
	const capturesDir = join(import.meta.dirname, "captures");
	const captureFiles = readdirSync(capturesDir).filter((f) =>
		f.endsWith(".json"),
	);

	// Dynamically generate one test per capture file — if the sanitizer changes
	// anything, the file was not clean (which violates the #261 invariant).
	for (const file of captureFiles) {
		it(`is a no-op on ${file}`, () => {
			const content = readFileSync(join(capturesDir, file), "utf8");
			const sanitized = sanitizeCapture(content);
			expect(sanitized).toBe(content);
		});
	}

	it("has at least one capture file to verify", () => {
		expect(captureFiles.length).toBeGreaterThan(0);
	});
});
