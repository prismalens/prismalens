/**
 * Code Bug Scenarios for Agent Evaluation
 *
 * These scenarios test the agent's ability to identify code-related issues:
 * - NullPointerException / undefined access
 * - Type errors
 * - Logic bugs
 * - Memory leaks
 *
 * Each scenario includes mock responses for GitHub and Render to enable
 * controlled, repeatable testing without real API calls.
 */

import {
	createCodeBugScenario,
	createIncident,
	createAlert,
	type ScenarioDefinition,
} from "../fixtures/incidents.js";
import type { ScenarioWithMocks } from "./types.js";

// =============================================================================
// EASY SCENARIOS (Clear stack traces, obvious errors)
// =============================================================================

/**
 * Classic NullPointerException with stack trace in alert annotations.
 * Agent should easily identify this as a code issue.
 *
 * Mock data includes:
 * - Code search results pointing to the problematic line
 * - The actual file content showing missing null check
 * - Recent commit that removed the null check
 * - Error logs from Render showing the NPE
 */
export const nullPointerException: ScenarioWithMocks = {
	...createCodeBugScenario("null-pointer-exception", {
		difficulty: "easy",
		input: {
			investigationId: "eval-npe-001",
			incidentId: "inc-npe-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-npe-001",
				title: "High 5xx error rate on /api/users endpoint",
				description:
					"Users are experiencing 500 errors when accessing their profile. " +
					"Error logs show NullPointerException in UserService.getUser() at line 42. " +
					"The error started after deployment v2.3.1 approximately 30 minutes ago.",
				severity: "high",
				serviceName: "api-server",
				alertCount: 3,
			}),
			alerts: [
				createAlert({
					alertId: "alert-npe-001",
					name: "HighErrorRate",
					message: "5xx error rate > 5% for api-server /api/users",
					severity: "high",
					annotations: {
						summary: "High error rate on users endpoint",
						endpoint: "/api/users",
						error_rate: "8.5%",
						threshold: "5%",
					},
				}),
				createAlert({
					alertId: "alert-npe-002",
					name: "ExceptionSpike",
					message: "NullPointerException spike detected",
					severity: "high",
					annotations: {
						exception_type: "java.lang.NullPointerException",
						exception_location: "UserService.getUser(UserService.java:42)",
						stack_trace:
							"java.lang.NullPointerException\n" +
							"  at com.example.UserService.getUser(UserService.java:42)\n" +
							"  at com.example.UserController.getProfile(UserController.java:28)\n" +
							"  at sun.reflect.NativeMethodAccessorImpl.invoke0(Native)\n",
						count: "1247",
						first_seen: "2024-01-15T10:30:00Z",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 60,
			rootCauseCategory: "code",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["NullPointer", "null", "getUser", "UserService"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				// Primary result - the problematic line
				{ file: "src/service/UserService.java", line: 42, snippet: "return user.getId();" },
				// Context - showing where user comes from
				{ file: "src/service/UserService.java", line: 38, snippet: "User user = repository.findById(id);" },
				// Related code - repository (red herring, not the issue)
				{ file: "src/repository/UserRepository.java", line: 15, snippet: "return jdbcTemplate.queryForObject(...);" },
			],
			getFile: {
				"src/service/UserService.java": `package com.example.service;

import com.example.repository.UserRepository;
import com.example.model.User;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    private final UserRepository repository;

    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    /**
     * Get user by ID.
     * Returns null if user not found.
     * @param id User ID
     * @return User or null
     */
    public User getUser(String id) {
        User user = repository.findById(id);
        return user.getId(); // NPE if user is null - REMOVED null check in PR #142
    }

    public User getUserProfile(String id) {
        User user = getUser(id);
        // Build profile...
        return user;
    }
}`,
			},
			listCommits: [
				// The problematic commit
				{
					sha: "abc123def",
					message: "perf: remove redundant null check in getUser() for faster response time",
					author: "developer@example.com",
					date: "2024-01-14T15:30:00Z",
				},
				// Unrelated commits (noise)
				{
					sha: "def456ghi",
					message: "feat: add user caching to reduce database load",
					author: "developer@example.com",
					date: "2024-01-13T10:00:00Z",
				},
				{
					sha: "ghi789jkl",
					message: "docs: update API documentation for user endpoints",
					author: "tech-writer@example.com",
					date: "2024-01-12T14:00:00Z",
				},
				{
					sha: "jkl012mno",
					message: "test: add integration tests for user service",
					author: "qa@example.com",
					date: "2024-01-11T09:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				// Primary error
				{
					timestamp: "2024-01-15T10:30:15Z",
					level: "error",
					message: "java.lang.NullPointerException at com.example.service.UserService.getUser(UserService.java:42)",
				},
				// Context
				{
					timestamp: "2024-01-15T10:30:14Z",
					level: "info",
					message: "Processing request GET /api/users/nonexistent-123",
				},
				// More context
				{
					timestamp: "2024-01-15T10:30:12Z",
					level: "info",
					message: "Cache miss for user nonexistent-123",
				},
				// Noise
				{
					timestamp: "2024-01-15T10:29:00Z",
					level: "info",
					message: "Health check passed",
				},
			],
			listServices: [
				{
					id: "srv-api-001",
					name: "api-server",
					status: "running",
					lastDeployedAt: "2024-01-14T16:00:00Z",
					lastDeployStatus: "succeeded",
				},
			],
		},
	},
	solutionHint:
		"Connect the NPE stack trace to the UserService code, find the commit that removed the null check, " +
		"and recommend adding the null check back or using Optional<User>.",
	tags: ["easy", "npe", "null-check", "java", "regression"],
};

/**
 * TypeScript undefined access error.
 * Clear error message pointing to property access on undefined.
 */
export const undefinedAccess: ScenarioWithMocks = {
	...createCodeBugScenario("undefined-property-access", {
		difficulty: "easy",
		input: {
			investigationId: "eval-undef-001",
			incidentId: "inc-undef-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-undef-001",
				title: "TypeError: Cannot read property 'id' of undefined",
				description:
					"The checkout flow is failing with TypeError. " +
					"Stack trace points to OrderService.processOrder where order.customer.id is accessed " +
					"but customer can be undefined when order is created via API directly.",
				severity: "high",
				serviceName: "checkout-service",
				alertCount: 2,
			}),
			alerts: [
				createAlert({
					alertId: "alert-undef-001",
					name: "UnhandledException",
					message: "TypeError: Cannot read property 'id' of undefined",
					severity: "high",
					annotations: {
						error_type: "TypeError",
						error_message: "Cannot read property 'id' of undefined",
						location: "OrderService.processOrder:87",
						stack_trace:
							"TypeError: Cannot read property 'id' of undefined\n" +
							"    at OrderService.processOrder (src/services/order.ts:87:35)\n" +
							"    at CheckoutController.checkout (src/controllers/checkout.ts:42:20)\n",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 60,
			rootCauseCategory: "code",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["undefined", "property", "customer", "id"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "src/services/order.ts", line: 87, snippet: "const customerId = order.customer.id;" },
				{ file: "src/services/order.ts", line: 45, snippet: "customer?: Customer; // Optional customer" },
				{ file: "src/controllers/checkout.ts", line: 42, snippet: "await orderService.processOrder(order);" },
			],
			getFile: {
				"src/services/order.ts": `import { Order, Customer } from '../models';

export interface ProcessOrderInput {
  orderId: string;
  items: OrderItem[];
  customer?: Customer; // Optional - not set for API orders
}

export class OrderService {
  async processOrder(order: ProcessOrderInput): Promise<OrderResult> {
    // Validate order
    if (!order.items?.length) {
      throw new Error('Order must have items');
    }

    // BUG: customer can be undefined for API orders
    const customerId = order.customer.id;  // Line 87 - TypeError here!

    // Process payment
    await this.paymentService.charge(customerId, this.calculateTotal(order));

    // Create order record
    return this.createOrderRecord(order, customerId);
  }
}`,
			},
			listCommits: [
				{
					sha: "xyz789abc",
					message: "feat: add API order creation without customer requirement",
					author: "api-dev@example.com",
					date: "2024-01-14T11:00:00Z",
				},
				{
					sha: "abc012def",
					message: "refactor: move customer to optional field for B2B orders",
					author: "api-dev@example.com",
					date: "2024-01-13T16:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T09:45:30Z",
					level: "error",
					message: "TypeError: Cannot read property 'id' of undefined at OrderService.processOrder (order.ts:87)",
				},
				{
					timestamp: "2024-01-15T09:45:29Z",
					level: "info",
					message: "Received POST /api/orders from API key: partner-api-key-123",
				},
			],
		},
	},
	solutionHint:
		"Find the optional customer field, trace to the API order creation, recommend optional chaining " +
		"(order.customer?.id) or proper validation before access.",
	tags: ["easy", "typescript", "undefined", "optional-chaining"],
};

// =============================================================================
// MEDIUM SCENARIOS (Requires some correlation)
// =============================================================================

/**
 * Memory leak causing gradual degradation.
 * Agent needs to correlate memory growth with error increase.
 */
export const memoryLeak: ScenarioWithMocks = {
	...createCodeBugScenario("memory-leak-code", {
		difficulty: "medium",
		input: {
			investigationId: "eval-memleak-001",
			incidentId: "inc-memleak-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-memleak-001",
				title: "Service degradation with increasing response times",
				description:
					"api-server response times have been increasing steadily over the past 6 hours. " +
					"Memory usage is also climbing. Restarting pods temporarily fixes the issue " +
					"but it returns after ~4 hours. Suspect memory leak in recent code change.",
				severity: "high",
				serviceName: "api-server",
				alertCount: 4,
			}),
			alerts: [
				createAlert({
					alertId: "alert-memleak-001",
					name: "HighLatency",
					message: "P95 latency > 2s for api-server",
					severity: "high",
					annotations: {
						p50_latency: "800ms",
						p95_latency: "2.3s",
						p99_latency: "5.1s",
						normal_p95: "200ms",
					},
				}),
				createAlert({
					alertId: "alert-memleak-002",
					name: "MemoryGrowth",
					message: "Heap memory usage increasing linearly",
					severity: "medium",
					annotations: {
						current_heap: "3.2GB",
						max_heap: "4GB",
						growth_rate: "100MB/hour",
					},
				}),
				createAlert({
					alertId: "alert-memleak-003",
					name: "GCPressure",
					message: "GC taking > 10% of CPU time",
					severity: "medium",
					annotations: {
						gc_time_percent: "12%",
						gc_frequency: "15/min",
						heap_after_gc: "2.8GB",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 40,
			rootCauseCategory: "code",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["memory", "leak", "heap", "GC"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "src/cache/UserCache.ts", line: 25, snippet: "private cache = new Map<string, User>();" },
				{ file: "src/cache/UserCache.ts", line: 45, snippet: "this.cache.set(userId, user);" },
				{
					file: "src/middleware/request-context.ts",
					line: 12,
					snippet: "const contexts: Map<string, RequestContext> = new Map();",
				},
			],
			getFile: {
				"src/cache/UserCache.ts": `import { User } from '../models';

/**
 * In-memory user cache for fast lookups.
 * WARNING: This implementation has unbounded growth!
 */
export class UserCache {
  private cache = new Map<string, User>();
  private static instance: UserCache;

  static getInstance(): UserCache {
    if (!UserCache.instance) {
      UserCache.instance = new UserCache();
    }
    return UserCache.instance;
  }

  get(userId: string): User | undefined {
    return this.cache.get(userId);
  }

  set(userId: string, user: User): void {
    // BUG: No eviction policy, no TTL, no size limit
    // Memory grows unbounded as more users are cached
    this.cache.set(userId, user);
  }

  // NOTE: clear() is never called anywhere
  clear(): void {
    this.cache.clear();
  }
}`,
				"src/middleware/request-context.ts": `/**
 * Request context storage - stores context per request
 */
const contexts: Map<string, RequestContext> = new Map();

export function setContext(requestId: string, ctx: RequestContext): void {
  contexts.set(requestId, ctx);
}

export function getContext(requestId: string): RequestContext | undefined {
  return contexts.get(requestId);
}

// BUG: This cleanup is never called on request end
export function clearContext(requestId: string): void {
  contexts.delete(requestId);
}`,
			},
			listCommits: [
				{
					sha: "mem123abc",
					message: "feat: add in-memory user cache for performance",
					author: "perf-engineer@example.com",
					date: "2024-01-10T10:00:00Z",
				},
				{
					sha: "mem456def",
					message: "refactor: use singleton pattern for UserCache",
					author: "perf-engineer@example.com",
					date: "2024-01-09T14:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T16:00:00Z",
					level: "warn",
					message: "Heap usage at 80%: 3.2GB / 4GB. GC frequency elevated.",
				},
				{
					timestamp: "2024-01-15T12:00:00Z",
					level: "warn",
					message: "Heap usage at 60%: 2.4GB / 4GB. Consider memory profiling.",
				},
				{
					timestamp: "2024-01-15T08:00:00Z",
					level: "info",
					message: "Service started. Initial heap: 512MB.",
				},
			],
		},
	},
	solutionHint:
		"Identify the unbounded cache with no eviction policy, correlate with memory growth timeline, " +
		"recommend adding LRU eviction, TTL, or size limits.",
	tags: ["medium", "memory-leak", "cache", "performance"],
};

/**
 * Race condition causing intermittent failures.
 * Agent needs to recognize the pattern of sporadic errors.
 */
export const raceCondition: ScenarioWithMocks = {
	...createCodeBugScenario("race-condition", {
		difficulty: "medium",
		input: {
			investigationId: "eval-race-001",
			incidentId: "inc-race-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-race-001",
				title: "Intermittent data inconsistency in order processing",
				description:
					"Some orders are processed with incorrect totals. " +
					"The issue happens randomly, about 2% of orders. " +
					"Logs show cart updates happening concurrently with order creation. " +
					"Multiple threads accessing shared state without proper synchronization.",
				severity: "high",
				serviceName: "order-service",
				alertCount: 2,
			}),
			alerts: [
				createAlert({
					alertId: "alert-race-001",
					name: "DataInconsistency",
					message: "Order total mismatch with cart items",
					severity: "high",
					annotations: {
						error_type: "OrderTotalMismatch",
						expected_total: "$125.00",
						actual_total: "$87.50",
						affected_orders: "47 in last hour",
					},
				}),
				createAlert({
					alertId: "alert-race-002",
					name: "ConcurrentModification",
					message: "ConcurrentModificationException in CartService",
					severity: "medium",
					annotations: {
						exception: "java.util.ConcurrentModificationException",
						location: "CartService.getItems:156",
						correlation_id: "cart-update-during-checkout",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 35,
			rootCauseCategory: "code",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["concurrent", "race", "thread", "synchronization"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "src/service/CartService.java", line: 156, snippet: "for (CartItem item : items) {" },
				{ file: "src/service/CartService.java", line: 78, snippet: "private List<CartItem> items = new ArrayList<>();" },
				{ file: "src/service/OrderService.java", line: 89, snippet: "List<CartItem> cartItems = cartService.getItems();" },
			],
			getFile: {
				"src/service/CartService.java": `package com.example.service;

import java.util.ArrayList;
import java.util.List;

/**
 * Cart service - manages shopping cart items.
 * WARNING: This class is not thread-safe!
 */
public class CartService {
  // BUG: Shared mutable state without synchronization
  private List<CartItem> items = new ArrayList<>();

  public void addItem(CartItem item) {
    items.add(item);  // Not synchronized
  }

  public void removeItem(String itemId) {
    items.removeIf(i -> i.getId().equals(itemId));  // Not synchronized
  }

  public List<CartItem> getItems() {
    // BUG: Returns mutable reference, no defensive copy
    // If caller iterates while another thread modifies -> ConcurrentModificationException
    return items;
  }

  public double calculateTotal() {
    // BUG: Iterating over shared list without synchronization
    return items.stream()
        .mapToDouble(CartItem::getPrice)
        .sum();
  }
}`,
			},
			listCommits: [
				{
					sha: "race123",
					message: "feat: add async cart updates for better UX",
					author: "frontend-dev@example.com",
					date: "2024-01-12T11:00:00Z",
				},
				{
					sha: "race456",
					message: "perf: remove unnecessary locks from cart operations",
					author: "perf-dev@example.com",
					date: "2024-01-11T15:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T14:30:45Z",
					level: "error",
					message: "ConcurrentModificationException in CartService.getItems",
				},
				{
					timestamp: "2024-01-15T14:30:44Z",
					level: "debug",
					message: "Thread-A: Getting cart items for checkout",
				},
				{
					timestamp: "2024-01-15T14:30:44Z",
					level: "debug",
					message: "Thread-B: Adding item to cart async",
				},
			],
		},
	},
	solutionHint:
		"Identify shared mutable state in CartService, find the missing synchronization, " +
		"recommend using ConcurrentHashMap, synchronized blocks, or immutable patterns.",
	tags: ["medium", "race-condition", "concurrency", "java"],
};

// =============================================================================
// HARD SCENARIOS (Complex, multi-factor)
// =============================================================================

/**
 * Subtle logic bug causing data corruption.
 * Agent needs to analyze the pattern and correlate with recent changes.
 */
export const logicBug: ScenarioWithMocks = {
	...createCodeBugScenario("subtle-logic-bug", {
		difficulty: "hard",
		input: {
			investigationId: "eval-logic-001",
			incidentId: "inc-logic-001",
			priority: "critical",
			incident: createIncident({
				incidentId: "inc-logic-001",
				title: "Silent data corruption in user preferences",
				description:
					"User preferences are being reset to defaults intermittently. " +
					"No errors in logs, but users report losing their settings. " +
					"Pattern seems to correlate with timezone changes. " +
					"Issue started after last week's release that touched UserPreferenceService.",
				severity: "critical",
				serviceName: "user-service",
				customerImpact: "Users losing customized settings, high support volume",
				alertCount: 1,
			}),
			alerts: [
				createAlert({
					alertId: "alert-logic-001",
					name: "SupportTicketSpike",
					message: "High volume of preference reset complaints",
					severity: "high",
					annotations: {
						ticket_count: "234",
						ticket_category: "settings_reset",
						common_pattern: "users in non-UTC timezones",
						support_sentiment: "frustrated",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 30,
			rootCauseCategory: "code",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["logic", "preference", "timezone", "bug"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "src/service/PreferenceService.ts", line: 67, snippet: "if (lastModified < defaultDate) {" },
				{ file: "src/service/PreferenceService.ts", line: 45, snippet: "const defaultDate = new Date('2024-01-01');" },
				{ file: "src/service/PreferenceService.ts", line: 89, snippet: "return defaultPreferences;" },
			],
			getFile: {
				"src/service/PreferenceService.ts": `import { Preferences } from '../models';

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'light',
  notifications: true,
  language: 'en',
};

export class PreferenceService {
  /**
   * Get user preferences, falling back to defaults if needed.
   */
  async getPreferences(userId: string): Promise<Preferences> {
    const stored = await this.repository.find(userId);

    if (!stored) {
      return DEFAULT_PREFERENCES;
    }

    // BUG: This comparison is timezone-dependent!
    // Users in UTC- timezones can have lastModified dates that appear
    // to be "before" the defaultDate when compared as strings
    const defaultDate = new Date('2024-01-01');
    const lastModified = new Date(stored.lastModifiedAt);

    // This condition can incorrectly trigger due to timezone issues
    // causing preferences to be reset to defaults
    if (lastModified < defaultDate) {
      console.log('Preferences outdated, returning defaults');
      return DEFAULT_PREFERENCES;  // Silent corruption!
    }

    return stored.preferences;
  }

  async savePreferences(userId: string, prefs: Preferences): Promise<void> {
    await this.repository.save(userId, {
      preferences: prefs,
      lastModifiedAt: new Date().toISOString(),
    });
  }
}`,
			},
			listCommits: [
				{
					sha: "logic123",
					message: "feat: add preference versioning to reset stale preferences",
					author: "backend-dev@example.com",
					date: "2024-01-08T09:00:00Z",
				},
				{
					sha: "logic456",
					message: "fix: handle edge case where preferences are very old",
					author: "backend-dev@example.com",
					date: "2024-01-07T16:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				// No errors! That's the problem - it's silent corruption
				{
					timestamp: "2024-01-15T05:00:00Z",
					level: "info",
					message: "Preferences outdated, returning defaults for user-456",
				},
				{
					timestamp: "2024-01-15T04:30:00Z",
					level: "info",
					message: "User user-456 logged in from timezone America/Los_Angeles",
				},
				{
					timestamp: "2024-01-15T04:00:00Z",
					level: "info",
					message: "Preference check: lastModified=2023-12-31T23:00:00Z, default=2024-01-01T00:00:00Z",
				},
			],
		},
	},
	solutionHint:
		"Trace the timezone-dependent comparison bug, understand that dates from UTC- timezones " +
		"can appear before 2024-01-01T00:00:00Z when the actual local time was still Dec 31, " +
		"recommend using UTC consistently or storing timestamps without timezone issues.",
	tags: ["hard", "logic-bug", "timezone", "silent-corruption", "subtle"],
};

// =============================================================================
// EXPORT ALL SCENARIOS
// =============================================================================

export const codeBugScenarios: ScenarioWithMocks[] = [
	nullPointerException,
	undefinedAccess,
	memoryLeak,
	raceCondition,
	logicBug,
];

export const easyCodeBugScenarios = codeBugScenarios.filter(
	(s) => s.difficulty === "easy",
);

export const mediumCodeBugScenarios = codeBugScenarios.filter(
	(s) => s.difficulty === "medium",
);

export const hardCodeBugScenarios = codeBugScenarios.filter(
	(s) => s.difficulty === "hard",
);

// Legacy export for backwards compatibility
export { nullPointerException as nullPointerExceptionScenario };
