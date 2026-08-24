// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvestigationStreamPanel } from "./InvestigationStreamPanel";

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

	constructor(nodeType: number, nodeName: string, ownerDocument: MockDocument | null = null) {
		this.nodeType = nodeType;
		this.nodeName = nodeName;
		this.ownerDocument = ownerDocument;
	}

	_updateSiblings() {
		for (let i = 0; i < this.childNodes.length; i++) {
			this.childNodes[i].previousSibling = i > 0 ? this.childNodes[i - 1] : null;
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
			this.ownerDocument || (this.nodeType === 9 ? (this as unknown as MockDocument) : null);
		this.childNodes.push(child);
		if ("children" in this && (this as unknown as MockElement).children && child.nodeType === 1) {
			(this as unknown as MockElement).children.push(child as unknown as MockElement);
		}
		this._updateSiblings();
		return child;
	}

	insertBefore<T extends MockNode>(child: T, before: MockNode | null): T {
		if (!before) return this.appendChild(child);
		if (child.parentNode) child.parentNode.removeChild(child);
		child.parentNode = this;
		child.ownerDocument =
			this.ownerDocument || (this.nodeType === 9 ? (this as unknown as MockDocument) : null);
		const idx = this.childNodes.indexOf(before);
		if (idx === -1) return this.appendChild(child);
		this.childNodes.splice(idx, 0, child);
		if ("children" in this && (this as unknown as MockElement).children && child.nodeType === 1) {
			const cIdx = (this as unknown as MockElement).children.indexOf(before as unknown as MockElement);
			if (cIdx >= 0) (this as unknown as MockElement).children.splice(cIdx, 0, child as unknown as MockElement);
			else (this as unknown as MockElement).children.push(child as unknown as MockElement);
		}
		this._updateSiblings();
		return child;
	}

	removeChild<T extends MockNode>(child: T): T {
		const idx = this.childNodes.indexOf(child);
		if (idx >= 0) this.childNodes.splice(idx, 1);
		if ("children" in this && (this as unknown as MockElement).children && child.nodeType === 1) {
			const cIdx = (this as unknown as MockElement).children.indexOf(child as unknown as MockElement);
			if (cIdx >= 0) (this as unknown as MockElement).children.splice(cIdx, 1);
		}
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

	dispatchEvent(evt: { type: string }) {
		const handlers = this._listeners[evt.type] || [];
		for (const h of handlers) h.call(this, evt);
	}
}

class MockElement extends MockNode {
	tagName: string;
	children: MockElement[] = [];
	attributes: Record<string, string> = {};
	style: Record<string, unknown> & {
		setProperty: (k: string, v: unknown) => void;
		removeProperty: (k: string) => void;
	};
	_scrollTop = 0;
	scrollHeight = 0;
	clientHeight = 0;

	constructor(tag: string, ownerDoc: MockDocument | null = null) {
		super(1, tag.toUpperCase(), ownerDoc);
		this.tagName = tag.toUpperCase();
		this.style = {
			setProperty: (k: string, v: unknown) => {
				this.style[k] = v;
			},
			removeProperty: (k: string) => {
				delete this.style[k];
			},
		};
	}

	get scrollTop() {
		return this._scrollTop;
	}

	set scrollTop(val: number) {
		this._scrollTop = val;
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

	querySelector(sel: string): MockElement | null {
		if (sel.startsWith("[") && sel.endsWith("]")) {
			const attr = sel.slice(1, -1);
			if (this.attributes[attr] !== undefined) return this;
		}
		for (const c of this.childNodes) {
			if (c instanceof MockElement) {
				const found = c.querySelector(sel);
				if (found) return found;
			}
		}
		return null;
	}

	querySelectorAll(sel: string): MockElement[] {
		const res: MockElement[] = [];
		if (sel.startsWith("[") && sel.endsWith("]")) {
			const attr = sel.slice(1, -1);
			if (this.attributes[attr] !== undefined) res.push(this);
		}
		for (const c of this.childNodes) {
			if (c instanceof MockElement) {
				res.push(...c.querySelectorAll(sel));
			}
		}
		return res;
	}
}

class MockDocument extends MockNode {
	documentElement: MockElement;
	head: MockElement;
	body: MockElement;
	defaultView: unknown;

	constructor() {
		super(9, "#document");
		this.ownerDocument = this;
		this.documentElement = new MockElement("HTML", this);
		this.head = new MockElement("HEAD", this);
		this.body = new MockElement("BODY", this);
		this.documentElement.appendChild(this.head);
		this.documentElement.appendChild(this.body);
		this.appendChild(this.documentElement);
		this.defaultView = globalThis;
	}

	createElement(tag: string) {
		return new MockElement(tag, this);
	}

	createElementNS(_ns: string, tag: string) {
		return new MockElement(tag, this);
	}

	createTextNode(text: string) {
		const node = new MockNode(3, "#text", this);
		(node as unknown as { nodeValue: string; textContent: string }).nodeValue = text;
		(node as unknown as { nodeValue: string; textContent: string }).textContent = text;
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
	globalThis.getComputedStyle = () => ({}) as CSSStyleDeclaration;
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
		setTimeout(cb, 0) as unknown as number;
	globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
	(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	return doc;
}

function makeEvents(count: number, offset = 0): CanonicalEvent[] {
	return Array.from({ length: count }, (_, i) => ({
		kind: "agent_step",
		runId: "00000000-0000-0000-0000-000000000001",
		branchId: "root",
		path: [],
		seq: offset + i,
		label: null,
		text: `Step ${offset + i}`,
		toolCalls: [],
		ts: "2026-08-22T00:00:00Z",
	}));
}

describe("InvestigationStreamPanel auto-scroll", () => {
	let doc: MockDocument;
	let container: MockElement;

	beforeEach(() => {
		doc = setupDOM();
		container = doc.createElement("div");
		doc.body.appendChild(container);
	});

	afterEach(() => {
		doc.body.removeChild(container);
	});

	it("scrolls on updates even when the capped event array length is constant", async () => {
		const root = createRoot(container as unknown as HTMLElement);
		const eventsBatch1 = makeEvents(200, 0);
		const eventsBatch2 = makeEvents(200, 1);

		let scrollSetterCount = 0;
		const originalSetScrollTop = Object.getOwnPropertyDescriptor(
			MockElement.prototype,
			"scrollTop",
		)?.set;

		Object.defineProperty(MockElement.prototype, "scrollTop", {
			configurable: true,
			get() {
				return this._scrollTop;
			},
			set(val: number) {
				if (this.attributes["data-radix-scroll-area-viewport"] !== undefined) {
					scrollSetterCount++;
				}
				originalSetScrollTop?.call(this, val);
			},
		});

		try {
			await act(async () => {
				root.render(
					React.createElement(InvestigationStreamPanel, {
						events: eventsBatch1,
						latestText: "Step 199",
						status: "streaming",
					}),
				);
			});

			expect(scrollSetterCount).toBe(1);

			// Re-render with a different array of the same length (MAX_EVENTS cap saturation)
			await act(async () => {
				root.render(
					React.createElement(InvestigationStreamPanel, {
						events: eventsBatch2,
						latestText: "Step 200",
						status: "streaming",
					}),
				);
			});

			expect(scrollSetterCount).toBe(2);
		} finally {
			if (originalSetScrollTop) {
				Object.defineProperty(MockElement.prototype, "scrollTop", {
					configurable: true,
					get() {
						return this._scrollTop;
					},
					set: originalSetScrollTop,
				});
			}
			await act(async () => {
				root.unmount();
			});
		}
	});
});
