import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Network, ShieldAlert, ShieldX, Users, Landmark, Radio } from 'lucide-react'
import { adminService } from '../../services/admin'
import { useLiveFeed } from '../../hooks/useLiveFeed'
import SkeletonLoader from '../../components/SkeletonLoader'
import { formatCurrency } from '../../utils/formatCurrency'

const WIDTH = 900
const HEIGHT = 520
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 }

function simulateLayout(nodes, edges) {
  const positions = new Map()
  nodes.forEach((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2
    positions.set(node.id, {
      x: CENTER.x + Math.cos(angle) * 180 + (Math.random() - 0.5) * 40,
      y: CENTER.y + Math.sin(angle) * 180 + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
    })
  })

  const REPULSION = 2600
  const SPRING = 0.02
  const SPRING_LENGTH = 160
  const DAMPING = 0.85
  const CENTER_PULL = 0.01

  for (let tick = 0; tick < 220; tick += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = positions.get(nodes[i].id)
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = positions.get(nodes[j].id)
        const dx = a.x - b.x
        const dy = a.y - b.y
        const distSq = Math.max(dx * dx + dy * dy, 1)
        const force = REPULSION / distSq
        const dist = Math.sqrt(distSq)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
      a.vx += (CENTER.x - a.x) * CENTER_PULL
      a.vy += (CENTER.y - a.y) * CENTER_PULL
    }

    edges.forEach((edge) => {
      const a = positions.get(edge.source)
      const b = positions.get(edge.target)
      if (!a || !b) return
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const displacement = dist - SPRING_LENGTH
      const fx = (dx / dist) * displacement * SPRING
      const fy = (dy / dist) * displacement * SPRING
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    })

    positions.forEach((p) => {
      p.vx *= DAMPING
      p.vy *= DAMPING
      p.x += p.vx
      p.y += p.vy
      p.x = Math.min(Math.max(p.x, 40), WIDTH - 40)
      p.y = Math.min(Math.max(p.y, 40), HEIGHT - 40)
    })
  }

  return positions
}

