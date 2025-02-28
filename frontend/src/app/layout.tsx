'use client';
import { useEffect } from 'react';
import './globals.css';
import Header from '@/components/Header';
import { AuthProvider } from '@/components/auth-provider';
import type { ChatbotConfig } from '@/types/global';
import { ChatWidget } from '@/components/ChatWidget';
import {Toaster} from '@/components/ui/toaster';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Your existing head content */}
      </head>
      <body>
        <AuthProvider>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-800">
          <main>{children}</main>
          <Toaster />
        </div>
        </AuthProvider>
        <ChatWidget />
      </body>
    </html>
  );
}