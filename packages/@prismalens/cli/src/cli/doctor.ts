/**
 * `prismalens doctor` — preflight checklist for the two-tier engine (ADR-0008/0010).
 *
 * Salvaged in spirit from the retired pl orchestrator's doctor, but pared down to the
 * checks that actually gate a run:
 *  - HARD: the configured harness binary is on PATH
 *      (deepagents -> "deepagents", claude-code -> "claude", codex -> "codex")
 *  - HARD: an LLM credential is present
 *      (OLLAMA_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY, or, for claude-code,
 *       a signed-in ~/.claude/.credentials.json)
 *  - SOFT: workspace.base_dir is writable
 *
 * Prints pass/fail per check; exits non-zero iff a HARD check fails. No tinyexec /
 * check-tool helper here — availability is a dependency-free PATH scan.
 */
import { accessSync, existsSync, constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { defineCommand } from "citty";
import consola from "consola";
import { loadConfig } from "../config/loader.js";
import { type PlConfig, PlConfigSchema } from "../config/schema.js";
import { resolveBaseDir } from "../core/session.js";

/** Harness backend -> the binary it shells out to. Keyed by the schema enum so it
 *  stays exhaustive if a new backend is added. */
type Harness = PlConfig["agent"]["default"];
const HARNESS_BINARY: Record<Harness, string> = {
	deepagents: "deepagents",
	"claude-code": "claude",
	codex: "codex",
};

/** The env vars any harness can use as an LLM credential. */
const CREDENTIAL_ENV_VARS = [
	"OLLAMA_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
] as const;

interface Check {
	name: string;
	pass: boolean;
	detail: string;
	/** A hard check failing makes `doctor` exit non-zero. */
	hard: boolean;
}

/** Is `bin` an executable somewhere on PATH? Synchronous, dependency-free. */
function isOnPath(bin: string): boolean {
	const pathEnv = process.env.PATH ?? "";
	const exts =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const dir of pathEnv.split(delimiter)) {
		if (dir.length === 0) continue;
		for (const ext of exts) {
			try {
				accessSync(join(dir, bin + ext), fsConstants.X_OK);
				return true;
			} catch {
				// not in this dir / not executable — keep looking
			}
		}
	}
	return false;
}

function checkHarness(harness: Harness): Check {
	const binary = HARNESS_BINARY[harness];
	const pass = isOnPath(binary);
	return {
		name: "Harness binary",
		pass,
		detail: pass
			? `${binary} found on PATH (harness: ${harness})`
			: `${binary} not found on PATH — install the "${harness}" harness`,
		hard: true,
	};
}

function checkCredential(harness: Harness): Check {
	const envVar = CREDENTIAL_ENV_VARS.find(
		(name) => (process.env[name]?.length ?? 0) > 0,
	);
	const credentialsFile = join(homedir(), ".claude", ".credentials.json");
	const hasClaudeLogin =
		harness === "claude-code" && existsSync(credentialsFile);

	if (envVar) {
		return {
			name: "LLM credential",
			pass: true,
			detail: `${envVar} is set`,
			hard: true,
		};
	}
	if (hasClaudeLogin) {
		return {
			name: "LLM credential",
			pass: true,
			detail: "~/.claude/.credentials.json present (Claude Code login)",
			hard: true,
		};
	}
	const hint =
		harness === "claude-code"
			? "set ANTHROPIC_API_KEY or sign in with `claude` (creates ~/.claude/.credentials.json)"
			: `set one of ${CREDENTIAL_ENV_VARS.join(", ")}`;
	return {
		name: "LLM credential",
		pass: false,
		detail: `no LLM credential found — ${hint}`,
		hard: true,
	};
}

async function checkWorkspace(config: PlConfig): Promise<Check> {
	const baseDir = resolveBaseDir(config.workspace.base_dir);
	try {
		await mkdir(baseDir, { recursive: true });
		await access(baseDir, fsConstants.W_OK);
		return {
			name: "Workspace",
			pass: true,
			detail: `${baseDir} is writable`,
			hard: false,
		};
	} catch {
		return {
			name: "Workspace",
			pass: false,
			detail: `${baseDir} is not writable — runs cannot persist here`,
			hard: false,
		};
	}
}

export default defineCommand({
	meta: {
		name: "doctor",
		description: "Preflight check the investigation environment",
	},
	async run() {
		// loadConfig applies schema defaults, so this succeeds even with no config
		// file. It only throws on an invalid file / unset ${VAR}; fall back to the
		// built-in defaults so doctor can still report what it can.
		let config: PlConfig;
		try {
			config = await loadConfig();
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			consola.warn(
				`Could not load config (${detail}); using built-in defaults.`,
			);
			config = PlConfigSchema.parse({});
		}

		const harness = config.agent.default;

		const checks: Check[] = [
			checkHarness(harness),
			checkCredential(harness),
			await checkWorkspace(config),
		];

		consola.log("");
		for (const check of checks) {
			const line = `${check.name}: ${check.detail}`;
			if (check.pass) consola.success(line);
			else if (check.hard) consola.error(line);
			else consola.warn(line);
		}
		consola.log("");

		const hardFailures = checks.filter((c) => c.hard && !c.pass);
		if (hardFailures.length > 0) {
			consola.error(
				`${hardFailures.length} required check(s) failed — fix the above before investigating.`,
			);
			process.exit(1);
		}
		consola.success("All required checks passed.");
	},
});
