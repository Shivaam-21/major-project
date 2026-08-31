import { 
  LayoutDashboard, 
  CreditCard, 
  History, 
  PieChart, 
  User, 
  Users, 
  AlertTriangle,
  FileText,
  Settings,
  Network,
  Radio
} from 'lucide-react'

export const userNavItems = [
  { label: 'Dashboard', path: '/user/dashboard', icon: LayoutDashboard },
  { label: 'Make Payment', path: '/user/payment', icon: CreditCard },
  { label: 'Transactions', path: '/user/transactions', icon: History },
  { label: 'Analytics', path: '/user/analytics', icon: PieChart },
  { label: 'Profile', path: '/user/profile', icon: User }
]

export const adminNavItems = [
  { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Live Monitor', path: '/admin/live', icon: Radio },
  { label: 'Transactions', path: '/admin/transactions', icon: History },
  { label: 'Alerts', path: '/admin/alerts', icon: AlertTriangle },
  { label: 'Fraud Ring', path: '/admin/fraud-ring', icon: Network },
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Reports', path: '/admin/reports', icon: FileText }
]