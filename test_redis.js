const Redis = require('ioredis');
const redis = new Redis({
    host: '127.0.0.1',
    port: 6379,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1
});

redis.on('connect', () => {
    console.log('Connected to local Redis!');
    redis.disconnect();
    process.exit(0);
});

redis.on('error', (err) => {
    console.error('Failed to connect to local Redis:', err.message);
    redis.disconnect();
    process.exit(1);
});
