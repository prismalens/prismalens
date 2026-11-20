// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

/** Why this client cannot open a terminal; the panel says it in words. */
export const TerminalUnavailableReasonSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum([
		/** A paired device, or a request that came through a proxy. */
		"not-host",
		/** The host's own browser, but it has no terminal key (not opened from a startup link). */
		"no-key",
		/** The PTY module failed to load on this machine. */
		"unsupported",
	]),
);
export type TerminalUnavailableReason = z.infer<
	typeof TerminalUnavailableReasonSchema
>;

export const TerminalAvailabilitySchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("available", [
		z.object({ available: z.literal(true) }),
		z.object({
			available: z.literal(false),
			reason: TerminalUnavailableReasonSchema,
		}),
	]),
);
export type TerminalAvailability = z.infer<typeof TerminalAvailabilitySchema>;

export const TerminalKeyInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		key: z.string().max(128).optional(),
	}),
);

export const TerminalTicketSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		ticket: z.string(),
		expiresAt: z.string(),
	}),
);

export const TerminalClaimKeyInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		/** An unused operator link, minted on the host (`pl pair --operator`). */
		token: z.string().min(1),
	}),
);

/** What the browser sends over the terminal socket, as JSON text frames. */
export const TerminalClientFrameSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("t", [
		z.object({ t: z.literal("in"), d: z.string().max(16384) }),
		/** A staged command the user confirmed with Enter; checked again on the server. */
		z.object({ t: z.literal("run"), d: z.string() }),
		z.object({
			t: z.literal("resize"),
			cols: z.number().int().min(2).max(1000),
			rows: z.number().int().min(1).max(500),
		}),
		/** Bytes of output xterm has finished writing (flow control). */
		z.object({ t: z.literal("ack"), n: z.number().int().min(0) }),
	]),
);
export type TerminalClientFrame = z.infer<typeof TerminalClientFrameSchema>;

/** Text frames from the server; output itself goes as binary frames. */
export const TerminalServerFrameSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("t", [
		z.object({ t: z.literal("exit"), code: z.number().nullable() }),
		z.object({ t: z.literal("refused"), reason: z.string() }),
	]),
);
export type TerminalServerFrame = z.infer<typeof TerminalServerFrameSchema>;

/** The socket path, under the API prefix so the dev proxy and allowlists see it. */
export const TERMINAL_SOCKET_PATH = "/api/terminal/socket";
