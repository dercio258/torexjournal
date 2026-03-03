const app = require('./app');
const db = require('./models');

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Sync Database (alter: true updates tables without dropping)
        await db.sequelize.sync({ alter: true });
        console.log('✅ Database synced (Alter enabled)');

        const http = require('http');
        const server = http.createServer(app);
        const { Server } = require('socket.io');

        const io = new Server(server, {
            cors: {
                origin: process.env.FRONTEND_URL || '*',
                methods: ['GET', 'POST']
            }
        });

        // Make io accessible globally
        global.io = io;

        io.on('connection', (socket) => {
            console.log('🔌 Novo cliente WebSocket conectado:', socket.id);
            socket.on('disconnect', () => {
                console.log('🔌 Cliente WebSocket desconectado');
            });
        });

        const activeServer = server.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });

        activeServer.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${PORT} is already in use.`);
            } else {
                console.error('❌ Server error:', error);
            }
            process.exit(1);
        });

        // Graceful Shutdown
        const shutdown = async () => {
            console.log('🛑 Shutting down server...');
            activeServer.close(() => {
                console.log('✅ Server closed.');
                db.sequelize.close().then(() => {
                    console.log('✅ Database connection closed.');
                    process.exit(0);
                });
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (err) {
        console.error('❌ Unable to connect to the database:', err);
        process.exit(1);
    }
}

startServer();