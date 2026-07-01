import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
    headers: {
        'Content-Type': 'application/json'
    }
});

api.interceptors.request.use((config) => {
    const isAdminRequest = config.url?.startsWith('/admin') || window.location.pathname.startsWith('/admin');
    const token = isAdminRequest
        ? (localStorage.getItem('adminToken') || localStorage.getItem('token'))
        : (localStorage.getItem('token') || localStorage.getItem('adminToken'));
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            console.error(`API Auth Error (401) on URL:`, error.config?.url);
            const isAdminRequest = error.config?.url?.startsWith('/admin') || window.location.pathname.startsWith('/admin');
            if (isAdminRequest) {
                localStorage.removeItem('adminToken');
                if (window.location.pathname !== '/admin') {
                    window.location.href = '/admin';
                }
            } else {
                localStorage.removeItem('token');
                if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register')) {
                    window.dispatchEvent(new Event('auth:unauthorized'));
                }
            }
        }
        return Promise.reject(error);
    }
);

export default api;
