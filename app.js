const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const mt5Routes = require('./routes/mt5Routes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const countryRoutes = require('./routes/countryRoutes');

const app = express();

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https:", "https://unpkg.com", "https://cdn.jsdelivr.net", "ws:", "wss:"],
            scriptSrcAttr: ["'unsafe-inline'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(morgan('dev')); // Request logging

// CORS Configuration
const corsOptions = {
    origin: process.env.FRONTEND_URL || '*', // Configure allowed origins in production
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'app-token', 'X-App-Token', 'token', 'api-token']
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        // Set proper MIME types for JavaScript files
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
        // Enable CORS for static assets
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
}));

// Routes
console.log('Loading routes...');
app.get('/test', (req, res) => res.json({ message: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/mt5', mt5Routes);
app.use('/api', dashboardRoutes);
app.use('/api/pagamento', paymentRoutes);
app.use('/api/payment', paymentRoutes); // Alias to avoid 404s
app.use('/api/countries', countryRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled Error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

module.exports = app;
