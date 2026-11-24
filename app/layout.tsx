import type { Metadata, Viewport } from "next";
import "./fonts";
import "./globals.css";
// AB fork: Keel design tokens over crawlseo's, then AB naming below.
import "./ab-theme.css";

export const metadata: Metadata = {
  title: {
    default: "AI Website Optimizer by AB",
    template: "%s · AI Website Optimizer",
  },
  description: "AI Website Optimizer by AB Business Support Services",
  applicationName: "AI Website Optimizer",
};

// Light only: tells the browser not to darken form controls and scrollbars.
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#0f264c",
};

// Earlier versions stored a theme choice under this key. The app is light only
// now, so the value is dropped before first paint. Storage can throw (private
// mode, blocked site data); nothing depends on it, so errors are ignored.
const clearStaleTheme = `try{localStorage.removeItem("crawlseo-theme")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <script dangerouslySetInnerHTML={{ __html: clearStaleTheme }} />
      </head>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
