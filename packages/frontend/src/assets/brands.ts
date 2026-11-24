// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Every agent and model maker with a published mark, drawn as shipped: no fill is set in CSS.
 * The files in `./brands` come from the owners' own pages or from @lobehub/icons-static-svg
 * 1.106.0 (MIT), whose colour variants keep each owner's colours; `source` is where each came from.
 * An owner that publishes one ink per theme has a `-light` and a `-dark` file.
 */
const FILES = import.meta.glob<string>("./brands/*.svg", {
	eager: true,
	query: "?no-inline",
	import: "default",
});

export interface Brand {
	/** The id of the agent (`claude-code`) or model maker or provider (`anthropic`) it marks. */
	id: string;
	/** The file's basename under `./brands`, without `.svg`, per theme. */
	files: { light: string; dark: string };
	/** The page or file the artwork came from. */
	source: string;
	/** The smallest size its owner allows, in px. */
	min?: { width: number; height: number };
}

const LOBE = "https://unpkg.com/@lobehub/icons-static-svg@1.106.0/icons";
const lobe = (id: string, file: string, ink = false): Brand => ({
	id,
	files: ink
		? { light: `${file}-light`, dark: `${file}-dark` }
		: { light: file, dark: file },
	source: `${LOBE}/${file}.svg`,
});

export const BRANDS: readonly Brand[] = [
	lobe("claude-code", "claudecode-color"),
	lobe("codex", "codex-color"),
	lobe("gemini", "geminicli-color"),
	{
		id: "opencode",
		files: { light: "opencode-light", dark: "opencode-dark" },
		source:
			"https://opencode.ai/brand/files/opencode-logo-transparent-light.svg",
		min: { width: 16, height: 20 },
	},
	{
		id: "deepagents",
		files: { light: "deepagents", dark: "deepagents" },
		source:
			"https://github.com/langchain-ai/deepagents/blob/main/.github/images/logo-dark.svg",
	},
	lobe("anthropic", "anthropic", true),
	lobe("openai", "openai", true),
	lobe("google", "google-color"),
	lobe("deepseek", "deepseek-color"),
	lobe("mistral", "mistral-color"),
	lobe("xai", "xai", true),
	lobe("meta", "meta-color"),
	lobe("alibaba", "alibaba-color"),
	lobe("moonshotai", "moonshot", true),
	lobe("zhipuai", "zhipu-color"),
	{
		id: "openrouter",
		files: { light: "openrouter-light", dark: "openrouter-dark" },
		source: "https://openrouter.ai/brand/v2/openrouter-light.svg",
	},
	lobe("nvidia", "nvidia-color"),
	lobe("cohere", "cohere-color"),
	lobe("minimax", "minimax-color"),
	lobe("stepfun", "stepfun-color"),
	lobe("tencent", "tencent-color"),
	lobe("poolside", "poolside-color"),
	lobe("arcee-ai", "arcee-color"),
];

const BY_ID = new Map(BRANDS.map((b) => [b.id, b]));

export function brandOf(id: string | null | undefined): Brand | undefined {
	return id ? BY_ID.get(id) : undefined;
}

/** The shipped file's URL for one theme. */
export function brandUrl(brand: Brand, theme: "light" | "dark"): string {
	const url = FILES[`./brands/${brand.files[theme]}.svg`];
	if (!url) throw new Error(`no brand file ${brand.files[theme]}.svg`);
	return url;
}
