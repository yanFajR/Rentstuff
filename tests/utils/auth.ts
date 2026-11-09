import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import {
  extractSessionCookie,
  fetchCsrfToken,
  sessionIdFromCookie,
  uniqueEmail,
} from './cookies.js';

export const testPrisma = new PrismaClient();

export interface TestUser {
  agent: ReturnType<typeof request.agent>;
  name: string;
  email: string;
  password: string;
  businessName: string;
  userId: string;
  businessId: string;
  membershipId: string;
  role: string;
  sessionCookie: string;
  sessionId: string;
}

export interface RegisterOverrides {
  name?: string;
  email?: string;
  password?: string;
  businessName?: string;
}

export async function registerTestUser(
  server: unknown,
  overrides: RegisterOverrides = {},
): Promise<TestUser> {
  const agent = request.agent(server as Parameters<typeof request.agent>[0]);
  const csrfToken = await fetchCsrfToken(agent, '/register');

  const name = overrides.name ?? 'Budi Santoso';
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? 'Rahasia123';
  const businessName = overrides.businessName ?? 'Rental Maju';

  const response = await agent
    .post('/register')
    .type('form')
    .send({
      _csrf: csrfToken,
      name,
      email,
      password,
      confirmPassword: password,
      businessName,
    })
    .expect(303);

  const sessionCookie = extractSessionCookie(response.headers as Record<string, unknown>);
  const sessionId = sessionIdFromCookie(sessionCookie);
  const normalizedEmail = email.trim().toLowerCase();

  const user = await testPrisma.user.findUniqueOrThrow({ where: { email: normalizedEmail } });
  const membership = await testPrisma.businessMember.findFirstOrThrow({
    where: { userId: user.id },
  });

  return {
    agent,
    name,
    email: normalizedEmail,
    password,
    businessName,
    userId: user.id,
    businessId: membership.businessId,
    membershipId: membership.id,
    role: membership.role,
    sessionCookie,
    sessionId,
  };
}

export interface LoginAttempt {
  agent: ReturnType<typeof request.agent>;
  status: number;
  location: string | undefined;
  text: string;
  cookie: string | null;
  sessionId: string | null;
}

export async function attemptLogin(
  server: unknown,
  email: string,
  password: string,
): Promise<LoginAttempt> {
  const agent = request.agent(server as Parameters<typeof request.agent>[0]);
  const csrfToken = await fetchCsrfToken(agent, '/login');

  const response = await agent
    .post('/login')
    .type('form')
    .send({ _csrf: csrfToken, email, password });

  let cookie: string | null = null;
  let sessionId: string | null = null;

  if (response.headers['set-cookie']) {
    cookie = extractSessionCookie(response.headers as Record<string, unknown>);
    sessionId = sessionIdFromCookie(cookie);
  }

  return {
    agent,
    status: response.status,
    location: response.headers.location as string | undefined,
    text: response.text,
    cookie,
    sessionId,
  };
}
