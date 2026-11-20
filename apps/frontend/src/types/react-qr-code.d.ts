import type * as React from "react";

// Augment react-qr-code to expose the named export that exists at runtime.
// Vite 8 (Rolldown) changed CJS interop so the default import returns the whole
// module.exports object rather than module.exports.default. Using the named
// export directly avoids that interop entirely.
declare module "react-qr-code" {
  export const QRCode: React.ComponentType<{
    value: string;
    size?: number;
    bgColor?: string;
    fgColor?: string;
    level?: "L" | "M" | "H" | "Q";
    title?: string;
  }>;
}
