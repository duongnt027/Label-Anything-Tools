export function IconFolderOpen({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
      />
    </svg>
  );
}

export function IconExport({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m7 10 5 5 5-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 21h14" />
    </svg>
  );
}

export function IconTrash({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 6V4h8v2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14H6L5 6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconBox({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
    </svg>
  );
}

export function IconSegment({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 18 9 8l4 6 3-4 3 8" />
    </svg>
  );
}

export function IconHand({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 13V7a1 1 0 0 1 2 0v4m0-2V5a1 1 0 0 1 2 0v6m0-2a1 1 0 0 1 2 0V8a1 1 0 1 1 2 0v7c0 2.5-2 4.5-4.5 4.5H11a4.5 4.5 0 0 1-4.5-4.5v-2.5a1 1 0 0 1 1.5-.9"
      />
    </svg>
  );
}

export function IconGoldBar({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="9" width="18" height="8" rx="1.5" fill="#eab308" stroke="#ca8a04" strokeWidth="1.5" />
      <rect x="5" y="11" width="14" height="2" rx="0.5" fill="#fde047" opacity="0.7" />
    </svg>
  );
}

export function IconDiamond({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z" />
    </svg>
  );
}

export function IconEye({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeOff({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.6 10.6a3 3 0 0 0 4.2 4.2M9.5 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a18.2 18.2 0 0 1-2.2 3.1M6.1 6.1A18.4 18.4 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 4.1-.8"
      />
    </svg>
  );
}
