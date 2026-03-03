const crypto = require('crypto');

async function testBackend() {
    const baseUrl = 'http://localhost:3001';
    const email = `test_${Date.now()}@example.com`;
    const password = 'password123';
    let token = '';

    console.log('--- Starting Backend Tests ---');

    // 0. Test Route
    try {
        console.log(`\n0. Testing /test route...`);
        const testRes = await fetch(`${baseUrl}/test`);
        const text = await testRes.text();
        try {
            const testData = JSON.parse(text);
            console.log('Test Route Response:', testRes.status, testData);
        } catch (e) {
            console.error('Test route failed JSON parse. Response text:', text.substring(0, 200));
        }
    } catch (err) {
        console.error('Test route failed:', err.message);
    }

    // 1. Register
    try {
        console.log(`\n1. Registering user: ${email}`);
        const regRes = await fetch(`${baseUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test User', email, password })
        });
        const regData = await regRes.json();
        console.log('Register Response:', regRes.status, regData);
    } catch (err) {
        console.error('Register failed:', err.message);
    }

    // 2. Login
    try {
        console.log(`\n2. Logging in...`);
        const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const loginData = await loginRes.json();
        console.log('Login Response:', loginRes.status);

        if (loginData.token) {
            token = loginData.token;
            console.log('Token received.');
        } else {
            console.error('No token in login response.');
            return;
        }
    } catch (err) {
        console.error('Login failed:', err.message);
        return;
    }

    // 3. Get Dashboard Data
    try {
        console.log(`\n3. Fetching Dashboard Data...`);
        const dashRes = await fetch(`${baseUrl}/api/account`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const dashData = await dashRes.json();
        console.log('Dashboard Response:', dashRes.status, dashData);
    } catch (err) {
        console.error('Dashboard fetch failed:', err.message);
    }

    // 4. Get Trades
    try {
        console.log(`\n4. Fetching Trades...`);
        const tradesRes = await fetch(`${baseUrl}/api/trades`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const tradesData = await tradesRes.json();
        console.log('Trades Response:', tradesRes.status, Array.isArray(tradesData) ? `Got ${tradesData.length} trades` : tradesData);
    } catch (err) {
        console.error('Trades fetch failed:', err.message);
    }

    console.log('\n--- Tests Completed ---');
}

testBackend();
