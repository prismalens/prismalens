import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="px-4 py-6 sm:px-0">
      <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
        Settings
      </h1>

      <div className="space-y-6">
        {/* LLM Configuration */}
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
            LLM Configuration
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Configure your preferred LLM provider. PrismaLens supports multiple providers via LiteLLM.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Provider
              </label>
              <select className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white">
                <option value="google">Google (Gemini)</option>
                <option value="openai">OpenAI (GPT-4)</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="azure">Azure OpenAI</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Model
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="gemini-2.0-flash"
                defaultValue="gemini-2.0-flash"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                API Key
              </label>
              <input
                type="password"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="Enter your API key"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Your API key is stored securely and never shared.
              </p>
            </div>
          </div>
        </div>

        {/* Integrations */}
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
            Integrations
          </h2>

          <div className="space-y-4">
            <IntegrationCard
              name="GitHub"
              description="Connect to analyze code and git history"
              connected={true}
            />
            <IntegrationCard
              name="Render"
              description="Collect logs from Render.com services"
              connected={false}
            />
            <IntegrationCard
              name="Prometheus"
              description="Query metrics and alerts"
              connected={false}
            />
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-6 border border-red-200 dark:border-red-800">
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-4">
            Danger Zone
          </h2>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-medium text-slate-900 dark:text-white">
                  Clear Investigation History
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Delete all investigation data. This action cannot be undone.
                </p>
              </div>
              <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
                Clear All
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function IntegrationCard({
  name,
  description,
  connected,
}: {
  name: string
  description: string
  connected: boolean
}) {
  return (
    <div className="flex justify-between items-center p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
      <div>
        <h3 className="font-medium text-slate-900 dark:text-white">{name}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      {connected ? (
        <span className="px-3 py-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full text-sm">
          Connected
        </span>
      ) : (
        <button className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300">
          Connect
        </button>
      )}
    </div>
  )
}
