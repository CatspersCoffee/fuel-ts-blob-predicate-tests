/**
 * Converts a 65-byte Ethereum signature (RSV format) to a 64-byte compact signature
 * @param signature - 65-byte signature in RSV format (0x + 130 hex characters)
 * @returns 64-byte compact signature (0x + 128 hex characters)
 */
export function toCompactSignature(signature: string): string {
  // Ensure signature has 0x prefix
  const normalizedSig = signature.startsWith("0x")
    ? signature
    : `0x${signature}`;

  // Validate signature length (0x + 130 hex chars)
  if (normalizedSig.length !== 132) {
    throw new Error("Invalid signature length");
  }

  // Extract r, s, and v
  const r = normalizedSig.slice(2, 66);
  const s = normalizedSig.slice(66, 130);
  const v = parseInt(normalizedSig.slice(130), 16);

  // Convert v to y-parity (0 or 1)
  const yParity = v - 27;
  if (yParity !== 0 && yParity !== 1) {
    throw new Error("Invalid v value");
  }

  // Convert s to BigInt for bit manipulation
  const sBigInt = BigInt(`0x${s}`);

  // Set the highest bit of s based on y-parity
  const yParityAndS =
    yParity === 1 ? sBigInt | (BigInt(1) << BigInt(255)) : sBigInt;

  // Convert back to hex, ensuring we maintain leading zeros
  const sWithParity = yParityAndS.toString(16).padStart(64, "0");

  // Combine r and modified s
  return `0x${r}${sWithParity}`;
}

/**
 * Converts a 64-byte compact signature back to 65-byte RSV format
 * @param compactSignature - 64-byte compact signature (0x + 128 hex characters)
 * @returns 65-byte signature in RSV format (0x + 130 hex characters)
 */
export function fromCompactSignature(compactSignature: string): string {
  // Ensure signature has 0x prefix
  const normalizedSig = compactSignature.startsWith("0x")
    ? compactSignature
    : `0x${compactSignature}`;

  // Validate signature length (0x + 128 hex chars)
  if (normalizedSig.length !== 130) {
    throw new Error("Invalid compact signature length");
  }

  // Extract r and s with parity
  const r = normalizedSig.slice(2, 66);
  const sWithParity = normalizedSig.slice(66);

  // Convert s to BigInt to extract y-parity
  const sBigInt = BigInt(`0x${sWithParity}`);

  // Extract y-parity from highest bit
  const yParity = Number((sBigInt >> BigInt(255)) & BigInt(1));

  // Clear highest bit to get original s
  const sMask = (BigInt(1) << BigInt(255)) - BigInt(1);
  const s = (sBigInt & sMask).toString(16).padStart(64, "0");

  // Convert y-parity back to v
  const v = (yParity + 27).toString(16).padStart(2, "0");

  return `0x${r}${s}${v}`;
}
