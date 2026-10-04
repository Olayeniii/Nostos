import { ImageResponse } from "next/og";
import { Mark } from "../src/mark.js";
export const alt = "NOSTOS. Private payments. A way back.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function SocialImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: "#0b1514",
          color: "#eef7f1",
          padding: "58px 72px",
          borderBottom: "12px solid #53e3a6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{ display: "flex", width: 68, height: 68, color: "#53e3a6" }}
          >
            <Mark size={68} />
          </div>
          <span style={{ fontSize: 32, letterSpacing: 7 }}>NOSTOS</span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 65,
            fontSize: 78,
            letterSpacing: -3,
            lineHeight: 1.08,
          }}
        >
          <span>Private payments.</span>
          <span style={{ color: "#53e3a6" }}>A way back.</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "auto",
            fontSize: 22,
            color: "#a9b6b0",
          }}
        >
          <span>Shielded Zcash payments and refunds</span>
          <span>ZCASH TESTNET</span>
        </div>
      </div>
    ),
    size,
  );
}
