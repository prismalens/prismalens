// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { trayStatus } from "./tray.js";

const owned = { ready: true, owned: true, baseUrl: "http://127.0.0.1:6473", wsl: null };

describe("trayStatus (#908)", () => {
	it("leads with the server, not the investigation count", () => {
		expect(trayStatus(owned, 0)).toEqual({
			lines: ["Server running on port 6473"],
			tooltip: "PrismaLens: Server running on port 6473",
		});
		expect(trayStatus({ ...owned, owned: false, baseUrl: "http://127.0.0.1:6491" }, 0).lines).toEqual([
			"Using the server on port 6491",
		]);
		expect(trayStatus({ ...owned, owned: false, wsl: { distro: "Ubuntu" } }, 0).lines).toEqual([
			"Using the server in WSL (Ubuntu)",
		]);
		expect(trayStatus({ ...owned, owned: false, wsl: { distro: null } }, 0).lines).toEqual([
			"Using the server in WSL (default distro)",
		]);
	});

	it("adds running investigations on a line of their own", () => {
		expect(trayStatus(owned, 1).lines).toEqual(["Server running on port 6473", "1 investigation running"]);
		expect(trayStatus(owned, 3).tooltip).toBe("PrismaLens: Server running on port 6473, 3 investigations running");
	});

	it("says the server stopped, and drops a stale count", () => {
		expect(trayStatus({ ...owned, ready: false }, 2).lines).toEqual(["Server stopped"]);
	});
});
