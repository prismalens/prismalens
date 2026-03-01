/**
 * Dataset seeding script — creates/updates LangSmith datasets from local JSON fixtures.
 *
 * Usage:
 *   LANGSMITH_API_KEY=... pnpm -F @prismalens/agents eval:seed
 *   LANGSMITH_API_KEY=... pnpm -F @prismalens/agents eval:seed --update
 */

import { Client } from "langsmith"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATASETS_DIR = resolve(__dirname, "datasets")

interface DatasetFixture {
  name: string
  description: string
  examples: Array<{
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
    metadata?: Record<string, unknown>
  }>
}

async function main() {
  const isUpdate = process.argv.includes("--update")
  const client = new Client()

  const files = readdirSync(DATASETS_DIR).filter((f) => f.endsWith(".json"))

  for (const file of files) {
    const content = readFileSync(resolve(DATASETS_DIR, file), "utf-8")
    const fixture: DatasetFixture = JSON.parse(content)

    console.log(`\nProcessing: ${fixture.name} (${fixture.examples.length} examples)`)

    let dataset: { id: string }

    if (isUpdate) {
      // Find existing dataset by name
      const datasets = []
      for await (const ds of client.listDatasets({ datasetName: fixture.name })) {
        datasets.push(ds)
      }

      if (datasets.length === 0) {
        console.log(`  Dataset "${fixture.name}" not found, creating...`)
        dataset = await client.createDataset(fixture.name, {
          description: fixture.description,
        })
      } else {
        dataset = datasets[0]
        console.log(`  Found existing dataset: ${dataset.id}`)
      }
    } else {
      // Create new dataset (will fail if exists)
      dataset = await client.createDataset(fixture.name, {
        description: fixture.description,
      })
      console.log(`  Created dataset: ${dataset.id}`)
    }

    // Create examples
    await client.createExamples({
      datasetId: dataset.id,
      inputs: fixture.examples.map((e) => e.inputs),
      outputs: fixture.examples.map((e) => e.outputs),
      metadata: fixture.examples.map((e) => e.metadata ?? {}),
    })

    console.log(`  Added ${fixture.examples.length} examples`)
  }

  console.log("\nDone!")
}

main().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
