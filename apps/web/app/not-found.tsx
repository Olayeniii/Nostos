import Link from "next/link";
import { Mark } from "../src/mark.js";

export default function NotFound() {
  return (
    <main className="not-found">
      <Link href="/" className="brand" aria-label="NOSTOS home">
        <Mark />
        <span>NOSTOS</span>
      </Link>
      <section className="intro">
        <p className="eyebrow">404</p>
        <h1>This page has no return route.</h1>
        <p className="lede">
          The link may be incorrect or the page may have moved.
        </p>
        <Link href="/" className="primary not-found-link">
          Back to NOSTOS
        </Link>
      </section>
    </main>
  );
}
