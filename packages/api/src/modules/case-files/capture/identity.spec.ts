// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	classifyFailure,
	IdentityError,
	matchesBinding,
	resolveIdentity,
	viewContext,
} from "./identity.js";
import { NoKubectlError } from "./run-command.js";

const dir = mkdtempSync(join(tmpdir(), "pl-fake-kubectl-"));
const fake = join(dir, "kubectl");
writeFileSync(
	fake,
	`#!${process.execPath}
const a = process.argv.slice(2);
const ctx = a[a.indexOf("--context") + 1];
if (a[0] === "config") {
  if (ctx === "unmatched-err") {
    process.stderr.write("unrecognized error occurred");
    process.exit(1);
  }
  if (ctx === "bad-json") {
    process.stdout.write("not-valid-json");
    process.exit(0);
  }
  if (ctx === "no-cluster") {
    process.stdout.write(JSON.stringify({
      contexts: [{ name: ctx, context: { cluster: "none" } }],
      clusters: [],
    }));
    process.exit(0);
  }
  if (ctx === "no-server") {
    process.stdout.write(JSON.stringify({
      contexts: [{ name: ctx, context: { cluster: "kind" } }],
      clusters: [{ name: "kind", cluster: {} }],
    }));
    process.exit(0);
  }
  if (ctx === "no-ns") {
    process.stdout.write(JSON.stringify({
      contexts: [{ name: ctx, context: {} }],
      clusters: [{ cluster: { server: "https://127.0.0.1:6443" } }],
    }));
    process.exit(0);
  }
  if (ctx === "whoami-ok") {
    process.stdout.write(JSON.stringify({
      contexts: [{ name: ctx, context: { cluster: "kind", user: "alice", namespace: "shop" } }],
      clusters: [{ name: "kind", cluster: { server: "https://127.0.0.1:6443" } }],
      users: [{ name: "alice", user: {} }],
    }));
    process.exit(0);
  }
  if (ctx !== "kind-pl") { process.stderr.write('error: context "' + ctx + '" does not exist'); process.exit(1); }
  process.stdout.write(JSON.stringify({
    contexts: [{ name: ctx, context: { cluster: "kind", user: "admin", namespace: "shop" } }],
    clusters: [{ name: "kind", cluster: { server: "https://127.0.0.1:6443", "certificate-authority-data": "SECRET" } }],
    users: [{ name: "admin", user: { token: "SECRET" } }],
  }));
} else if (a[0] === "auth") {
  if (ctx === "whoami-ok") {
    process.stdout.write(JSON.stringify({
      status: {
        userInfo: {
          username: "alice",
          uid: "1001",
          groups: ["system:authenticated", "devs"]
        }
      }
    }));
    process.exit(0);
  }
  process.stderr.write("error: unknown command"); process.exit(1);
}
`,
);
chmodSync(fake, 0o755);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("resolveIdentity", () => {
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

	it("resolves whoami when supported with groups and uid", async () => {
		const id = await resolveIdentity(fake, "whoami-ok");
		expect(id.whoami).toEqual({
			username: "alice",
			uid: "1001",
			groups: ["system:authenticated", "devs"],
		});
		expect(id.matchesBinding).toBe(false);
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

	it("throws context-missing when config view has no clusters or server", async () => {
		await expect(resolveIdentity(fake, "no-cluster")).rejects.toMatchObject({
			reason: "context-missing",
		});
		await expect(resolveIdentity(fake, "no-server")).rejects.toMatchObject({
			reason: "context-missing",
		});
	});

	it("unmatched config-view failure falls back to context-missing", async () => {
		await expect(resolveIdentity(fake, "unmatched-err")).rejects.toMatchObject({
			reason: "context-missing",
		});
	});

	it("throws context-missing when config view returns malformed JSON", async () => {
		await expect(resolveIdentity(fake, "bad-json")).rejects.toMatchObject({
			reason: "context-missing",
		});
	});
});

describe("viewContext", () => {
	it("reads viewContext with namespace and clusterName", async () => {
		const view = await viewContext(fake, "kind-pl");
		expect(view).toEqual({
			kubeContext: "kind-pl",
			clusterName: "kind",
			server: "https://127.0.0.1:6443",
			kubeUser: "admin",
			namespace: "shop",
		});
	});

	it("reads viewContext when namespace and clusterName are omitted", async () => {
		const view = await viewContext(fake, "no-ns");
		expect(view).toEqual({
			kubeContext: "no-ns",
			clusterName: null,
			server: "https://127.0.0.1:6443",
			kubeUser: null,
			namespace: null,
		});
	});

	it("viewContext wraps runCommand error into IdentityError", async () => {
		await expect(viewContext("/nonexistent/bin", "kind-pl")).rejects.toMatchObject({
			reason: "no-kubectl",
		});
	});
});

describe("matchesBinding", () => {
	it("returns true only when both context and cluster match", () => {
		const target = { kubeContext: "kind-pl", cluster: "https://k8s:6443" };
		expect(matchesBinding(target, target)).toBe(true);
		expect(
			matchesBinding({ ...target, kubeContext: "other" }, target),
		).toBe(false);
		expect(
			matchesBinding({ ...target, cluster: "https://other:6443" }, target),
		).toBe(false);
	});
});

describe("classifyFailure", () => {
	it.each([
		["Error from server (Forbidden): pods is forbidden", "unauthorised"],
		["Unauthorized", "unauthorised"],
		['error: context "x" does not exist', "context-missing"],
		['context "x" not found', "context-missing"],
		["Unable to connect to the server: dial tcp", "unreachable"],
		["client rate limiter Wait: context deadline exceeded", "unreachable"],
		["net/http: TLS handshake timeout (i/o timeout)", "unreachable"],
		["dial tcp: lookup k8s.example.com: no such host", "unreachable"],
		["dial tcp 127.0.0.1:6443: connect: connection refused", "unreachable"],
		["something else", null],
	])("%s → %s", (stderr, reason) => {
		expect(classifyFailure(stderr)).toBe(reason);
	});

	it("ENOENT is no-kubectl", () => {
		expect(classifyFailure("", new NoKubectlError("kubectl"))).toBe(
			"no-kubectl",
		);
		const raw = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
		expect(classifyFailure("", raw)).toBe("no-kubectl");
	});
});
