export const metadata = {
  title: 'Flags Server',
  description: 'Minimal test for API',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
