// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The public ACP registry's agents, bundled per release by `scripts/acp-registry-snapshot.mjs`
 * (#848). The app never fetches it and installs nothing (ADR 0003 §4).
 */
import { z } from "zod";
import bundled from "./acp-registry.json" with { type: "json" };

const ARG = "[\\w@%+=:,./-]+";
/** Copy-safe only: `npx -y`/`uvx` over a plain package, or `platform: https://…` (#848). */
const INSTALL_LINE = new RegExp(
	`^(?:(?:npx -y|uvx) [\\w@%+=:,./][\\w@%+=:,./-]*(?: ${ARG})*|[\\w-]+: https://[\\w.~%+:,=/-]+)$`,
);

export const AcpRegistryEntrySchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	/** The lines a person copies to install it: a command, or a platform's archive URL. */
	install: z.array(z.string().regex(INSTALL_LINE)).min(1),
});
export type AcpRegistryEntry = z.infer<typeof AcpRegistryEntrySchema>;

export const AcpRegistrySchema = z.array(AcpRegistryEntrySchema);

/** The entries that pass; one that does not is dropped, not fatal. */
export function parseAcpRegistry(raw: unknown): AcpRegistryEntry[] {
	return z
		.array(z.unknown())
		.parse(raw)
		.flatMap((item) => {
			const entry = AcpRegistryEntrySchema.safeParse(item);
			return entry.success ? [entry.data] : [];
		});
}

export const ACP_REGISTRY: readonly AcpRegistryEntry[] =
	parseAcpRegistry(bundled);
