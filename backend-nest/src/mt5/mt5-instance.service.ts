import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { CloudInstanceEntity, CloudInstanceStatus } from './cloud-instance.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class Mt5InstanceService implements OnModuleInit {
    private readonly logger = new Logger(Mt5InstanceService.name);
    private templatePath: string;
    private instancesRoot: string;
    private readonly TERMINAL_EXE = 'terminal64.exe';

    constructor(
        @InjectRepository(CloudInstanceEntity)
        private instanceRepo: Repository<CloudInstanceEntity>,
        private configService: ConfigService
    ) { }

    async onModuleInit() {
        this.templatePath = this.configService.get<string>('MT5_TEMPLATE_PATH', 'C:\\MT5_TEMPLATE');
        this.instancesRoot = this.configService.get<string>('MT5_INSTANCES_ROOT', 'C:\\MT5_INSTANCES');

        this.logger.log(`MT5 Manager Config: Template=${this.templatePath}, Instances=${this.instancesRoot}`);

        this.ensureDirectories();
    }

    private ensureDirectories() {
        if (!fs.existsSync(this.instancesRoot)) {
            try {
                fs.mkdirSync(this.instancesRoot, { recursive: true });
            } catch (e) {
                this.logger.error(`Failed to create instances root: ${e.message}`);
            }
        }
    }

    async startInstance(userId: string, login: string, password: string, server: string): Promise<CloudInstanceEntity> {
        // Validation: Check if template exists
        if (!fs.existsSync(this.templatePath)) {
            const msg = `Base MT5 Template not found at ${this.templatePath}. Please configure MT5_TEMPLATE_PATH correctly.`;
            this.logger.error(msg);
            throw new Error(msg);
        }

        // Validation: Check if terminal64.exe exists in template (prevent copying wrong dir)
        const templateExe = path.join(this.templatePath, this.TERMINAL_EXE);
        if (!fs.existsSync(templateExe)) {
            const msg = `Invalid MT5 Template at ${this.templatePath}: ${this.TERMINAL_EXE} is missing. Please point MT5_TEMPLATE_PATH to a valid MT5 installation folder.`;
            this.logger.error(msg);
            throw new Error(msg);
        }

        // Sanitize login for folder name to avoid FS errors with symbols
        const safeLogin = login.replace(/[^a-zA-Z0-9_-]/g, '_');
        const instanceDir = path.join(this.instancesRoot, `user_${userId}_${safeLogin}`);

        // 1. Check if already running
        let dbInstance = await this.instanceRepo.findOne({ where: { userId, mt5Id: login } });
        if (dbInstance && dbInstance.status === CloudInstanceStatus.RUNNING) {
            // Check if PID is actually alive
            if (this.isPidRunning(dbInstance.pid)) {
                this.logger.log(`Instance for ${login} already running (PID: ${dbInstance.pid})`);
                return dbInstance;
            }
            // If dead, mark stopped and restart
            dbInstance.status = CloudInstanceStatus.STOPPED;
            await this.instanceRepo.save(dbInstance);
        }

        // 2. Clone Template if needed
        if (!fs.existsSync(instanceDir)) {
            this.logger.log(`Cloning template to ${instanceDir}...`);
            await this.copyDirectory(this.templatePath, instanceDir);
        }

        // 3. Create Config.ini for Auto-Login
        const configPath = path.join(instanceDir, 'config', 'startup.ini');
        this.createStartupConfig(configPath, login, password, server);

        // 4. Spawn Process
        const exePath = path.join(instanceDir, this.TERMINAL_EXE);
        if (!fs.existsSync(exePath)) {
            throw new Error(`Terminal Executable not found at ${exePath}`);
        }

        this.logger.log(`Spawning MT5 for ${login}...`);
        // /portable flag is critical to keep data in local folder
        const child = cp.spawn(exePath, [`/config:${configPath}`, '/portable'], {
            detached: true, // Allow it to run if Node exits
            stdio: 'ignore', // Don't pipe stdout/err
            cwd: instanceDir
        });

        child.unref(); // Don't wait for it

        // 5. Update DB
        if (!dbInstance) {
            dbInstance = this.instanceRepo.create({
                userId,
                mt5Id: login,
                status: CloudInstanceStatus.STARTING
            });
        }

        dbInstance.pid = child.pid;
        dbInstance.status = CloudInstanceStatus.RUNNING;
        dbInstance.errorMessage = null;

        return this.instanceRepo.save(dbInstance);
    }

    async stopInstance(userId: string, login: string): Promise<boolean> {
        const dbInstance = await this.instanceRepo.findOne({ where: { userId, mt5Id: login } });

        if (!dbInstance || !dbInstance.pid) return false;

        try {
            process.kill(dbInstance.pid); // SIGTERM
        } catch (e) {
            this.logger.warn(`Failed to kill PID ${dbInstance.pid}: ${e.message}`);
        }

        dbInstance.status = CloudInstanceStatus.STOPPED;
        dbInstance.pid = null;
        await this.instanceRepo.save(dbInstance);
        return true;
    }

    private createStartupConfig(filePath: string, login: string, pass: string, server: string) {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const content = `
; Auto-Generated Startup Config
[Common]
Login=${login}
Password=${pass}
Server=${server}
AutoConfiguration=true
EnableNews=false
NewsLanguages=
Certificates=
CertificatesPath=

[Charts]
MaxBars=1000
PrintColor=true
SaveDeleted=false

[Experts]
AllowDllImport=true
Enabled=true
Account=true
Profile=true
`;
        fs.writeFileSync(filePath, content);
    }

    private async copyDirectory(src: string, dest: string) {
        return new Promise<void>((resolve, reject) => {
            // Using standard OS copy command for speed/simplicity on Windows (xcopy /E /I /Y)
            // Or node recursive copy. Let's use cp -r equivalent if Node version allows, otherwise recursion.
            // Node 16.7+ has fs.cp
            if (fs.cp) {
                fs.cp(src, dest, { recursive: true }, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            } else {
                // Fallback for older node (less likely but safer)
                this.copyDirRecursive(src, dest);
                resolve();
            }
        });
    }

    private copyDirRecursive(src: string, dest: string) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                this.copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    private isPidRunning(pid: number): boolean {
        try {
            // signal 0 tests existence
            process.kill(pid, 0);
            return true;
        } catch (e) {
            return false;
        }
    }
}
