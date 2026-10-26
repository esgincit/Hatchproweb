'use client';
import { useEffect } from 'react';

/** Opens the browser's print dialog (→ "Save as PDF") once when the report loads, and again on tap. */
export function PrintButton({ label }: { label: string }) {
  useEffect(() => { const id = setTimeout(() => window.print(), 300); return () => clearTimeout(id); }, []);
  return <button className="btn small noprint" onClick={() => window.print()}>{label}</button>;
}
