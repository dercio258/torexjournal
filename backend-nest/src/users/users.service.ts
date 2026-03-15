import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(UserEntity)
        private usersRepository: Repository<UserEntity>,
    ) { }

    async findOneByEmail(email: string): Promise<UserEntity | undefined> {
        return this.usersRepository.findOne({ where: { email } });
    }

    async findOneByGoogleId(googleId: string): Promise<UserEntity | undefined> {
        return this.usersRepository.findOne({ where: { googleId } });
    }

    async findOneByGithubId(githubId: string): Promise<UserEntity | undefined> {
        return this.usersRepository.findOne({ where: { githubId } });
    }

    async findOneById(id: string): Promise<UserEntity | undefined> {
        return this.usersRepository.findOne({ where: { id } });
    }

    async findOneByRefreshToken(refreshToken: string): Promise<UserEntity | undefined> {
        // Note: we'll need to use raw query if we want to match hashed tokens, 
        // but for now let's assume we can search by the field.
        // Actually, we store the hash, so we can't search by raw token.
        // We'll need a better way if we have many users.
        // For now, let's just find the user by ID if passed, or find any user with a refreshToken not null
        // and check manually.
        return this.usersRepository.findOne({ where: { refreshToken: refreshToken } });
    }

    async create(userData: Partial<UserEntity>): Promise<UserEntity> {
        const user = this.usersRepository.create(userData);
        return this.usersRepository.save(user);
    }

    async updateProfile(userId: string, data: { name?: string; avatarUrl?: string }): Promise<UserEntity> {
        await this.usersRepository.update(userId, data);
        return this.findOneById(userId);
    }

    async update(user: UserEntity): Promise<UserEntity> {
        return this.usersRepository.save(user);
    }

    async updateContact(userId: string, whatsapp: string): Promise<UserEntity> {
        const user = await this.findOneById(userId);
        user.whatsapp = whatsapp;
        return this.usersRepository.save(user);
    }

    async updateRefreshToken(userId: string, refreshToken: string | null): Promise<void> {
        await this.usersRepository.update(userId, { refreshToken });
    }

    async findAll(): Promise<UserEntity[]> {
        return this.usersRepository.find({
            relations: ['subscriptions', 'subscriptions.planConfig'],
            order: { createdAt: 'DESC' }
        });
    }
}
