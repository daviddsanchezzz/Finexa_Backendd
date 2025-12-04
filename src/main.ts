import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const reflector = app.get(Reflector);

  // ✅ Habilitar CORS
  app.enableCors({
    origin: [
      'http://localhost:8081', // Expo web
      'http://localhost:19006', // Expo dev
      'http://192.168.68.53:8081', // acceso LAN desde móvil
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // 👈 añade PUT aquí
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ✅ Validaciones globales
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // ✅ Protección JWT global
  app.useGlobalGuards(new JwtAuthGuard(reflector));

  // ✅ Iniciar servidor
  await app.listen(process.env.PORT || 3000);
  console.log(`🚀 Server running on http://192.168.68.53:${process.env.PORT || 3000}`);
}
bootstrap();
