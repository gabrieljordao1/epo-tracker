export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Standalone layout — no sidebar or topbar
  return <>{children}</>;
}
