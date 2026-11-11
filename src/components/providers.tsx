'use client';
import { PrivyProvider } from '@privy-io/react-auth';
export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId)
    return (
      <div className="configuration-error">
        Email access is not configured. Set the public app ID to open Corrigenda.
      </div>
    );
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email'],
        appearance: {
          theme: 'light',
          accentColor: '#131315',
          logo: '/logo.svg',
          showWalletLoginFirst: false,
        },
        embeddedWallets: { ethereum: { createOnLogin: 'off' } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
