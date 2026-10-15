// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Both resets clear the Case File tables, children first, and `<appData>/cases`. */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-settings-reset-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { SettingsService } = await import("./settings.service.js");
const { casesDir } = await import("../../modules/case-files/storage/artifact-store.js");

const CASE_ORDER = [
	"claimRevision",
	"caseEdge",
	"caseNode",
	"manifestEntry",
	"captureArtifact",
	"caseCapture",
	"capture",
];

/** A transaction client that records every `deleteMany` by model, in order. */
function recordingPrisma() {
	const calls: string[] = [];
	const tx = new Proxy(
		{},
		{
			get: (_, model: string) => ({
				count: async () => 0,
				deleteMany: async () => {
					calls.push(model);
					return { count: 0 };
				},
			}),
		},
	);
	const prisma = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
	return { calls, prisma };
}

describe("SettingsService resets", () => {
	afterAll(() => rmSync(env.root, { recursive: true, force: true }));

	it.each([
		["resetData", false],
		["factoryReset", true],
	] as const)("%s deletes the case tables before incidents and removes the cases dir", async (method, bindings) => {
		const { calls, prisma } = recordingPrisma();
		mkdirSync(join(casesDir(), "c1"), { recursive: true });
		await new SettingsService(prisma as never)[method]();

		const at = (m: string) => calls.indexOf(m);
		expect(calls.filter((c) => CASE_ORDER.includes(c))).toEqual(CASE_ORDER);
		expect(at("capture")).toBeLessThan(at("incident"));
		if (bindings) expect(at("serviceBinding")).toBeLessThan(at("service"));
		else expect(calls).not.toContain("serviceBinding");
		expect(existsSync(casesDir())).toBe(false);
	});
});
