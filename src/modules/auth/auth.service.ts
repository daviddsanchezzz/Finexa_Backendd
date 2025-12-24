import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Tokens } from '../../common/types/tocken.type';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwtService: JwtService) {}

  // 🧱 Registro de usuario
async register(data: { email: string; password: string; name: string }): Promise<Tokens> {
  const existingUser = await this.prisma.user.findUnique({
    where: { email: data.email },
  });

  if (existingUser) throw new ConflictException("Email already registered");

  const hashedPassword = await bcrypt.hash(data.password, 10);

    // 🔹 Transacción: crea usuario + wallet + categorías
    const result = await this.prisma.$transaction(async (tx) => {
      // 1️⃣ Crear usuario
      const user = await tx.user.create({
        data: {
          email: data.email,
          password: hashedPassword,
          name: data.name,
        },
      });
  

      await tx.wallet.createMany({
        data: [
          {
            userId: user.id,
            name: "Principal",
            emoji: "💰",
            balance: 0,
            currency: "EUR",
            kind: "cash",
          },
          {
            userId: user.id,
            name: "Inversión",
            emoji: "📈",
            balance: 0,
            currency: "EUR",
            kind: "investment",
          },
        ],
        skipDuplicates: true,
      });

  
       // 3️⃣ Crear categorías por defecto
      const defaultCategories = [
        // 🧾 GASTOS
        { name: "Alimentación", emoji: "🍔", color: "#FFB74D", type: "expense" },
        { name: "Transporte", emoji: "🚗", color: "#4FC3F7", type: "expense" },
        { name: "Hogar", emoji: "🏠", color: "#A1887F", type: "expense" },
        { name: "Servicios", emoji: "💡", color: "#FFD54F", type: "expense" },
        { name: "Salud", emoji: "💊", color: "#81C784", type: "expense" },
        { name: "Ocio", emoji: "🍺", color: "#BA68C8", type: "expense" },
        { name: "Compras", emoji: "🛍️", color: "#F48FB1", type: "expense" },
        { name: "Regalos", emoji: "🎁", color: "#F06292", type: "expense" },
        { name: "Viajes", emoji: "✈️", color: "#4DD0E1", type: "expense" },
  
        // 💰 INGRESOS
        { name: "Salario", emoji: "💼", color: "#81C784", type: "income" },
        { name: "Inversiones", emoji: "📈", color: "#9575CD", type: "income" },
        { name: "Regalos", emoji: "🎁", color: "#F48FB1", type: "income" },
      ];
  
      await tx.category.createMany({
        data: defaultCategories.map((cat) => ({
          ...cat,
          userId: user.id,
        })),
      });
  
      return user; // retornamos el usuario para usarlo luego
    });
  
    // 4️⃣ Emitir tokens JWT
    return this.issueTokens(result.id, result.email);
  }


  // 🔑 Login
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    const access_token = this.generateAccessToken(user.id, user.email);
    const refresh_token = this.generateRefreshToken(user.id, user.email);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: refresh_token },
    });

    // Devolvemos también los datos del usuario (sin la contraseña)
    const { password: _, ...userWithoutPassword } = user;

    return {
      access_token,
      refresh_token,
      user: userWithoutPassword,
    };
  }

  // 🔁 Refrescar tokens
  async refreshToken(refresh_token: string) {
    try {
      const decoded = this.jwtService.verify(refresh_token);
      const access_token = this.generateAccessToken(decoded.sub, decoded.email);

      // Buscamos el usuario para devolverlo también
      const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });
      if (!user) throw new UnauthorizedException('User not found');

      const { password: _, ...userWithoutPassword } = user;

      return {
        access_token,
        refresh_token, // opcional, puedes devolver el mismo o uno nuevo
        user: userWithoutPassword,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  // 🧠 Emitir tokens y guardar refresh token en BD
  private async issueTokens(userId: number, email: string): Promise<Tokens> {
    const access_token = this.generateAccessToken(userId, email);
    const refresh_token = this.generateRefreshToken(userId, email);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: refresh_token },
    });

    return { access_token, refresh_token };
  }

  private generateAccessToken(userId: number, email: string): string {
    const payload = { sub: userId, email };
    return this.jwtService.sign(payload, { expiresIn: '15m' });
  }

  private generateRefreshToken(userId: number, email: string): string {
    const payload = { sub: userId, email };
    return this.jwtService.sign(payload, { expiresIn: '30d' });
  }
}
