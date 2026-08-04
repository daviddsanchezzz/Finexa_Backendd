import { IsInt } from "class-validator";

export class InviteTripMemberDto {
  @IsInt()
  userId: number;
}
