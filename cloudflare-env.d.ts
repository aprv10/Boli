declare module 'cloudflare:workers' {
  export const env: {
    DB: D1Database;
    MISTRAL_API_KEY?: string;
    BOLI_AGENT_API_KEY?: string;
    BOLI_PAYMENT_MODE?: 'demo' | 'razorpay';
    RAZORPAY_KEY_ID?: string;
    RAZORPAY_KEY_SECRET?: string;
    RAZORPAY_WEBHOOK_SECRET?: string;
    APP_BASE_URL?: string;
  };
}
