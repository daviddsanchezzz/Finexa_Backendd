import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from '../../common/decorators/user.decorator';
import { PinFinanceTabDto } from './dto/pin-finance-tab.dto';
import { CreateUserDocumentDto, UpdateUserDocumentDto } from './dto/user-document.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // (Opcional) Endpoint para listar todos los usuarios — solo si lo usas como admin
  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Get('me/pinned-finance-tab')
  getPinnedFinanceTab(@User('id') userId: number) {
    return this.userService.getPinnedFinanceTab(userId);
  }

  @Patch('me/pinned-finance-tab')
  setPinnedFinanceTab(@User('id') userId: number, @Body() dto: PinFinanceTabDto) {
    return this.userService.setPinnedFinanceTab(userId, dto.moduleKey);
  }

  @Get('me/documents')
  getDocuments(@User('id') userId: number) {
    return this.userService.getUserDocuments(userId);
  }

  @Post('me/documents')
  createDocument(@User('id') userId: number, @Body() dto: CreateUserDocumentDto) {
    return this.userService.createUserDocument(userId, dto);
  }

  @Patch('me/documents/:id')
  updateDocument(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) documentId: number,
    @Body() dto: UpdateUserDocumentDto,
  ) {
    return this.userService.updateUserDocument(userId, documentId, dto);
  }

  @Delete('me/documents/:id')
  deleteDocument(@User('id') userId: number, @Param('id', ParseIntPipe) documentId: number) {
    return this.userService.deleteUserDocument(userId, documentId);
  }

  @Get('me/quick-add-token')
  getQuickAddToken(@User('id') userId: number) {
    return this.userService.getQuickAddToken(userId);
  }

  @Post('me/quick-add-token/regenerate')
  regenerateQuickAddToken(@User('id') userId: number) {
    return this.userService.regenerateQuickAddToken(userId);
  }
}
