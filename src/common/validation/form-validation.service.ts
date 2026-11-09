import { Injectable } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';

export interface FormValidationResult<T extends object> {
  readonly data: T;
  readonly errors: Record<string, string>;
  readonly valid: boolean;
}

@Injectable()
export class FormValidationService {
  async validate<T extends object>(
    type: ClassConstructor<T>,
    value: Record<string, unknown>,
  ): Promise<FormValidationResult<T>> {
    const instance = plainToInstance(type, value);
    const validationErrors = await validate(instance, {
      whitelist: true,
      forbidUnknownValues: false,
      stopAtFirstError: true,
    });

    const errors: Record<string, string> = {};
    for (const error of validationErrors) {
      const message = error.constraints ? Object.values(error.constraints)[0] : undefined;
      errors[error.property] = message ?? 'Nilai tidak valid.';
    }

    return {
      data: instance,
      errors,
      valid: Object.keys(errors).length === 0,
    };
  }
}
