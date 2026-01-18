/**
 * MockLLM - Deterministic LLM for Testing
 *
 * Provides a mock LLM implementation that returns predefined responses
 * in sequence, enabling deterministic testing of agent workflows.
 *
 * Based on LangChain's "Evaluating Deep Agents" best practices.
 */

import {
	type AIMessage,
	AIMessageChunk,
	type BaseMessage,
	HumanMessage,
} from "@langchain/core/messages";
import type { BaseChatModel, BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult, ChatGeneration } from "@langchain/core/outputs";

// =============================================================================
// TYPES
// =============================================================================

export interface MockResponse {
	/** The text content to return */
	content: string;
	/** Optional tool calls to include in the response */
	toolCalls?: MockToolCall[];
	/** Optional function calls (legacy format) */
	functionCalls?: MockFunctionCall[];
	/** Delay in milliseconds before responding (for testing async behavior) */
	delay?: number;
	/** Whether this should be a streaming response */
	stream?: boolean;
	/** Optional metadata */
	metadata?: Record<string, unknown>;
}

export interface MockToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface MockFunctionCall {
	name: string;
	arguments: string;
}

export interface MockLLMConfig extends BaseChatModelParams {
	/** Pre-configured responses to return in sequence */
	responses: MockResponse[];
	/** Whether to loop back to start when responses are exhausted */
	loop?: boolean;
	/** Default delay for all responses (ms) */
	defaultDelay?: number;
	/** Callback for tracking calls */
	onCall?: (messages: BaseMessage[], response: MockResponse) => void;
}

// =============================================================================
// CALL HISTORY TRACKING
// =============================================================================

export interface LLMCall {
	messages: BaseMessage[];
	response: MockResponse;
	timestamp: Date;
	index: number;
}

// =============================================================================
// MOCK LLM IMPLEMENTATION
// =============================================================================

/**
 * MockLLM for deterministic testing
 *
 * @example
 * ```typescript
 * const mockLLM = createMockLLM({
 *   responses: [
 *     { content: "I'll analyze the logs first." },
 *     {
 *       content: "Based on my analysis...",
 *       toolCalls: [{
 *         id: "call_1",
 *         name: "form_hypothesis",
 *         args: { claim: "Database timeout", confidence: 85 }
 *       }]
 *     }
 *   ]
 * });
 *
 * const result = await mockLLM.invoke([new HumanMessage("Investigate")]);
 * expect(mockLLM.callHistory).toHaveLength(1);
 * ```
 */
export class MockLLM {
	private responses: MockResponse[];
	private loop: boolean;
	private defaultDelay: number;
	private onCall?: (messages: BaseMessage[], response: MockResponse) => void;
	private currentIndex: number = 0;
	public callHistory: LLMCall[] = [];

	constructor(config: MockLLMConfig) {
		this.responses = config.responses;
		this.loop = config.loop ?? false;
		this.defaultDelay = config.defaultDelay ?? 0;
		this.onCall = config.onCall;
	}

	get _llmType(): string {
		return "mock";
	}

	get callCount(): number {
		return this.callHistory.length;
	}

	/**
	 * Reset the mock to initial state
	 */
	reset(): void {
		this.currentIndex = 0;
		this.callHistory = [];
	}

	/**
	 * Get the next response in sequence
	 */
	private getNextResponse(): MockResponse {
		if (this.currentIndex >= this.responses.length) {
			if (this.loop) {
				this.currentIndex = 0;
			} else {
				throw new Error(
					`MockLLM exhausted: ${this.responses.length} responses configured, ` +
					`but ${this.currentIndex + 1} calls made. Set loop: true to cycle.`
				);
			}
		}
		return this.responses[this.currentIndex++];
	}

	/**
	 * Create an AIMessage from a MockResponse
	 */
	private createMessage(response: MockResponse): AIMessage {
		const message: AIMessage = {
			content: response.content,
			additional_kwargs: {},
			response_metadata: response.metadata || {},
			lc_namespace: ["langchain_core", "messages"],
			lc_serializable: true,
		} as AIMessage;

		// Add tool calls if present
		if (response.toolCalls && response.toolCalls.length > 0) {
			message.tool_calls = response.toolCalls.map((tc) => ({
				id: tc.id,
				name: tc.name,
				args: tc.args,
				type: "tool_call" as const,
			}));
		}

		// Add legacy function calls if present
		if (response.functionCalls && response.functionCalls.length > 0) {
			message.additional_kwargs.function_call = response.functionCalls[0];
		}

		return message;
	}

