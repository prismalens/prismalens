// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./loader.js";

describe("loadConfig — layered precedence (ADR-0014)", () => {
	let dir: string;
	let xdg: string;
	let savedXdg: string | undefined;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-loader-"));
		// Isolate the XDG user layer (Linux/WSL) so a dev's real ~/.config/prismalens
		// can't leak into these tests. env-paths honours XDG_CONFIG_HOME on Linux.
		xdg = mkdtempSync(join(tmpdir(), "pl-xdg-"));
		savedXdg = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = xdg;
	});

	afterEach(() => {
		if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = savedXdg;
		rmSync(dir, { recursive: true, force: true });
		rmSync(xdg, { recursive: true, force: true });
	});

	const writeProject = (yaml: string) =>
		writeFileSync(join(dir, "prismalens.config.yaml"), yaml);
	const writeLocal = (yaml: string) =>
		writeFileSync(join(dir, "prismalens.config.local.yaml"), yaml);

	it("applies built-in defaults when no config file is present", async () => {
		const config = await loadConfig({ cwd: dir });
		expect(config.agent.default).toBe("deepagents");
		expect(config.workspace.base_dir).toBe("~/.prismalens");
		// The sandbox default is `auto` (B.1.1 egress-gate flip) — safe because `auto`
		// runs an egress self-check before trusting srt, degrading honestly to the floor.
		expect(config.agent.sandbox).toBe("auto");
	});

	it("defaults the listen section: port 4181, no token (listen refuses to start)", async () => {
		const config = await loadConfig({ cwd: dir });
		expect(config.listen.port).toBe(4181);
		expect(config.listen.token).toBeUndefined();
	});

	it("reads a configured listen section (token typically via ${VAR})", async () => {
		writeProject("listen:\n  port: 9999\n  token: hunter2\n");
		const config = await loadConfig({ cwd: dir });
		expect(config.listen.port).toBe(9999);
		expect(config.listen.token).toBe("hunter2");
	});

	it("project-local overrides project; unrelated project values survive (deep-merge)", async () => {
		writeProject(
			"agent:\n  model: project-model\ntelemetry:\n  apiUrl: http://project\n",
		);
		writeLocal("agent:\n  model: local-model\n");

		const config = await loadConfig({ cwd: dir });
		expect(config.agent.model).toBe("local-model"); // local wins
		expect(config.telemetry.apiUrl).toBe("http://project"); // project survives
	});

	it("CLI overrides beat every file layer", async () => {
		writeProject("agent:\n  model: project-model\n");
		writeLocal("agent:\n  model: local-model\n");

		const config = await loadConfig({
			cwd: dir,
			cliOverrides: { model: "cli-model" },
		});
		expect(config.agent.model).toBe("cli-model");
	});

	it("interpolates env-var placeholders from the environment", async () => {
		process.env.PL_TEST_API = "http://interp";
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder is the interpolation syntax under test
		writeProject("telemetry:\n  apiUrl: ${PL_TEST_API}\n");

		const config = await loadConfig({ cwd: dir });
		expect(config.telemetry.apiUrl).toBe("http://interp");
		delete process.env.PL_TEST_API;
	});

	it("parses agent.limits (best-effort resource caps, ADR-0020)", async () => {
		writeProject(
			"agent:\n  limits:\n    wall_clock_ms: 60000\n    memory_mb: 512\n    cpu_cores: 2\n",
		);
		const config = await loadConfig({ cwd: dir });
		expect(config.agent.limits.wall_clock_ms).toBe(60000);
		expect(config.agent.limits.memory_mb).toBe(512);
		expect(config.agent.limits.cpu_cores).toBe(2);
	});

	it("defaults agent.limits to an empty object when omitted (no lying caps)", async () => {
		const config = await loadConfig({ cwd: dir });
		expect(config.agent.limits).toEqual({});
	});

	it("throws on an unset env-var placeholder", async () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder is the interpolation syntax under test
		writeProject("telemetry:\n  apiUrl: ${PL_DEFINITELY_UNSET_XYZ}\n");
		await expect(loadConfig({ cwd: dir })).rejects.toThrow(
			/unset environment variable/,
		);
	});
});
