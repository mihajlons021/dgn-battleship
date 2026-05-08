import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getMint } from '@solana/spl-token';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dgn-battleship.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { roomCode, playerWallet, playerId } = req.body;

  if (!roomCode || !playerWallet || !playerId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }

  const db = getDatabase();
  const roomSnap = await db.ref(`rooms/${roomCode}`).get();
  if (!roomSnap.exists()) return res.status(404).json({ error: 'Room not found' });

  const room = roomSnap.val();
  const wager = parseFloat(room.wager) || 0;

  const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
  const FREEDOM_MINT = new PublicKey(process.env.FREEDOM_TOKEN_MINT);
  const ESCROW_WALLET = new PublicKey('GynyDkXj8WVdP7XDL1nTekF7Azv7ebxA7RCMnY3a3tSu');

  try {
    const mintInfo = await getMint(connection, FREEDOM_MINT);
    const decimals = mintInfo.decimals;
    const requiredAmount = BigInt(Math.floor(wager * Math.pow(10, decimals)));

    // Find player token account
    const playerPubkey = new PublicKey(playerWallet);
    
    // Get escrow token account balance
    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    const escrowTokenAddress = await getAssociatedTokenAddress(FREEDOM_MINT, ESCROW_WALLET);
    
    // Check recent transactions to escrow
    const signatures = await connection.getSignaturesForAddress(escrowTokenAddress, { limit: 20 });
    
    let depositFound = false;
    for (const sig of signatures) {
      const tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
      if (!tx) continue;
      
      for (const ix of tx.transaction.message.instructions) {
        if (ix.parsed?.type === 'transferChecked' || ix.parsed?.type === 'transfer') {
          const info = ix.parsed.info;
          if (
            info.destination === escrowTokenAddress.toString() &&
            info.authority === playerWallet &&
            BigInt(info.tokenAmount?.amount || info.amount) >= requiredAmount
          ) {
            depositFound = true;
            break;
          }
        }
      }
      if (depositFound) break;
    }

    if (!depositFound) {
      return res.status(400).json({ error: 'Deposit not found. Please send tokens first.' });
    }

    // Mark player as deposited
    await db.ref(`rooms/${roomCode}/${playerId}`).update({
      wallet: playerWallet,
      deposited: true,
      depositTimestamp: Date.now(),
    });

    // Check if both players deposited
    const updatedSnap = await db.ref(`rooms/${roomCode}`).get();
    const updatedRoom = updatedSnap.val();
    
    if (updatedRoom.p1?.deposited && updatedRoom.p2?.deposited) {
      await db.ref(`rooms/${roomCode}`).update({ depositsComplete: true });
    }

    return res.status(200).json({ success: true, deposited: true });

  } catch (error) {
    console.error('Deposit check error:', error);
    return res.status(500).json({ error: 'Failed to verify deposit', details: error.message });
  }
}
