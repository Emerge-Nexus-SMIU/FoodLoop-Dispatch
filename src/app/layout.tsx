import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'FoodLoop Dispatch — Surplus to service',
  description: 'Verified surplus food donation and pickup coordination.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
