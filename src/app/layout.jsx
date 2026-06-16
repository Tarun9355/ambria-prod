import "./globals.css";

export const metadata = {
  title: "Ambria",
  description: "Wedding & Event Décor Management",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
