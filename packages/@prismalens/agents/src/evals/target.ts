/**
 * Eval target — wraps InvestigationExecutor as a LangSmith evaluate() target.
 *
 * The returned function:
 * 1. Receives { incidentId } from a dataset example
 * 2. Builds InvestigationInput with LLM config from env
 * 3. Streams via executor.stream(), capturing trajectory + result
 * 4. Returns { trajectory, result } for evaluators to score
 */

import { randomUUID } from "node:crypto"
import { InvestigationExecutor } from "../executor/investigation-executor.js"
import { buildIntegrationsFromEnv } from "../providers/integration-registry.js"
import type { DataProvider } from "../providers/data-provider.js"
import type { IntegrationWithCredentials } from "../types/contexts.js"
import type { InvestigationResult } from "../types/results.js"
import type { InvestigationInput, LLMProviderConfig } from "../types/inputs.js"

/**
 * Output shape returned by the eval target for evaluators to consume.
 */
export interface EvalOutput {
  trajectory: string[]
  result: InvestigationResult | null
}

/**
 * Options for creating an eval target.
 */
interface EvalTargetOptions {
  dataProvider: DataProvider
  integrations?: IntegrationWithCredentials[]
}

/**
 * Build LLM config from environment variables.
 * Requires LLM_PROVIDER and LLM_MODEL — no defaults.
 */
export function buildLLMConfig(): LLMProviderConfig {
  const provider = process.env.LLM_PROVIDER
  const model = process.env.LLM_MODEL

  if (!provider || !model) {
    throw new Error(
      "LLM_PROVIDER and LLM_MODEL env vars are required for evals (no defaults)",
    )
  }

  const baseURL = process.env.LLM_BASE_URL

  return {
    provider: provider as LLMProviderConfig["provider"],
    model,
    ...(baseURL && { baseURL }),
  }
}

/**
 * Create a LangSmith evaluate() target function.
 *
 * Usage with langsmith/evaluation:
 * ```ts
 * const target = createEvalTarget({ dataProvider })
 * await evaluate(target, { data: "my-dataset", evaluators: [...] })
 * ```
 */
export function createEvalTarget(
  opts: EvalTargetOptions,
): (inputs: Record<string, unknown>) => Promise<EvalOutput> {
  const integrations = opts.integrations ?? buildIntegrationsFromEnv()
  const executor = new InvestigationExecutor({
    dataProvider: opts.dataProvider,
  })

  return async (inputs: Record<string, unknown>): Promise<EvalOutput> => {
    const incidentId = inputs.incidentId as string
    if (!incidentId) {
      throw new Error("Dataset example must include 'incidentId' in inputs")
    }

    const input: InvestigationInput = {
      investigationId: randomUUID(),
      incidentId,
      config: {
        llm: buildLLMConfig(),
        maxIterations: 10,
        timeout: 300_000, // 5 minutes
      },
      integrations,
    }

    const trajectory: string[] = []
    let result: InvestigationResult | null = null

    for await (const [mode, data] of executor.stream(input)) {
      // Capture node names from task lifecycle events
      if (mode === "tasks") {
        const task = data as { name?: string }
        if (task.name) {
          // Only add unique consecutive entries (avoid duplicate start/end for same node)
          if (trajectory[trajectory.length - 1] !== task.name) {
            trajectory.push(task.name)
          }
        }
      }

      // Capture the final result from state updates
      if (mode === "updates") {
        const update = data as Record<string, unknown>
        for (const nodeData of Object.values(update)) {
          const nd = nodeData as Record<string, unknown>
          if (nd?.result && typeof nd.result === "object") {
            const candidate = nd.result as Record<string, unknown>
            if ("investigationId" in candidate && "status" in candidate) {
              result = candidate as unknown as InvestigationResult
            }
          }
        }
      }
    }

    return { trajectory, result }
  }
}
