import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../common/prisma/prisma.service";
import { Tokens } from "../../common/types/tocken.type";

type SafeUser = {
  id: number;
  email: string;
  name: string;
  avatar?: string | null;
};

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwtService: JwtService) {}

  // ============================
  // REGISTER
  // ============================
  async register(data: { email: string; password: string; name: string }): Promise<Tokens> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) throw new ConflictException("Email already registered");

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: data.email,
          password: hashedPassword,
          name: data.name,
        },
      });

      await tx.wallet.createMany({
        data: [
          {
            userId: created.id,
            name: "Principal",
            emoji: "💰",
            balance: 0,
            currency: "EUR",
            kind: "cash",
          },
          {
            userId: created.id,
            name: "Inversión",
            emoji: "📈",
            balance: 0,
            currency: "EUR",
            kind: "investment",
          },
        ],
        skipDuplicates: true,
      });

      const defaultCategories = [
        { name: "Alimentación", emoji: "🍔", color: "#FFB74D", type: "expense" },
        { name: "Transporte", emoji: "🚗", color: "#4FC3F7", type: "expense" },
        { name: "Hogar", emoji: "🏠", color: "#A1887F", type: "expense" },
        { name: "Servicios", emoji: "💡", color: "#FFD54F", type: "expense" },
        { name: "Salud", emoji: "💊", color: "#81C784", type: "expense" },
        { name: "Ocio", emoji: "🍺", color: "#BA68C8", type: "expense" },
        { name: "Compras", emoji: "🛍️", color: "#F48FB1", type: "expense" },
        { name: "Regalos", emoji: "🎁", color: "#F06292", type: "expense" },
        { name: "Viajes", emoji: "✈️", color: "#4DD0E1", type: "expense" },

        { name: "Salario", emoji: "💼", color: "#81C784", type: "income" },
        { name: "Inversiones", emoji: "📈", color: "#9575CD", type: "income" },
        { name: "Regalos", emoji: "🎁", color: "#F48FB1", type: "income" },
      ];

      await tx.category.createMany({
        data: defaultCategories.map((cat) => ({
          ...cat,
          userId: created.id,
        })),
      });

      return created;
    });

    // Emite tokens + guarda refresh hasheado
    return this.issueTokens(user.id, user.email   , user.name);
  }

  // ============================
  // LOGIN
  // ============================
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException("Invalid credentials");

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) throw new UnauthorizedException("Invalid credentials");

    const access_token = this.generateAccessToken(user.id, user.email, user.name);

    // Refresh token 30d + guardado hasheado en DB
    const refresh_token = this.generateRefreshToken(user.id, user.email, user.name);
    const refreshHash = await bcrypt.hash(refresh_token, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: refreshHash },
    });

    const userWithoutPassword: SafeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: (user as any).avatar ?? null,
    };

    return { access_token, refresh_token, user: userWithoutPassword };
  }

  // ============================
  // REFRESH (rotación recomendada)
  // ============================
  async refreshToken(refresh_token: string) {
    try {
      const decoded = this.jwtService.verify(refresh_token);
      const userId = decoded.sub as number;

      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new UnauthorizedException("User not found");
      if (!user.refreshToken) throw new UnauthorizedException("No refresh token stored");

      // Comparar contra hash guardado (no plano)
      const match = await bcrypt.compare(refresh_token, user.refreshToken);
      if (!match) throw new UnauthorizedException("Refresh token mismatch");

      // Nuevo access
      const access_token = this.generateAccessToken(user.id, user.email , user.name);

      // ROTACIÓN: emitir refresh nuevo y sustituir hash en DB
      const new_refresh_token = this.generateRefreshToken(user.id, user.email, user.name);
      const newRefreshHash = await bcrypt.hash(new_refresh_token, 10);

      await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshToken: newRefreshHash },
      });

      const userWithoutPassword: SafeUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: (user as any).avatar ?? null,
      };

      return {
        access_token,
        refresh_token: new_refresh_token,
        user: userWithoutPassword,
      };
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  // ============================
  // (Opcional) LOGOUT: invalida refresh
  // ============================
  async logout(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
    return { ok: true };
  }

  // ============================
  // Helpers
  // ============================
  private async issueTokens(userId: number, email: string, name: string): Promise<Tokens> {
    const access_token = this.generateAccessToken(userId, email, name);
    const refresh_token = this.generateRefreshToken(userId, email, name);

    const refreshHash = await bcrypt.hash(refresh_token, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: refreshHash },
    });

    return { access_token, refresh_token };
  }

  private generateAccessToken(userId: number, email: string, name: string): string {
    const payload = { sub: userId, email, name };
    return this.jwtService.sign(payload, { expiresIn: "15m" });
  }

  private generateRefreshToken(userId: number, email: string, name: string): string {
    const payload = { sub: userId, email, name };
    return this.jwtService.sign(payload, { expiresIn: "30d" });
  }
}
