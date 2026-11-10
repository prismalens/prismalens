// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Reflector } from "@nestjs/core";
import { sourcesContract } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { IS_PUBLIC_KEY } from "../../core/auth/public.decorator.js";
import { OpenAPIController } from "./openapi.controller.js";

describe("OpenAPIController and contracts dead routes (#1066)", () => {
	it("OpenAPIController has no docs handler and is not public", () => {
		const reflector = new Reflector();
		const isPublic = reflector.get(IS_PUBLIC_KEY, OpenAPIController);
		expect(isPublic).toBeUndefined();

		const proto = OpenAPIController.prototype as unknown as Record<
			string,
			unknown
		>;
		expect(proto.docs).toBeUndefined();
		expect(proto.getScalarDocs).toBeUndefined();
	});

	it("sourcesContract has no retest and no setRunbooks", () => {
		expect("retest" in sourcesContract).toBe(false);
		expect("setRunbooks" in sourcesContract).toBe(false);
	});
});
