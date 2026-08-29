// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useInvestigationStream } from "./use-investigation-stream";

class MockNode {
	static ELEMENT_NODE = 1;
	static TEXT_NODE = 3;
	static COMMENT_NODE = 8;
	static DOCUMENT_NODE = 9;
	static DOCUMENT_FRAGMENT_NODE = 11;

	nodeType: number;
	nodeName: string;
	childNodes: MockNode[] = [];
	parentNode: MockNode | null = null;
	nextSibling: MockNode | null = null;
	previousSibling: MockNode | null = null;
	firstChild: MockNode | null = null;
	lastChild: MockNode | null = null;
	ownerDocument: MockDocument | null = null;
	_listeners: Record<string, ((evt: unknown) => void)[]> = {};

	constructor(
		nodeType: number,
		nodeName: string,
		ownerDocument: MockDocument | null = null,
	) {
		this.nodeType = nodeType;
		this.nodeName = nodeName;
		this.ownerDocument = ownerDocument;
	}

	_updateSiblings() {
		for (let i = 0; i < this.childNodes.length; i++) {
			this.childNodes[i].previousSibling =
				i > 0 ? this.childNodes[i - 1] : null;
			this.childNodes[i].nextSibling =
				i < this.childNodes.length - 1 ? this.childNodes[i + 1] : null;
		}
		this.firstChild = this.childNodes[0] || null;
		this.lastChild = this.childNodes[this.childNodes.length - 1] || null;
	}

	appendChild<T extends MockNode>(child: T): T {
		if (child.parentNode) child.parentNode.removeChild(child);
		child.parentNode = this;
		child.ownerDocument =
			this.ownerDocument ||
			(this.nodeType === 9 ? (this as unknown as MockDocument) : null);
		this.childNodes.push(child);
		this._updateSiblings();
		return child;
	}

	removeChild<T extends MockNode>(child: T): T {
		const idx = this.childNodes.indexOf(child);
		if (idx >= 0) this.childNodes.splice(idx, 1);
		child.parentNode = null;
		this._updateSiblings();
		return child;
	}

	addEventListener(type: string, fn: (evt: unknown) => void) {
		(this._listeners[type] = this._listeners[type] || []).push(fn);
	}

	removeEventListener(type: string, fn: (evt: unknown) => void) {
		if (this._listeners[type]) {
			this._listeners[type] = this._listeners[type].filter((l) => l !== fn);
		}
	}
}

class MockElement extends MockNode {
	tagName: string;
	children: MockElement[] = [];
	attributes: Record<string, string> = {};
	style: Record<string, unknown> = {};

	constructor(tag: string, ownerDoc: MockDocument | null = null) {
		super(1, tag.toUpperCase(), ownerDoc);
		this.tagName = tag.toUpperCase();
	}

	setAttribute(k: string, v: unknown) {
		this.attributes[k] = String(v);
	}

	getAttribute(k: string) {
		return this.attributes[k] ?? null;
	}

	removeAttribute(k: string) {
		delete this.attributes[k];
	}

	hasAttribute(k: string) {
		return k in this.attributes;
	}
}

class MockDocument extends MockNode {
	documentElement: MockElement;
	head: MockElement;
	body: MockElement;

	constructor() {
		super(9, "#document");
		this.ownerDocument = this;
		this.documentElement = new MockElement("HTML", this);
		this.head = new MockElement("HEAD", this);
		this.body = new MockElement("BODY", this);
		this.documentElement.appendChild(this.head);
		this.documentElement.appendChild(this.body);
		this.appendChild(this.documentElement);
	}

	createElement(tag: string) {
		return new MockElement(tag, this);
	}

	createElementNS(_ns: string, tag: string) {
		return new MockElement(tag, this);
	}

	createTextNode(text: string) {
		const node = new MockNode(3, "#text", this);
		(node as unknown as { nodeValue: string; textContent: string }).nodeValue =
			text;
		(
			node as unknown as { nodeValue: string; textContent: string }
		).textContent = text;
		return node;
	}

	createComment(text: string) {
		const node = new MockNode(8, "#comment", this);
		(node as unknown as { nodeValue: string }).nodeValue = text;
		return node;
	}

	createDocumentFragment() {
		return new MockNode(11, "#document-fragment", this);
	}
}

class MockEventSource {
	static instances: MockEventSource[] = [];

	url: string;
	readyState = 0;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	closed = false;

	constructor(url: string) {
		this.url = url;
		this.readyState = 1;
		MockEventSource.instances.push(this);
	}

	close() {
		this.closed = true;
		this.readyState = 2;
	}

	emitMessage(data: unknown) {
		this.onmessage?.({ data: JSON.stringify(data) });
	}

	emitError() {
		this.onerror?.(new Event("error"));
	}
}

