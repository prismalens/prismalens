// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who makes a model and who serves it, from the models.dev snapshot that
 * `scripts/sync-models.mjs` writes for the pin-bump PR (#1101). Nothing here
 * guesses from a model's name: a maker the snapshot lacks gets letters from its id.
 */
import snapshot from "./model-makers.json" with { type: "json" };

export interface ModelMaker {
	id: string;
	name: string;
	/** Its tile's letters, for a maker with no published logo (`frontend/src/assets/brands.ts`). */
	letters: string;
}

const MAKERS: Readonly<Record<string, { name: string; letters: string }>> =
	snapshot.makers;
const PROVIDERS: Readonly<Record<string, { name: string }>> =
	snapshot.providers;

/**
 * Account pages: the one fact per provider the snapshot does not carry. A provider
 * missing here has no page PrismaLens can link to.
 */
export const PROVIDER_ACCOUNTS: Readonly<
	Record<string, { billing: string; limits?: string }>
> = {
	anthropic: {
		billing: "https://platform.claude.com/settings/billing",
		limits: "https://platform.claude.com/settings/limits",
	},
	openai: {
		billing: "https://platform.openai.com/settings/organization/billing",
		limits: "https://platform.openai.com/settings/organization/limits",
	},
	google: {
		billing: "https://aistudio.google.com/usage",
		limits: "https://aistudio.google.com/usage",
	},
	opencode: { billing: "https://opencode.ai/console/billing" },
	openrouter: { billing: "https://openrouter.ai/settings/credits" },
	deepseek: { billing: "https://platform.deepseek.com/top_up" },
};

/** Two letters: the first two words or camel humps of a name, else its first two letters. */
export function makerLetters(name: string): string {
	const words = name
		.replace(/\(.*?\)/g, "")
		.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g) ?? ["?"];
	const [a = "?", b] = words;
	return (b ? a.charAt(0) + b.charAt(0) : a.slice(0, 2)).toUpperCase();
}

/** A provider's name by its models.dev id, or null when the snapshot has none. */
export function providerName(id: string): string | null {
	return PROVIDERS[id]?.name ?? null;
}

/** The maker behind `id`: the snapshot's name and letters, else the id and letters from it. */
export function modelMaker(id: string): ModelMaker {
	const known = MAKERS[id] ?? PROVIDERS[id];
	const name = known?.name ?? id;
	return {
		id,
		name,
		letters: MAKERS[id]?.letters ?? makerLetters(name),
	};
}

/** The provider a model id routes through: its `provider/` prefix, as the agent reported it. */
export function modelProvider(modelId: string): string | null {
	const slash = modelId.indexOf("/");
	return slash > 0 ? modelId.slice(0, slash) : null;
}

/** A provider's name and account pages; null when neither the snapshot nor the accounts know it. */
export function providerFacts(
	id: string,
): { id: string; name: string; billing?: string; limits?: string } | null {
	const name = providerName(id);
	const pages = PROVIDER_ACCOUNTS[id];
	return name || pages ? { id, name: name ?? id, ...pages } : null;
}

/** How one identity field is known, as `ModelIdentitySchema` in contracts records it. */
export type IdentitySource =
	| "reported"
	| "selected"
	| "inferred"
	| "thread"
	| "unknown";
export type Known = { value: string | null; source: IdentitySource };
export interface ModelIdentityShape {
	agent: Known;
	provider: Known;
	maker: Known;
	model: Known;
}

/** What the resolver reads of an agent's registry row. */
export interface IdentityAgentFacts {
	vendor?: string;
	routingEnvKeys?: readonly string[];
	catalogue?: { prefixed?: boolean };
}

export interface IdentityEvidence {
	agent: Known;
	model: Known;
	/** A provider the agent itself reported for the session. */
	reportedProvider?: string | null;
	/** The run's env and the `env` of the settings files it read; null when not known, as at read time. */
	env: Readonly<Record<string, string | undefined>> | null;
	/** The listed entry's or the catalogue's maker for the model. */
	maker?: string | null;
}

const UNKNOWN: Known = { value: null, source: "unknown" };

/**
 * One rule per field, from evidence only (#1180). Provider: the agent's own report or its
 * prefixed id; else its vendor, only when the run env is known to hold none of its routing keys.
 */
export function modelIdentity(
	facts: IdentityAgentFacts | null,
	evidence: IdentityEvidence,
): ModelIdentityShape {
	const model = evidence.model.value;
	const prefix =
		facts?.catalogue?.prefixed && model ? modelProvider(model) : null;
	const reported = evidence.reportedProvider ?? prefix;
	const env = evidence.env;
	const routed =
		!env ||
		!facts?.routingEnvKeys ||
		facts.routingEnvKeys.some((k) => env[k] !== undefined && env[k] !== "");
	const provider: Known = reported
		? { value: reported, source: "reported" }
		: facts?.vendor && !routed
			? { value: facts.vendor, source: "inferred" }
			: UNKNOWN;
	return {
		agent: evidence.agent,
		provider,
		maker: evidence.maker
			? { value: evidence.maker, source: "inferred" }
			: UNKNOWN,
		model: evidence.model,
	};
}

export const MODEL_MAKERS_AS_OF: string = snapshot.updatedAt;
