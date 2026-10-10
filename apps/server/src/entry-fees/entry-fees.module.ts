import { Module } from '@nestjs/common';
import { EntryFeesController } from './entry-fees.controller';
import { EntryFeesService } from './entry-fees.service';

@Module({
  controllers: [EntryFeesController],
  providers: [EntryFeesService],
})
export class EntryFeesModule {}
