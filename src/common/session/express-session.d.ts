import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    businessId?: string;
    csrfToken?: string;
    flash?: {
      type: 'success' | 'error' | 'info';
      message: string;
    };
  }
}
