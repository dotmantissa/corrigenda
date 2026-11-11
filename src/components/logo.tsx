export function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      width={small ? 28 : 42}
      height={small ? 28 : 42}
      fill="none"
    >
      <path d="M34 10a17 17 0 1 0 0 28" stroke="currentColor" strokeWidth="6" />
      <path
        d="M22 24h22M35 16l9 8-9 8"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
