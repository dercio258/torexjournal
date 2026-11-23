import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MockDashboardBackdrop } from '../components/subscription/MockDashboardBackdrop';
import { WorkspacePricingModal } from '../components/subscription/WorkspacePricingModal';

export const Pricing = () => {
    const navigate = useNavigate();
    const { user, isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return <div className="min-h-screen bg-canvas" />;
    }

    if (isAuthenticated && user) {
        const hasActivePlan = Boolean(user.tier && user.tier !== 'FREE');
        return <Navigate to={hasActivePlan ? '/dashboard?plans=1' : '/dashboard'} replace />;
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-canvas">
            <MockDashboardBackdrop />
            <WorkspacePricingModal
                isOpen={true}
                dismissible={true}
                onClose={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
                trialEligible={false}
            />
        </div>
    );
};

export default Pricing;
