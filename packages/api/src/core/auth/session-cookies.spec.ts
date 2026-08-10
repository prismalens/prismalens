// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Response } from "express";
import { applySetCookieHeaders } from "./session-cookies.js";

describe("applySetCookieHeaders", () => {
	function fakeRes() {
		return { append: vi.fn() } as unknown as Response & {
			append: ReturnType<typeof vi.fn>;
		};
	}

	it("appends every cookie separately, attributes untouched", () => {
		const res = fakeRes();
		const headers = new Headers();
		headers.append(
			"set-cookie",
			"prismalens.session_token=abc; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; SameSite=Lax",
		);
		headers.append("set-cookie", "prismalens.session_data=xyz; Path=/; HttpOnly");

		applySetCookieHeaders(headers, res);

		expect(res.append).toHaveBeenCalledTimes(2);
		expect(res.append).toHaveBeenNthCalledWith(
			1,
			"Set-Cookie",
			"prismalens.session_token=abc; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; SameSite=Lax",
		);
		expect(res.append).toHaveBeenNthCalledWith(
			2,
			"Set-Cookie",
			"prismalens.session_data=xyz; Path=/; HttpOnly",
		);
	});

	it("does nothing when there are no cookies", () => {
		const res = fakeRes();
		applySetCookieHeaders(new Headers(), res);
		expect(res.append).not.toHaveBeenCalled();
	});

	it("tolerates a missing response", () => {
		const headers = new Headers();
		headers.append("set-cookie", "prismalens.session_token=abc; Path=/");
		expect(() => applySetCookieHeaders(headers, undefined)).not.toThrow();
	});
});
