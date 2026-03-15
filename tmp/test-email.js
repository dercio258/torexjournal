const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load .env from backend-nest
const envPath = path.join(__dirname, '..', 'backend-nest', '.env');
const logFile = path.join(__dirname, 'test-log.txt');

function log(msg) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

fs.writeFileSync(logFile, `Starting Test at ${new Date().toISOString()}\n`);
log(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

async function main() {
    const host = process.env.SMTP_HOST || 'smtppro.zoho.com';
    const port = Number(process.env.SMTP_PORT) || 465;
    const secure = process.env.SMTP_SECURE !== 'false';
    const user = process.env.Email_notification;
    const pass = process.env.Email_notification_pass;

    log('--- Configuration ---');
    log(`Host: ${host}`);
    log(`Port: ${port}`);
    log(`Secure: ${secure}`);
    log(`User: ${user}`);
    log(`Pass length: ${pass ? pass.length : 0}`);
    log('---------------------');

    if (!user || !pass) {
        log('❌ Error: User or Password missing in .env!');
        return;
    }

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
            user,
            pass,
        },
        connectionTimeout: 15000,
    });

    log('Starting verification...');
    try {
        await transporter.verify();
        log('✅ SMTP Connection verified successfully!');
    } catch (error) {
        log('❌ SMTP Connection failed:');
        log(error.message);
    }
}

main().catch(err => {
    log('CRITICAL ERROR: ' + err.message);
});
