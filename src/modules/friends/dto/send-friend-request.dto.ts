import { IsEmail } from "class-validator";

export class SendFriendRequestDto {
  @IsEmail()
  email: string;
}
