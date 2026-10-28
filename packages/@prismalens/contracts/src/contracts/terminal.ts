// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The integrated terminal (#931). Only the host's own browser or desktop app,
 * holding the terminal key, gets a ticket; the socket at TERMINAL_SOCKET_PATH
 * takes the ticket once.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	TerminalAvailabilitySchema,
	TerminalClaimKeyInputSchema,
	TerminalKeyInputSchema,
	TerminalTicketSchema,
} from "../schemas/terminal.js";

export const terminalContract = {
	/** POST /terminal/availability: whether this client may open a terminal, and why not. */
	availability: oc
		.route({
			method: "POST",
			path: "/terminal/availability",
			summary: "Whether this client can open a terminal on the host",
			tags: ["terminal"],
		})
		.input(TerminalKeyInputSchema)
		.output(TerminalAvailabilitySchema),

	/** POST /terminal/ticket: a single-use, 30-second ticket for the socket. */
	ticket: oc
		.route({
			method: "POST",
			path: "/terminal/ticket",
			summary: "A single-use ticket to open one terminal",
			tags: ["terminal"],
		})
		.input(TerminalKeyInputSchema)
		.output(TerminalTicketSchema),

	/** POST /terminal/key: an already-paired host browser trades a fresh operator link for its key. */
	claimKey: oc
		.route({
			method: "POST",
			path: "/terminal/key",
			summary:
				"Exchange an unused operator link for this device's terminal key",
			tags: ["terminal"],
		})
		.input(TerminalClaimKeyInputSchema)
		.output(z.object({ key: z.string() })),
};
