export const BUSINESS_ROLES = {
  OWNER: 'OWNER',
} as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[keyof typeof BUSINESS_ROLES];

export function isBusinessRole(value: string): value is BusinessRole {
  return Object.values(BUSINESS_ROLES).includes(value as BusinessRole);
}
