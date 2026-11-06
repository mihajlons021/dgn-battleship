// PAYOUTS_DISABLED (2026-11-06): emergency lock.
// The previous payout handler trusted an API key that was shipped in the public
// client code, so anyone could request payouts from the escrow wallet.
// The original code is in git history (commit fa141a9). Do not restore it as-is:
// it needs a server-side check of the game result before any transfer.
export default function handler(req, res) {
  return res.status(503).json({ error: "Payouts are temporarily disabled" });
}
