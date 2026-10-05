import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppChrome } from "@/components/AppChrome";
import { NotificationsProvider } from "@/components/NotificationsProvider";

export const metadata: Metadata = {
  title: "Kopi Boy Partner",
  description: "Cook and rider app for Kopi Boy — orders, deliveries, and payouts.",
  icons: { apple: "/icons/apple-touch-icon.png" },
  // iOS "Add to Home Screen": launch full-screen with the KB Partner name.
  appleWebApp: { capable: true, title: "KB Partner", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#0B1B34", // --kb-navy: tints the browser/status bar to match the app
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
