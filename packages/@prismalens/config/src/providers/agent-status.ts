// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What Settings → Agents says about an agent beside its check (#1171): its sign-in line and version. */
import semver from "semver";
import { quote } from "shell-quote";
import type { HarnessDescriptor } from "./harness.js";

type SignInRow = Pick<
	HarnessDescriptor,
	"binary" | "companionBinary" | "configDir" | "signInArgs"
>;

// biome-ignore lint/suspicious/noControlCharactersInRegex: a newline or control character would end the staged line early (#1171).
const CONTROL = /[\u0000-\u001f\u007f]/;
// about_Quoting_Rules: smart quotation marks close a single-quoted string too, so each is doubled (#1171).
const PS_QUOTES = /['‘’‚‛]/g;
const PS_BARE = /^[A-Za-z0-9_./:-]+$/;

const psQuote = (value: string) => `'${value.replace(PS_QUOTES, "$&$&")}'`;
const psArg = (value: string) => (PS_BARE.test(value) ? value : psQuote(value));

/**
 * The agent's own login as one shell line, run in the user's terminal; null when
 * it has none, or a value would not survive quoting. Never names a stored env value.
 */
export function signInCommand(
	row: SignInRow,
	opts: { binaryPath?: string; configDir?: string; platform: string },
): string | null {
	if (!row.signInArgs) return null;
	const program = opts.binaryPath ?? row.companionBinary ?? row.binary;
	if (!program) return null;
	const configDir = row.configDir && opts.configDir ? opts.configDir : null;
	const values = [
		program,
		...row.signInArgs,
		...(configDir ? [configDir] : []),
	];
	if (values.some((v) => CONTROL.test(v))) return null;
	if (opts.platform === "win32") {
		const prefix =
			configDir && row.configDir
				? `$env:${row.configDir.envKey}=${psQuote(configDir)}; `
				: "";
		const head = opts.binaryPath ? `& ${psQuote(program)}` : psArg(program);
		return `${prefix}${[head, ...row.signInArgs.map(psArg)].join(" ")}`;
	}
	const prefix =
		configDir && row.configDir
			? `${row.configDir.envKey}=${quote([configDir])} `
			: "";
	return `${prefix}${quote([program, ...row.signInArgs])}`;
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
