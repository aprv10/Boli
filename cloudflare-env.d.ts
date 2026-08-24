declare module 'cloudflare:workers' {
  export const env: {
    DB: D1Database;
    MISTRAL_API_KEY?: string;
  };
}
