import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let service: HealthService;

  const prismaMock = {
    $queryRaw: jest.fn<() => Promise<unknown>>(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  it('liveness tidak membocorkan detail database atau environment', () => {
    const report = service.liveness();

    expect(report).toMatchObject({ status: 'ok', service: 'rental-reminder' });
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(report).not.toHaveProperty('database');
    expect(report).not.toHaveProperty('environment');
    expect(report).not.toHaveProperty('timezone');
  });

  it('readiness ok ketika database dapat diakses', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '1': 1 }]);

    const report = await service.readiness();

    expect(report.status).toBe('ok');
    expect(report).not.toHaveProperty('database');
    expect(report).not.toHaveProperty('latencyMs');
  });

  it('readiness unavailable ketika database gagal diakses', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('connection refused'));

    const report = await service.readiness();

    expect(report.status).toBe('unavailable');
  });
});
