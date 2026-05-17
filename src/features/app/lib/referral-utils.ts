// Referral code helpers — shared between client and server
// Referral code = referrer's FID encoded as base36 (short + unique)

export function fidToRefCode(fid: number): string {
  return fid.toString(36).toUpperCase();
}

export function refCodeToFid(code: string): number | null {
  const fid = parseInt(code.toLowerCase(), 36);
  return isNaN(fid) || fid <= 0 ? null : fid;
}
