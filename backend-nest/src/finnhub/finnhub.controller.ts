import { Controller, Get, UseGuards } from '@nestjs/common';
import { FinnhubService } from './finnhub.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('finnhub')
export class FinnhubController {
    constructor(private readonly finnhubService: FinnhubService) { }

    @Get('calendar')
    // @UseGuards(JwtAuthGuard) // Optional: restrict to logged in users
    async getCalendar() {
        return this.finnhubService.getEconomicCalendar();
    }
}
