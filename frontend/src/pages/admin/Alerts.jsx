import { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle, XCircle, Eye } from 'lucide-react'
import { adminService } from '../../services/admin'
import SkeletonLoader from '../../components/SkeletonLoader'
import ExplanationPanel from '../../components/ExplanationPanel'

const FEATURE_LABELS = {
  amount: 'Amount',
  transaction_frequency: 'Transaction frequency',
  device_change: 'Device change',
  location_change: 'Location change',
  hour_of_day: 'Hour of day',
}

const formatFeatureValue = (value) => {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

const Alerts = () => {
  const [loading, setLoading] = useState(true)
  const [alerts, setAlerts] = useState([])
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [assignee, setAssignee] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    adminService.getAlerts()
      .then(setAlerts)
      .finally(() => setLoading(false))
  }, [])

  const handleAction = async (status, alertId) => {
    const updated = await adminService.updateAlert(alertId, {
      status,
      assignee: assignee || selectedAlert?.assignee || null,
      note: note || null,
    })
    setAlerts((current) => current.map((alert) => (alert.id === alertId ? updated : alert)))
    setSelectedAlert(updated)
    setNote('')
  }

  const severityStyles = {
    high: 'bg-danger/10 text-danger border-danger/20',
    medium: 'bg-warning/10 text-warning border-warning/20',
    low: 'bg-success/10 text-success border-success/20'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fraud Alerts</h1>
          <p className="text-gray-600 mt-1">Monitor and manage suspicious activities</p>
        </div>
        <button className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary/90 transition">
          Export Alerts
        </button>
      </div>

      {loading ? (
        <SkeletonLoader type="card" count={3} />
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`bg-surface rounded-2xl border p-6 ${severityStyles[alert.severity]} hover:shadow-md transition-shadow`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${severityStyles[alert.severity]}`}>
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-900">{alert.message}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium uppercase ${severityStyles[alert.severity]}`}>
                        {alert.severity}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">
                      Transaction ID: <span className="font-mono">{alert.transactionId}</span>
                    </p>
                    <p className="text-sm text-gray-600 mb-1">Status: {alert.status}</p>
                    {alert.assignee ? <p className="text-sm text-gray-600 mb-1">Assignee: {alert.assignee}</p> : null}
                    <p className="text-xs text-gray-500">{new Date(alert.timestamp).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedAlert(alert)
                      setAssignee(alert.assignee || '')
                      setNote('')
                    }}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                    title="View details"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleAction('resolved', alert.id)}
                    className="p-2 text-success hover:bg-success/10 rounded-lg transition"
                    title="Mark as resolved"
                  >
                    <CheckCircle className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleAction('dismissed', alert.id)}
                    className="p-2 text-danger hover:bg-danger/10 rounded-lg transition"
                    title="Dismiss"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedAlert ? (
        <div className="bg-surface rounded-2xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Investigation Panel</h2>
              <p className="text-sm text-gray-600">Alert ID: {selectedAlert.id}</p>
            </div>
            <button onClick={() => setSelectedAlert(null)} className="text-sm text-gray-500 hover:text-gray-700">
              Close
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="font-medium text-gray-900 mb-3">Transaction features</p>
              <div className="space-y-2">
                {Object.entries(selectedAlert.features || {}).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{FEATURE_LABELS[key] || key}</span>
                    <span className="font-medium text-gray-900">{formatFeatureValue(value)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-3 text-sm">
                <span className="text-gray-600">Final risk score</span>
                <span className={`font-semibold ${selectedAlert.riskScore >= 70 ? 'text-danger' : selectedAlert.riskScore >= 45 ? 'text-warning' : 'text-success'}`}>
                  {Number(selectedAlert.riskScore ?? 0).toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="font-medium text-gray-900 mb-3">Why was this flagged?</p>
              <ExplanationPanel explanation={selectedAlert.explanation} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <input
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="Assign to analyst"
              className="rounded-xl border border-gray-200 px-4 py-3"
            />
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add investigation note"
              className="rounded-xl border border-gray-200 px-4 py-3"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleAction('investigating', selectedAlert.id)}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white"
            >
              Mark Investigating
            </button>
            <button
              onClick={() => handleAction('resolved', selectedAlert.id)}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
            >
              Resolve
            </button>
          </div>

          {selectedAlert.notes?.length ? (
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="font-medium text-gray-900 mb-3">Notes</p>
              <div className="space-y-2">
                {selectedAlert.notes.map((entry) => (
                  <div key={entry.createdAt} className="text-sm text-gray-700">
                    <p>{entry.message}</p>
                    <p className="text-xs text-gray-500">{new Date(entry.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default Alerts
