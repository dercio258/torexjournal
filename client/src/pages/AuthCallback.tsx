import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2 } from 'lucide-react';

export const AuthCallback = () => {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    useEffect(() => {
        const token = searchParams.get('token');
        const onboardingCompleted = searchParams.get('onboardingCompleted') === 'true';
        const requiresContact = searchParams.get('requiresContact') === 'true';

        if (token) {
            login(token);
            
            if (requiresContact) {
                navigate('/complete-profile');
            } else if (!onboardingCompleted) {
                navigate('/onboarding');
            } else {
                navigate('/dashboard');
            }
        } else {
            navigate('/login');
        }
    }, [login, navigate, searchParams]);

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
            <p className="text-slate-400 font-medium">Autenticando...</p>
        </div>
    );
};
