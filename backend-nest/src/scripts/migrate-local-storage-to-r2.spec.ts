import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHmac } from 'crypto';
import {
    LocalStorageToR2Migrator,
    MigrationCliOptions,
    R2MigrationClient,
    SqlExecutor,
    classifyMediaReference,
    detectFormatFromMagicBytes,
    parseCliArgs,
    validateR2ConfigForApply,
} from './migrate-local-storage-to-r2';
import { R2StorageConfig, StoredObjectResult } from '../common/security/cloudflare-r2-storage.service';

// Minimal valid binary headers
const PNG_BUFFER = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP_BUFFER = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1');

const TEST_R2_PUBLIC_URL = 'https://pub-4777b2f66f124673917e6cc73cc00a47.r2.dev';

function createMockR2(overrides: Partial<R2StorageConfig> = {}): {
    client: R2MigrationClient;
    uploads: Array<{ visibility: string; key: string; contentType: string; size: number }>;
    existingPrivateKeys: Set<string>;
} {
    const cfg: R2StorageConfig = {
        enabled: true,
        accountId: 'dc79fd7a99ca7bf3a8a38a659e90badb',
        accessKeyId: 'real-access-key-id-1234',
        secretAccessKey: 'real-secret-access-key-5678',
        endpoint: 'https://dc79fd7a99ca7bf3a8a38a659e90badb.r2.cloudflarestorage.com',
        publicBucket: 'torexj',
        privateBucket: 'torexj-private',
        publicBaseUrl: TEST_R2_PUBLIC_URL,
        presignTtlSeconds: 300,
        ...overrides,
    };

    const uploads: Array<{ visibility: string; key: string; contentType: string; size: number }> = [];
    const existingPrivateKeys = new Set<string>();

    const client: R2MigrationClient = {
        getConfig: () => cfg,
        computeOwnerTag: (userId: string) =>
            createHmac('sha256', 'test-signing-secret')
                .update(`owner:${userId.trim()}`)
                .digest('hex')
                .slice(0, 24),
        sanitizeObjectKey: (rawKey: string) => {
            const clean = String(rawKey || '').trim().replace(/^\/+/, '');
            if (!clean || clean.includes('..') || !/^[a-zA-Z0-9._/-]+$/.test(clean)) return null;
            return clean;
        },
        verifyR2Connection: jest.fn(async () => ({
            ok: true,
            publicBucket: { name: cfg.publicBucket, ok: true, status: 200 },
            privateBucket: { name: cfg.privateBucket, ok: true, status: 200 },
        })),
        objectExistsInR2: jest.fn(async (_vis, key) => existingPrivateKeys.has(key)),
        uploadRawObjectToR2: jest.fn(
            async (params): Promise<StoredObjectResult> => {
                uploads.push({
                    visibility: params.visibility,
                    key: params.key,
                    contentType: params.contentType,
                    size: params.buffer.length,
                });
                return {
                    url:
                        params.visibility === 'public'
                            ? `${cfg.publicBaseUrl}/${params.key}`
                            : `/api/media/private/${params.key}`,
                    key: params.key,
                    provider: 'cloudflare-r2',
                    visibility: params.visibility,
                    contentType: params.contentType,
                    sizeBytes: params.buffer.length,
                    sha256: 'mock-sha',
                };
            },
        ),
    };

    return { client, uploads, existingPrivateKeys };
}

