// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl up` — boot the whole app as ONE process on ONE port, with no external
 * services: the NestJS API, the SPA it serves from its own static dir, and a
 * SQLite database created on first run.
 *
 * Every path below is resolved from the INSTALLED package, never from a repo
 * checkout: `scripts/pack-cli.mjs` copies each first-party package into this
 * package's own `node_modules/@prismalens/<name>`, so `require.resolve` finds
 * exactly the copy that shipped, not a developer's monorepo.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineCommand } from "citty";
import consola from "consola";
import { cliVersion } from "../version.js";
import {
	ensureServe,
	serveTarget,
	TailscaleError,
	tailnetHostname,
	withAllowedHost,
} from "./tailscale.js";
import {
	browserCommand,
	displayUrl,
	healthUrl,
	NO_BROWSER_LINE,
	networkBindWarning,
	readTelemetryState,
	resolveBind,
	resolveConsoleMode,
	resolveLogDir,
	serviceHint,
	TELEMETRY_NOTICE,
	waitForReady,
} from "./up-console.js";
import { updateNotice } from "./update-notice.js";
import { completePendingRestore } from "./upgrade-trial.js";

const require = createRequire(import.meta.url);
const READY_TIMEOUT_MS = 60_000;

interface PackagedApi {
	/** Directory of the installed `@prismalens/api`. */
	dir: string;
	/** Absolute path to its compiled Nest entrypoint. */
	main: string;
	/** Absolute path to the built SPA it serves. */
	staticDir: string;
}

function resolvePackagedApi(): PackagedApi {
	let manifestPath: string;
	try {
		manifestPath = require.resolve("@prismalens/api/package.json");
	} catch {
		throw new Error(
			"`pl up` needs the packaged application. It resolves @prismalens/api " +
				"from this package's own node_modules, which only the published " +
				"tarball carries (see scripts/pack-cli.mjs). In the repo, run " +
				"`pnpm dev` instead.",
		);
	}
	const dir = dirname(manifestPath);
	const manifest = require(manifestPath) as { main?: string };
	if (!manifest.main) {
		throw new Error(`@prismalens/api at ${dir} declares no "main"`);
	}
	const main = join(dir, manifest.main);
	if (!existsSync(main)) {
		throw new Error(`@prismalens/api "main" points at a missing file: ${main}`);
	}
	const staticDir = process.env.PRISMALENS_STATIC_DIR ?? join(dir, "public");
	if (!existsSync(join(staticDir, "index.html"))) {
		throw new Error(
			`No SPA at ${staticDir}: index.html is missing. The packed artifact is ` +
				"incomplete — `pl up` would serve an API with no user interface.",
		);
	}
	return { dir, main, staticDir };
}

