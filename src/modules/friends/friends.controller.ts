import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, HttpCode } from "@nestjs/common";
import { User } from "src/common/decorators/user.decorator";
import { FriendsService } from "./friends.service";
import { SendFriendRequestDto } from "./dto/send-friend-request.dto";

@Controller("friends")
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  listFriends(@User("id") userId: number) {
    return this.friendsService.listFriends(userId);
  }

  @Delete(":userId")
  @HttpCode(200)
  removeFriend(@User("id") userId: number, @Param("userId", ParseIntPipe) otherUserId: number) {
    return this.friendsService.removeFriend(userId, otherUserId);
  }

  @Get("requests")
  listRequests(@User("id") userId: number) {
    return this.friendsService.listRequests(userId);
  }

  @Post("requests")
  sendRequest(@User("id") userId: number, @Body() dto: SendFriendRequestDto) {
    return this.friendsService.sendRequest(userId, dto);
  }

  @Patch("requests/:id/accept")
  @HttpCode(200)
  acceptRequest(@User("id") userId: number, @Param("id", ParseIntPipe) id: number) {
    return this.friendsService.respond(userId, id, true);
  }

  @Patch("requests/:id/reject")
  @HttpCode(200)
  rejectRequest(@User("id") userId: number, @Param("id", ParseIntPipe) id: number) {
    return this.friendsService.respond(userId, id, false);
  }

  @Delete("requests/:id")
  @HttpCode(200)
  cancelRequest(@User("id") userId: number, @Param("id", ParseIntPipe) id: number) {
    return this.friendsService.cancelRequest(userId, id);
  }
}
