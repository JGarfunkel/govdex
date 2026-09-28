import "./globals.css";

export const metadata = {
  title: "NYC vs. NYS Open Data Transparency",
  description:
    "A side-by-side comparison of how New York City and New York State publish public data across civic domains.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
