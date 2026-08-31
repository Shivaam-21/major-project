import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BrainCircuit, Cpu, Gauge } from 'lucide-react'

const FEATURE_LABELS = {
  amount: 'Amount',
  transaction_frequency: 'Transaction frequency',
  device_change: 'Device change',
  location_change: 'Location change',
  hour_of_day: 'Hour of day',
}

const MODEL_LABELS = {
  random_forest: 'Random Forest',
  logistic_regression: 'Logistic Regression',
  self_training: 'Self-Training',
  label_propagation: 'Label Propagation',
  isolation_forest: 'Isolation Forest',
  kmeans_clustering: 'K-Means',
}

const prettifyRule = (rule) =>
  rule
    .split('_')
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')

const ScoreBar = ({ label, value, weight, color }) => (
  <div>
    <div className="flex items-center justify-between text-xs mb-1">
      <span className="text-gray-600">
        {label} <span className="text-gray-400">· weight {weight}</span>
      </span>
      <span className="font-semibold text-gray-900">{Number(value ?? 0).toFixed(1)}%</span>
    </div>
    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(Number(value ?? 0), 100)}%`, backgroundColor: color }}
      />
    </div>
  </div>
)

// Renders the "why was this flagged" story for a scored transaction: how the
// final score is composed, which features pushed the ML ensemble toward or
// away from fraud, which rules fired, and what each model said.
const ExplanationPanel = ({ explanation }) => {
  if (!explanation || Object.keys(explanation).length === 0) {
    return <p className="text-sm text-gray-500">No explanation was recorded for this transaction.</p>
  }

  const contributions = explanation.featureContributions?.contributions || {}
  const contributionData = Object.entries(contributions)
    .map(([feature, value]) => ({
      name: FEATURE_LABELS[feature] || feature,
      value: Number((value * 100).toFixed(2)),
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  const modelEntries = Object.entries({
    ...(explanation.modelBreakdown || {}),
    ...(explanation.anomalyBreakdown || {}),
  })

  return (
    <div className="space-y-5">
      {explanation.reason ? (
        <div className="flex items-start gap-2">
          <BrainCircuit className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-gray-700">{explanation.reason}</p>
        </div>
      ) : null}

      <div className="space-y-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
          <Gauge className="h-4 w-4 text-gray-500" /> Score composition
        </p>
        <ScoreBar label="ML ensemble" value={explanation.mlScore} weight="55%" color="#2563eb" />
        <ScoreBar label="Anomaly detectors" value={explanation.anomalyScore} weight="30%" color="#7c3aed" />
        <ScoreBar label="Business rules" value={explanation.ruleScore} weight="15%" color="#0d9488" />
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900 mb-1">What drove the ML score</p>
        {contributionData.length === 0 ? (
          <p className="text-xs text-gray-500">
            Feature-level attribution is available for transactions scored after the explainability upgrade.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-2">
              Change in fraud probability (percentage points) versus a typical transaction. Red pushes toward
              fraud, green pulls toward legitimate.
            </p>
            <div style={{ height: Math.max(contributionData.length * 36, 120) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={contributionData} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={130}
                    tick={{ fontSize: 11, fill: '#374151' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ReferenceLine x={0} stroke="#9ca3af" />
                  <Tooltip
                    formatter={(value) => [`${value > 0 ? '+' : ''}${value} pp`, 'Contribution']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {contributionData.map((entry) => (
                      <Cell key={entry.name} fill={entry.value >= 0 ? '#ef4444' : '#16a34a'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {explanation.ruleHits?.length ? (
        <div>
          <p className="text-sm font-medium text-gray-900 mb-2">Rules triggered</p>
          <div className="flex flex-wrap gap-2">
            {explanation.ruleHits.map((rule) => (
              <span
                key={rule}
                className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700"
              >
                {prettifyRule(rule)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {modelEntries.length ? (
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900 mb-2">
            <Cpu className="h-4 w-4 text-gray-500" /> Per-model verdicts
          </p>
          <div className="grid grid-cols-2 gap-2">
            {modelEntries.map(([model, score]) => (
              <div key={model} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">{MODEL_LABELS[model] || model}</p>
                <p className={`text-sm font-semibold ${score >= 0.7 ? 'text-danger' : score >= 0.45 ? 'text-warning' : 'text-gray-900'}`}>
                  {(Number(score) * 100).toFixed(1)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-gray-400">
        {explanation.usedLiveModel
          ? 'Scored by the live ML engine.'
          : 'Live ML engine was unavailable — heuristic fallback scoring was used.'}
      </p>
    </div>
  )
}

export default ExplanationPanel
