/**
 * 图片上传：仅商户/管理员，PNG / JPEG / WebP，≤5MB。
 * 三重校验：声明 MIME → 文件头魔数 → 两者一致；文件名完全由服务端生成，
 * 不使用 originalname，杜绝目录穿越与伪装扩展名。
 */
import {
  Controller,
  Module,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AuthUser, CurrentUser, Errors, Roles, ok } from '../common';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);

/** 只认文件头，不认扩展名与 Content-Type。 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly config: ConfigService) {}

  @Roles('MERCHANT', 'ADMIN')
  @Post('dishes')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  uploadDishImage(@CurrentUser() _user: AuthUser, @UploadedFile() file?: UploadedFileLike) {
    if (!file || !file.buffer?.length) throw Errors.invalidParam('请选择要上传的图片');
    if (file.size > MAX_UPLOAD_BYTES) throw Errors.invalidParam('图片不能超过 5MB');

    const declared = ALLOWED_MIME.get(file.mimetype);
    if (!declared) throw Errors.invalidParam('仅支持 PNG / JPEG / WebP');

    const actual = sniffImageMime(file.buffer);
    if (!actual) throw Errors.invalidParam('文件内容不是有效图片');
    if (actual !== file.mimetype) throw Errors.invalidParam('文件类型与内容不一致');

    const dir = resolve(this.config.get<string>('STORAGE_LOCAL_DIR') || './uploads');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const name = `${Date.now()}-${randomBytes(8).toString('hex')}${ALLOWED_MIME.get(actual)}`;
    writeFileSync(join(dir, name), file.buffer, { mode: 0o644 });

    return ok({ url: `/uploads/${name}`, size: file.size, mime: actual }, '上传成功');
  }
}

@Module({ controllers: [UploadsController] })
export class UploadsModule {}