describe('migrate-local-storage-to-r2', () => {
    describe('parseCliArgs & R2 preflight validation', () => {
        it('defaults to safe dry-run mode and blocks --cleanup-local without --apply', () => {
            const def = parseCliArgs([]);
            expect(def.dryRun).toBe(true);
            expect(def.apply).toBe(false);
            expect(def.cleanupLocal).toBe(false);

            expect(() => parseCliArgs(['--cleanup-local'])).toThrow(/--cleanup-local/);

            const full = parseCliArgs([
                '--apply',
                '--cleanup-local',
                '--include-orphans',
                '--only=users,trade_notes',
            ]);
            expect(full.apply).toBe(true);
            expect(full.dryRun).toBe(false);
            expect(full.cleanupLocal).toBe(true);
            expect(full.includeOrphans).toBe(true);
            expect(full.onlyTables).toEqual(['users', 'trade_notes']);
        });

        it('rejects placeholder credentials before --apply', () => {
            const { client } = createMockR2({
                accessKeyId: 'sua_r2_access_key_id',
                secretAccessKey: 'sua_r2_secret_access_key',
            });
            const issues = validateR2ConfigForApply(client.getConfig());
            expect(issues.length).toBeGreaterThanOrEqual(2);
            expect(issues.some((i) => i.includes('R2_ACCESS_KEY_ID'))).toBe(true);
            expect(issues.some((i) => i.includes('R2_SECRET_ACCESS_KEY'))).toBe(true);
        });
    });

    describe('classifyMediaReference & detectFormatFromMagicBytes', () => {
        it('classifies legacy local URLs, private gateways, data URIs, R2 URLs, and external links accurately', () => {
            expect(
                classifyMediaReference(
                    'https://torexjournal.com/uploads/avatars/avatar_u1.jpg',
                    TEST_R2_PUBLIC_URL,
                ),
            ).toEqual({
                kind: 'local-upload',
                relativePath: 'avatars/avatar_u1.jpg',
                fragment: '',
            });

            expect(
                classifyMediaReference(
                    '/uploads/journal-screenshots/u1/shot.png#antes',
                    TEST_R2_PUBLIC_URL,
                ),
            ).toEqual({
                kind: 'local-upload',
                relativePath: 'journal-screenshots/u1/shot.png',
                fragment: '#antes',
            });

            const priv = classifyMediaReference(
                'https://torexjournal.com/api/media/private/private/abc123/journal-screenshots/x.png?exp=123&sig=xyz#depois',
                TEST_R2_PUBLIC_URL,
            );
            expect(priv).toEqual({
                kind: 'private-gateway',
                key: 'private/abc123/journal-screenshots/x.png',
                fragment: '#depois',
                normalizedUrl: '/api/media/private/private/abc123/journal-screenshots/x.png#depois',
                changed: true,
            });

            const already = classifyMediaReference(
                `${TEST_R2_PUBLIC_URL}/avatars/uuid.jpg`,
                TEST_R2_PUBLIC_URL,
            );
            expect(already).toEqual({
                kind: 'already-r2-public',
                normalizedUrl: `${TEST_R2_PUBLIC_URL}/avatars/uuid.jpg`,
                changed: false,
            });

            expect(
                classifyMediaReference(
                    'https://lh3.googleusercontent.com/a/avatar-123',
                    TEST_R2_PUBLIC_URL,
                ),
            ).toEqual({ kind: 'external-or-other' });

            const dataUri = classifyMediaReference(
                `data:image/png;base64,${PNG_BUFFER.toString('base64')}#extra`,
                TEST_R2_PUBLIC_URL,
            );
            expect(dataUri.kind).toBe('data-uri');
            if (dataUri.kind === 'data-uri') {
                expect(dataUri.ext).toBe('png');
                expect(dataUri.fragment).toBe('#extra');
            }
        });

        it('detects true format from magic bytes and blocks SVG/HTML payloads', () => {
            expect(detectFormatFromMagicBytes(JPEG_BUFFER, 'png')).toEqual({
                ext: 'jpg',
                contentType: 'image/jpeg',
                detectedByMagic: true,
            });
            expect(detectFormatFromMagicBytes(WEBP_BUFFER, 'jpg')).toEqual({
                ext: 'webp',
                contentType: 'image/webp',
                detectedByMagic: true,
            });
            const svg = detectFormatFromMagicBytes(
                Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
                'png',
            );
            expect(svg.rejectedReason).toBeTruthy();
        });
    });

    describe('LocalStorageToR2Migrator end-to-end orchestration', () => {
        let tmpRoot: string;
        let uploadsDir: string;
        let privateUploadsDir: string;

        beforeEach(() => {
            tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'torex-r2-mig-'));
            uploadsDir = path.join(tmpRoot, 'uploads');
            privateUploadsDir = path.join(tmpRoot, 'private-uploads');

            fs.mkdirSync(path.join(uploadsDir, 'avatars'), { recursive: true });
            fs.mkdirSync(path.join(uploadsDir, 'journal-screenshots', 'user-1'), {
                recursive: true,
            });
            fs.writeFileSync(path.join(uploadsDir, 'avatars', 'avatar_user-1_123.jpeg'), JPEG_BUFFER);
            fs.writeFileSync(path.join(uploadsDir, 'post-abc.png'), PNG_BUFFER);
            fs.writeFileSync(path.join(uploadsDir, 'mental-01.webp'), WEBP_BUFFER);
            fs.writeFileSync(
                path.join(uploadsDir, 'journal-screenshots', 'user-1', 'jshot_1.png'),
                PNG_BUFFER,
            );
            // Orphan private journal file on disk (not in DB)
            fs.writeFileSync(
                path.join(uploadsDir, 'journal-screenshots', 'user-1', 'orphan_shot.jpg'),
                JPEG_BUFFER,
            );
        });

        afterEach(() => {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        });

        function buildMockDb(ownerTagForUser1: string) {
            const updates: Array<{ sql: string; params: any[] }> = [];
            const existingPrivateKey = `private/${ownerTagForUser1}/journal-screenshots/already-key.png`;

            // Also create local private-uploads file for that existing key
            const privFilePath = path.join(privateUploadsDir, existingPrivateKey);
            fs.mkdirSync(path.dirname(privFilePath), { recursive: true });
            fs.writeFileSync(privFilePath, PNG_BUFFER);

            const dataUriShot = `data:image/jpeg;base64,${JPEG_BUFFER.toString('base64')}`;

            const db: SqlExecutor = {
                query: jest.fn(async (sql: string, params?: any[]) => {
                    if (sql.includes('to_regclass')) {
                        return [{ reg: params?.[0] }];
                    }
                    if (sql.trim().startsWith('UPDATE')) {
                        updates.push({ sql, params: params || [] });
                        return [[], 1];
                    }
                    if (sql.includes('FROM "users"')) {
                        return [
                            { id: 'user-1', val: '/uploads/avatars/avatar_user-1_123.jpeg' },
                            { id: 'user-2', val: 'https://lh3.googleusercontent.com/a/oauth' },
                            { id: 'user-3', val: `${TEST_R2_PUBLIC_URL}/avatars/already.jpg` },
                        ];
                    }
                    if (sql.includes('FROM "leaderboard_ranks"')) {
                        // References same avatar file as user-1 -> should deduplicate to single R2 object!
                        return [
                            {
                                id: 'rank-1',
                                val: 'https://torexjournal.com/uploads/avatars/avatar_user-1_123.jpeg',
                            },
                        ];
                    }
                    if (sql.includes('FROM "network_posts"')) {
                        return [{ id: 10, val: '/uploads/post-abc.png' }];
                    }
                    if (sql.includes('FROM "mental_logs"')) {
                        return [{ id: 42, val: '/uploads/mental-01.webp', owner_user_id: 'user-1' }];
                    }
                    if (sql.includes('FROM "trade_notes"')) {
                        return [
                            {
                                id: 'tn-1',
                                user_id: 'user-1',
                                screenshot_url: '/uploads/journal-screenshots/user-1/jshot_1.png',
                                screenshots: [
                                    '/uploads/journal-screenshots/user-1/jshot_1.png#antes',
                                    `/api/media/private/${existingPrivateKey}?exp=999&sig=old#depois`,
                                ],
                            },
                        ];
                    }
                    if (sql.includes('FROM "backtest_session_blobs"')) {
                        return [
                            {
                                session_id: 'bs-1',
                                user_id: 'user-1',
                                session_screenshots: [
                                    { id: 's1', dataUrl: dataUriShot, timestamp: 1700000000 },
                                ],
                                journal_images: [],
                            },
                        ];
                    }
                    return [];
                }),
            };

            return { db, updates, existingPrivateKey, privFilePath };
        }

        it('performs zero writes or uploads in --dry-run mode while reporting full plan', async () => {
            const { client, uploads } = createMockR2();
            const ownerTag = client.computeOwnerTag('user-1');
            const { db, updates } = buildMockDb(ownerTag);

            const options: MigrationCliOptions = {
                apply: false,
                dryRun: true,
                cleanupLocal: false,
                includeOrphans: false,
                skipPreflight: false,
                help: false,
                onlyTables: null,
                extraRoots: [],
                manifestPath: null,
            };

            const migrator = new LocalStorageToR2Migrator({
                db,
                r2: client,
                uploadsDirs: [uploadsDir],
                privateUploadsDirs: [privateUploadsDir],
                options,
                logger: () => undefined,
            });

            const manifest = await migrator.run();

            expect(manifest.mode).toBe('dry-run');
            expect(uploads).toHaveLength(0);
            expect(updates).toHaveLength(0);
            expect(manifest.summary.uploadedPublicToR2).toBe(2); // avatar + post (leaderboard deduped)
            expect(manifest.summary.uploadedPrivateToR2).toBe(3); // mental_log + trade_note shot + backtest base64
            expect(manifest.summary.privateLocalSyncedToR2).toBe(1); // existing private-uploads file
            expect(manifest.summary.deduplicatedReuses).toBe(2); // leaderboard_ranks + trade_notes.screenshots[0]
            expect(manifest.summary.dataUrisConverted).toBe(1);
            expect(manifest.summary.orphansFound).toBe(1);
            expect(manifest.summary.errorsCount).toBe(0);
        });

        it('uploads normalized objects, preserves #antes/#depois fragments, deduplicates, migrates orphans privately, and cleans up disk on --apply --cleanup-local', async () => {
            const { client, uploads } = createMockR2();
            const ownerTag = client.computeOwnerTag('user-1');
            const { db, updates, existingPrivateKey, privFilePath } = buildMockDb(ownerTag);

            const options: MigrationCliOptions = {
                apply: true,
                dryRun: false,
                cleanupLocal: true,
                includeOrphans: true,
                skipPreflight: false,
                help: false,
                onlyTables: null,
                extraRoots: [],
                manifestPath: null,
            };

            const migrator = new LocalStorageToR2Migrator({
                db,
                r2: client,
                uploadsDirs: [uploadsDir],
                privateUploadsDirs: [privateUploadsDir],
                options,
                logger: () => undefined,
            });

            const manifest = await migrator.run();

            expect(manifest.mode).toBe('apply');
            expect(manifest.summary.errorsCount).toBe(0);
            expect(client.verifyR2Connection).toHaveBeenCalledTimes(1);

            // Check deduplication between users.avatarUrl and leaderboard_ranks.avatarUrl
            const userUpd = updates.find((u) => u.sql.includes('UPDATE "users"'));
            const rankUpd = updates.find((u) => u.sql.includes('UPDATE "leaderboard_ranks"'));
            expect(userUpd).toBeDefined();
            expect(rankUpd).toBeDefined();
            expect(userUpd!.params[0]).toMatch(
                new RegExp(`^${TEST_R2_PUBLIC_URL}/avatars/[0-9a-f-]+\\.jpg$`),
            );
            expect(rankUpd!.params[0]).toBe(userUpd!.params[0]);

            // Check trade_notes preserved #antes and #depois and stripped stale ?exp&sig
            const tnUpd = updates.find((u) => u.sql.includes('UPDATE "trade_notes"'));
            expect(tnUpd).toBeDefined();
            const migratedPrimary = tnUpd!.params[0] as string;
            const migratedList = JSON.parse(tnUpd!.params[1]) as string[];
            expect(migratedPrimary).toMatch(
                new RegExp(`^/api/media/private/private/${ownerTag}/journal-screenshots/[0-9a-f-]+\\.png$`),
            );
            expect(migratedList[0]).toBe(`${migratedPrimary}#antes`);
            expect(migratedList[1]).toBe(`/api/media/private/${existingPrivateKey}#depois`);

            // Check existing private-uploads key was uploaded to R2 preserving its exact key
            expect(
                uploads.some((u) => u.visibility === 'private' && u.key === existingPrivateKey),
            ).toBe(true);

            // Check backtest_session_blobs converted inline base64 dataUrl while keeping id & timestamp
            const blobUpd = updates.find((u) => u.sql.includes('UPDATE "backtest_session_blobs"'));
            expect(blobUpd).toBeDefined();
            const updatedShots = JSON.parse(blobUpd!.params[0]);
            expect(updatedShots[0].id).toBe('s1');
            expect(updatedShots[0].timestamp).toBe(1700000000);
            expect(updatedShots[0].dataUrl).toMatch(
                new RegExp(`^/api/media/private/private/${ownerTag}/backtest-screenshots/[0-9a-f-]+\\.jpg$`),
            );

            // Check orphan journal screenshot went into PRIVATE bucket under HMAC ownerTag (never public!)
            const orphanUpload = uploads.find(
                (u) => u.visibility === 'private' && u.key.includes('legacy-'),
            );
            expect(orphanUpload).toBeDefined();
            expect(orphanUpload!.key).toMatch(
                new RegExp(`^private/${ownerTag}/journal-screenshots/legacy-[0-9a-f]+\\.jpg$`),
            );
            expect(manifest.summary.orphansMigrated).toBe(1);

            // Check --cleanup-local deleted all migrated local files
            expect(fs.existsSync(path.join(uploadsDir, 'avatars', 'avatar_user-1_123.jpeg'))).toBe(
                false,
            );
            expect(fs.existsSync(privFilePath)).toBe(false);
            expect(manifest.summary.localFilesDeleted).toBe(6);
        });
    });
});
