import type { Metadata } from 'next';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import { Providers } from '@/components/providers';
export const metadata: Metadata = {
  title: 'Corrigenda | Every correction has somewhere to go',
  description: 'Follow corrections from their source to the decisions that depend on them.',
  icons: { icon: '/logo.svg', apple: '/logo.svg' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
