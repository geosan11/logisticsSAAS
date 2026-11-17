export const EHILogo = ({ className, width, height }: { className?: string, width?: number | string, height?: number | string }) => (
  <svg 
    viewBox="0 0 280 64" 
    width={width || "100%"} 
    height={height || "100%"} 
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Concept 1: The Connected Hub-Route "H" */}
    <g id="mark" transform="translate(4, 4)">
      <rect width="56" height="56" rx="14" fill="#0D1117" />
      
      {/* Left Route Pillar */}
      <rect x="14" y="13" width="7" height="30" rx="3.5" fill="#FFFFFF" />
      <circle cx="17.5" cy="14" r="2" fill="#090A0C" />
      
      {/* Right Route Pillar */}
      <rect x="35" y="13" width="7" height="30" rx="3.5" fill="#FFFFFF" />
      <circle cx="38.5" cy="42" r="2" fill="#090A0C" />
      
      {/* Dynamic Forward Transit Bridge & Hub (Brand Accent: Signal Amber) */}
      <path d="M17.5 32 C 22 32, 24 24, 38.5 24" stroke="#FF6B00" stroke-width="4.5" stroke-linecap="round" />
      <circle cx="28" cy="28" r="5" fill="#FF6B00" />
      <circle cx="28" cy="28" r="2" fill="#090A0C" />
    </g>

    {/* Wordmark "Haulwey" */}
    <text 
      x="76" 
      y="42" 
      fontFamily="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" 
      fontSize="28" 
      fontWeight="700" 
      letterSpacing="-0.03em" 
      fill="currentColor"
    >
      Haulwey
    </text>
  </svg>
);
