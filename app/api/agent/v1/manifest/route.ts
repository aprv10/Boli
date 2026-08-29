import { commerceManifest } from '@/src/application/agent/commerce-manifest';

export async function GET(request: Request) {
  return Response.json(commerceManifest(new URL(request.url).origin), {
    headers: { 'cache-control': 'no-store' },
  });
}
