/* global BigInt */
// pf-pay.js — Project Freedom stakes and payouts for the games (browser, no build step needed).
// Source of truth: freedom-payouts/public/pf-pay.js. A copy lives in every game, so no game loads payment code from another site.
//
//   const st = await pfStatus();                                   // escrow address, limits, on/off
//   const { signature } = await pfDeposit({ game, room, amount, rpc, onStatus });   // player stakes
//   const sig = await pfSign({ game, room, result, deposits });    // player (or owner) signs the result
//   const r = await pfSettle({ game, room, result, deposits, signatures });          // server pays
//
// result is the winner's wallet address, "draw" (everyone gets their stake back) or "refund"
// (one unmatched stake back, 30 min after the deposit).
export const PF_API = "https://freedom-payouts.vercel.app";
const WEB3 = "https://esm.sh/@solana/web3.js@1.98.0";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

let statusCache = null, statusAt = 0;
export async function pfStatus(force = false) {
  if (!force && statusCache && Date.now() - statusAt < 60_000) return statusCache;
  const r = await fetch(PF_API + "/api/status", { cache: "no-store" });
  statusCache = await r.json(); statusAt = Date.now();
  return statusCache;
}

/** Exactly the text the server checks. Keep in sync with freedom-payouts/lib/core.js. */
export function pfMessage({ game, room, result, deposits }) {
  return ["Project Freedom payout v1", `game: ${game}`, `room: ${room}`, `result: ${result}`, `deposits: ${[...deposits].sort().join(",")}`].join("\n");
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b) break; s = "1" + s; }
  return s;
}

const phantom = () => (window.phantom?.solana?.isPhantom ? window.phantom.solana : window.solana?.isPhantom ? window.solana : null);

/** Player sends the stake to the escrow, with the memo pf:<game>:<room> in the same transaction. */
export async function pfDeposit({ game, room, amount, rpc = "https://api.mainnet-beta.solana.com", onStatus = () => {} }) {
  const p = phantom(); if (!p) throw new Error("Phantom wallet not found.");
  if (!p.publicKey) await p.connect();
  onStatus("Checking the payout server…");
  const st = await pfStatus(true);
  if (!st.enabled || !st.escrow) throw new Error("Token games are paused right now. No tokens were sent.");
  if (!(amount > 0) || amount > st.maxStake) throw new Error(`Stake must be between 1 and ${st.maxStake.toLocaleString()} FREEDOM.`);
  const { Connection, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram, SystemProgram } = await import(/* webpackIgnore: true */ /* @vite-ignore */ WEB3);
  const c = new Connection(rpc, "confirmed");
  const me = new PublicKey(p.publicKey.toString()), mint = new PublicKey(st.mint), escrow = new PublicKey(st.escrow);
  const tokenP = new PublicKey(TOKEN), ataP = new PublicKey(ATA);
  const ata = o => PublicKey.findProgramAddressSync([o.toBuffer(), tokenP.toBuffer(), mint.toBuffer()], ataP)[0];
  const from = ata(me), to = ata(escrow);
  const raw = BigInt(Math.round(amount * 10 ** st.decimals));
  const data = new Uint8Array(10); data[0] = 12; new DataView(data.buffer).setBigUint64(1, raw, true); data[9] = st.decimals;
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }))
    .add(new TransactionInstruction({ programId: ataP, data: new Uint8Array([1]), keys: [   // escrow token account, if missing
      { pubkey: me, isSigner: true, isWritable: true }, { pubkey: to, isSigner: false, isWritable: true }, { pubkey: escrow, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: tokenP, isSigner: false, isWritable: false }] }))
    .add(new TransactionInstruction({ programId: tokenP, data, keys: [
      { pubkey: from, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: to, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }] }))
    .add(new TransactionInstruction({ programId: new PublicKey(MEMO), keys: [{ pubkey: me, isSigner: true, isWritable: false }], data: new TextEncoder().encode(`pf:${game}:${room}`) }));
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash; tx.feePayer = me;
  onStatus("Approve the stake in Phantom…");
  const { signature } = await p.signAndSendTransaction(tx);
  onStatus("Confirming on the blockchain…");
  const conf = await c.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) throw new Error("The stake transaction failed. No tokens were taken.");
  onStatus("Stake confirmed ✅");
  return { signature, wallet: me.toBase58() };
}

/** The connected wallet signs the result. No transaction, no fee: just a signature. */
export async function pfSign({ game, room, result, deposits }) {
  const p = phantom(); if (!p) throw new Error("Phantom wallet not found.");
  if (!p.publicKey) await p.connect();
  const { signature } = await p.signMessage(new TextEncoder().encode(pfMessage({ game, room, result, deposits })), "utf8");
  return { wallet: p.publicKey.toString(), signature: b58(signature) };
}

/** Ask the server to pay. Waits for deposits that are not final yet (about 15 seconds after staking). */
export async function pfSettle(body, onStatus = () => {}) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(PF_API + "/api/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: "Payout server did not answer." }));
    if (r.ok) return j;
    if (r.status === 409 && /not final/i.test(j.error || "")) { onStatus("Waiting for the blockchain to finalise the stakes…"); await new Promise(res => setTimeout(res, 8000)); continue; }
    throw new Error(j.error || "Payout failed.");
  }
  throw new Error("Stakes are not final yet. Try again in a minute.");
}

/**
 * End of a staked game: every player signs the same result, the signatures travel through the game's own
 * database (store.put / store.watch), and as soon as all are there any client asks the server to pay.
 *   deposits:   every stake transaction of the room
 *   resultFrom: (stakes read from the chain) => winner wallet | "draw"
 *   store:      { put(wallet, signature), watch(cb(allSigs)) -> unsubscribe }
 * Returns { result, players, sign(), ask() } or throws if the stakes can't be verified.
 */
export async function pfRoundUp({ game, room, deposits, resultFrom, store, onStatus = () => {}, onPaid = () => {} }) {
  const chk = await pfInspect({ game, room, deposits });
  if (chk.some(x => x.paid)) { onPaid(null); throw new Error("This game has already been paid out."); }
  if (chk.length !== deposits.length || chk.some(x => !x.ok)) throw new Error("Stake problem: " + (chk.find(x => !x.ok)?.error || "not found"));
  const players = chk.map(x => x.player), result = resultFrom(chk);
  const body = { game, room, result, deposits };
  let paying = false, mySig = null;
  const stop = store.watch(async (sigs = {}) => {
    const have = players.filter(w => sigs[w]);
    onStatus(`${have.length}/${players.length} players confirmed`);
    if (have.length < players.length || paying) return;
    paying = true;
    try {
      const r = await pfSettle({ ...body, signatures: Object.fromEntries(players.map(w => [w, sigs[w]])) }, onStatus);
      stop && stop(); onPaid(r);
    } catch (e) {
      if (/already been paid/i.test(e.message)) { stop && stop(); onPaid(null); } else { paying = false; onStatus("Payout: " + e.message); }
    }
  });
  return {
    result, players,
    sign: async () => { const s = await pfSign(body); mySig = s; await store.put(s.wallet, s.signature); return s; },
    ask: async () => {
      if (!mySig) mySig = await pfSign(body);
      const r = await fetch(PF_API + "/api/dispute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, wallet: mySig.wallet, signature: mySig.signature }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not reach the owner.");
    },
  };
}

/** Who really deposited, read from the blockchain (not from the game database). */
export async function pfInspect({ game, room, deposits }) {
  const r = await fetch(PF_API + "/api/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, room, deposits }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Payout server did not answer.");
  return j.deposits || [];
}
