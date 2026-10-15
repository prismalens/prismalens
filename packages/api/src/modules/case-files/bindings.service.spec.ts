// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	chmodSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceBinding as BindingRow } from "@prismalens/database";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	BindingNotFoundError,
	BindingRefusedError,
	BindingsService,
	serializeBinding,
	ServiceNotFoundError,
} from "./bindings.service.js";

const dir = mkdtempSync(join(tmpdir(), "pl-bindings-kubectl-"));
const modeFile = join(dir, "mode");
// The child gets a scrubbed env, so the fake reads its mode from a file beside it.
writeFileSync(
	join(dir, "kubectl"),
	`#!${process.execPath}
const fs = require("node:fs");
const mode = fs.readFileSync(${JSON.stringify(modeFile)}, "utf8").trim();
const a = process.argv.slice(2);
const out = (s) => process.stdout.write(s);
const fail = (s) => { process.stderr.write(s); process.exit(1); };
if (a[0] === "version") {
  if (mode === "version-fail") fail("error: version failure");
  if (mode === "version-nonstring") out(JSON.stringify({ clientVersion: { gitVersion: 123 } }));
  if (mode === "version-invalid-json") out("not valid json");
  out(JSON.stringify({ clientVersion: { gitVersion: "v1.31.0" } }));
} else if (a[0] === "config" && a[1] === "get-contexts") {
  if (mode === "contexts-fail") fail("error: contexts failure");
  out("kind-pl\\nprod\\n");
} else if (a[0] === "config" && a[1] === "current-context") {
  if (mode === "no-current-context") fail("error: current-context is not set");
  else if (mode === "current-context-whitespace") out("  \\n");
  else if (mode === "unknown-current-context") out("missing-ctx\\n");
  else out("kind-pl\\n");
} else if (a[0] === "config" && a[1] === "view") {
  const ctx = a[a.indexOf("--context") + 1];
  if (ctx !== "kind-pl" || mode === "deleted") fail('error: context "' + ctx + '" does not exist');
  const server = mode === "moved" ? "https://other:6443" : "https://127.0.0.1:6443";
  const contextObj = mode === "no-namespace"
    ? { cluster: "kind", user: "admin" }
    : { cluster: "kind", user: "admin", namespace: "shop" };
  out(JSON.stringify({
    contexts: [{ name: ctx, context: contextObj }],
    clusters: [{ name: "kind", cluster: { server, "certificate-authority-data": "CERTDATA" } }],
    users: [{ name: "admin", user: { token: "TOKENDATA" } }],
  }));
} else if (a[0] === "auth") fail("error: unknown command");
else if (a.includes("get")) {
  if (mode === "forbidden") fail('Error from server (Forbidden): pods is forbidden: User "x" cannot list resource "pods"');
  if (mode === "unreachable") fail("Error from server: dial tcp: connection refused");
  if (mode === "timeout") fail("error: i/o timeout");
  if (mode === "byte-cap") out("x".repeat(70000));
  if (mode === "empty-stderr-fail") process.exit(1);
  out("pod/checkout-1\\n");
} else fail("unexpected " + a.join(" "));
`,
);
chmodSync(join(dir, "kubectl"), 0o755);

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";

function fakePrisma() {
	const rows = new Map<string, BindingRow>();
	const serviceBinding = {
		findUnique: async ({ where }: { where: { serviceId: string } }) =>
			rows.get(where.serviceId) ?? null,
		upsert: async (args: {
			where: { serviceId: string };
			create: Partial<BindingRow> & { serviceId: string };
			update: Partial<BindingRow>;
		}) => {
			const now = new Date();
			const existing = rows.get(args.where.serviceId);
			const next = existing
				? { ...existing, ...args.update, updatedAt: now }
				: ({
						id: "b1",
						kind: "kubernetes",
						createdAt: now,
						updatedAt: now,
						...args.create,
					} as BindingRow);
			rows.set(args.where.serviceId, next);
			return next;
		},
		update: async (args: {
			where: { serviceId: string };
			data: Partial<BindingRow>;
		}) => {
			const existing = rows.get(args.where.serviceId);
			if (!existing) throw new Error("no row");
			const next = { ...existing, ...args.data, updatedAt: new Date() };
			rows.set(args.where.serviceId, next);
			return next;
		},
		deleteMany: async ({ where }: { where: { serviceId: string } }) => ({
			count: rows.delete(where.serviceId) ? 1 : 0,
		}),
	};
	const service = {
		findUnique: async ({ where }: { where: { id: string } }) =>
			where.id === SERVICE_ID ? { id: SERVICE_ID } : null,
	};
	return { rows, prisma: { serviceBinding, service } };
}

