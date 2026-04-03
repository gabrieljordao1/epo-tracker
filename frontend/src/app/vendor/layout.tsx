export default function VendorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Standalone layout — rendered inside root layout but without sidebar/topbar
  return <>{children}</>;
}
