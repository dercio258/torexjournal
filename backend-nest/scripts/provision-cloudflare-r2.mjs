#!/usr/bin/env node
/**
 * Cloudflare R2 Bucket Provisioning Script for Torex Journal (Phase P3)
 *
 * Creates the dual-bucket architecture in Cloudflare R2 via Cloudflare REST API:
 *   1. R2_PUBLIC_BUCKET  (default: torex-public)  -> anonymized avatars & community network images
 *   2. R2_PRIVATE_BUCKET (default: torex-private) -> private journal/mental-log/backtest screenshots (SigV4 presigned)
 * And configures strict CORS rules for torexjournal.com origins.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=xxx R2_ACCOUNT_ID=yyy node scripts/provision-cloudflare-r2.mjs
 *   node scripts/provision-cloudflare-r2.mjs --dry-run
 */

const accountId = (process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const apiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
const publicBucket = (process.env.R2_PUBLIC_BUCKET || 'torex-public').trim();
const privateBucket = (process.env.R2_PRIVATE_BUCKET || 'torex-private').trim();
const locationHint = (process.env.R2_LOCATION_HINT || 'weur').trim(); // wnam | enam | weur | eeur | apac | oc
const isDryRun = process.argv.includes('--dry-run');

const allowedOrigins = (
    process.env.R2_CORS_ORIGINS ||
    'https://torexjournal.com,https://www.torexjournal.com,http://localhost:5173'
)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

const buckets = [
    {
        name: publicBucket,
        visibility: 'public',
        corsRules: [
            {
                id: 'torex-public-read',
                allowed: {
                    origins: allowedOrigins,
                    methods: ['GET', 'HEAD'],
                    headers: ['*'],
                },
                exposeHeaders: ['ETag', 'Content-Length', 'Content-Type'],
                maxAgeSeconds: 86400,
            },
        ],
    },
    {
        name: privateBucket,
        visibility: 'private',
        corsRules: [
            {
                id: 'torex-private-presigned-read',
                allowed: {
                    origins: allowedOrigins,
                    methods: ['GET', 'HEAD', 'PUT'],
                    headers: ['Content-Type', 'Authorization', 'x-amz-date', 'x-amz-content-sha256'],
                },
                exposeHeaders: ['ETag', 'Content-Length', 'Content-Type'],
                maxAgeSeconds: 300,
            },
        ],
    },
];

async function cfRequest(method, endpointPath, body) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}${endpointPath}`;
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        json = { raw: text };
    }
    return { status: res.status, ok: res.ok, data: json };
}

async function main() {
    console.log('=== Torex Journal — Cloudflare R2 Dual-Bucket Provisioning ===');
    console.log(`Public Bucket : ${publicBucket}`);
    console.log(`Private Bucket: ${privateBucket}`);
    console.log(`Location Hint : ${locationHint}`);
    console.log(`CORS Origins  : ${allowedOrigins.join(', ')}`);

    if (isDryRun) {
        console.log('\n[DRY-RUN] Planned operations:');
        for (const b of buckets) {
            console.log(`  - Ensure R2 bucket "${b.name}" (${b.visibility}) with CORS policy`);
        }
        console.log('\nSet CLOUDFLARE_API_TOKEN and R2_ACCOUNT_ID to execute.');
        return;
    }

    if (!accountId || !apiToken) {
        console.error(
            '\nERROR: Set CLOUDFLARE_API_TOKEN (with R2 Admin Edit permission) and R2_ACCOUNT_ID before running.',
        );
        process.exit(1);
    }

    for (const b of buckets) {
        console.log(`\n-> Provisioning bucket "${b.name}" (${b.visibility})...`);
        const createRes = await cfRequest('POST', '/r2/buckets', {
            name: b.name,
            locationHint,
            storageClass: 'Standard',
        });

        if (createRes.ok) {
            console.log(`   [CREATED] Bucket "${b.name}" created successfully.`);
        } else if (createRes.status === 409 || JSON.stringify(createRes.data).includes('already exists')) {
            console.log(`   [EXISTS] Bucket "${b.name}" already exists — keeping existing bucket.`);
        } else {
            console.error(`   [ERROR] Failed to create "${b.name}" (HTTP ${createRes.status}):`, createRes.data);
            process.exit(1);
        }

        const corsRes = await cfRequest('PUT', `/r2/buckets/${encodeURIComponent(b.name)}/cors`, {
            rules: b.corsRules,
        });
        if (corsRes.ok) {
            console.log(`   [CORS OK] Applied strict CORS policy to "${b.name}".`);
        } else {
            console.warn(`   [CORS WARN] Could not set CORS on "${b.name}" (HTTP ${corsRes.status}):`, corsRes.data);
        }
    }

    console.log('\n=== Provisioning Complete ===');
    console.log('Next steps in Cloudflare Dashboard -> R2:');
    console.log(`  1. Attach custom domain (e.g. cdn.torexjournal.com) or R2.dev ONLY to "${publicBucket}".`);
    console.log(`  2. Keep "${privateBucket}" strictly PRIVATE (no public access / no custom domain).`);
    console.log('  3. Create an R2 API Token (Object Read & Write) scoped to these two buckets and add R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_PUBLIC_URL to your backend environment.');
}

main().catch((err) => {
    console.error('Provisioning failed:', err);
    process.exit(1);
});
