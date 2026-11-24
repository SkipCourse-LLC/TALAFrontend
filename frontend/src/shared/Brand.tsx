import { schoolConfig } from "../config/schoolConfig";
import { Link } from "react-router-dom";
export function Brand() {
  return (
    <Link
      className="brand"
      to="/"
      aria-label={`${schoolConfig.brand.shortName} home`}
    >
      <svg aria-hidden="true" viewBox="0 0 40 40" fill="none">
        <path
          d={schoolConfig.brand.logoPath}
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
      </svg>
      <span translate="no">
        {schoolConfig.brand.wordmark}
        <span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
