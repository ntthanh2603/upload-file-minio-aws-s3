import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        entities: [__dirname + '/../**/**/*.entity{.ts,.js}'],
        synchronize: true,
        host: configService.get<string>('DB_HOST'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        port: parseInt(configService.get<string>('DB_PORT') || '5432', 10),
        database: configService.get<string>('DB_NAME'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
