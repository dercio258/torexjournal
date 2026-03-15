const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE_NAME = process.env.EVOLUTION_API_INSTANCE_NAME || 'torex_journal';
const WEBHOOK_URL = `${process.env.BACKEND_URL || 'http://localhost:3000'}/whatsapp/webhook`;

const api = axios.create({
    baseURL: EVOLUTION_API_URL,
    headers: {
        apikey: EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
    }
});

async function createInstance() {
    try {
        console.log(`🚀 Criando instância: ${INSTANCE_NAME}...`);

        // 1. Create Instance
        const createRes = await api.post('/instance/create', {
            instanceName: INSTANCE_NAME,
            token: '', // Evolution API can generate one or we can provide it
            number: '',
            qrcode: true
        });

        console.log('✅ Instância criada com sucesso!');
        console.log('Informações:', createRes.data);

        // 2. Configure Webhook
        console.log(`🔗 Configurando Webhook para: ${WEBHOOK_URL}...`);
        await api.post(`/webhook/set/${INSTANCE_NAME}`, {
            enabled: true,
            url: WEBHOOK_URL,
            webhook_by_events: false,
            events: [
                "MESSAGES_UPSERT",
                "MESSAGES_UPDATE",
                "MESSAGES_DELETE",
                "SEND_MESSAGE",
                "CONTACTS_UPSERT",
                "CONTACTS_UPDATE",
                "PRESENCE_UPDATE",
                "CHATS_UPSERT",
                "CHATS_UPDATE",
                "CHATS_DELETE",
                "GROUPS_UPSERT",
                "GROUPS_UPDATE",
                "GROUP_PARTICIPANTS_UPDATE",
                "CONNECTION_UPDATE",
                "LABELS_EDIT",
                "LABELS_ASSOCIATION"
            ]
        });

        console.log('✅ Webhook configurado!');

        console.log('\n--- PRÓXIMOS PASSOS ---');
        console.log(`1. Acesse o dashboard da Evolution API (${EVOLUTION_API_URL}/dashboard)`);
        console.log(`2. Selecione a instância "${INSTANCE_NAME}"`);
        console.log('3. Escaneie o QR Code para conectar seu WhatsApp');

    } catch (error) {
        if (error.response) {
            console.error('❌ Erro da API Evolution:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('❌ Erro de conexão/script:', error.message);
            console.error(error);
        }
    }
}

createInstance();
