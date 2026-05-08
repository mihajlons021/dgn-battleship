// DGN Battleship — Phantom Wallet Integration
const ESCROW_WALLET = 'GynyDkXj8WVdP7XDL1nTekF7Azv7ebxA7RCMnY3a3tSu';
const FREEDOM_MINT = 'DGNPSiTrX5xnKcpVKBaXUsWBZbFuA2cJcb7fUJmoAJrd';
const API_BASE = 'https://dgn-battleship.vercel.app';

let connectedWallet = null;

// Connect Phantom Wallet
async function connectWallet() {
  try {
    if (!window.solana || !window.solana.isPhantom) {
      alert('Please install Phantom Wallet!\nhttps://phantom.app');
      window.open('https://phantom.app', '_blank');
      return null;
    }
    const resp = await window.solana.connect();
    connectedWallet = resp.publicKey.toString();
    console.log('Connected wallet:', connectedWallet);
    updateWalletUI();
    return connectedWallet;
  } catch (err) {
    console.error('Wallet connect error:', err);
    return null;
  }
}

// Disconnect wallet
async function disconnectWallet() {
  if (window.solana) await window.solana.disconnect();
  connectedWallet = null;
  updateWalletUI();
}

// Update UI based on wallet connection
function updateWalletUI() {
  const btn = document.getElementById('walletBtn');
  if (!btn) return;
  if (connectedWallet) {
    btn.textContent = `✅ ${connectedWallet.slice(0,4)}...${connectedWallet.slice(-4)}`;
    btn.style.borderColor = 'var(--g)';
    btn.style.color = 'var(--g)';
  } else {
    btn.textContent = '🦊 Connect Wallet';
    btn.style.borderColor = 'rgba(57,255,20,0.3)';
    btn.style.color = 'rgba(57,255,20,0.5)';
  }
}

// Send FREEDOM tokens to escrow
async function depositToEscrow(wagerAmount, roomCode, playerId) {
  try {
    if (!connectedWallet) {
      const wallet = await connectWallet();
      if (!wallet) return false;
    }

    // Use Phantom to send SPL tokens
    const { solanaWeb3, splToken } = await loadSolanaLibs();
    
    const connection = new solanaWeb3.Connection(
      'https://api.mainnet-beta.solana.com', 'confirmed'
    );

    const fromPubkey = new solanaWeb3.PublicKey(connectedWallet);
    const toPubkey = new solanaWeb3.PublicKey(ESCROW_WALLET);
    const mintPubkey = new solanaWeb3.PublicKey(FREEDOM_MINT);

    // Get token accounts
    const fromTokenAccount = await splToken.getAssociatedTokenAddress(mintPubkey, fromPubkey);
    const toTokenAccount = await splToken.getAssociatedTokenAddress(mintPubkey, toPubkey);

    // Get decimals
    const mintInfo = await splToken.getMint(connection, mintPubkey);
    const amount = BigInt(Math.floor(wagerAmount * Math.pow(10, mintInfo.decimals)));

    // Create transaction
    const transaction = new solanaWeb3.Transaction().add(
      splToken.createTransferCheckedInstruction(
        fromTokenAccount,
        mintPubkey,
        toTokenAccount,
        fromPubkey,
        amount,
        mintInfo.decimals
      )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromPubkey;

    // Sign with Phantom
    const signed = await window.solana.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    console.log('Deposit TX:', signature);

    // Verify deposit with backend
    const response = await fetch(`${API_BASE}/api/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerWallet: connectedWallet, playerId }),
    });

    const data = await response.json();
    return data.success;

  } catch (err) {
    console.error('Deposit error:', err);
    alert('Deposit failed: ' + err.message);
    return false;
  }
}

// Load Solana libraries dynamically
async function loadSolanaLibs() {
  const solanaWeb3 = await import('https://esm.sh/@solana/web3.js@1.91.1');
  const splToken = await import('https://esm.sh/@solana/spl-token@0.4.6');
  return { solanaWeb3, splToken };
}

// Auto-connect if previously connected
window.addEventListener('load', async () => {
  if (window.solana?.isPhantom) {
    try {
      const resp = await window.solana.connect({ onlyIfTrusted: true });
      connectedWallet = resp.publicKey.toString();
      updateWalletUI();
    } catch {}
  }
});

export { connectWallet, disconnectWallet, depositToEscrow, connectedWallet };
