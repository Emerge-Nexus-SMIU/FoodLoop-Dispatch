import Console from '@/components/console';
import { localDemoMode } from '@/server/auth';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  await connection();
  const path = '/' + ((await params).slug ?? []).join('/');
  if (
    !/^\/(|login|register|privacy|terms|forgot-password|reset-password|verify-email|invite|onboarding\/organization|app\/(dashboard|lots(?:\/[^/]+(?:\/edit)?)?|matches(?:\/[^/]+)?|pickups(?:\/[^/]+)?|impact|settings|team|account|notifications|disputes|partners|opportunities|offers|received|profile|dispatch(?:\/[^/]+)?)|admin(?:\/(organizations|audit|disputes|policy))?)$/.test(
      path,
    )
  )
    notFound();
  return <Console allowDemoAccounts={process.env.NODE_ENV !== 'production' || localDemoMode()} />;
}
