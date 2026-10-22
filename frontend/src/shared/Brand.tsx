import { Link } from "react-router-dom";
export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="TALA home">
      <svg aria-hidden="true" viewBox="0 0 40 40" fill="none">
        <path
          d="M20 34V19M20 25C8 26 4 17 5 8c10-1 16 6 15 17ZM20 19C20 9 26 3 35 4c1 10-5 17-15 15Z"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
      </svg>
      <span translate="no">
        tala<span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
