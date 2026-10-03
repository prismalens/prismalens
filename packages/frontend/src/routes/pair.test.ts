// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PairView } from "./pair";

describe("PairView revocation copy (f6)", () => {
	it("shows 'This device was revoked...' when server indicates revoked cookie", () => {
		const html = renderToStaticMarkup(
			React.createElement(PairView, {
				token: "",
				operatorReason: "revoked",
				redeem: { isError: false, error: null },
			}),
		);

		expect(html).toContain(
			"This device was revoked on the machine running PrismaLens. Ask for a new pairing link.",
		);
		expect(html).not.toContain("Nothing to pair");
	});

	it("shows 'Nothing to pair' when request has no token and is not revoked", () => {
		const html = renderToStaticMarkup(
			React.createElement(PairView, {
				token: "",
				operatorReason: null,
				redeem: { isError: false, error: null },
			}),
		);

		expect(html).toContain("Nothing to pair");
		expect(html).not.toContain("This device was revoked");
	});
});