const FraudRing = () => {
  const [loading, setLoading] = useState(true)
  const [graph, setGraph] = useState({
    nodes: [],
    edges: [],
    suspiciousReceivers: 0,
    fraudulentTransactions: 0,
    flaggedSenders: 0,
  })
  const [selectedNode, setSelectedNode] = useState(null)
  const containerRef = useRef(null)
  const refreshTimer = useRef(null)

  const loadGraph = useCallback(() => {
    adminService
      .getFraudRing()
      .then(setGraph)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadGraph()
    return () => clearTimeout(refreshTimer.current)
  }, [loadGraph])

  // When a payment is scored anywhere in the system, the graph refreshes so a
  // detected fraud shows up here immediately (debounced to absorb bursts).
  const liveStatus = useLiveFeed((event) => {
    if (event.type === 'NEW_TRANSACTION' || event.type === 'TRANSACTION_UPDATED') {
      clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(loadGraph, 800)
    }
  })

  const positions = useMemo(
    () => simulateLayout(graph.nodes, graph.edges),
    [graph],
  )

  const nodesById = useMemo(() => {
    const map = new Map()
    graph.nodes.forEach((node) => map.set(node.id, node))
    return map
  }, [graph.nodes])

  const edgesForSelected = selectedNode
    ? graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
    : []

  if (loading) {
    return <SkeletonLoader type="card" count={3} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" />
            Fraud Ring Detector
          </h1>
          <p className="text-gray-600 mt-1">
            Maps senders to receiver accounts, marks every detected fraud in red, and flags accounts shared by
            multiple senders &mdash; a classic money-mule / collusion signal that a single-transaction risk score
            can&apos;t see.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-surface px-3 py-1.5">
          <Radio className={`h-3.5 w-3.5 ${liveStatus === 'live' ? 'text-success' : 'text-gray-400'}`} />
          <span className={`text-xs font-medium ${liveStatus === 'live' ? 'text-success' : 'text-gray-500'}`}>
            {liveStatus === 'live' ? 'Auto-updating live' : 'Live feed offline'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-surface rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Senders in graph</p>
              <p className="text-xl font-semibold text-gray-900">
                {graph.nodes.filter((n) => n.type === 'user').length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Landmark className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Receiver accounts</p>
              <p className="text-xl font-semibold text-gray-900">
                {graph.nodes.filter((n) => n.type === 'receiver').length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-2xl border border-warning/30 p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-warning/10 text-warning flex items-center justify-center">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Shared receivers flagged</p>
              <p className="text-xl font-semibold text-warning">{graph.suspiciousReceivers}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-2xl border border-danger/20 p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-danger/10 text-danger flex items-center justify-center">
              <ShieldX className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Fraudulent transactions</p>
              <p className="text-xl font-semibold text-danger">{graph.fraudulentTransactions ?? 0}</p>
            </div>
          </div>
        </div>
      </div>

      {graph.nodes.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-gray-100 p-10 text-center text-gray-600">
          No transactions with receiver accounts yet. Once payments start flowing, this graph will populate
          automatically.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-surface rounded-2xl border border-gray-100 p-4 overflow-x-auto" ref={containerRef}>
            <svg width={WIDTH} height={HEIGHT} className="mx-auto">
              {graph.edges.map((edge) => {
                const a = positions.get(edge.source)
                const b = positions.get(edge.target)
                if (!a || !b) return null
                return (
                  <line
                    key={edge.transactionId}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={edge.fraud ? '#ef4444' : edge.shared ? '#f59e0b' : '#cbd5e1'}
                    strokeWidth={edge.fraud ? 2.5 : edge.shared ? 2 : 1.5}
                    strokeOpacity={edge.fraud ? 0.9 : edge.shared ? 0.85 : 0.6}
                    strokeDasharray={edge.fraud ? '7 4' : undefined}
                  />
                )
              })}

              {graph.nodes.map((node) => {
                const pos = positions.get(node.id)
                if (!pos) return null
                const isUser = node.type === 'user'
                const isSelected = selectedNode?.id === node.id
                const highlighted = node.fraudulent || node.flagged
                const radius = isUser ? (node.fraudulent ? 20 : 16) : highlighted ? 22 : 18
                const fill = node.fraudulent
                  ? '#ef4444'
                  : node.flagged
                    ? '#f59e0b'
                    : isUser
                      ? '#3b82f6'
                      : '#64748b'

                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() => setSelectedNode(node)}
                    className="cursor-pointer"
                  >
                    {highlighted ? (
                      <circle r={radius + 6} fill={node.fraudulent ? '#ef4444' : '#f59e0b'} opacity={0.15}>
                        <animate attributeName="r" values={`${radius + 4};${radius + 10};${radius + 4}`} dur="1.8s" repeatCount="indefinite" />
                      </circle>
                    ) : null}
                    <circle
                      r={radius}
                      fill={fill}
                      stroke={isSelected ? '#0f172a' : '#fff'}
                      strokeWidth={isSelected ? 3 : 2}
                    />
                    <text
                      textAnchor="middle"
                      dy={radius + 14}
                      fontSize="10"
                      fill="#475569"
                      className="select-none"
                    >
                      {node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}
                    </text>
                  </g>
                )
              })}
            </svg>

            <div className="flex flex-wrap gap-4 justify-center text-xs text-gray-600 mt-2">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-primary inline-block" /> Sender
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-500 inline-block" /> Receiver account
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 inline-block" /> Shared receiver (mule signal)
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-danger inline-block" /> Fraud-linked account
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-4 border-t-2 border-dashed border-danger inline-block" /> Fraudulent transaction
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-1 rounded bg-amber-500 inline-block" /> Shared money flow
              </span>
            </div>
          </div>

          <div className="bg-surface rounded-2xl border border-gray-100 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {selectedNode ? (selectedNode.type === 'user' ? 'Sender' : 'Receiver Account') : 'Select a node'}
            </h2>

            {!selectedNode ? (
              <p className="text-sm text-gray-600">
                Click any circle in the graph to inspect who&apos;s sending, who&apos;s receiving, and every
                transaction linking them.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Label</p>
                  <p className="font-medium text-gray-900 break-all">{selectedNode.label}</p>
                </div>
                {selectedNode.type === 'receiver' ? (
                  <div>
                    <p className="text-sm text-gray-600">Distinct senders</p>
                    <p className={`font-medium ${selectedNode.senderCount >= 2 ? 'text-warning' : 'text-gray-900'}`}>
                      {selectedNode.senderCount}
                      {selectedNode.senderCount >= 2 ? ' — shared across multiple accounts' : ''}
                    </p>
                  </div>
                ) : null}
                {selectedNode.fraudCount > 0 ? (
                  <div>
                    <p className="text-sm text-gray-600">Fraudulent transactions</p>
                    <p className="font-medium text-danger">
                      {selectedNode.fraudCount} detected on this account
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="text-sm text-gray-600">Highest risk score seen</p>
                  <p className="font-medium text-gray-900">{selectedNode.maxRiskScore?.toFixed(2)}%</p>
                </div>

                <div>
                  <p className="text-sm text-gray-600 mb-2">Linked transactions ({edgesForSelected.length})</p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {edgesForSelected.map((edge) => (
                      <div
                        key={edge.transactionId}
                        className={`rounded-xl border p-3 text-sm ${
                          edge.fraud
                            ? 'border-danger/30 bg-danger/5'
                            : edge.shared
                              ? 'border-warning/40 bg-warning/5'
                              : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-gray-900">{formatCurrency(edge.amount)}</span>
                          <span className="flex items-center gap-2">
                            {edge.fraud ? (
                              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-danger">
                                Fraud
                              </span>
                            ) : null}
                            <span className="text-xs text-gray-500">{edge.date}</span>
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {nodesById.get(edge.source)?.label} → {nodesById.get(edge.target)?.label}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Risk {edge.riskScore.toFixed(2)}% · {edge.decision}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default FraudRing
