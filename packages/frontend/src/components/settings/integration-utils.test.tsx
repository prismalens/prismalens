// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionStatusBadge } from "./integration-utils";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("ConnectionStatusBadge", () => {
	it('ACTIVE renders "connected"', async () => {
		await act(async () => {
			root.render(<ConnectionStatusBadge status="ACTIVE" />);
		});
		expect(container.textContent).toContain("connected");
	});

	it('ACTIVE with untested renders "not tested"', async () => {
		await act(async () => {
			root.render(<ConnectionStatusBadge status="ACTIVE" untested={true} />);
		});
		expect(container.textContent).toContain("not tested");
	});

	it('CREDENTIALS_INVALID renders "rejected" (#831 w6-9)', async () => {
		await act(async () => {
			root.render(<ConnectionStatusBadge status="CREDENTIALS_INVALID" />);
		});
		expect(container.textContent).toBe("rejected");
	});

	it('ERROR with untested renders "error"', async () => {
		await act(async () => {
			root.render(<ConnectionStatusBadge status="ERROR" untested={true} />);
		});
		expect(container.textContent).toContain("error");
	});
});
