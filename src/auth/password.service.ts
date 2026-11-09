import bcrypt from 'bcryptjs';
import { Injectable } from '@nestjs/common';

const SALT_ROUNDS = 12;

const TIMING_EQUALIZER_HASH = '$2b$12$8sgImkMnNMMKqwXbn6yCyuPbPxOxX9J5CTu2bvsSs/bMZB9lJIgQy';

@Injectable()
export class PasswordService {
  hash(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, SALT_ROUNDS);
  }

  verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, passwordHash);
  }

  async runTimingEqualizer(plainPassword: string): Promise<void> {
    await bcrypt.compare(plainPassword, TIMING_EQUALIZER_HASH);
  }
}
