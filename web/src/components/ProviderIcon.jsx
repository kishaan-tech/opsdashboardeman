// Brand marks for integration providers (simple geometric SVGs).

const SIZE = { width: 18, height: 18, viewBox: '0 0 24 24' };

export function ProviderIcon({ id, className = '' }) {
  const common = { ...SIZE, className: `shrink-0 ${className}`, 'aria-hidden': true };
  switch (id) {
    case 'typeform':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#262627" />
          <path d="M7 8.5h10v2.2H13.2V16H10.8V10.7H7V8.5z" fill="#fff" />
        </svg>
      );
    case 'calendly':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#006BFF" />
          <path
            d="M8 6.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2zm0 3.5h8M10 6v2.5M14 6v2.5"
            stroke="#fff"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'iclosed':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#0F172A" />
          <circle cx="12" cy="12" r="5.5" stroke="#22D3EE" strokeWidth="2" fill="none" />
          <path d="M12 9.2v3.2l2.2 1.3" stroke="#22D3EE" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
      );
    case 'whop':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#FA4616" />
          <path
            d="M6.5 7.5 9.2 16h2.1l1.7-5.2L14.7 16h2.1l2.7-8.5h-2.2l-1.5 5.1-1.6-5.1h-2.1L10.5 12.6 9 7.5H6.5z"
            fill="#fff"
          />
        </svg>
      );
    case 'fanbasis':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#7C3AED" />
          <path
            d="M7 16V8.2h5.4c2.2 0 3.5 1.1 3.5 2.9 0 1.9-1.4 3-3.6 3H9.4V16H7zm2.4-4.1h2.7c.9 0 1.4-.4 1.4-1.1s-.5-1.1-1.4-1.1H9.4v2.2z"
            fill="#fff"
          />
        </svg>
      );
    case 'ghl':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#188BF6" />
          <path d="M7 16V8h2.2v6.2H14V16H7z" fill="#fff" />
        </svg>
      );
    case 'custom':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#374151" />
          <path
            d="M8 9h8M8 12h8M8 15h5"
            stroke="#E5E7EB"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    case 'webinarjam':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#FF5A5F" />
          <path d="M9 8.5v7l7-3.5-7-3.5z" fill="#fff" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#333" />
          <circle cx="12" cy="12" r="3" fill="#999" />
        </svg>
      );
  }
}

export const PROVIDER_LABELS = {
  typeform: 'Typeform',
  calendly: 'Calendly',
  iclosed: 'iClosed',
  ghl: 'GoHighLevel',
  custom: 'Custom form',
  webinarjam: 'WebinarJam',
  whop: 'Whop',
  fanbasis: 'Fanbasis',
};
