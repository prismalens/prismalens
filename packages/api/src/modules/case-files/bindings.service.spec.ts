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
import { BindingRefusedError, BindingsService } from "./bindings.service.js";

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
if (a[0] === "version") out(JSON.stringify({ clientVersion: { gitVersion: "v1.31.0" } }));
else if (a[0] === "config" && a[1] === "get-contexts") out("kind-pl\\nprod\\n");
else if (a[0] === "config" && a[1] === "current-context") out("kind-pl\\n");
else if (a[0] === "config" && a[1] === "view") {
  const ctx = a[a.indexOf("--context") + 1];
  if (ctx !== "kind-pl") fail('error: context "' + ctx + '" does not exist');
  const server = mode === "moved" ? "https://other:6443" : "https://127.0.0.1:6443";
  out(JSON.stringify({
    contexts: [{ name: ctx, context: { cluster: "kind", user: "admin", namespace: "shop" } }],
    clusters: [{ name: "kind", cluster: { server, "certificate-authority-data": "CERTDATA" } }],
    users: [{ name: "admin", user: { token: "TOKENDATA" } }],
  }));
} else if (a[0] === "auth") fail("error: unknown command");
else if (a.includes("get")) {
  if (mode === "forbidden") fail('Error from server (Forbidden): pods is forbidden: User "x" cannot list resource "pods"');
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
});
