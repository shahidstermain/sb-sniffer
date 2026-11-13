import React from 'react';

interface LogoProps {
  variant?: 'mark' | 'full';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showBadge?: boolean;
}

export const Logo: React.FC<LogoProps> = ({
  variant = 'full',
  size = 'md',
  className = '',
  showBadge = true,
}) => {
  const sizeMap = {
    xs: { mark: 24, textTitle: 'text-xs', textSub: 'text-[8px]' },
    sm: { mark: 32, textTitle: 'text-sm', textSub: 'text-[9px]' },
    md: { mark: 40, textTitle: 'text-base', textSub: 'text-[10px]' },
    lg: { mark: 48, textTitle: 'text-lg', textSub: 'text-xs' },
    xl: { mark: 64, textTitle: 'text-2xl', textSub: 'text-xs' },
  };

  const currentSize = sizeMap[size];

  const MarkSvg = (
    <svg
      viewBox="0 0 120 120"
      width={currentSize.mark}
      height={currentSize.mark}
      fill="none"
      className="shrink-0 drop-shadow-md"
    >
      <defs>
        <radialGradient id="logoBgGlow" cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#1e2329" />
          <stop offset="100%" stopColor="#0a0b0d" />
        </radialGradient>
        <linearGradient id="logoEmeraldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3ECF8E" />
          <stop offset="50%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="logoCyanGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3ECF8E" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
        <filter id="logoGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Squircle Background Container */}
      <rect x="2" y="2" width="116" height="116" rx="28" fill="url(#logoBgGlow)" stroke="#262c33" strokeWidth="2" />
      <rect x="3" y="3" width="114" height="114" rx="27" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1" />

      {/* Sonar Radar Rings */}
      <circle cx="60" cy="60" r="38" stroke="#3ECF8E" strokeOpacity="0.08" strokeWidth="1" strokeDasharray="3 3" />
      <circle cx="60" cy="60" r="26" stroke="#3ECF8E" strokeOpacity="0.14" strokeWidth="1" />
      <circle cx="60" cy="60" r="14" stroke="#3ECF8E" strokeOpacity="0.2" strokeWidth="1" />

      {/* Radar Cone */}
      <path d="M 60,60 L 86,34 A 38 38 0 0 0 46,24 Z" fill="url(#logoCyanGrad)" fillOpacity="0.08" />

      {/* Database Cylinders */}
      <ellipse cx="60" cy="40" rx="30" ry="9" fill="#1d2228" stroke="#3ECF8E" strokeOpacity="0.35" strokeWidth="1.5" />
      <path d="M 30,58 A 30 9 0 0 0 90,58" fill="none" stroke="#2c343e" strokeWidth="1.5" />
      <path d="M 30,76 A 30 9 0 0 0 90,76" fill="none" stroke="#222830" strokeWidth="1.5" />
      <line x1="30" y1="40" x2="30" y2="76" stroke="#262c34" strokeWidth="1.5" />
      <line x1="90" y1="40" x2="90" y2="76" stroke="#262c34" strokeWidth="1.5" />

      {/* Energetic "S" Sniffer Waveform */}
      <path
        d="M 76,33 C 66,28 46,31 43,41 C 40,51 54,54 64,57 C 76,60 81,67 77,77 C 73,87 50,89 40,83"
        fill="none"
        stroke="url(#logoEmeraldGrad)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#logoGlow)"
      />

      {/* Heartbeat Diagnostic Spike */}
      <path
        d="M 40,58 L 51,58 L 56,43 L 64,72 L 70,58 L 80,58"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="56" cy="43" r="3" fill="#38BDF8" />
      <circle cx="56" cy="43" r="1.5" fill="#FFFFFF" />

      {/* Status Ping */}
      <circle cx="95" cy="25" r="4" fill="#3ECF8E" />
      <circle cx="95" cy="25" r="2" fill="#FFFFFF" />
    </svg>
  );

  if (variant === 'mark') {
    return MarkSvg;
  }

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {MarkSvg}
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className={`font-black tracking-tight text-white ${currentSize.textTitle}`}>
            SUPABASE{' '}
            <span className="text-emerald-400 bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              SNIFFER
            </span>
          </span>
          {showBadge && (
            <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              v1.0
            </span>
          )}
        </div>
        <span
          className={`font-mono font-semibold text-zinc-400 tracking-[0.2em] uppercase ${currentSize.textSub}`}
        >
          Diagnostic &amp; Health Engine
        </span>
      </div>
    </div>
  );
};
