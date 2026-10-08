import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppChrome } from "@/components/AppChrome";
import { NotificationsProvider } from "@/components/NotificationsProvider";

export const metadata: Metadata = {
  title: "Kopi Boy Partner",
  description: "Cook and rider app for Kopi Boy — orders, deliveries, and payouts.",
  icons: { apple: "/icons/apple-touch-icon.png" },
  // iOS "Add to Home Screen": launch full-screen with the KB Partner name.
  appleWebApp: { capable: true, title: "KB Partner", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF", // matches the white Back/Cancel/Home bar
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NotificationsProvider>
          <AppChrome>{children}</AppChrome>
        </NotificationsProvider>
      </body>
    </html>
  );
}
