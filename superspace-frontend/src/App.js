import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Route, Routes, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import './App.css';
import Profile from './components/Profile';
import Feed from './components/Feed';
import Spaces from './components/Spaces';
import logo from './assets/logo.png';
import { FaBars, FaTimes, FaHome, FaUser, FaPodcast } from 'react-icons/fa';
import config from './config';

function App() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  const sonicRpc = 'https://api.testnet.sonic.game';
  const connection = new Connection(sonicRpc, 'confirmed');

  const logToFile = async (message, level = 'info') => {
    try {
      await axios.post(`${config.API_URL}/api/log`, { message, level });
    } catch (err) {
      console.error('Failed to log to file:', err.message);
    }
  };

  const fetchBalance = useCallback(async (address) => {
    try {
      const publicKey = new PublicKey(address);
      const balanceInLamports = await connection.getBalance(publicKey);
      const balanceInS = balanceInLamports / 1e9;
      setBalance(balanceInS);
      await logToFile(`Sonic $S balance: ${balanceInS}`);
    } catch (err) {
      const errorMsg = err.message || JSON.stringify(err);
      console.error('Failed to fetch Sonic balance:', errorMsg);
      await logToFile(`Failed to fetch Sonic balance: ${errorMsg}`, 'error');
      setBalance(null);
    }
  }, [connection]);

  useEffect(() => {
    const checkSession = async () => {
      const storedSessionId = localStorage.getItem('sessionId');
      if (storedSessionId) {
        try {
          const res = await axios.get(`${config.API_URL}/api/auth/session/${storedSessionId}`);
          setWalletAddress(res.data.walletAddress);
          setSessionId(storedSessionId);
          await fetchBalance(res.data.walletAddress);
        } catch (err) {
          localStorage.removeItem('sessionId');
        }
      }
    };
    checkSession();

    const openModal = () => {
      navigate('/spaces');
      window.dispatchEvent(new CustomEvent('openSpaceModal'));
    };
    window.addEventListener('openSpaceModal', openModal);
    return () => window.removeEventListener('openSpaceModal', openModal);
  }, [fetchBalance, navigate]);

  const connectWallet = async () => {
    const { solana } = window;
    if (!solana || !solana.isPhantom) {
      alert('Please install Phantom wallet!');
      window.open('https://phantom.app/', '_blank');
      return;
    }
    try {
      const response = await solana.connect();
      const address = response.publicKey.toString();

      const message = `Sign this message to authenticate with SuperSpace: ${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await solana.signMessage(encodedMessage);
      const signatureBase58 = bs58.encode(signature.signature);

      const res = await axios.post(`${config.API_URL}/api/auth/signin`, {
        walletAddress: address,
        signature: signatureBase58,
        message,
      });

      setWalletAddress(address);
      setSessionId(res.data.sessionId);
      localStorage.setItem('sessionId', res.data.sessionId);
      await fetchBalance(address);
      await logToFile(`Connected to Sonic wallet: ${address}`);
    } catch (err) {
      const errorMsg = err.message || JSON.stringify(err);
      console.error('Wallet connection failed:', errorMsg);
      await logToFile(`Wallet connection failed: ${errorMsg}`, 'error');
      alert(`Failed to connect wallet: ${errorMsg}`);
    }
  };

  const disconnectWallet = async () => {
    const { solana } = window;
    if (!solana) return;
    try {
      await solana.disconnect();
      setWalletAddress(null);
      setBalance(null);
      setSessionId(null);
      localStorage.removeItem('sessionId');
      await logToFile('Sonic wallet disconnected');
    } catch (err) {
      const errorMsg = err.message || JSON.stringify(err);
      console.error('Wallet disconnection failed:', errorMsg);
      await logToFile(`Wallet disconnection failed: ${errorMsg}`, 'error');
      alert(`Failed to disconnect wallet: ${errorMsg}`);
    }
  };

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  return (
    <div className="app">
      <header className="header">
        <button className="menu-toggle" onClick={toggleMenu}>
          {isMenuOpen ? <FaTimes /> : <FaBars />}
        </button>
        <Link to="/" className="logo-container" onClick={() => setIsMenuOpen(false)}>
          <img src={logo} alt="SuperSpace Logo" className="logo-img" />
          <h1 className="logo">SuperSpace</h1>
        </Link>
        <nav ref={menuRef} className={`nav ${isMenuOpen ? 'open' : ''}`}>
          <div className="nav-header">
            <img src={logo} alt="SuperSpace Logo" className="nav-logo-img" />
            <h2 className="nav-logo">SuperSpace</h2>
          </div>
          <Link to="/" className="nav-link" onClick={() => setIsMenuOpen(false)}>
            <FaHome className="nav-icon" /> Feed
          </Link>
          <Link to="/profile" className="nav-link" onClick={() => setIsMenuOpen(false)}>
            <FaUser className="nav-icon" /> Profile
          </Link>
          <Link to="/spaces" className="nav-link" onClick={() => setIsMenuOpen(false)}>
            <FaPodcast className="nav-icon" /> Spaces
          </Link>
          <button
            className="nav-link start-space-btn"
            onClick={() => {
              setIsMenuOpen(false);
              window.dispatchEvent(new CustomEvent('openSpaceModal'));
            }}
          >
            <FaPodcast className="nav-icon" /> Start Space
          </button>
          {walletAddress && window.innerWidth <= 768 && (
            <div className="nav-wallet">
              <div className="wallet-details">
                <span className="wallet-address">
                  {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)} <span className="network">(Sonic)</span>
                </span>
                {balance !== null && <span className="balance">{balance.toFixed(4)} $S</span>}
              </div>
            </div>
          )}
        </nav>
        <div className="wallet">
          {walletAddress && (
            <span className="wallet-address-header">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)} <span className="network">(Sonic)</span>
            </span>
          )}
          {!walletAddress ? (
            <button className="btn connect-btn" onClick={connectWallet}>Connect</button>
          ) : (
            <button className="btn disconnect-btn" onClick={disconnectWallet}>Disconnect</button>
          )}
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Feed walletAddress={walletAddress} />} />
          <Route path="/profile" element={<Profile walletAddress={walletAddress} connection={connection} />} />
          <Route path="/spaces" element={<Spaces walletAddress={walletAddress} />} />
        </Routes>
      </main>
      <footer className="footer">
        <p>© 2025 SuperSpace. Powered by Sonic.</p>
      </footer>
    </div>
  );
}

export default function AppWrapper() {
  return (
    <Router>
      <App />
    </Router>
  );
}