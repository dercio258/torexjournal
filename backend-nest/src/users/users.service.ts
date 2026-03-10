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

    async findOneById(id: string): Promise<UserEntity | undefined> {
        return this.usersRepository.findOne({ where: { id } });
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

    async findAll(): Promise<UserEntity[]> {
        return this.usersRepository.find({
            relations: ['subscriptions', 'subscriptions.planConfig'],
            order: { createdAt: 'DESC' }
        });
    }
}
