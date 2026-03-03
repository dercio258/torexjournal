const { Sequelize } = require('sequelize');
const sequelize = require('./config/database');
const { Account, User } = require('./models');

async function testHistoryEndpoint() {
    const baseUrl = 'http://localhost:3001';

    // 1. Get or Create Account with App Token
    let appToken;
    try {
        // Ensure DB connection
        await sequelize.authenticate();

        // Find any account
        let account = await Account.findOne();

        if (!account) {
            console.log('No account found. Creating one...');
            // Need a user first
            let user = await User.findOne();
            if (!user) {
                user = await User.create({
                    name: 'Test User',
                    email: `test_${Date.now()}@example.com`,
                    password_hash: 'hash',
                    whatsapp: '123'
                });
            }

            const crypto = require('crypto');
            appToken = crypto.randomBytes(32).toString('hex');

            account = await Account.create({
                user_id: user.id,
                mt5_id: '123456',
                app_token: appToken,
                balance: 1000,
                equity: 1000
            });
        } else {
            appToken = account.app_token;
        }

        console.log('Using App Token:', appToken);

    } catch (err) {
        console.error('DB Error:', err);
        return;
    }

    // 2. Send History Payload
    const payload = [
        {
            "Date": "2025.12.29 10:45",
            "Symbol": "EURUSD",
            "Status": "WIN",
            "Side": "BUY",
            "Qty": 0.10,
            "Entry": 1.05500,
            "Exit": 1.05600,
            "Pos": 123456789,
            "Hold": "00:45:12",
            "Return": 10.50,
            "ReturnPercent": 0.09,
            "Actions": "View"
        },
        {
            "Date": "2025.12.29 11:00",
            "Symbol": "GBPUSD",
            "Status": "LOSS",
            "Side": "SELL",
            "Qty": 0.50,
            "Entry": 1.25000,
            "Exit": 1.25100,
            "Pos": 987654321,
            "Hold": "01:20:00",
            "Return": -50.00,
            "ReturnPercent": -0.08,
            "Actions": "View"
        }
    ];

    try {
        console.log('Sending payload...');
        const res = await fetch(`${baseUrl}/api/mt5/save-history`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'app-token': appToken
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log('Response:', res.status, data);

    } catch (err) {
        console.error('Fetch Error:', err);
    }
}

testHistoryEndpoint();
