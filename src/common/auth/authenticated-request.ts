import type { Request } from 'express';
import type { Business, BusinessMember, User } from '@prisma/client';

export interface AuthenticationContext {
  userId: string;
  businessId: string;
  membershipId: string;
  role: string;
  user: Pick<User, 'id' | 'name' | 'email'>;
  business: Pick<Business, 'id' | 'name' | 'address' | 'whatsappNumber' | 'description'>;
  membership: BusinessMember;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthenticationContext;
}
