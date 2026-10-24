// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The public ACP registry's agents, bundled per release by `scripts/acp-registry-snapshot.mjs`
 * (#848). The app never fetches it and installs nothing (ADR 0003 §4).
 */
import { z } from "zod";
import bundled from "./acp-registry.json" with { type: "json" };

export const AcpRegistryEntrySchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	/** The lines a person copies to install it: a command, or a platform's archive URL. */
	install: z.array(z.string().min(1)).min(1),
});
export type AcpRegistryEntry = z.infer<typeof AcpRegistryEntrySchema>;

export const AcpRegistrySchema = z.array(AcpRegistryEntrySchema);

export const ACP_REGISTRY: readonly AcpRegistryEntry[] =
	AcpRegistrySchema.parse(bundled);
