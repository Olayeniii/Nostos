import { ImageResponse } from "next/og";
import { Mark } from "../src/mark.js";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          background: "#0b1514",
          color: "#53e3a6",
          width: "100%",
          height: "100%",
          padding: 28,
        }}
      >
        <Mark size={124} />
      </div>
    ),
    size,
  );
}
