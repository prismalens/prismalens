import { createFileRoute } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { Activity, Clock, CheckCircle, AlertCircle } from 'lucide-react'

export const Route = createFileRoute('/investigations/')({
  component: InvestigationsPage,
})

function InvestigationsPage() {
  // Mock data - will be replaced with API calls
  const investigations = [
    {
      id: 'case_abc123',
      alertName: 'HTTP 500 Errors Spike',
      service: 'auth-service',
      status: 'completed',
      confidence: 0.87,
      startedAt: '2024-01-15T10:30:00Z',
      completedAt: '2024-01-15T10:35:00Z',
    },
    {
      id: 'case_def456',
      alertName: 'High Memory Usage',
      service: 'todo-app-api',
      status: 'running',
      confidence: null,
      startedAt: '2024-01-15T10:40:00Z',
      completedAt: null,
    },
    {
      id: 'case_ghi789',
      alertName: 'Database Connection Timeout',
      service: 'payment-gateway',
      status: 'completed',
      confidence: 0.92,
      startedAt: '2024-01-15T09:15:00Z',
      completedAt: '2024-01-15T09:22:00Z',
    },
  ]

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
          Investigations
        </h1>
        <button className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700">
          New Investigation
        </button>
      </div>

      {/* Investigations Table */}
      <div className="bg-white dark:bg-slate-800 shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">
                Case ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">
                Alert
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">
                Service
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">
                Confidence
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">
                Duration
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
            {investigations.map((investigation) => (
              <tr
                key={investigation.id}
                className="hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <Link
                    to="/investigations/$id"
                    params={{ id: investigation.id }}
                    className="text-primary-600 hover:text-primary-800 font-mono text-sm"
                  >
                    {investigation.id}
                  </Link>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-slate-900 dark:text-white">
                    {investigation.alertName}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 py-1 text-xs font-medium rounded bg-slate-100 dark:bg-slate-600 text-slate-700 dark:text-slate-200">
                    {investigation.service}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <StatusBadge status={investigation.status} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {investigation.confidence ? (
                    <div className="flex items-center">
                      <div className="w-16 bg-slate-200 dark:bg-slate-600 rounded-full h-2 mr-2">
                        <div
                          className="bg-green-500 h-2 rounded-full"
                          style={{ width: `${investigation.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-slate-600 dark:text-slate-300">
                        {(investigation.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-slate-400">-</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                  {investigation.completedAt
                    ? calculateDuration(
                        investigation.startedAt,
                        investigation.completedAt
                      )
                    : 'In progress...'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig = {
    completed: {
      icon: CheckCircle,
      className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    },
    running: {
      icon: Activity,
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    },
    failed: {
      icon: AlertCircle,
      className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    },
    pending: {
      icon: Clock,
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    },
  }

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending
  const Icon = config.icon

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}
    >
      <Icon className="w-3 h-3 mr-1" />
      {status}
    </span>
  )
}

function calculateDuration(start: string, end: string): string {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const diffMs = endDate.getTime() - startDate.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffSecs = Math.floor((diffMs % 60000) / 1000)
  return `${diffMins}m ${diffSecs}s`
}
