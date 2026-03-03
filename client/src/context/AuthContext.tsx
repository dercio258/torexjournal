import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../api';

interface AuthContextType {
    token: string | null;
    isAuthenticated: boolean;
    login: (token: string, email?: string) => void;
    logout: () => void;
    userEmail: string | null;
    user: {
        id: string;
        email: string;
        username: string;
        avatarUrl?: string;
        is_connected?: boolean;
    } | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [token, setTokenObj] = useState<string | null>(localStorage.getItem('token'));
    const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem('userEmail'));
    const [user, setUser] = useState<AuthContextType['user']>(null);

    useEffect(() => {
        if (token) {
            fetchProfile();
        }
    }, [token]);

    const fetchProfile = async () => {
        try {
            const res = await api.get('/auth/profile');
            if (res.data) {
                const data = res.data;
                setUser(data);
                if (data.email) {
                    localStorage.setItem('userEmail', data.email);
                    setUserEmail(data.email);
                }
            }
        } catch (e) {
            console.error("Failed to fetch profile", e);
            // Optional: logout if profile fetch fails with 401
            // But api.ts interceptor handles 401
        }
    };

    const login = (newToken: string, email?: string) => {
        localStorage.setItem('token', newToken);
        setTokenObj(newToken);
        if (email) {
            localStorage.setItem('userEmail', email);
            setUserEmail(email);
        }
        fetchProfile(); // Fetch full profile on login
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        setTokenObj(null);
        setUserEmail(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{
            token,
            isAuthenticated: !!token,
            login,
            logout,
            userEmail,
            user
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
