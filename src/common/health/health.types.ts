export interface LivenessReport {
  status: 'ok';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
}

export interface ReadinessReport {
  status: 'ok' | 'unavailable';
  timestamp: string;
}

export interface HealthProbeResult {
  healthy: boolean;
  latencyMs: number | null;
  timestamp: Date;
}