export default defineCommand({
	meta: {
		name: "up",
		description:
			"Run PrismaLens as a single process: API and dashboard on one port, SQLite, no external services.\n" +
			"Once a day this checks GitHub Releases for a newer prismalens and prints one line; no identifier is sent. " +
			"Turn it off with PRISMALENS_UPDATE_CHECK=off or DO_NOT_TRACK.",
	},
	args: {
		port: {
			type: "string",
			description:
				"Port to listen on for this run (default: the workspace's port, 6473 for a new one; or PRISMALENS_PORT)",
		},
		host: {
			type: "string",
			description: "Host to bind (default localhost, or PRISMALENS_HOST)",
		},
		workspace: {
			type: "string",
			description:
				"Data directory for the database, secrets and logs (default ~/.prismalens, or PRISMALENS_WORKSPACE_DIR)",
		},
		verbose: {
			type: "boolean",
			description:
				"Stream every log record to the terminal as well as the log file (default: warnings and errors only)",
		},
		open: {
			type: "boolean",
			default: true,
			description:
				"Open this machine's browser on the startup link (--no-open prints it only)",
		},
		"tailscale-serve": {
			type: "boolean",
			description:
				"Publish this run on your tailnet over HTTPS with `tailscale serve` and allow its https://<machine>.<tailnet>.ts.net name",
		},
		telemetry: {
			type: "string",
			description:
				"`off` disables usage telemetry for this run whatever Settings says (or PRISMALENS_TELEMETRY=off)",
		},
	},
	async run({ args }) {
		const app = resolvePackagedApi();

		// The packaged app always runs as production, whatever the shell exports;
		// CI's packed smoke and app-boot runs set the same value.
		process.env.NODE_ENV = "production";
		if (args.port) process.env.PRISMALENS_PORT = String(args.port);
		if (args.host) process.env.PRISMALENS_HOST = String(args.host);
		if (args.workspace) {
			process.env.PRISMALENS_WORKSPACE_DIR = String(args.workspace);
		}
		if (args.telemetry !== undefined) {
			if (String(args.telemetry) !== "off") {
				consola.error("--telemetry takes only `off`; turn it on in Settings.");
				process.exit(1);
			}
			process.env.PRISMALENS_TELEMETRY = "off";
		}
		process.env.PRISMALENS_STATIC_DIR = app.staticDir;
		process.env.PRISMALENS_LOG_CONSOLE = resolveConsoleMode(
			process.env,
			Boolean(args.verbose),
		);

		// @prismalens/config derives every on-disk path from this directory —
		// PRISMALENS_DB_URL is ignored, so the workspace dir is the ONLY knob.
		const { getAppDataDir, ensureAppDataDir, resolvePort } = (await import(
			"@prismalens/config"
		)) as {
			getAppDataDir: () => string;
			ensureAppDataDir: () => string;
			resolvePort: (env: NodeJS.ProcessEnv, workspaceDir: string) => number;
		};
		ensureAppDataDir();
		const workspaceDir = getAppDataDir();
		mkdirSync(workspaceDir, { recursive: true });
		// Before the API opens the database: a rollback cut short finishes first (#766).
		if (completePendingRestore(workspaceDir)) {
			consola.warn(
				"Finished restoring the database from an interrupted upgrade rollback.",
			);
		}

		// NO migration code here. The API bootstrap runs the shipped migration
		// runner (`@prismalens/database/migrator`) before Nest starts, and `pl up`
		// boots the API by importing it below — in THIS process, so that runner
		// covers this path too. `pl up` migrating first would be a second,
		// redundant pass over the same ledger (issue #335).
		//
		// What `pl up` still depends on is the migration SQL being present in the
		// tarball: `scripts/pack-cli.mjs` stages it at
		// `@prismalens/database/dist/prisma/sqlite/schema` and asserts it.
		const logDir = resolveLogDir(process.env, workspaceDir);
		const bind = resolveBind(
			process.env,
			resolvePort(process.env, workspaceDir),
		);
		const url = displayUrl(bind);
		let tailnetUrl: string | null = null;
		if (args["tailscale-serve"]) {
			if (bind.protocol === "https") {
				consola.error(
					"--tailscale-serve proxies plain HTTP; drop the TLS settings for this run.",
				);
				process.exit(1);
			}
			try {
				// Allowlisted before the API reads its env, or the tailnet name gets 403s (#765).
				process.env.PRISMALENS_ALLOWED_HOSTS = withAllowedHost(
					process.env.PRISMALENS_ALLOWED_HOSTS,
					tailnetHostname(),
				);
				tailnetUrl = ensureServe(serveTarget(bind.host, bind.port)).url;
			} catch (error) {
				if (!(error instanceof TailscaleError)) throw error;
				consola.error(error.message);
				process.exit(1);
			}
		}
		consola.info(`Workspace: ${workspaceDir}`);
		consola.info(`Logs: ${logDir}`);
		const exposed = networkBindWarning(bind);
		if (exposed) {
			consola.warn(exposed);
			// The API then logs its detail to the file only (#673).
			process.env.PRISMALENS_BIND_WARNED = "1";
		}
		if (process.env.PRISMALENS_LOG_CONSOLE === "verbose") {
			consola.info(`Dashboard: ${app.staticDir}`);
		}

		// Read from a cache written by an earlier run, so nothing here waits on
		// the network; `refresh` updates that cache for the NEXT run and is
		// deliberately never awaited.
		const notice = updateNotice({
			current: cliVersion(),
			workspaceDir,
		});
		const printUpdateNotice = () => {
			if (notice.line) consola.info(notice.line);
		};

		// One process (0005 §1-2): the API runs each investigation in-process.
		// Bootstrap exits the process itself on a fatal error, so the poll below
		// only ever ends in "ready" or "still starting".
		// The notice is printed only after the readiness probe below, so https never shows it.
		if (process.stdout.isTTY && bind.protocol !== "https")
			process.env.PRISMALENS_NOTICE_TTY = "1";
		await import(pathToFileURL(app.main).href);

		// A self-signed cert would fail the probe's TLS check; https installs get
		// the URL without the readiness line.
		if (bind.protocol === "https") {
			consola.info(`Starting at ${url}`);
			consola.info(
				"Once it is listening, `pl pair --operator` prints this machine's link.",
			);
			printUpdateNotice();
			return;
		}
		const ready = await waitForReady(healthUrl(bind), {
			timeoutMs: READY_TIMEOUT_MS,
		});
		if (ready) {
			consola.success(`PrismaLens is ready at ${url}`);
			if (tailnetUrl) {
				consola.success(`On your tailnet: ${tailnetUrl}`);
				consola.info("Pair a device there with `pl pair --tailscale`.");
			}
			const { serviceOwnsWorkspace } = await import("@prismalens/config");
			const hint = serviceHint({
				platform: process.platform,
				env: process.env,
				serviceOwnsWorkspace: serviceOwnsWorkspace(workspaceDir),
			});
			if (hint) consola.info(hint);
			await printStartupLink(workspaceDir, url, args.open !== false);
			// Never a prompt: the notice, once, on the boot that stamped it (#673 w45).
			if ((await readTelemetryState(healthUrl(bind))) === "notice") {
				consola.info(TELEMETRY_NOTICE);
			}
		} else {
			consola.warn(
				`Not listening after ${READY_TIMEOUT_MS / 1000}s. Still starting, or stuck: see ${logDir}`,
			);
		}
		printUpdateNotice();
	},
});

/**
 * The host's own browser pairs like any other device (ADR 0004 §8): one link,
 * minted now, carrying the operator's scopes. A browser that already holds
 * this machine's session skips it, so a restart adds no device.
 */
async function printStartupLink(
	workspaceDir: string,
	origin: string,
	open: boolean,
): Promise<void> {
	const { buildPairingUrl, createStartupLinkInWorkspace } = await import(
		"@prismalens/auth"
	);
	const link = await createStartupLinkInWorkspace(workspaceDir);
	const startupUrl = buildPairingUrl(origin, link.token);
	consola.info(`Open: ${startupUrl}`);
	consola.info(
		"It works once, for 15 minutes; treat it as a password. `pl pair --operator` prints another.",
	);
	const command = open
		? browserCommand(process.platform, process.env, startupUrl)
		: null;
	if (!command) return;
	const child = spawn(command.file, command.args, {
		detached: true,
		stdio: "ignore",
		windowsVerbatimArguments: process.platform === "win32",
	});
	let reported = false;
	const report = () => {
		if (reported) return;
		reported = true;
		consola.info(NO_BROWSER_LINE);
	};
	child.on("error", report);
	child.on("exit", (code) => {
		if (code !== 0) report();
	});
	child.unref();
}
