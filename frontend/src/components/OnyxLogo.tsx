/**
 * Onyx geometric logo — connected data points forming a hexagonal constellation.
 * Used across the app for branding (sidebar, login, vendor portal).
 */
export function OnyxLogo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      fill="none"
      width={size}
      height={size}
      className={className}
    >
      {/* Connection lines */}
      <line x1="20" y1="4" x2="33" y2="13" stroke="url(#og1)" strokeWidth="1.2" opacity="0.6"/>
      <line x1="33" y1="13" x2="33" y2="27" stroke="url(#og1)" strokeWidth="1.2" opacity="0.6"/>
      <line x1="33" y1="27" x2="20" y2="36" stroke="url(#og1)" strokeWidth="1.2" opacity="0.6"/>
      <line x1="20" y1="36" x2="7" y2="27" stroke="url(#og1)" strokeWidth="1.2" opacity="0.6"/>
      <line x1="7" y1="27" x2="7" y2="13" stroke="url(#og1)" strokeWidth="1.2" opacity="0.6"/>
      <line x1="7" y1="13" x2="20" y2="4" stroke="url(#og1)" strokeWidth="1.2" opacity="0.6"/>

      {/* Inner connections to center */}
      <line x1="20" y1="4" x2="20" y2="20" stroke="url(#og2)" strokeWidth="1" opacity="0.4"/>
      <line x1="7" y1="13" x2="33" y2="27" stroke="url(#og2)" strokeWidth="1" opacity="0.4"/>
      <line x1="33" y1="13" x2="7" y2="27" stroke="url(#og2)" strokeWidth="1" opacity="0.4"/>
      <line x1="20" y1="20" x2="20" y2="36" stroke="url(#og2)" strokeWidth="1" opacity="0.4"/>
      <line x1="20" y1="20" x2="33" y2="13" stroke="url(#og2)" strokeWidth="1" opacity="0.35"/>
      <line x1="20" y1="20" x2="7" y2="13" stroke="url(#og2)" strokeWidth="1" opacity="0.35"/>
      <line x1="20" y1="20" x2="33" y2="27" stroke="url(#og2)" strokeWidth="1" opacity="0.35"/>
      <line x1="20" y1="20" x2="7" y2="27" stroke="url(#og2)" strokeWidth="1" opacity="0.35"/>

      {/* Outer nodes */}
      <circle cx="20" cy="4" r="2.5" fill="url(#onG)"/>
      <circle cx="33" cy="13" r="2.5" fill="url(#onG)"/>
      <circle cx="33" cy="27" r="2.5" fill="url(#onG)"/>
      <circle cx="20" cy="36" r="2.5" fill="url(#onG)"/>
      <circle cx="7" cy="27" r="2.5" fill="url(#onG)"/>
      <circle cx="7" cy="13" r="2.5" fill="url(#onG)"/>

      {/* Center node */}
      <circle cx="20" cy="20" r="3.5" fill="url(#ocG)"/>
      <circle cx="20" cy="20" r="5.5" fill="none" stroke="#34d399" strokeWidth="0.5" opacity="0.2"/>

      {/* Glow effects */}
      <circle cx="20" cy="4" r="4" fill="#34d399" opacity="0.15"/>
      <circle cx="33" cy="13" r="4" fill="#34d399" opacity="0.12"/>
      <circle cx="33" cy="27" r="4" fill="#34d399" opacity="0.12"/>
      <circle cx="20" cy="36" r="4" fill="#34d399" opacity="0.15"/>
      <circle cx="7" cy="27" r="4" fill="#34d399" opacity="0.12"/>
      <circle cx="7" cy="13" r="4" fill="#34d399" opacity="0.12"/>
      <circle cx="20" cy="20" r="6" fill="#34d399" opacity="0.1"/>

      <defs>
        <linearGradient id="og1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399"/>
          <stop offset="100%" stopColor="#059669"/>
        </linearGradient>
        <linearGradient id="og2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.6"/>
          <stop offset="100%" stopColor="#059669" stopOpacity="0.3"/>
        </linearGradient>
        <radialGradient id="onG">
          <stop offset="0%" stopColor="#6ee7b7"/>
          <stop offset="100%" stopColor="#34d399"/>
        </radialGradient>
        <radialGradient id="ocG">
          <stop offset="0%" stopColor="#a7f3d0"/>
          <stop offset="50%" stopColor="#34d399"/>
          <stop offset="100%" stopColor="#059669"/>
        </radialGradient>
      </defs>
    </svg>
  );
}