describe("BindingsService", () => {
	const originalPath = process.env.PATH;
	let fake: ReturnType<typeof fakePrisma>;
	let service: BindingsService;

	beforeEach(() => {
		process.env.PATH = dir;
		writeFileSync(modeFile, "ok");
		fake = fakePrisma();
		service = new BindingsService(fake.prisma as unknown as PrismaService);
	});
	afterEach(() => {
		process.env.PATH = originalPath;
	});
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("detects kubectl, its contexts and a suggested binding", async () => {
		const detected = await service.detect(SERVICE_ID);
		expect(detected).toEqual({
			kubectl: { path: join(dir, "kubectl"), version: "v1.31.0" },
			contexts: ["kind-pl", "prod"],
			currentContext: "kind-pl",
			current: {
				cluster: "https://127.0.0.1:6443",
				user: "admin",
				namespace: "shop",
			},
			suggested: { kubeContext: "kind-pl", namespace: "shop" },
		});
	});

	it("detect returns an empty detection without kubectl", async () => {
		process.env.PATH = join(dir, "missing");
		expect(await service.detect(SERVICE_ID)).toEqual({
			kubectl: null,
			contexts: [],
		});
	});

	it("confirm stores the binding and probes it ok, keeping no credential", async () => {
		const binding = await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		expect(binding).toMatchObject({
			kubeContext: "kind-pl",
			cluster: "https://127.0.0.1:6443",
			namespace: "shop",
			kubeUser: "admin",
			probeState: "ok",
		});
		const stored = fake.rows.get(SERVICE_ID);
		expect(stored?.detected).not.toMatch(/CERTDATA|TOKENDATA/);
		expect(await service.get(SERVICE_ID)).toEqual(binding);
	});

	it("confirm stores the binding even when the probe is unauthorised", async () => {
		writeFileSync(modeFile, "forbidden");
		const binding = await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		expect(binding.probeState).toBe("unauthorised");
		expect(fake.rows.has(SERVICE_ID)).toBe(true);
	});

	it("probe reports identity-mismatch when the context moved", async () => {
		await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		writeFileSync(modeFile, "moved");
		const binding = await service.probe(SERVICE_ID);
		expect(binding.probeState).toBe("identity-mismatch");
	});

	it("confirm refuses a context this machine does not have", async () => {
		await expect(
			service.confirm({
				serviceId: SERVICE_ID,
				kubeContext: "gone",
				namespace: "shop",
			}),
		).rejects.toBeInstanceOf(BindingRefusedError);
		expect(fake.rows.has(SERVICE_ID)).toBe(false);
	});

	it("remove deletes the binding", async () => {
		await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		expect(await service.remove(SERVICE_ID)).toBe(true);
		expect(await service.get(SERVICE_ID)).toBeNull();
	});

	it("detect with no namespace in the context suggests default", async () => {
		writeFileSync(modeFile, "no-namespace");
		const detected = await service.detect(SERVICE_ID);
		expect(detected.suggested).toEqual({
			kubeContext: "kind-pl",
			namespace: "default",
		});
		expect(detected.current?.namespace).toBeNull();
	});

	it("probe gives context-missing after the context is deleted", async () => {
		await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		writeFileSync(modeFile, "deleted");
		const binding = await service.probe(SERVICE_ID);
		expect(binding.probeState).toBe("context-missing");
	});

	it("probe with no kubectl gives no-kubectl", async () => {
		await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		process.env.PATH = join(dir, "missing");
		const binding = await service.probe(SERVICE_ID);
		expect(binding.probeState).toBe("no-kubectl");
		expect(binding.probeDetail).toBe("kubectl is not on PATH");
	});

	it("probe maps connection failure to unreachable", async () => {
		await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		writeFileSync(modeFile, "unreachable");
		const binding = await service.probe(SERVICE_ID);
		expect(binding.probeState).toBe("unreachable");
	});

	it("probe maps timeout to unreachable", async () => {
		await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		writeFileSync(modeFile, "timeout");
		const binding = await service.probe(SERVICE_ID);
		expect(binding.probeState).toBe("unreachable");
	});

	it("serializeBinding falls back to empty detection when detected JSON is corrupt", () => {
		const now = new Date();
		const row: BindingRow = {
			id: "b1",
			serviceId: SERVICE_ID,
			kind: "kubernetes",
			kubeContext: "kind-pl",
			cluster: "https://127.0.0.1:6443",
			namespace: "shop",
			kubeUser: "admin",
			detected: "{not-valid-json",
			confirmedAt: now,
			probeState: "ok",
			probeDetail: null,
			probedAt: now,
			createdAt: now,
			updatedAt: now,
		};
		const binding = serializeBinding(row);
		expect(binding.detected).toEqual({ kubectl: null, contexts: [] });
		expect(binding.probeState).toBe("ok");
	});

	it("confirm for an unknown serviceId throws ServiceNotFoundError", async () => {
		await expect(
			service.confirm({
				serviceId: "00000000-0000-0000-0000-000000000000",
				kubeContext: "kind-pl",
				namespace: "shop",
			}),
		).rejects.toBeInstanceOf(ServiceNotFoundError);
	});

	it("probe with no binding throws BindingNotFoundError", async () => {
		await expect(service.probe(SERVICE_ID)).rejects.toBeInstanceOf(
			BindingNotFoundError,
		);
	});

	it("re-confirm takes the upsert update path", async () => {
		const first = await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		expect(first.namespace).toBe("shop");

		const updated = await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "staging",
		});
		expect(updated.namespace).toBe("staging");
		expect(fake.rows.get(SERVICE_ID)?.namespace).toBe("staging");
	});

	it("confirm when kubectl is not on PATH throws BindingRefusedError", async () => {
		process.env.PATH = join(dir, "missing");
		await expect(
			service.confirm({
				serviceId: SERVICE_ID,
				kubeContext: "kind-pl",
				namespace: "shop",
			}),
		).rejects.toMatchObject({
			reason: "no-kubectl",
		});
	});

	it("probe accepts byte-cap as ok", async () => {
		await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		writeFileSync(modeFile, "byte-cap");
		const binding = await service.probe(SERVICE_ID);
		expect(binding.probeState).toBe("ok");
	});

	it("detect with no current context", async () => {
		writeFileSync(modeFile, "no-current-context");
		const detected = await service.detect(SERVICE_ID);
		expect(detected.currentContext).toBeNull();
		expect(detected.suggested).toBeNull();
		expect(detected.current).toBeNull();
	});

	it("detect when kubectl version fails", async () => {
		writeFileSync(modeFile, "version-fail");
		const detected = await service.detect(SERVICE_ID);
		expect(detected.kubectl?.version).toBeNull();
	});

	it("serializeBinding falls back to unchecked with invalid probeState", () => {
		const now = new Date();
		const row: BindingRow = {
			id: "b1",
			serviceId: SERVICE_ID,
			kind: "kubernetes",
			kubeContext: "kind-pl",
			cluster: "https://127.0.0.1:6443",
			namespace: "shop",
			kubeUser: "admin",
			detected: JSON.stringify({ kubectl: null, contexts: [] }),
			confirmedAt: now,
			probeState: "invalid-state",
			probeDetail: null,
			probedAt: null,
			createdAt: now,
			updatedAt: now,
		};
		const binding = serializeBinding(row);
		expect(binding.probeState).toBe("unchecked");
	});

	it("detect when kubectl version has non-string gitVersion or invalid json", async () => {
		writeFileSync(modeFile, "version-nonstring");
		expect((await service.detect(SERVICE_ID)).kubectl?.version).toBeNull();

		writeFileSync(modeFile, "version-invalid-json");
		expect((await service.detect(SERVICE_ID)).kubectl?.version).toBeNull();
	});

	it("probe maps failure with empty stderr to unreachable and retrieval reason detail", async () => {
		await service.confirm({
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
		writeFileSync(modeFile, "empty-stderr-fail");
		const binding = await service.probe(SERVICE_ID);
		expect(binding.probeState).toBe("unreachable");
		expect(binding.probeDetail).toBe("get pods: error");
	});

	it("serializeBinding falls back to empty detection when detected JSON does not match schema", () => {
		const now = new Date();
		const row: BindingRow = {
			id: "b1",
			serviceId: SERVICE_ID,
			kind: "kubernetes",
			kubeContext: "kind-pl",
			cluster: "https://127.0.0.1:6443",
			namespace: "shop",
			kubeUser: null,
			detected: JSON.stringify({ invalid: "schema" }),
			confirmedAt: now,
			probeState: "ok",
			probeDetail: "some detail",
			probedAt: null,
			createdAt: now,
			updatedAt: now,
		};
		const binding = serializeBinding(row);
		expect(binding.detected).toEqual({ kubectl: null, contexts: [] });
		expect(binding.probeDetail).toBe("some detail");
		expect(binding.probedAt).toBeNull();
	});

	it("detect returns empty detection when kubectl fails spawn with ENOENT", async () => {
		const badDir = mkdtempSync(join(tmpdir(), "bad-kubectl-"));
		writeFileSync(join(badDir, "kubectl"), "#!/nonexistent/interpreter\n");
		chmodSync(join(badDir, "kubectl"), 0o755);
		process.env.PATH = badDir;
		try {
			const detected = await service.detect(SERVICE_ID);
			expect(detected).toEqual({ kubectl: null, contexts: [] });
		} finally {
			rmSync(badDir, { recursive: true, force: true });
		}
	});

	it("detect handles get-contexts failure, whitespace current-context, and unknown current-context", async () => {
		writeFileSync(modeFile, "contexts-fail");
		expect((await service.detect(SERVICE_ID)).contexts).toEqual([]);

		writeFileSync(modeFile, "current-context-whitespace");
		expect((await service.detect(SERVICE_ID)).currentContext).toBeNull();

		writeFileSync(modeFile, "unknown-current-context");
		const detected = await service.detect(SERVICE_ID);
		expect(detected.currentContext).toBe("missing-ctx");
		expect(detected.current).toBeNull();
		expect(detected.suggested).toEqual({
			kubeContext: "missing-ctx",
			namespace: "default",
		});
	});
});
