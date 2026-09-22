import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { Tokens } from "../../common/types/tocken.type";

const GOOGLE_CLIENT_IDS = [
  process.env.GOOGLE_CLIENT_ID_WEB,
  process.env.GOOGLE_CLIENT_ID_IOS,
  process.env.GOOGLE_CLIENT_ID_ANDROID,
].filter((id): id is string => Boolean(id));

const googleClient = new OAuth2Client();

type SafeUser = {
  id: number;
  email: string;
  name: string;
  avatar?: string | null;
  currency?: string | null;
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

    const user = await this.prisma.$transaction((tx) =>
      this.seedNewUser(tx, {
        email: data.email,
        name: data.name,
        password: hashedPassword,
      })
    );

    // Emite tokens + guarda refresh hasheado
    return this.issueTokens(user.id, user.email   , user.name);
  }

  // ============================
  // GOOGLE LOGIN
  // ============================
  async loginWithGoogle(idToken: string) {
    if (!idToken) throw new UnauthorizedException("Missing Google id_token");
    if (GOOGLE_CLIENT_IDS.length === 0) {
      throw new UnauthorizedException("Google login is not configured");
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_IDS,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException("Invalid Google token");
    }

    if (!payload?.email) throw new UnauthorizedException("Google account has no email");
    if (payload.email_verified === false) {
      throw new UnauthorizedException("Google email not verified");
    }

    let user = await this.prisma.user.findUnique({ where: { googleId: payload.sub } });

    if (!user) {
      const existingByEmail = await this.prisma.user.findUnique({ where: { email: payload.email } });

      if (existingByEmail) {
        user = await this.prisma.user.update({
          where: { id: existingByEmail.id },
          data: {
            googleId: payload.sub,
            avatar: existingByEmail.avatar ?? payload.picture ?? null,
          },
        });
      } else {
        user = await this.prisma.$transaction((tx) =>
          this.seedNewUser(tx, {
            email: payload!.email!,
            name: payload!.name || payload!.email!.split("@")[0],
            avatar: payload!.picture,
            googleId: payload!.sub,
          })
        );
      }
    }

    return this.issueTokensWithUser(user.id, user.email, user.name, {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      currency: user.currency,
    });
  }

  // ============================
  // LOGIN
  // ============================
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException("Invalid credentials");
    if (!user.password) {
      throw new UnauthorizedException(
        "Esta cuenta usa inicio de sesión con Google. Usa 'Iniciar sesión con Google'."
      );
    }

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
      avatar: user.avatar,
      currency: user.currency,
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
        avatar: user.avatar,
        currency: user.currency,
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
  // Perfil actual (lee de BD, no del JWT — el token solo lleva un snapshot
  // de name/email del momento del login, sin avatar)
  // ============================
  async getProfile(userId: number): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("User not found");
    return { id: user.id, email: user.email, name: user.name, avatar: user.avatar, currency: user.currency };
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

  private async issueTokensWithUser(
    userId: number,
    email: string,
    name: string,
    user: SafeUser
  ) {
    const access_token = this.generateAccessToken(userId, email, name);
    const refresh_token = this.generateRefreshToken(userId, email, name);
    const refreshHash = await bcrypt.hash(refresh_token, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: refreshHash },
    });

    return { access_token, refresh_token, user };
  }

  // Crea un usuario nuevo junto con sus wallets/categorías por defecto.
  // Usado tanto por el registro normal como por el alta vía Google.
  private async seedNewUser(
    tx: Prisma.TransactionClient,
    data: {
      email: string;
      name: string;
      password?: string | null;
      googleId?: string | null;
      avatar?: string | null;
    }
  ) {
    const created = await tx.user.create({
      data: {
        email: data.email,
        password: data.password ?? null,
        name: data.name,
        googleId: data.googleId ?? null,
        avatar: data.avatar ?? null,
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
  }
}
