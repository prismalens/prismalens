/**
 * Investigation Semaphore
 *
 * In-memory concurrency control for regular mode investigations.
 * Limits the number of concurrent investigations to prevent resource exhaustion.
 */

export interface QueuedRequest {
	resolve: () => void;
	reject: (error: Error) => void;
	investigationId: string;
	queuedAt: Date;
}

/**
 * Semaphore for limiting concurrent investigation executions.
 * Used in regular mode (non-queue mode) to prevent unbounded parallelism.
 *
 * @example
 * const semaphore = new InvestigationSemaphore(3); // Max 3 concurrent
 *
 * // In your execution code:
 * await semaphore.acquire(investigationId);
 * try {
 *   await runInvestigation(...);
 * } finally {
 *   semaphore.release();
 * }
 */
export class InvestigationSemaphore {
	private running = 0;
	private queue: QueuedRequest[] = [];

	constructor(private readonly maxConcurrent: number) {
		if (maxConcurrent < 1) {
			throw new Error("maxConcurrent must be at least 1");
		}
	}

	/**
	 * Acquire a slot for execution.
	 * If slots are available, returns immediately.
	 * Otherwise, waits in queue until a slot becomes available.
	 *
	 * @param investigationId - ID of the investigation (for debugging/monitoring)
	 * @returns Promise that resolves when the slot is acquired
	 */
	async acquire(investigationId: string): Promise<void> {
		if (this.running < this.maxConcurrent) {
			this.running++;
			return;
		}

		// Queue the request
		return new Promise<void>((resolve, reject) => {
			this.queue.push({
				resolve,
				reject,
				investigationId,
				queuedAt: new Date(),
			});
		});
	}

	/**
	 * Release a slot after execution completes.
	 * If there are queued requests, the next one is granted the slot
	 * without decrementing (atomic handoff to prevent race conditions).
	 */
	release(): void {
		const next = this.queue.shift();
		if (next) {
			// Atomic handoff: keep running count the same (one out, one in)
			next.resolve();
		} else {
			// Only decrement if no queued request takes the slot
			this.running--;
		}
	}

	/**
	 * Cancel a queued request for an investigation.
	 * Does nothing if the investigation is not in the queue.
	 *
	 * @param investigationId - ID of the investigation to cancel
	 * @returns true if the request was found and cancelled
	 */
	cancel(investigationId: string): boolean {
		const index = this.queue.findIndex(
			(req) => req.investigationId === investigationId,
		);

		if (index === -1) {
			return false;
		}

		const [removed] = this.queue.splice(index, 1);
		removed.reject(new Error("Investigation cancelled while waiting in queue"));
		return true;
	}

	/**
	 * Get current semaphore status.
	 */
	getStatus(): {
		running: number;
		queued: number;
		maxConcurrent: number;
		queuedInvestigations: Array<{ id: string; waitingMs: number }>;
	} {
		const now = Date.now();
		return {
			running: this.running,
			queued: this.queue.length,
			maxConcurrent: this.maxConcurrent,
			queuedInvestigations: this.queue.map((req) => ({
				id: req.investigationId,
				waitingMs: now - req.queuedAt.getTime(),
			})),
		};
	}

	/**
	 * Check if a slot is immediately available (without acquiring).
	 */
	isAvailable(): boolean {
		return this.running < this.maxConcurrent;
	}

	/**
	 * Get the queue position for an investigation.
	 * Returns -1 if not in queue (either running or not found).
	 */
	getQueuePosition(investigationId: string): number {
		return this.queue.findIndex(
			(req) => req.investigationId === investigationId,
		);
	}
}
