const axios = require('axios');

async function checkStatus() {
    try {
        const response = await axios.get('http://localhost:3000/api/whatsapp/status');
        console.log('Status Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('Error fetching status:', error.message);
    }
}

checkStatus();
