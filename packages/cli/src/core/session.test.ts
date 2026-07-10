import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionManager } from "./session.js";

describe("SessionManager", () => {
	it("appendGroupAlert throws ENOENT when appending to nonexistent group.json", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pl-session-test-"));
		try {
			const sessions = createSessionManager(dir);
			await expect(
				sessions.appendGroupAlert("nonexistent-run", { alertname: "Late" }),
			).rejects.toThrow(
				"Cannot append alert to missing group.json for run nonexistent-run",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
