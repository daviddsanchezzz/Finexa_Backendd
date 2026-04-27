import { Injectable, Logger } from '@nestjs/common';
import * as webPush from 'web-push';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RegisterTokenDto } from './dto/register-token.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

export interface RecurringNotificationPayload {
  userId: number;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  recurrence: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {
    // Configurar VAPID para Web Push
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webPush.setVapidDetails(
        `mailto:${process.env.VAPID_EMAIL ?? 'noreply@spendly.app'}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
    }
  }

  // ──────────────────────────────────────────
  // TOKEN REGISTRATION
  // ──────────────────────────────────────────

  async registerToken(userId: number, dto: RegisterTokenDto) {
    await this.prisma.deviceToken.upsert({
      where: { userId_token: { userId, token: dto.token } },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform,
      },
      update: {
        platform: dto.platform,
      },
    });
    return { ok: true };
  }

  async removeToken(userId: number, token: string) {
    await this.prisma.deviceToken
      .delete({ where: { userId_token: { userId, token } } })
      .catch(() => null);
    return { ok: true };
  }

  // ──────────────────────────────────────────
  // PREFERENCES
  // ──────────────────────────────────────────

  async getPreferences(userId: number) {
    const prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (!prefs) {
      return { recurringTransactions: true };
    }
    return { recurringTransactions: prefs.recurringTransactions };
  }

  async updatePreferences(userId: number, dto: UpdatePreferencesDto) {
    const prefs = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: { ...dto },
    });
    return { recurringTransactions: prefs.recurringTransactions };
  }

  // ──────────────────────────────────────────
  // IN-APP NOTIFICATIONS (historial)
  // ──────────────────────────────────────────

  async getNotifications(userId: number) {
    return this.prisma.notification.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markAsRead(userId: number, id: number) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllAsRead(userId: number) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  // ──────────────────────────────────────────
  // SEND: RECURRING TRANSACTION EXECUTED
  // Llamado por TransactionsService tras el cron
  // ──────────────────────────────────────────

  async notifyRecurringTransactionExecuted(payload: RecurringNotificationPayload) {
    const { userId, description, amount, type, recurrence } = payload;

    // 1) Verificar que el usuario tiene esta preferencia activa
    const prefs = await this.getPreferences(userId);
    if (!prefs.recurringTransactions) return;

    // 2) Construir el mensaje
    const sign = type === 'income' ? '+' : type === 'expense' ? '-' : '';
    const amountStr = `${sign}${amount.toFixed(2).replace('.', ',')} €`;
    const recurrenceMap: Record<string, string> = {
      daily: 'diaria',
      weekly: 'semanal',
      monthly: 'mensual',
      yearly: 'anual',
    };
    const recurrenceLabel = recurrenceMap[recurrence] ?? recurrence;
    const title = '💸 Transacción recurrente ejecutada';
    const body = description
      ? `${description} · ${amountStr} (${recurrenceLabel})`
      : `${amountStr} · frecuencia ${recurrenceLabel}`;

    // 3) Guardar notificación in-app
    await this.prisma.notification.create({
      data: {
        userId,
        title,
        message: body,
        type: 'recurring_transaction',
      },
    });

    // 4) Obtener tokens del dispositivo
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
    });
    if (!tokens.length) return;

    const nativeTokens = tokens.filter((t) => t.platform !== 'web').map((t) => t.token);
    const webTokens = tokens.filter((t) => t.platform === 'web').map((t) => t.token);

    // 5a) Enviar a dispositivos nativos vía Expo Push API
    if (nativeTokens.length) {
      await this.sendExpoNotifications(nativeTokens, title, body, {
        type: 'recurring_transaction',
      });
    }

    // 5b) Enviar a suscriptores web push
    if (webTokens.length) {
      await this.sendWebPushNotifications(webTokens, title, body);
    }
  }

  // ──────────────────────────────────────────
  // EXPO PUSH (iOS + Android nativos)
  // ──────────────────────────────────────────

  private async sendExpoNotifications(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, unknown> = {},
  ) {
    const messages = tokens.map((to) => ({ to, title, body, data, sound: 'default' }));

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      });

      if (!res.ok) {
        this.logger.warn(`Expo push falló: ${res.status}`);
      }
    } catch (err) {
      this.logger.error('Error enviando Expo push:', err);
    }
  }

  // ──────────────────────────────────────────
  // WEB PUSH (Safari PWA / Chrome / Firefox)
  // Los tokens web son el JSON del PushSubscription
  // ──────────────────────────────────────────

  private async sendWebPushNotifications(subscriptionJsons: string[], title: string, body: string) {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      this.logger.warn('VAPID keys no configuradas, saltando web push');
      return;
    }

    const payload = JSON.stringify({ title, body, icon: '/icon.png' });

    for (const json of subscriptionJsons) {
      try {
        const subscription = JSON.parse(json) as webPush.PushSubscription;
        await webPush.sendNotification(subscription, payload);
      } catch (err: any) {
        // 410 = suscripción expirada/inválida → limpiar
        if (err?.statusCode === 410) {
          await this.prisma.deviceToken
            .deleteMany({ where: { token: json } })
            .catch(() => null);
        } else {
          this.logger.error('Error enviando web push:', err);
        }
      }
    }
  }
}
