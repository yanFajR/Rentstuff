import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

export function MaxByteLength(maxBytes: number, options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'maxByteLength',
      target: object.constructor,
      propertyName,
      constraints: [maxBytes],
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= maxBytes;
        },
        defaultMessage(arguments_: ValidationArguments): string {
          return `Nilai maksimal ${arguments_.constraints[0]} byte UTF-8.`;
        },
      },
    });
  };
}
