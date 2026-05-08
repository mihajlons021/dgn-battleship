import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction, getMint } from '@solana/spl-token';
import { getDatabase } from 'firebase-admin/database';
import { initializeApp, cert, getApps } from 'firebase-admin/app';

// ─── Security: only allow POST ───────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://dgn-battleship.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ─── API Key check ────────────────────────────────────────────────────────
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.PAYOUT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { roomCode, winnerWallet } = req.body;

  if (!roomCode || !winnerWallet) {
    return res.status(400).json({ error: 'Missing roomCode or winnerWallet' });
  }

  // ─── Validate winner wallet address ──────────────────────────────────────
  let winnerPubkey;
  try {
    winnerPubkey = new PublicKey(winnerWallet);
  } catch {
    return res.status(400).json({ error: 'Invalid winner wallet address' });
  }

  // ─── Init Firebase Admin ─────────────────────────────────────────────────
  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }

  const db = getDatabase();

  // ─── Fetch room from Firebase ─────────────────────────────────────────────
  const roomSnap = await db.ref(`rooms/${roomCode}`).get();
  if (!roomSnap.exists()) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const room = roomSnap.val();

  // ─── Security checks ──────────────────────────────────────────────────────
  if (room.status !== 'finished') {
    return res.status(400).json({ error: 'Game not finished yet' });
  }
  if (room.payoutSent) {
    return res.status(400).json({ error: 'Payout already sent' });
  }
  if (!room.winner) {
    return res.status(400).json({ error: 'No winner set' });
  }

  // Verify the winner wallet matches the winner player
  const winnerPlayer = room.winner; // 'p1' or 'p2'
  const winnerStoredWallet = room[winnerPlayer]?.wallet;
  if (winnerStoredWallet && winnerStoredWallet !== winnerWallet) {
    return res.status(400).json({ error: 'Winner wallet mismatch' });
  }

  // ─── Mark payout as processing (prevents double payout) ──────────────────
  await db.ref(`rooms/${roomCode}`).update({ payoutSent: true, payoutProcessing: true });

  try {
    // ─── Solana connection ────────────────────────────────────────────────
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );

    // ─── Load escrow keypair from env ─────────────────────────────────────
    const escrowPrivateKeyArray = JSON.parse(process.env.ESCROW_PRIVATE_KEY);
    const escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowPrivateKeyArray));

    // ─── FREEDOM token mint address ───────────────────────────────────────
    const FREEDOM_MINT = new PublicKey(process.env.FREEDOM_TOKEN_MINT);

    // ─── Calculate total payout ───────────────────────────────────────────
    const wager = parseFloat(room.wager) || 0;
    const totalPayout = wager * 2;

    if (totalPayout <= 0) {
      return res.status(400).json({ error: 'Invalid wager amount' });
    }

    // ─── Get token decimals ───────────────────────────────────────────────
    const mintInfo = await getMint(connection, FREEDOM_MINT);
    const decimals = mintInfo.decimals;
    const amount = BigInt(Math.floor(totalPayout * Math.pow(10, decimals)));

    // ─── Get escrow token account ─────────────────────────────────────────
    const escrowTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      escrowKeypair,
      FREEDOM_MINT,
      escrowKeypair.publicKey
    );

    // ─── Get winner token account ─────────────────────────────────────────
    const winnerTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      escrowKeypair, // fee payer
      FREEDOM_MINT,
      winnerPubkey
    );

    // ─── Check escrow balance ─────────────────────────────────────────────
    if (escrowTokenAccount.amount < amount) {
      await db.ref(`rooms/${roomCode}`).update({ payoutSent: false, payoutProcessing: false, payoutError: 'Insufficient escrow balance' });
      return res.status(400).json({ error: 'Insufficient escrow balance' });
    }

    // ─── Build and send transaction ───────────────────────────────────────
    const transaction = new Transaction().add(
      createTransferInstruction(
        escrowTokenAccount.address,
        winnerTokenAccount.address,
        escrowKeypair.publicKey,
        amount
      )
    );

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [escrowKeypair],
      { commitment: 'confirmed' }
    );

    // ─── Update Firebase with success ────────────────────────────────────
    await db.ref(`rooms/${roomCode}`).update({
      payoutSent: true,
      payoutProcessing: false,
      payoutSignature: signature,
      payoutAmount: totalPayout,
      payoutWinner: winnerWallet,
      payoutTimestamp: Date.now(),
    });

    console.log(`✅ Payout sent: ${totalPayout} FREEDOM to ${winnerWallet} | TX: ${signature}`);

    return res.status(200).json({
      success: true,
      signature,
      amount: totalPayout,
      winner: winnerWallet,
      explorer: `https://solscan.io/tx/${signature}`,
    });

  } catch (error) {
    console.error('Payout error:', error);
    // ─── Rollback payoutSent on error ─────────────────────────────────────
    await db.ref(`rooms/${roomCode}`).update({
      payoutSent: false,
      payoutProcessing: false,
      payoutError: error.message,
    });
    return res.status(500).json({ error: 'Payout failed', details: error.message });
  }
}
