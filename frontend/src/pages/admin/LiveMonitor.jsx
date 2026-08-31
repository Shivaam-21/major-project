import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CreditCard,
  Radio,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { adminService } from '../../services/admin'
import { useLiveFeed } from '../../hooks/useLiveFeed'
import AlertPopup from '../../components/AlertPopup'
import { formatCurrency } from '../../utils/formatCurrency'

const FEED_LIMIT = 30
const RISK_POINTS = 40

const decisionBadges = {
  ALLOW: { label: 'Allowed', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: ShieldCheck },
  OTP_REQUIRED: { label: 'OTP challenge', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: ShieldQuestion },
  BLOCK: { label: 'Blocked', className: 'bg-red-500/15 text-red-400 border-red-500/30', icon: ShieldAlert },
}

const statusStyles = {
  live: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'LIVE' },
  connecting: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'CONNECTING' },
  offline: { dot: 'bg-red-400', text: 'text-red-400', label: 'OFFLINE' },
}

const riskTone = (score) => {
  if (score > 70) return 'text-red-400'
  if (score > 40) return 'text-amber-400'
  return 'text-emerald-400'
}

const timeLabel = (isoOrNow) => {
  const date = isoOrNow ? new Date(isoOrNow) : new Date()
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const LiveMonitor = () => {
  const [feed, setFeed] = useState([])
  const [alerts, setAlerts] = useState([])
  const [riskSeries, setRiskSeries] = useState([])
  const [popupAlert, setPopupAlert] = useState(null)
  const [liveCount, setLiveCount] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true
    Promise.all([
      adminService.getRecentTransactions({ limit: 15 }),
      adminService.getAlerts(),
    ]).then(([transactions, alertRows]) => {
      if (!mounted) return
      setFeed(transactions.map((tx) => ({ tx, live: false })))
      setAlerts(alertRows.slice(0, 8))
      setRiskSeries(
        transactions
          .slice()
          .reverse()
          .map((tx) => ({ time: tx.date, risk: Number(tx.riskScore || 0) })),
      )
    }).catch((error) => console.error('Failed to seed live monitor', error))
    return () => { mounted = false }
  }, [])

  const pushRiskPoint = useCallback((tx, timestamp) => {
    setRiskSeries((current) => [
      ...current.slice(-(RISK_POINTS - 1)),
      { time: timeLabel(timestamp), risk: Number(tx.riskScore || 0) },
    ])
  }, [])

  const handleEvent = useCallback((event) => {
    if (event.type === 'NEW_TRANSACTION' && event.transaction) {
      setFeed((current) => [
        { tx: event.transaction, live: true, receivedAt: event.timestamp },
        ...current.filter((item) => item.tx.id !== event.transaction.id),
      ].slice(0, FEED_LIMIT))
      setLiveCount((count) => count + 1)
      pushRiskPoint(event.transaction, event.timestamp)
    }
    if (event.type === 'TRANSACTION_UPDATED' && event.transaction) {
      setFeed((current) => {
        const exists = current.some((item) => item.tx.id === event.transaction.id)
        if (!exists) {
          return [{ tx: event.transaction, live: true, receivedAt: event.timestamp }, ...current].slice(0, FEED_LIMIT)
        }
        return current.map((item) =>
          item.tx.id === event.transaction.id ? { ...item, tx: event.transaction, live: true } : item,
        )
      })
    }
    if (event.type === 'FRAUD_ALERT' && event.alert) {
      setAlerts((current) => [event.alert, ...current.filter((a) => a.id !== event.alert.id)].slice(0, 8))
      setPopupAlert(event.alert)
    }
    if (event.type === 'ALERT_UPDATED' && event.alert) {
      setAlerts((current) => current.map((a) => (a.id === event.alert.id ? event.alert : a)))
    }
  }, [pushRiskPoint])

  const connection = useLiveFeed(handleEvent)
  const connectionUi = statusStyles[connection] || statusStyles.offline

  const stats = useMemo(() => {
    const transactions = feed.map((item) => item.tx)
    const blocked = transactions.filter((tx) => tx.status === 'failed' || tx.decision === 'BLOCK').length
    const otp = transactions.filter((tx) => tx.decision === 'OTP_REQUIRED' || tx.status === 'pending').length
    const avgRisk = transactions.length
      ? transactions.reduce((sum, tx) => sum + Number(tx.riskScore || 0), 0) / transactions.length
      : 0
    return { total: transactions.length, blocked, otp, avgRisk: Math.round(avgRisk) }
  }, [feed])

  const openAlerts = alerts.filter((alert) => alert.status === 'open' || alert.status === 'investigating')

  const tiles = [
    { label: 'Transactions in feed', value: stats.total, icon: CreditCard, tone: 'text-sky-400' },
    { label: 'Received live', value: liveCount, icon: Radio, tone: 'text-emerald-400' },
    { label: 'Blocked', value: stats.blocked, icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'OTP challenges', value: stats.otp, icon: ShieldQuestion, tone: 'text-amber-400' },
    { label: 'Avg risk score', value: stats.avgRisk, icon: Activity, tone: riskTone(stats.avgRisk) },
  ]

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-slate-950 p-6 space-y-6 border border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Radio className="h-6 w-6 text-emerald-400" />
              Live Fraud Command Center
            </h1>
            <p className="text-slate-400 mt-1">
              Every payment scored by the ML engine streams in here the moment it happens — no refresh needed.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-slate-900 border border-slate-800 px-4 py-2">
            <span className={`h-2.5 w-2.5 rounded-full ${connectionUi.dot} ${connection === 'live' ? 'animate-pulse' : ''}`} />
            <span className={`text-xs font-semibold tracking-widest ${connectionUi.text}`}>{connectionUi.label}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">{tile.label}</p>
                <tile.icon className={`h-4 w-4 ${tile.tone}`} />
              </div>
              <p className={`text-2xl font-bold mt-2 ${tile.tone}`}>{tile.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-100">Transaction stream</h2>
              <span className="text-xs text-slate-500">newest first · last {FEED_LIMIT}</span>
            </div>
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {feed.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">
                  Waiting for transactions… make a payment from a user account to see it appear instantly.
                </p>
              ) : (
                feed.map((item) => {
                  const badge = decisionBadges[item.tx.decision] || decisionBadges.ALLOW
                  return (
                    <div
                      key={`${item.tx.id}-${item.tx.status}`}
                      className={`flex items-center gap-4 rounded-xl border px-4 py-3 ${
                        item.live ? 'feed-item-enter border-slate-700 bg-slate-800/70' : 'border-slate-800 bg-slate-900'
                      }`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${badge.className}`}>
                        <badge.icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-100">{formatCurrency(item.tx.amount)}</span>
                          <ArrowRight className="h-3 w-3 text-slate-500 shrink-0" />
                          <span className="truncate text-sm text-slate-300">{item.tx.receiverName || item.tx.receiverAccount}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 font-mono truncate">#{item.tx.id?.slice(0, 12)}</p>
                      </div>
                      <span className={`hidden sm:inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold ${riskTone(Number(item.tx.riskScore || 0))}`}>
                          {Number(item.tx.riskScore || 0).toFixed(0)}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">risk</p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
              <h2 className="text-base font-semibold text-slate-100 mb-4">Risk pulse</h2>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={riskSeries} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                    <defs>
                      <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f87171" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#f87171" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, color: '#e2e8f0' }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Area type="monotone" dataKey="risk" stroke="#f87171" strokeWidth={2} fill="url(#riskGradient)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-slate-100">Fraud alerts</h2>
                <span className="rounded-full bg-red-500/15 border border-red-500/30 px-2.5 py-0.5 text-xs font-semibold text-red-400">
                  {openAlerts.length} open
                </span>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {alerts.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 text-center">No alerts yet.</p>
                ) : (
                  alerts.map((alert) => (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => navigate(`/admin/alerts?transactionId=${alert.transactionId}`)}
                      className="w-full text-left rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 hover:border-slate-600 transition"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`h-4 w-4 shrink-0 ${alert.severity === 'high' ? 'text-red-400' : 'text-amber-400'}`} />
                        <span className="truncate text-sm text-slate-200">{alert.message}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                        <span className="font-mono truncate">#{alert.transactionId?.slice(0, 12)}</span>
                        <span className="uppercase">{alert.status}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {popupAlert && (
        <AlertPopup
          alert={popupAlert}
          onClose={() => setPopupAlert(null)}
          onClick={() => navigate(`/admin/alerts?transactionId=${popupAlert.transactionId}`)}
        />
      )}
    </div>
  )
}

export default LiveMonitor
