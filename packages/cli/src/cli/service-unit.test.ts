// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { parseServiceUnit } from "@prismalens/config";
import { describe, expect, it } from "vitest";
import {
	activeProbe,
	buildPlan,
	renderLaunchdPlist,
	renderSystemdUnit,
	resolveLauncher,
	servicePath,
	steps,
} from "./service-unit.js";

const plan = buildPlan({
	launcher: "/home/u/.local/bin/pl",
	workspace: "/home/u/.prismalens",
	port: 3170,
	path: "/home/u/.local/bin:/usr/bin",
	env: { PRISMALENS_ALLOWED_HOSTS: "box.tailnet", PRISMALENS_AUTH_SECRET: "never" },
});

describe("buildPlan", () => {
	it("runs pl up without a browser and carries only non-secret settings", () => {
		expect(plan.program).toEqual(["/home/u/.local/bin/pl", "up", "--no-open"]);
		expect(plan.env).toEqual({
			PATH: "/home/u/.local/bin:/usr/bin",
			PRISMALENS_WORKSPACE_DIR: "/home/u/.prismalens",
			PRISMALENS_PORT: "3170",
			PRISMALENS_SERVICE: "1",
			PRISMALENS_ALLOWED_HOSTS: "box.tailnet",
		});
		expect(plan.logPath).toBe("/home/u/.prismalens/logs/service.log");
	});

	it("runs pl up --tailscale-serve when installed with it (#765)", () => {
		const served = buildPlan({
			launcher: "/pl",
			workspace: "/w",
			port: 1,
			path: "/bin",
			tailscaleServe: true,
		});
		expect(served.program).toEqual(["/pl", "up", "--no-open", "--tailscale-serve"]);
	});
});

describe("resolveLauncher", () => {
	it("uses the installer's wrapper, which survives upgrades", () => {
		expect(
			resolveLauncher({ channel: "installer", argv1: "/x/runtime/0.5.1/bin/pl", installerBinDir: "/home/u/.local/bin" }),
		).toBe("/home/u/.local/bin/pl");
	});
	it("uses the pl that was run on every other channel", () => {
		expect(resolveLauncher({ channel: "npm", argv1: "/usr/local/bin/pl", installerBinDir: null })).toBe(
			"/usr/local/bin/pl",
		);
	});
});

describe("servicePath", () => {
	it("keeps the shell's order, adds node's dir, drops relative and repeated entries", () => {
		expect(servicePath("/a:.:/usr/bin:/a", "/n/bin/node")).toBe(
			"/a:/usr/bin:/n/bin:/opt/homebrew/bin:/usr/local/bin:/bin",
		);
	});
});

describe("renderSystemdUnit", () => {
	const unit = renderSystemdUnit(plan);
	it("restarts on failure, treats SIGTERM's 143 as success and appends to the log", () => {
		expect(unit).toContain('ExecStart="/home/u/.local/bin/pl" "up" "--no-open"');
		expect(unit).toContain("SuccessExitStatus=143");
		expect(unit).toContain("Restart=on-failure");
		expect(unit).toContain("StandardOutput=append:/home/u/.prismalens/logs/service.log");
		expect(unit).toContain("WantedBy=default.target");
	});
	it("round-trips the workspace and port", () => {
		expect(parseServiceUnit(unit, "/u")).toEqual({ unitPath: "/u", workspace: "/home/u/.prismalens", port: 3170 });
	});
	it("escapes systemd specifiers", () => {
		const odd = renderSystemdUnit(buildPlan({ ...basics, workspace: "/w/100%" }));
		expect(odd).toContain('Environment="PRISMALENS_WORKSPACE_DIR=/w/100%%"');
	});
});

const basics = { launcher: "/pl", workspace: "/w", port: 3001, path: "/usr/bin" };

describe("renderLaunchdPlist", () => {
	const plist = renderLaunchdPlist(plan, "/Users/u");
	it("keeps the job alive only after a failed exit", () => {
		expect(plist).toContain("<key>SuccessfulExit</key>\n    <false/>");
		expect(plist).toContain("<string>--no-open</string>");
	});
	it("round-trips the workspace and port, XML-escaped", () => {
		const odd = renderLaunchdPlist(buildPlan({ ...basics, workspace: "/w/a&b" }), "/Users/u");
		expect(odd).toContain("<string>/w/a&amp;b</string>");
		expect(parseServiceUnit(odd, "/p")?.workspace).toBe("/w/a&b");
	});
});

describe("activeProbe", () => {
	it("asks systemd whether the unit runs, and launchd whether it is loaded", () => {
		expect(activeProbe("systemd", 1000)).toEqual(["systemctl", "--user", "is-active", "--quiet", "prismalens.service"]);
		expect(activeProbe("launchd", 501)).toEqual(["launchctl", "print", "gui/501/io.prismalens.server"]);
	});
});

describe("steps", () => {
	it("enables and starts a systemd unit, and removal tolerates a unit that isn't loaded", () => {
		expect(steps("systemd", "start", "/u", 1000).map((s) => s.argv.join(" "))).toEqual([
			"systemctl --user daemon-reload",
			"systemctl --user enable prismalens.service",
			"systemctl --user restart prismalens.service",
		]);
		expect(steps("systemd", "remove", "/u", 1000)[0].optional).toBe(true);
	});
	it("bootstraps a launchd agent in the user's gui domain", () => {
		expect(steps("launchd", "start", "/p.plist", 501).at(-1)?.argv).toEqual([
			"launchctl",
			"bootstrap",
			"gui/501",
			"/p.plist",
		]);
		expect(steps("launchd", "restart", "/p.plist", 501)[0].argv).toEqual([
			"launchctl",
			"kickstart",
			"-k",
			"gui/501/io.prismalens.server",
		]);
	});
});

describe("parseServiceUnit", () => {
	it("undoes systemd's %% escape", () => {
		const unit = renderSystemdUnit(buildPlan({ ...basics, workspace: "/w/100%" }));
		expect(parseServiceUnit(unit, "/u")?.workspace).toBe("/w/100%");
	});
});
