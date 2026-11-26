// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { installCommand } from "@prismalens/providers/agents";
/** What Settings → Agents says about an agent beside its check (#1171): its sign-in line and version. */
import semver from "semver";
import { quote } from "shell-quote";
import type { HarnessDescriptor } from "./harness.js";

type CommandRow = Pick<
	HarnessDescriptor,
	"binary" | "companionBinary" | "configDir"
>;
type SignInRow = CommandRow & Pick<HarnessDescriptor, "signInArgs">;

/** Where the agent's own CLI runs from and which config folder it reads, as Settings sets them. */
export interface CommandOpts {
	binaryPath?: string;
	configDir?: string;
	platform: string;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: a newline or control character would end the staged line early (#1171).
const CONTROL = /[\u0000-\u001f\u007f]/;
// about_Quoting_Rules: smart quotation marks close a single-quoted string too, so each is doubled (#1171).
const PS_QUOTES = /['‘’‚‛]/g;
const PS_BARE = /^[A-Za-z0-9_./:-]+$/;

const psQuote = (value: string) => `'${value.replace(PS_QUOTES, "$&$&")}'`;
const psArg = (value: string) => (PS_BARE.test(value) ? value : psQuote(value));

/**
 * The agent's own CLI with `args` as one shell line, run in the user's terminal; null
 * when a value would not survive quoting. Never names a stored env value.
 */
export function agentCommand(
	row: CommandRow,
	args: readonly string[],
	opts: CommandOpts,
): string | null {
	const program = opts.binaryPath ?? row.companionBinary ?? row.binary;
	if (!program) return null;
	const configDir = row.configDir && opts.configDir ? opts.configDir : null;
	const values = [program, ...args, ...(configDir ? [configDir] : [])];
	if (values.some((v) => CONTROL.test(v))) return null;
	if (opts.platform === "win32") {
		const prefix =
			configDir && row.configDir
				? `$env:${row.configDir.envKey}=${psQuote(configDir)}; `
				: "";
		const head = opts.binaryPath ? `& ${psQuote(program)}` : psArg(program);
		return `${prefix}${[head, ...args.map(psArg)].join(" ")}`;
	}
	const prefix =
		configDir && row.configDir
			? `${row.configDir.envKey}=${quote([configDir])} `
			: "";
	return `${prefix}${quote([program, ...args])}`;
}

/** The agent's own login as one shell line; null when it has none. */
export function signInCommand(
	row: SignInRow,
	opts: CommandOpts,
): string | null {
	return row.signInArgs ? agentCommand(row, row.signInArgs, opts) : null;
}

/** How the agent's CLI was installed, read from where its binary lies; null when no known channel holds it. */
export type FoundChannel =
	| "npm"
	| { cask: string }
	| { formula: string }
	| null;

/** Where the binary was found on PATH (or set), and the file that path resolves to. */
export interface FoundBinary {
	path: string;
	realPath: string;
}

const norm = (p: string, platform: string) => {
	const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
	return platform === "win32" ? s.toLowerCase() : s;
};
const under = (dir: string, p: string, platform: string) =>
	norm(p, platform).startsWith(`${norm(dir, platform)}/`);
const dirOf = (p: string, platform: string) =>
	norm(p, platform).replace(/\/[^/]*$/, "");

/**
 * npm when the binary sits in npm's global bin folder (`{prefix}` on Windows,
 * `{prefix}/bin` elsewhere, npm docs "folders") or resolves into its global
 * modules; Homebrew when it resolves under `Caskroom/<cask>` or `Cellar/<formula>`.
 */
export function installChannelOf(
	bin: FoundBinary,
	where: { npmPrefix: string | null; brewPrefix: string | null },
	brew: { cask?: string; formula?: string } | undefined,
	platform: string,
): FoundChannel {
	const { npmPrefix, brewPrefix } = where;
	if (npmPrefix) {
		const win = platform === "win32";
		const binDir = win ? npmPrefix : `${npmPrefix}/bin`;
		const modules = win
			? `${npmPrefix}/node_modules`
			: `${npmPrefix}/lib/node_modules`;
		if (
			dirOf(bin.path, platform) === norm(binDir, platform) ||
			dirOf(bin.realPath, platform) === norm(binDir, platform) ||
			under(modules, bin.realPath, platform)
		)
			return "npm";
	}
	if (
		brewPrefix &&
		brew?.cask &&
		under(`${brewPrefix}/Caskroom/${brew.cask}`, bin.realPath, platform)
	)
		return { cask: brew.cask };
	if (
		brewPrefix &&
		brew?.formula &&
		under(`${brewPrefix}/Cellar/${brew.formula}`, bin.realPath, platform)
	)
		return { formula: brew.formula };
	return null;
}

type UpdateRow = CommandRow &
	Pick<
		HarnessDescriptor,
		"updateArgs" | "updateFallbackArgs" | "updateLine" | "channel"
	>;

/** Shown when nothing says how this install updates. */
export const UPDATE_FALLBACK_LINE = "Update it the way you installed it";

/**
 * How to update the agent: its own updater, else the channel its binary came from,
 * else its own fallback updater, else its documented route as text. A line is never a command for another install.
 */
export function updateRoute(
	row: UpdateRow,
	found: FoundChannel,
	opts: CommandOpts,
): { command: string } | { line: string } {
	const own = row.updateArgs ? agentCommand(row, row.updateArgs, opts) : null;
	if (own) return { command: own };
	if (found === "npm" && row.channel && "npm" in row.channel)
		return { command: installCommand({ npm: `${row.channel.npm}@latest` }) };
	if (found && typeof found === "object")
		return {
			command:
				"cask" in found
					? `brew upgrade --cask ${found.cask}`
					: `brew upgrade ${found.formula}`,
		};
	const fallback = row.updateFallbackArgs
		? agentCommand(row, row.updateFallbackArgs, opts)
		: null;
	if (fallback) return { command: fallback };
	return { line: row.updateLine ?? UPDATE_FALLBACK_LINE };
}

/** The version it ran against the one PrismaLens was tested with; null when either is unknown. */
export function versionVsTested(
	ran: string | null | undefined,
	tested: string | null | undefined,
): "older" | "same" | "newer" | null {
	const a = ran ? semver.coerce(ran, { includePrerelease: true }) : null;
	const b = tested ? semver.coerce(tested, { includePrerelease: true }) : null;
	if (!a || !b) return null;
	const c = semver.compare(a, b);
	return c < 0 ? "older" : c > 0 ? "newer" : "same";
}
