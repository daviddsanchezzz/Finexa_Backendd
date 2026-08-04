import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { SendFriendRequestDto } from "./dto/send-friend-request.dto";

const PUBLIC_USER_SELECT = { id: true, name: true, email: true };

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sendRequest(userId: number, dto: SendFriendRequestDto) {
    const email = dto.email.trim().toLowerCase();

    const target = await this.prisma.user.findUnique({
      where: { email },
      select: PUBLIC_USER_SELECT,
    });
    if (!target) {
      throw new NotFoundException("No existe ningún usuario con ese email");
    }
    if (target.id === userId) {
      throw new BadRequestException("No puedes añadirte a ti mismo");
    }

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: target.id },
          { requesterId: target.id, addresseeId: userId },
        ],
      },
    });

    if (existing?.status === "accepted") {
      throw new ConflictException("Ya sois amigos");
    }

    if (existing?.status === "pending") {
      if (existing.requesterId === userId) {
        throw new ConflictException("Ya has enviado una solicitud a este usuario");
      }
      // El otro usuario ya te había enviado una solicitud: la aceptamos directamente.
      return this.respond(userId, existing.id, true);
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLIC_USER_SELECT,
    });

    const friendship = await this.prisma.friendship.create({
      data: { requesterId: userId, addresseeId: target.id },
      include: { requester: { select: PUBLIC_USER_SELECT }, addressee: { select: PUBLIC_USER_SELECT } },
    });

    await this.notifications.notifyUser(
      target.id,
      "Nueva solicitud de amistad",
      `${requester?.name ?? "Alguien"} quiere ser tu amigo`,
      "friend_request",
      { friendshipId: friendship.id },
    );

    return friendship;
  }

  async listFriends(userId: number) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: "accepted",
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: PUBLIC_USER_SELECT },
        addressee: { select: PUBLIC_USER_SELECT },
      },
      orderBy: { updatedAt: "desc" },
    });

    return friendships.map((f) => (f.requesterId === userId ? f.addressee : f.requester));
  }

  async listRequests(userId: number) {
    const [incoming, outgoing, myFriends] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { status: "pending", addresseeId: userId },
        include: { requester: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.friendship.findMany({
        where: { status: "pending", requesterId: userId },
        include: { addressee: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: "desc" },
      }),
      this.listFriends(userId),
    ]);

    const myFriendIds = new Set(myFriends.map((f) => f.id));

    const incomingWithMutual = await Promise.all(
      incoming.map(async (f) => {
        const theirFriends = await this.listFriends(f.requesterId);
        const mutualFriends = theirFriends
          .filter((u) => myFriendIds.has(u.id))
          .map((u) => ({ id: u.id, name: u.name }));
        return { id: f.id, createdAt: f.createdAt, user: f.requester, mutualFriends };
      }),
    );

    return {
      incoming: incomingWithMutual,
      outgoing: outgoing.map((f) => ({ id: f.id, createdAt: f.createdAt, user: f.addressee })),
    };
  }

  async respond(userId: number, friendshipId: number, accept: boolean) {
    const friendship = await this.prisma.friendship.findFirst({
      where: { id: friendshipId, addresseeId: userId, status: "pending" },
      include: { requester: { select: PUBLIC_USER_SELECT }, addressee: { select: PUBLIC_USER_SELECT } },
    });
    if (!friendship) {
      throw new NotFoundException("Solicitud no encontrada");
    }

    if (!accept) {
      await this.prisma.friendship.delete({ where: { id: friendshipId } });
      return { ok: true, status: "rejected" };
    }

    const updated = await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: "accepted" },
      include: { requester: { select: PUBLIC_USER_SELECT }, addressee: { select: PUBLIC_USER_SELECT } },
    });

    await this.notifications.notifyUser(
      friendship.requesterId,
      "Solicitud de amistad aceptada",
      `${friendship.addressee.name} ha aceptado tu solicitud de amistad`,
      "friend_accepted",
      { friendshipId: friendship.id },
    );

    return updated;
  }

  async cancelRequest(userId: number, friendshipId: number) {
    const result = await this.prisma.friendship.deleteMany({
      where: { id: friendshipId, requesterId: userId, status: "pending" },
    });
    if (!result.count) {
      throw new NotFoundException("Solicitud no encontrada");
    }
    return { ok: true };
  }

  async removeFriend(userId: number, otherUserId: number) {
    const result = await this.prisma.friendship.deleteMany({
      where: {
        status: "accepted",
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId },
        ],
      },
    });
    if (!result.count) {
      throw new NotFoundException("Amistad no encontrada");
    }
    return { ok: true };
  }
}
