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

	it("throws on an unset env-var placeholder", async () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder is the interpolation syntax under test
		writeProject("telemetry:\n  apiUrl: ${PL_DEFINITELY_UNSET_XYZ}\n");
		await expect(loadConfig({ cwd: dir })).rejects.toThrow(
			/unset environment variable/,
		);
	});
});
