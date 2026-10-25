// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import { TriangleAlert } from "lucide-react";

/**
 * The agent page's environment words (#848): one state per variable and the
 * two lines under it; the shell-versus-PrismaLens chain stays out.
 */

/** The provider keys that are API keys: what Sign-in offers, and what the sign-in warning is about (#911). */
export const apiKeyVars = (id: HarnessId): string[] =>
	(HARNESS_REGISTRY[id]?.providerKeys ?? []).filter((k) =>
		k.endsWith("_API_KEY"),
	);

export const isApiKeyVar = (id: HarnessId, name: string) =>
	apiKeyVars(id).includes(name);

/** One state word: Key set, From environment, Not set (#911's `set`/`env`/`unset`). */
export function envStateWord(state: "set" | "env" | "unset"): string {
	return state === "set"
		? "Key set"
		: state === "env"
			? "From environment"
			: "Not set";
}

/**
 * Under a variable set in PrismaLens: "Overrides the environment" when the
 * shell has it too, and on an API key the conditional warning, since
 * PrismaLens cannot tell which credential a signed-in agent uses (OBJ-008).
 */
export function EnvVarNotes({
	agent,
	id,
	name,
	state,
	inEnv,
}: {
	agent: string;
	id: HarnessId;
	name: string;
	state: "set" | "env" | "unset";
	inEnv?: boolean;
}) {
	if (state !== "set") return null;
	return (
		<>
			{inEnv && (
				<p className="text-meta text-text-2" data-testid="env-overrides">
					Overrides the environment
				</p>
			)}
			{isApiKeyVar(id, name) && (
				<p
					className="mt-1 flex items-start gap-1.5 text-meta text-warn"
					data-testid="env-signin-warning"
				>
					<TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
					If {agent} is signed in, it may use this key instead.
				</p>
			)}
		</>
	);
}
