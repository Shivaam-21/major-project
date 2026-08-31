import { useState, useEffect } from 'react'
import { CreditCard, Users, AlertTriangle, Activity } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import RiskCard from '../../components/RiskCard'
import TransactionTable from '../../components/TransactionTable'
import AlertPopup from '../../components/AlertPopup'
import SkeletonLoader from '../../components/SkeletonLoader'
import { adminService } from '../../services/admin'
import { useLiveFeed } from '../../hooks/useLiveFeed'

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [recentTransactions, setRecentTransactions] = useState([])
  const [fraudAlert, setFraudAlert] = useState(null)
  const navigate = useNavigate()

  useLiveFeed((data) => {
    if (data.type === 'FRAUD_ALERT') {
      setFraudAlert(data.alert)
    }
    if (data.type === 'NEW_TRANSACTION') {
      setRecentTransactions(prev => [data.transaction, ...prev.filter((tx) => tx.id !== data.transaction.id)].slice(0, 10))
    }
    if (data.type === 'TRANSACTION_UPDATED') {
      setRecentTransactions(prev => prev.map((tx) => (tx.id === data.transaction.id ? data.transaction : tx)))
    }
  })

  useEffect(() => {
    let isMounted = true

    const fetchDashboard = async ({ showLoader = false } = {}) => {
      if (showLoader) {
        setLoading(true)
      }
      try {
        const [statsData, txData] = await Promise.all([
          adminService.getStats(),
          adminService.getRecentTransactions({ limit: 10 })
        ])
        if (!isMounted) return
        setStats(statsData)
        setRecentTransactions(txData)
      } catch (error) {
        console.error('Failed to fetch admin dashboard', error)
      } finally {
        if (showLoader && isMounted) {
          setLoading(false)
        }
      }
    }

    fetchDashboard({ showLoader: true })
    const interval = setInterval(() => fetchDashboard(), 5000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [])

  const handleFraudAlertClick = (alert) => {
    navigate(`/admin/alerts?transactionId=${alert.transactionId}`)
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <SkeletonLoader type="card" count={4} />
        <SkeletonLoader type="table" count={5} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600 mt-1">Monitor platform activity and risk metrics.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <RiskCard
          title="Total Volume"
          value={stats?.totalVolume}
          change={stats?.volumeChange}
          riskLevel="Low"
          icon={CreditCard}
        />
        <RiskCard
          title="Active Users"
          value={stats?.activeUsers}
          change={stats?.usersChange}
          riskLevel="Low"
          icon={Users}
          filterType="users"
        />
        <RiskCard
          title="Fraud Alerts"
          value={stats?.fraudAlerts}
          change={stats?.fraudChange}
          riskLevel={stats?.fraudAlerts > 5 ? 'High' : 'Medium'}
          icon={AlertTriangle}
          filterType="alerts"
        />
        <RiskCard
          title="Avg Risk Score"
          value={stats?.avgRiskScore}
          riskLevel={stats?.avgRiskScore > 50 ? 'High' : stats?.avgRiskScore > 30 ? 'Medium' : 'Low'}
          icon={Activity}
          filterType="risk"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Live Transactions</h2>
          <button
            onClick={() => navigate('/admin/transactions')}
            className="text-sm text-primary font-medium hover:underline"
          >
            View all
          </button>
        </div>
        <TransactionTable transactions={recentTransactions} showRisk={true} />
      </div>

      {fraudAlert && (
        <AlertPopup
          alert={fraudAlert}
          onClose={() => setFraudAlert(null)}
          onClick={() => handleFraudAlertClick(fraudAlert)}
        />
      )}
    </div>
  )
}

export default AdminDashboard
