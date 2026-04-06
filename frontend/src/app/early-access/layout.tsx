export default function EarlyAccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Standalone layout — no sidebar or topbar
  return <>{children}</>;
}
