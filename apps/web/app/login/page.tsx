import { OtpLogin } from '@/components/auth/OtpLogin';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="screen" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
      <div className="wrap" style={{ maxWidth: 420 }}>
        <div className="eyebrow">PoultryOS</div>
        <h1 className="h2">Sign in to your farm</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>Owners, managers, supervisors, labour and vets.</p>
        {error === 'no-access' && (
          <div className="pill warn" style={{ whiteSpace: 'normal' }}>Your account has no role yet. Ask your farm owner.</div>
        )}
        <OtpLogin portal="farm" />
      </div>
    </main>
  );
}
