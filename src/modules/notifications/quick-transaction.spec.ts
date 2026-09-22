import { NotificationsService } from './notifications.service';

describe('quick transaction currency', () => {
  it.each([
    [{ currency: 'USD' }, 'USD'],
    [{ rawQuery: '?qa=1&amount=12&currency=GBP' }, 'GBP'],
    [{ currency: 'CHF', rawQuery: '?currency=EUR' }, 'CHF'],
    [{}, 'EUR'],
  ])('preserves currency in storage and push channels: %j', async (fields, currency) => {
    const prisma = {
      notification: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      deviceToken: { findMany: jest.fn().mockResolvedValue([
        { platform: 'ios', token: 'native' }, { platform: 'web', token: 'web' },
      ]) },
    };
    const service = new NotificationsService(prisma as any);
    const native = jest.spyOn(service as any, 'sendExpoNotifications').mockResolvedValue(undefined);
    const web = jest.spyOn(service as any, 'sendWebPushNotifications').mockResolvedValue(undefined);
    await service.createQuickTransactionNotification({ userId: 1, amount: 12, ...fields });
    const stored = prisma.notification.create.mock.calls[0][0].data;
    expect(stored.data.currency).toBe(currency);
    expect(stored.message).toBe(new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(12));
    expect(native.mock.calls[0][3]).toEqual(expect.objectContaining({ currency }));
    expect(new URL(String(web.mock.calls[0][3]), 'https://example.com').searchParams.get('currency')).toBe(currency);
  });
});
