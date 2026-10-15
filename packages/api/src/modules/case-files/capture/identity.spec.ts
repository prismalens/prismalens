// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	classifyFailure,
	IdentityError,
	resolveIdentity,
} from "./identity.js";
import { NoKubectlError } from "./run-command.js";

const dir = mkdtempSync(join(tmpdir(), "pl-fake-kubectl-"));
const fake = join(dir, "kubectl");
// Answers config view for context kind-pl only; whoami fails unless FAKE_WHOAMI is set.
writeFileSync(
	fake,
	`#!${process.execPath}
const a = process.argv.slice(2);
const ctx = a[a.indexOf("--context") + 1];
if (a[0] === "config") {
  if (ctx !== "kind-pl") { process.stderr.write('error: context "' + ctx + '" does not exist'); process.exit(1); }
  process.stdout.write(JSON.stringify({
    contexts: [{ name: ctx, context: { cluster: "kind", user: "admin", namespace: "shop" } }],
    clusters: [{ name: "kind", cluster: { server: "https://127.0.0.1:6443", "certificate-authority-data": "SECRET" } }],
    users: [{ name: "admin", user: { token: "SECRET" } }],
  }));
} else if (a[0] === "auth") {
  process.stderr.write("error: unknown command"); process.exit(1);
}
`,
);
chmodSync(fake, 0o755);

describe("resolveIdentity", () => {
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("matches the binding and keeps no credential", async () => {
		const id = await resolveIdentity(fake, "kind-pl", {
			binding: { kubeContext: "kind-pl", cluster: "https://127.0.0.1:6443" },
		});
		expect(id).toEqual({
			kubeContext: "kind-pl",
			cluster: "https://127.0.0.1:6443",
			kubeUser: "admin",
			whoami: null,
			matchesBinding: true,
		});
		expect(JSON.stringify(id)).not.toContain("SECRET");
	});

	it("a context now pointing elsewhere does not match", async () => {
		const id = await resolveIdentity(fake, "kind-pl", {
			binding: { kubeContext: "kind-pl", cluster: "https://other:6443" },
		});
		expect(id.matchesBinding).toBe(false);
	});

	it("a missing context throws context-missing", async () => {
		await expect(resolveIdentity(fake, "gone")).rejects.toMatchObject({
			reason: "context-missing",
		});
		await expect(resolveIdentity(fake, "gone")).rejects.toBeInstanceOf(
			IdentityError,
		);
	});
});

describe("classifyFailure", () => {
	it.each([
		['Error from server (Forbidden): pods is forbidden', "unauthorised"],
		['error: context "x" does not exist', "context-missing"],
		["Unable to connect to the server: dial tcp", "unreachable"],
		["something else", null],
	])("%s → %s", (stderr, reason) => {
		expect(classifyFailure(stderr)).toBe(reason);
	});

	it("ENOENT is no-kubectl", () => {
		expect(classifyFailure("", new NoKubectlError("kubectl"))).toBe(
			"no-kubectl",
		);
	});
});
