// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

/** How one identity field is known, strongest first (#1180). */
export const IDENTITY_SOURCES = [
	"reported",
	"selected",
	"inferred",
	"thread",
	"unknown",
] as const;
export type IdentitySource = (typeof IDENTITY_SOURCES)[number];

const Known = <T extends z.ZodTypeAny>(v: T) =>
	z.object({ value: v.nullable(), source: z.enum(IDENTITY_SOURCES) });

/** Which agent ran a turn, through which provider, on whose model, each with its evidence (#1180). */
export const ModelIdentitySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		agent: Known(z.string()),
		/** The routing provider, by its models.dev id. */
		provider: Known(z.string()),
		/** The model maker, by its models.dev id. */
		maker: Known(z.string()),
		/** As the agent named it; `mixed` for a turn of several without a split. */
		model: Known(z.string()),
	}),
);
export type ModelIdentity = z.infer<typeof ModelIdentitySchema>;
export type KnownValue = ModelIdentity["model"];