	/**
	 * Invoke the mock LLM
	 */
	async invoke(messages: BaseMessage[]): Promise<AIMessage> {
		const response = this.getNextResponse();

		// Apply delay
		const delay = response.delay ?? this.defaultDelay;
		if (delay > 0) {
			await new Promise((resolve) => setTimeout(resolve, delay));
		}

		// Track the call
		this.callHistory.push({
			messages: [...messages],
			response,
			timestamp: new Date(),
			index: this.currentIndex - 1,
		});

		// Call callback if provided
		if (this.onCall) {
			this.onCall(messages, response);
		}

		return this.createMessage(response);
	}

	/**
	 * Bind tools to the mock (no-op, but needed for compatibility)
	 */
	bindTools(_tools: unknown[]): MockLLM {
		return this;
	}

	/**
	 * Get calls that triggered a specific tool
	 */
	getCallsWithTool(toolName: string): LLMCall[] {
		return this.callHistory.filter((call) =>
			call.response.toolCalls?.some((tc) => tc.name === toolName)
		);
	}

	/**
	 * Assert that a specific tool was called
	 */
	assertToolCalled(toolName: string, times?: number): void {
		const calls = this.getCallsWithTool(toolName);
		if (times !== undefined) {
			if (calls.length !== times) {
				throw new Error(
					`Expected tool "${toolName}" to be called ${times} times, but was called ${calls.length} times`
				);
			}
		} else if (calls.length === 0) {
			throw new Error(`Expected tool "${toolName}" to be called, but it was never called`);
		}
	}
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a mock LLM with the given responses
 */
export function createMockLLM(config: MockLLMConfig): MockLLM {
	return new MockLLM(config);
}

/**
 * Create a mock LLM for a typical investigation workflow
 *
 * @example
 * ```typescript
 * const mockLLM = createInvestigationMockLLM({
 *   hypothesis: {
 *     claim: "Null pointer in auth handler",
 *     confidence: 85,
 *     category: "code",
 *   },
 *   recommendation: {
 *     title: "Fix null check",
 *     priority: "high",
 *   },
 * });
 * ```
 */
export function createInvestigationMockLLM(options: {
	/** Initial context gathering response */
	gatheringResponse?: string;
	/** Hypothesis to form */
	hypothesis?: {
		claim: string;
		confidence: number;
		category: "code" | "config" | "infrastructure" | "external" | "unknown";
		evidence?: string[];
	};
	/** Recommendation to propose */
	recommendation?: {
		title: string;
		description?: string;
		priority: "critical" | "high" | "medium" | "low";
		category?: "code_fix" | "config_change" | "rollback" | "monitoring" | "investigation";
	};
}): MockLLM {
	const responses: MockResponse[] = [];

	// Phase 1: Context gathering
	responses.push({
		content: options.gatheringResponse || "I'll analyze the available data.",
	});

	// Phase 2: Hypothesis formation
	if (options.hypothesis) {
		responses.push({
			content: "Based on my analysis, I've formed a hypothesis.",
			toolCalls: [
				{
					id: "hypothesis_1",
					name: "form_hypothesis",
					args: {
						claim: options.hypothesis.claim,
						confidence: options.hypothesis.confidence,
						category: options.hypothesis.category,
						evidence: options.hypothesis.evidence || [
							"Evidence from analysis",
						],
					},
				},
			],
		});
	}

	// Phase 3: Recommendation
	if (options.recommendation) {
		responses.push({
			content: "I recommend the following fix.",
			toolCalls: [
				{
					id: "recommend_1",
					name: "propose_fix",
					args: {
						title: options.recommendation.title,
						description: options.recommendation.description || "Fix proposal",
						priority: options.recommendation.priority,
						category: options.recommendation.category || "code_fix",
						urgency: options.recommendation.priority === "critical" ? "immediate" : "short_term",
					},
				},
			],
		});
	}

	// Final summary
	responses.push({
		content: "Investigation complete. Summary provided.",
	});

	return createMockLLM({ responses, loop: true });
}

// =============================================================================
// RESPONSE BUILDERS
// =============================================================================

/**
 * Builder for creating mock responses with tool calls
 */
export class MockResponseBuilder {
	private response: MockResponse;

	constructor(content: string = "") {
		this.response = { content };
	}

	static create(content: string = ""): MockResponseBuilder {
		return new MockResponseBuilder(content);
	}

	withContent(content: string): MockResponseBuilder {
		this.response.content = content;
		return this;
	}

	withToolCall(
		name: string,
		args: Record<string, unknown>,
		id?: string,
	): MockResponseBuilder {
		if (!this.response.toolCalls) {
			this.response.toolCalls = [];
		}
		this.response.toolCalls.push({
			id: id || `call_${this.response.toolCalls.length + 1}`,
			name,
			args,
		});
		return this;
	}

	withDelay(ms: number): MockResponseBuilder {
		this.response.delay = ms;
		return this;
	}

	withMetadata(metadata: Record<string, unknown>): MockResponseBuilder {
		this.response.metadata = metadata;
		return this;
	}

	build(): MockResponse {
		return { ...this.response };
	}
}
