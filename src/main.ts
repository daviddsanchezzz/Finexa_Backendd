import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ValidationPipe } from '@nestjs/common';
import { PrismaService } from './common/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const reflector = app.get(Reflector);

  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);

  // ✅ Habilitar CORS
  app.enableCors({
    origin: true,
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