function setupDOM() {
	const doc = new MockDocument();
	globalThis.window = globalThis as unknown as Window & typeof globalThis;
	globalThis.document = doc as unknown as Document;
	globalThis.Node = MockNode as unknown as typeof Node;
	globalThis.Element = MockElement as unknown as typeof Element;
	globalThis.HTMLElement = MockElement as unknown as typeof HTMLElement;
	globalThis.HTMLDivElement = MockElement as unknown as typeof HTMLDivElement;
	globalThis.HTMLButtonElement = class HTMLButtonElement extends MockElement {} as unknown as typeof HTMLButtonElement;
	globalThis.HTMLIFrameElement = class HTMLIFrameElement extends MockElement {} as unknown as typeof HTMLIFrameElement;
	globalThis.HTMLInputElement = class HTMLInputElement extends MockElement {} as unknown as typeof HTMLInputElement;
	globalThis.HTMLTextAreaElement = class HTMLTextAreaElement extends MockElement {} as unknown as typeof HTMLTextAreaElement;
	globalThis.getComputedStyle = () => ({}) as CSSStyleDeclaration;
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
		setTimeout(cb, 0) as unknown as number;
	globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
	globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
	(
		globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	return doc;
}

describe("useInvestigationStream", () => {
	let doc: MockDocument;
	let container: MockElement;

	beforeEach(() => {
		MockEventSource.instances = [];
		doc = setupDOM();
		container = doc.createElement("div");
		doc.body.appendChild(container);
	});

	afterEach(() => {
		doc.body.removeChild(container);
	});

	it("keeps status streaming on in-stream canonical error event and sets error on transport failure", async () => {
		let latestHookState: ReturnType<typeof useInvestigationStream> | undefined;

		function TestComponent({
			id,
			enabled,
		}: { id: string; enabled: boolean }) {
			const state = useInvestigationStream(id, { enabled });
			latestHookState = state;
			return null;
		}

		const root = createRoot(container as unknown as HTMLElement);

		await act(async () => {
			root.render(
				React.createElement(TestComponent, {
					id: "inv-1",
					enabled: true,
				}),
			);
		});

		expect(MockEventSource.instances).toHaveLength(1);
		const source = MockEventSource.instances[0];
		expect(source.url).toBe("/api/investigations/inv-1/stream");
		expect(latestHookState?.status).toBe("connecting");

		// Deliver an agent_step event
		const stepEvent: CanonicalEvent = {
			kind: "agent_step",
			runId: "run-1",
			branchId: "root",
			path: [],
			seq: 0,
			label: "scout",
			text: "Mapping services",
			toolCalls: [],
			ts: "2026-08-22T00:00:00Z",
		};
		await act(async () => {
			source.emitMessage(stepEvent);
		});
		expect(latestHookState?.status).toBe("streaming");
		expect(latestHookState?.events).toHaveLength(1);
		expect(latestHookState?.latestText).toBe("Mapping services");

		// Deliver a canonical error event (case 2: in-stream error event over open EventSource)
		const errorEvent: CanonicalEvent = {
			kind: "error",
			runId: "run-1",
			branchId: "root",
			path: [],
			seq: 1,
			label: null,
			message: "harness lost the tool socket",
			ts: "2026-08-22T00:00:01Z",
		};
		await act(async () => {
			source.emitMessage(errorEvent);
		});

		// Status MUST remain "streaming", NOT "error"
		expect(latestHookState?.status).toBe("streaming");
		expect(latestHookState?.events).toHaveLength(2);
		expect(source.closed).toBe(false);

		// Deliver a subsequent step over the still-open stream
		const retryEvent: CanonicalEvent = {
			kind: "agent_step",
			runId: "run-1",
			branchId: "root",
			path: [],
			seq: 2,
			label: "scout",
			text: "Retrying with fallback tool",
			toolCalls: [],
			ts: "2026-08-22T00:00:02Z",
		};
		await act(async () => {
			source.emitMessage(retryEvent);
		});
		expect(latestHookState?.status).toBe("streaming");
		expect(latestHookState?.events).toHaveLength(3);

		// Now trigger transport failure (case 1: source.onerror)
		await act(async () => {
			source.emitError();
		});

		// Status MUST transition to "error" and close the source
		expect(latestHookState?.status).toBe("error");
		expect(source.closed).toBe(true);

		await act(async () => {
			root.unmount();
		});
	});

	it("transitions status to completed on { type: 'done' } marker", async () => {
		let latestHookState: ReturnType<typeof useInvestigationStream> | undefined;

		function TestComponent({
			id,
			enabled,
		}: { id: string; enabled: boolean }) {
			const state = useInvestigationStream(id, { enabled });
			latestHookState = state;
			return null;
		}

		const root = createRoot(container as unknown as HTMLElement);

		await act(async () => {
			root.render(
				React.createElement(TestComponent, {
					id: "inv-2",
					enabled: true,
				}),
			);
		});

		const source = MockEventSource.instances[0];

		// Deliver an in-stream error event
		const errorEvent: CanonicalEvent = {
			kind: "error",
			runId: "run-2",
			branchId: "root",
			path: [],
			seq: 0,
			label: null,
			message: "step failed",
			ts: "2026-08-22T00:00:00Z",
		};
		await act(async () => {
			source.emitMessage(errorEvent);
		});
		expect(latestHookState?.status).toBe("streaming");

		// Deliver done marker
		await act(async () => {
			source.emitMessage({ type: "done" });
		});

		expect(latestHookState?.status).toBe("completed");
		expect(source.closed).toBe(true);

		await act(async () => {
			root.unmount();
		});
	});
});
