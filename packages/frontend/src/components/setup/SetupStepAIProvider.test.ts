// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * SetupStepAIProvider tests (#516).
 * Verifies that the keyless Claude subscription flow passes the default model
 * so the setup step completes.
 */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupStepAIProvider } from "./SetupStepAIProvider";

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

	get textContent(): string {
		if (this.nodeType === 3) {
			return (this as unknown as { nodeValue?: string }).nodeValue || "";
		}
		let text = "";
		for (const c of this.childNodes) {
			text += c.textContent;
		}
		return text;
	}

	set textContent(val: string) {
		if (this.nodeType === 3) {
			(this as unknown as { nodeValue?: string }).nodeValue = val;
		} else {
			while (this.childNodes.length > 0) {
				this.removeChild(this.childNodes[0]);
			}
			if (val) {
				const textNode = new MockNode(3, "#text", this.ownerDocument);
				(textNode as unknown as { nodeValue: string }).nodeValue = val;
				this.appendChild(textNode);
			}
		}
	}

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
		if (
			"children" in this &&
			(this as unknown as MockElement).children &&
			child.nodeType === 1
		) {
			(this as unknown as MockElement).children.push(
				child as unknown as MockElement,
			);
		}
		this._updateSiblings();
		return child;
	}

	insertBefore<T extends MockNode>(child: T, before: MockNode | null): T {
		if (!before) return this.appendChild(child);
		if (child.parentNode) child.parentNode.removeChild(child);
		child.parentNode = this;
		child.ownerDocument =
			this.ownerDocument ||
			(this.nodeType === 9 ? (this as unknown as MockDocument) : null);
		const idx = this.childNodes.indexOf(before);
		if (idx >= 0) {
			this.childNodes.splice(idx, 0, child);
			if (
				"children" in this &&
				(this as unknown as MockElement).children &&
				child.nodeType === 1
			) {
				const cIdx = (this as unknown as MockElement).children.indexOf(
					before as unknown as MockElement,
				);
				if (cIdx >= 0) {
					(this as unknown as MockElement).children.splice(cIdx, 0, child as unknown as MockElement);
				} else {
					(this as unknown as MockElement).children.push(child as unknown as MockElement);
				}
			}
		} else {
			this.childNodes.push(child);
		}
		this._updateSiblings();
		return child;
	}

	removeChild<T extends MockNode>(child: T): T {
		const idx = this.childNodes.indexOf(child);
		if (idx >= 0) {
			this.childNodes.splice(idx, 1);
		}
		if (
			"children" in this &&
			(this as unknown as MockElement).children &&
			child.nodeType === 1
		) {
			const cIdx = (this as unknown as MockElement).children.indexOf(
				child as unknown as MockElement,
			);
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

	dispatchEvent(evt: { type: string; target?: MockNode; bubbles?: boolean }) {
		if (!evt.target) evt.target = this;
		let curr: MockNode | null = this;
		while (curr) {
			const handlers = [...(curr._listeners[evt.type] || [])];
			for (const h of handlers) h.call(curr, evt);
			curr = curr.parentNode;
		}
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

	private _matches(sel: string): boolean {
		if (sel.startsWith("[") && sel.endsWith("]")) {
			const attr = sel.slice(1, -1);
			const [name, val] = attr.split("=");
			if (val !== undefined) {
				const cleanVal = val.replace(/^["']|["']$/g, "");
				return this.attributes[name] === cleanVal;
			}
			return this.attributes[attr] !== undefined;
		}
		return this.tagName.toLowerCase() === sel.toLowerCase();
	}

	querySelector(sel: string): MockElement | null {
		if (this._matches(sel)) return this;
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
		if (this._matches(sel)) res.push(this);
		for (const c of this.childNodes) {
			if (c instanceof MockElement) {
				res.push(...c.querySelectorAll(sel));
			}
		}
		return res;
	}

	click() {
		this.dispatchEvent({ type: "click" });
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
		(node as unknown as { nodeValue: string; textContent: string }).nodeValue =
			text;
		(node as unknown as { nodeValue: string; textContent: string }).textContent =
			text;
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
	globalThis.HTMLDivElement =
		class HTMLDivElement extends MockElement {} as unknown as typeof HTMLDivElement;
	globalThis.HTMLButtonElement =
		class HTMLButtonElement extends MockElement {} as unknown as typeof HTMLButtonElement;
	globalThis.HTMLInputElement =
		class HTMLInputElement extends MockElement {} as unknown as typeof HTMLInputElement;
	globalThis.HTMLIFrameElement =
		class HTMLIFrameElement extends MockElement {} as unknown as typeof HTMLIFrameElement;
	globalThis.HTMLHeadingElement =
		class HTMLHeadingElement extends MockElement {} as unknown as typeof HTMLHeadingElement;
	globalThis.HTMLParagraphElement =
		class HTMLParagraphElement extends MockElement {} as unknown as typeof HTMLParagraphElement;
	globalThis.HTMLSpanElement =
		class HTMLSpanElement extends MockElement {} as unknown as typeof HTMLSpanElement;
	globalThis.getComputedStyle = () => ({}) as CSSStyleDeclaration;
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
		setTimeout(cb, 0) as unknown as number;
	globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
	(
		globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	return doc;
}

const mockUpdateSettingsMutateAsync = vi.fn();

const mockModels = [
	{
		id: "gpt-5.4-mini",
		name: "GPT 5.4 Mini",
		provider: "openai",
		releaseDate: "2026-01-01",
		cost: { input: 0, output: 0 },
		limit: { context: 128000, output: 4096 },
	},
];

vi.mock("@/lib/api/hooks", () => ({
	useLlmEnvStatus: () => ({ data: { providers: {} }, isLoading: false }),
	useLlmSettings: () => ({
		data: { activeProvider: null, providers: {} },
		isLoading: false,
	}),
	useLlmModels: () => ({ data: { models: mockModels }, isLoading: false }),
	useLlmCredentialStatus: () => ({ data: { providers: {} } }),
	useHarnesses: () => ({
		data: {
			harnesses: [
				{
					id: "claude-code",
					label: "Claude Code (Agent SDK)",
					implemented: true,
					verdict: { usable: true, route: "cli-session", verified: true },
					runnable: true,
					blockedReason: null,
				},
			],
		},
	}),
	useOllamaModels: () => ({ data: [] }),
	useSaveLlmCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useTestLlmConnectionWithEnv: () => ({
		mutateAsync: vi.fn(),
		isPending: false,
	}),
	useUpdateLlmSettings: () => ({
		mutateAsync: mockUpdateSettingsMutateAsync,
		isPending: false,
	}),
}));

describe("SetupStepAIProvider", () => {
	let container: MockElement;
	let root: ReturnType<typeof createRoot>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdateSettingsMutateAsync.mockResolvedValue({});
		const doc = setupDOM();
		container = doc.createElement("div");
		doc.body.appendChild(container);
		root = createRoot(container as unknown as HTMLElement);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
	});

	it("passes the default Anthropic model when using Claude subscription (#516)", async () => {
		const onComplete = vi.fn();
		await act(async () => {
			root.render(
				React.createElement(SetupStepAIProvider, {
					onComplete,
					onSkip: vi.fn(),
				}),
			);
		});

		const claudeBanner = container.querySelector(
			'[data-testid="wizard-claude-session"]',
		);
		expect(claudeBanner).not.toBeNull();

		const button = claudeBanner?.querySelector("button");
		expect(button).not.toBeNull();

		await act(async () => {
			button?.click();
		});

		expect(mockUpdateSettingsMutateAsync).toHaveBeenCalledWith({
			activeProvider: "anthropic",
			providers: {
				anthropic: {
					model: "claude-sonnet-5",
				},
			},
		});
		expect(onComplete).toHaveBeenCalled();
	});

	it("persists Anthropic default model when Claude subscription is clicked even if a non-Anthropic provider and model are selected (#516)", async () => {
		const onComplete = vi.fn();
		await act(async () => {
			root.render(
				React.createElement(SetupStepAIProvider, {
					onComplete,
					onSkip: vi.fn(),
				}),
			);
		});

		// Find and click the OpenAI provider button
		const buttons = container.querySelectorAll("button");
		const openaiButton = buttons.find((b) =>
			b.textContent.includes("OpenAI"),
		);
		expect(openaiButton).not.toBeUndefined();

		await act(async () => {
			openaiButton?.click();
		});

		// Find and click the GPT 5.4 Mini model card
		const updatedButtons = container.querySelectorAll("button");
		const modelCard = updatedButtons.find((b) =>
			b.textContent.includes("GPT 5.4 Mini"),
		);
		expect(modelCard).not.toBeUndefined();

		await act(async () => {
			modelCard?.click();
		});

		// Now click the Claude subscription button
		const claudeBanner = container.querySelector(
			'[data-testid="wizard-claude-session"]',
		);
		const claudeButton = claudeBanner?.querySelector("button");
		expect(claudeButton).not.toBeNull();

		await act(async () => {
			claudeButton?.click();
		});

		expect(mockUpdateSettingsMutateAsync).toHaveBeenCalledWith({
			activeProvider: "anthropic",
			providers: {
				anthropic: {
					model: "claude-sonnet-5",
				},
			},
		});
		expect(onComplete).toHaveBeenCalled();
	});
});
