// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	installedService,
	serviceManagerKind,
	serviceOwnsWorkspace,
	serviceUnitPath,
} from "./background-service.js";

describe("background service paths", () => {
	it("is systemd on Linux, launchd on macOS, none on Windows", () => {
		expect(serviceManagerKind("linux")).toBe("systemd");
		expect(serviceManagerKind("darwin")).toBe("launchd");
		expect(serviceManagerKind("win32")).toBe(null);
		expect(serviceUnitPath("win32", {}, "/h")).toBe(null);
	});
	it("honours XDG_CONFIG_HOME for the systemd unit", () => {
		expect(serviceUnitPath("linux", {}, "/h")).toBe("/h/.config/systemd/user/prismalens.service");
		expect(serviceUnitPath("linux", { XDG_CONFIG_HOME: "/c" }, "/h")).toBe("/c/systemd/user/prismalens.service");
		expect(serviceUnitPath("darwin", {}, "/h")).toBe("/h/Library/LaunchAgents/io.prismalens.server.plist");
	});
});

describe("installedService", () => {
	it("reads the workspace and port from an installed unit, and knows whose workspace it is", () => {
		const home = mkdtempSync(join(tmpdir(), "pl-svc-"));
		expect(installedService("linux", {}, home)).toBe(null);
		const dir = join(home, ".config", "systemd", "user");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "prismalens.service"),
			'[Service]\nEnvironment="PRISMALENS_WORKSPACE_DIR=/w/ws"\nEnvironment="PRISMALENS_PORT=3170"\n',
		);
		const service = installedService("linux", {}, home);
		expect(service).toMatchObject({ workspace: "/w/ws", port: 3170 });
		expect(serviceOwnsWorkspace("/w/ws/", service)).toBe(true);
		expect(serviceOwnsWorkspace("/w/other", service)).toBe(false);
		expect(serviceOwnsWorkspace("/w/ws", null)).toBe(false);
	});
});
