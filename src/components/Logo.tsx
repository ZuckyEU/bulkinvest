/**
 * Shared brand mark used across the landing page and app shell.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 via-sky-500 to-violet-500 shadow-lg shadow-sky-500/20">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-5 w-5 text-slate-950"
          aria-hidden="true"
        >
          <path
            d="M4 17.5 9 11l3.5 3.2L20 6"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 11V6h-5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="text-lg font-semibold tracking-tight text-white">
        Bulk<span className="text-emerald-400">Invest</span>
      </span>
    </span>
  );
}
