import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { MainLayout } from './layouts/MainLayout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { Journal } from './pages/Journal';
import { Payments } from './pages/Payments';
import { Pricing } from './pages/Pricing';
import { Configuration } from './pages/Configuration';
import { AddTrades } from './pages/AddTrades';
import { Trades } from './pages/Trades';
import { TradeDetails } from './pages/TradeDetails';
import EmotionalManagement from './pages/EmotionalManagement';
import { EmotionalShare } from './pages/EmotionalShare';
import EconomicCalendar from './pages/EconomicCalendar';
import { Notifications } from './pages/Notifications';
import { Network } from './pages/Network';
import { Backtest } from './pages/Backtest';
import { Reports } from './pages/Reports';
import { ProtectedRoute } from './components/ProtectedRoute';
import { GuestRoute } from './components/GuestRoute';
import { Landing } from './pages/Landing';
import { Checkout } from './pages/Checkout';
import { SubscriptionSuccess } from './pages/SubscriptionSuccess';
import { AdminLogin } from './pages/admin/AdminLogin';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminFinance } from './pages/admin/AdminFinance';
import { AdminPlans } from './pages/admin/AdminPlans';

// Legal Pages
import { LegalHub } from './pages/legal/LegalHub';
import { Terms } from './pages/legal/Terms';
import { Privacy } from './pages/legal/Privacy';
import { RiskDisclosure } from './pages/legal/RiskDisclosure';
import { RefundPolicy } from './pages/legal/RefundPolicy';


function App() {
    return (
        <AuthProvider>
            <SocketProvider>
                <BrowserRouter>
                    <Routes>
                        {/* Public Routes */}
                        <Route path="/" element={<Landing />} />

                        <Route path="/legal" element={<LegalHub />} />
                        <Route path="/terms" element={<Terms />} />
                        <Route path="/privacy" element={<Privacy />} />
                        <Route path="/risk-disclosure" element={<RiskDisclosure />} />
                        <Route path="/refund-policy" element={<RefundPolicy />} />


                        {/* Guest Routes (Redirect to Dashboard if logged in) */}
                        <Route path="/login" element={
                            <GuestRoute>
                                <Login />
                            </GuestRoute>
                        } />
                        <Route path="/register" element={
                            <GuestRoute>
                                <Register />
                            </GuestRoute>
                        } />

                        {/* Protected Standalone Routes (Pages that need auth but have custom layout) */}
                        <Route path="/pricing" element={
                            <ProtectedRoute>
                                <Pricing />
                            </ProtectedRoute>
                        } />
                        <Route path="/checkout" element={
                            <ProtectedRoute>
                                <Checkout />
                            </ProtectedRoute>
                        } />
                        <Route path="/subscription/success" element={
                            <ProtectedRoute>
                                <SubscriptionSuccess />
                            </ProtectedRoute>
                        } />

                        {/* Admin Routes */}
                        <Route path="/admin" element={<AdminLogin />} />

                        <Route element={<AdminLayout />}>
                            <Route path="/admin/dashboard" element={<AdminDashboard />} />
                            <Route path="/admin/users" element={<AdminUsers />} />
                            <Route path="/admin/finance" element={<AdminFinance />} />
                            <Route path="/admin/plans" element={<AdminPlans />} />
                        </Route>



                        {/* Protected App Routes (With Sidebar/Layout) */}
                        <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
                            <Route path="/dashboard" element={<Dashboard />} />
                            <Route path="/journal" element={<Journal />} />
                            <Route path="/payments" element={<Payments />} />
                            <Route path="/configuration" element={<Configuration />} />
                            <Route path="/network" element={<Network />} />
                            <Route path="/add-trades" element={<AddTrades />} />
                            <Route path="/emotional" element={<EmotionalManagement />} />
                            <Route path="/emotional/share" element={<EmotionalShare />} />
                            <Route path="/calendar" element={<EconomicCalendar />} />
                            <Route path="/notifications" element={<Notifications />} />
                            <Route path="/reports" element={<Reports />} />
                            <Route path="/trades" element={<Trades />} />
                            <Route path="/trades/:id" element={<TradeDetails />} />
                            <Route path="/backtest" element={<Backtest />} />
                        </Route>

                        {/* Fallback */}
                        <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                </BrowserRouter>
            </SocketProvider>
        </AuthProvider>
    );
}

export default App;
