import { createFileRoute, Link } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { ArrowLeft, CheckCircle } from 'lucide-react'

// Dynamically import React Flow to avoid SSR issues
const InvestigationCanvas = lazy(() => import('@/components/InvestigationCanvas'))

export const Route = createFileRoute('/investigations/$id/')({
  component: InvestigationDetailPage,
})

function InvestigationDetailPage() {
  const { id: investigationId } = Route.useParams()

  // Mock data - will be replaced with API calls
  const investigation = {
    id: investigationId,
    alertName: 'HTTP 500 Errors Spike',
    service: 'auth-service',
    severity: 'critical',
    status: 'completed',
    confidence: 0.87,
    startedAt: '2024-01-15T10:30:00Z',
    completedAt: '2024-01-15T10:35:00Z',
    alertData: {
      service: 'auth-service',
      timestamp: '2024-01-15T10:28:00Z',
    },
    gathererData: {
      logsCollected: 150,
      filesAnalyzed: 12,
    },
    analyzerData: {
      rootCause: 'Database connection pool exhausted',
      confidence: 0.87,
    },
    recommenderData: {
      count: 3,
      recommendations: [
        {
          title: 'Increase connection pool size',
          priority: 'high',
          description: 'Increase the database connection pool from 10 to 25 connections',
        },
        {
          title: 'Add connection timeout handling',
          priority: 'medium',
          description: 'Implement proper timeout handling for database connections',
        },
        {
          title: 'Set up connection pool monitoring',
          priority: 'low',
          description: 'Add metrics for connection pool usage to prevent future issues',
        },
      ],
    },
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/investigations"
          className="inline-flex items-center text-sm text-slate-600 dark:text-slate-400 hover:text-primary-600 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Investigations
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
              {investigation.alertName}
            </h1>
            <div className="flex items-center mt-2 space-x-4">
              <span className="px-2 py-1 text-xs font-medium rounded bg-slate-100 dark:bg-slate-600 text-slate-700 dark:text-slate-200">
                {investigation.service}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Case ID: {investigation.id}
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
              <CheckCircle className="w-4 h-4 mr-1" />
              {investigation.status}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Confidence: {(investigation.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Investigation Canvas */}
      <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
          Investigation Flow
        </h2>
        <Suspense fallback={<div className="h-96 flex items-center justify-center">Loading...</div>}>
          <InvestigationCanvas
            investigationId={investigationId}
            data={{
              alertData: investigation.alertData,
              gathererData: investigation.gathererData,
              analyzerData: investigation.analyzerData,
              recommenderData: investigation.recommenderData,
              status: investigation.status,
            }}
          />
        </Suspense>
      </div>

      {/* Root Cause & Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Root Cause */}
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
            Root Cause Analysis
          </h2>
          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <p className="text-purple-900 dark:text-purple-100 font-medium">
              {investigation.analyzerData.rootCause}
            </p>
            <div className="mt-2 flex items-center text-sm text-purple-700 dark:text-purple-300">
              <span>Confidence: {(investigation.analyzerData.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {/* Recommendations */}
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
            Recommendations
          </h2>
          <ul className="space-y-3">
            {investigation.recommenderData.recommendations.map((rec, index) => (
              <li
                key={index}
                className="p-3 bg-slate-50 dark:bg-slate-700 rounded-lg"
              >
                <div className="flex justify-between items-start">
                  <span className="font-medium text-slate-900 dark:text-white">
                    {rec.title}
                  </span>
                  <PriorityBadge priority={rec.priority} />
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                  {rec.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors = {
    high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    low: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  }

  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded ${colors[priority as keyof typeof colors] || colors.medium}`}
    >
      {priority}
    </span>
  )
}
