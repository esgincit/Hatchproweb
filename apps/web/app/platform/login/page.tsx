import { OtpLogin } from '@/components/auth/OtpLogin';

export default function PlatformLogin() {
  return (
    <main className="screen" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
      <div className="wrap" style={{ maxWidth: 420 }}>
        <div className="eyebrow">PoultryOS · staff</div>
        <h1 className="h2">Platform console</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>Admin, finance, marketing, sales, support and operations teams.</p>
        <OtpLogin portal="platform" />
      </div>
    </main>
  );
}
