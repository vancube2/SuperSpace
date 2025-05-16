const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const winston = require('winston');
const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');
const nacl = require('tweetnacl');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

/*
// CORS configuration
app.use(cors({
  origin: ['https://superspace-frontend.vercel.app', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());
*/

// Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: '../app.log' })
  ]
});

// MongoDB Connection with Retry Logic
const connectToMongo = async () => {
  let retries = 5;
  while (retries) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      logger.info('MongoDB connected successfully');
      break;
    } catch (err) {
      logger.error(`MongoDB connection failed: ${err.message}`);
      retries -= 1;
      if (!retries) {
        logger.error('MongoDB connection retries exhausted. Exiting...');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
    }
  }
};
connectToMongo();

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'superspace', allowed_formats: ['jpg', 'png'] },
});
const upload = multer({ storage });

// Solana Connection
const connection = new Connection('https://api.testnet.sonic.game', 'confirmed');

// Schemas
/* userSchema.index({ tagname: 1 }, { unique: true, sparse: true }); */
const userSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true, unique: true },
  username: String,
  profilePicture: String,
  followers: [String],
  tagname: { type: String, unique: true, sparse: true }, // Sparse index allows null/undefined
  lastTagnameChange: Date,
});

const postSchema = new mongoose.Schema({
  walletAddress: String,
  content: String,
  imageUrl: String,
  timestamp: { type: Date, default: Date.now },
});
const messageSchema = new mongoose.Schema({
  spaceId: String,
  sender: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
});
const User = mongoose.model('User', userSchema);
const Post = mongoose.model('Post', postSchema);
const Message = mongoose.model('Message', messageSchema);

// In-memory storage for spaces and sessions
let spaces = [];
const sessions = {};

// Wallet Address Validation
const isValidWalletAddress = (address) => {
  return typeof address === 'string' && address.length === 44 && /^[A-Za-z0-9]+$/.test(address);
};

// API Routes
app.post('/api/log', express.json(), (req, res) => {
  const { message, level } = req.body;
  logger[level || 'info'](message);
  res.sendStatus(200);
});

// Profile Routes
app.get('/api/profile/:walletAddress', async (req, res) => {
  const { walletAddress } = req.params;
  if (!isValidWalletAddress(walletAddress)) {
    logger.error(`GET /api/profile/${walletAddress}: Invalid walletAddress`);
    return res.status(400).json({ error: 'Valid walletAddress is required' });
  }
  try {
    const user = await User.findOne({ walletAddress });
    logger.info(`GET /api/profile/${walletAddress}: Fetched profile`);
    res.json(user || {});
  } catch (err) {
    logger.error(`GET /api/profile/${walletAddress} failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Failed to fetch profile', details: err.message });
  }
});

app.post('/api/profile', upload.single('profilePic'), async (req, res) => {
  const { walletAddress, username, tagname } = req.body;
  const profilePicUrl = req.file ? req.file.path : undefined;
  if (!walletAddress || !isValidWalletAddress(walletAddress)) {
    logger.error('POST /api/profile: Invalid or missing walletAddress');
    return res.status(400).json({ error: 'Valid walletAddress is required' });
  }
  try {
    const updateData = { walletAddress };
    if (username) updateData.username = username;
    if (profilePicUrl) updateData.profilePicture = profilePicUrl;

    // Handle tagname update
    if (tagname) {
      const user = await User.findOne({ walletAddress });
      const now = new Date();
      if (user?.lastTagnameChange && (now - new Date(user.lastTagnameChange) < 7 * 24 * 60 * 60 * 1000) && tagname !== user.tagname) {
        logger.error(`POST /api/profile: Tagname change too soon for ${walletAddress}, lastChange=${user.lastTagnameChange}`);
        return res.status(400).json({ error: 'You can only change your tagname once every 7 days' });
      }
      // Check if tagname is taken by another user
      if (tagname !== user?.tagname) {
        const existingTagname = await User.findOne({ tagname });
        if (existingTagname && existingTagname.walletAddress !== walletAddress) {
          logger.error(`POST /api/profile: Tagname ${tagname} already taken by ${existingTagname.walletAddress}`);
          return res.status(400).json({ error: 'Tagname is already taken' });
        }
      }
      updateData.tagname = tagname;
      updateData.lastTagnameChange = now;
    }

    const user = await User.findOneAndUpdate(
      { walletAddress },
      updateData,
      { upsert: true, new: true }
    );
    logger.info(`POST /api/profile: Updated profile for ${walletAddress}`);
    res.json({
      profilePicUrl: user.profilePicture,
      username: user.username,
      tagname: user.tagname,
      lastTagnameChange: user.lastTagnameChange,
    });
  } catch (err) {
    logger.error(`POST /api/profile failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Failed to update profile', details: err.message });
  }
});

app.get('/api/check-tagname/:tagname', async (req, res) => {
  const { tagname } = req.params;
  if (!tagname || tagname.length > 20) {
    logger.error(`GET /api/check-tagname/${tagname}: Invalid tagname`);
    return res.status(400).json({ exists: false });
  }
  try {
    const user = await User.findOne({ tagname }).lean(); // Use lean() for faster queries
    logger.info(`GET /api/check-tagname/${tagname}: Checked availability, exists=${!!user}, user=${user ? user.walletAddress : 'none'}`);
    res.json({ exists: !!user });
  } catch (err) {
    logger.error(`GET /api/check-tagname/${tagname} failed: ${err.message} ${err.stack}`);
    res.status(500).json({ exists: false });
  }
});


// Post Routes
app.post('/api/posts', upload.single('image'), async (req, res) => {
  const { walletAddress, content } = req.body;
  const imageUrl = req.file ? req.file.path : null;
  if (!walletAddress || !isValidWalletAddress(walletAddress)) {
    logger.error('POST /api/posts: Invalid or missing walletAddress');
    return res.status(400).json({ error: 'Valid walletAddress is required' });
  }
  try {
    const post = new Post({ walletAddress, content, imageUrl });
    await post.save();
    logger.info(`POST /api/posts: Created post by ${walletAddress}`);
    res.json(post);
  } catch (err) {
    logger.error(`POST /api/posts failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Failed to create post', details: err.message });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ timestamp: -1 });
    logger.info('GET /api/posts: Fetched all posts');
    res.json(posts);
  } catch (err) {
    logger.error(`GET /api/posts failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Failed to fetch posts', details: err.message });
  }
});

// Legacy User Routes
app.post('/api/users', async (req, res) => {
  const { walletAddress, username, profilePicture } = req.body;
  if (!walletAddress || !isValidWalletAddress(walletAddress)) {
    logger.error('POST /api/users: Invalid or missing walletAddress');
    return res.status(400).json({ error: 'Valid walletAddress is required' });
  }
  try {
    const user = await User.findOneAndUpdate(
      { walletAddress },
      { username, profilePicture },
      { upsert: true, new: true }
    );
    logger.info(`POST /api/users: Updated user ${walletAddress}`);
    res.json(user);
  } catch (err) {
    logger.error(`POST /api/users failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Failed to save user profile', details: err.message });
  }
});

app.get('/api/users/:walletAddress', async (req, res) => {
  const { walletAddress } = req.params;
  if (!isValidWalletAddress(walletAddress)) {
    logger.error(`GET /api/users/${walletAddress}: Invalid walletAddress`);
    return res.status(400).json({ error: 'Valid walletAddress is required' });
  }
  try {
    const user = await User.findOne({ walletAddress });
    logger.info(`GET /api/users/${walletAddress}: Fetched user`);
    res.json(user || {});
  } catch (err) {
    logger.error(`GET /api/users/${walletAddress} failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Failed to fetch user', details: err.message });
  }
});

// Authentication Routes
app.post('/api/auth/signin', async (req, res) => {
  const { walletAddress, signature, message } = req.body;
  if (!walletAddress || !signature || !message) {
    logger.error('POST /api/auth/signin: Missing required fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const decodedMessage = new TextEncoder().encode(message);
    const decodedSignature = bs58.decode(signature);
    const publicKey = new PublicKey(walletAddress).toBytes();

    const verified = nacl.sign.detached.verify(decodedMessage, decodedSignature, publicKey);
    if (!verified) {
      logger.error(`POST /api/auth/signin: Invalid signature for ${walletAddress}`);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const sessionId = Date.now().toString();
    sessions[sessionId] = { walletAddress, expires: Date.now() + 24 * 60 * 60 * 1000 };
    logger.info(`POST /api/auth/signin: Authenticated ${walletAddress}`);
    res.json({ sessionId });
  } catch (err) {
    logger.error(`POST /api/auth/signin failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

app.get('/api/auth/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions[sessionId];
  if (!session || session.expires < Date.now()) {
    logger.error(`GET /api/auth/session/${sessionId}: Invalid or expired session`);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  logger.info(`GET /api/auth/session/${sessionId}: Session valid for ${session.walletAddress}`);
  res.json({ walletAddress: session.walletAddress });
});

// Spaces Routes

app.get('/api/spaces', (req, res) => {
  logger.info('GET /api/spaces: Fetched all spaces');
  res.json(spaces);
});

app.post('/api/spaces/create', async (req, res) => {
  const { walletAddress, title, description, joinPermission, record } = req.body;
  if (!walletAddress || !isValidWalletAddress(walletAddress) || !title) {
    logger.error('POST /api/spaces/create: Invalid or missing fields');
    return res.status(400).json({ error: 'Valid walletAddress and title are required' });
  }
  try {
    const user = await User.findOne({ walletAddress });
    const space = {
      id: Date.now().toString(),
      host: walletAddress,
      title,
      description: description || '',
      joinPermission: joinPermission || 'everyone',
      record: !!record,
      participants: [walletAddress],
      muted: [walletAddress],
      coHosts: [],
      invited: joinPermission === 'invite' ? [walletAddress] : [],
      pending: [],
      hostFollowing: user?.followers || [],
      restrictions: { video: false, mic: false, chat: false, screen: false },
      locked: false,
      createdAt: new Date(),
    };
    spaces.push(space);
    logger.info(`POST /api/spaces/create: Space created by ${walletAddress}`);
    res.status(201).json(space);
  } catch (err) {
    logger.error(`POST /api/spaces/create failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Failed to create space' });
  }
});

app.post('/api/spaces/join', async (req, res) => {
  const { spaceId, walletAddress } = req.body;
  if (!isValidWalletAddress(walletAddress)) {
    logger.error(`POST /api/spaces/join: Invalid walletAddress`);
    return res.status(400).json({ error: 'Valid walletAddress is required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/join: Space ${spaceId} not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  if (space.locked && !space.participants.includes(walletAddress)) {
    space.pending = space.pending || [];
    if (!space.pending.includes(walletAddress)) space.pending.push(walletAddress);
    logger.info(`POST /api/spaces/join: ${walletAddress} pending approval for ${spaceId}`);
    return res.status(202).json({ message: 'Awaiting approval', space });
  }
  if (space.joinPermission === 'invite' && !space.invited.includes(walletAddress)) {
    logger.error(`POST /api/spaces/join: ${walletAddress} not invited to ${spaceId}`);
    return res.status(403).json({ error: 'You are not invited to this space' });
  }
  if (space.joinPermission === 'following' && space.host !== walletAddress) { // Bypass check for host
    const hostUser = await User.findOne({ walletAddress: space.host });
    if (!hostUser?.followers?.includes(walletAddress)) {
      logger.error(`POST /api/spaces/join: ${walletAddress} not following host of ${spaceId}`);
      return res.status(403).json({ error: 'You must follow the host to join' });
    }
  }
  if (!space.participants.includes(walletAddress)) {
    space.participants.push(walletAddress);
    space.muted.push(walletAddress);
  }
  logger.info(`POST /api/spaces/join: ${walletAddress} joined space ${spaceId}`);
  res.json(space);
});

app.post('/api/spaces/approve', async (req, res) => {
  const { spaceId, walletAddress, targetAddress } = req.body;
  if (!isValidWalletAddress(walletAddress) || !isValidWalletAddress(targetAddress)) {
    logger.error(`POST /api/spaces/approve: Invalid walletAddress or targetAddress`);
    return res.status(400).json({ error: 'Valid walletAddress and targetAddress required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/approve: Space ${spaceId} not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  if (space.host !== walletAddress && !space.coHosts.includes(walletAddress)) {
    logger.error(`POST /api/spaces/approve: ${walletAddress} not authorized for ${spaceId}`);
    return res.status(403).json({ error: 'Only host or co-host can approve' });
  }
  space.pending = space.pending.filter(p => p !== targetAddress);
  space.participants.push(targetAddress);
  space.muted.push(targetAddress);
  logger.info(`POST /api/spaces/approve: ${walletAddress} approved ${targetAddress} for ${spaceId}`);
  res.json(space);
});

app.post('/api/spaces/leave', (req, res) => {
  const { spaceId, walletAddress } = req.body;
  if (!isValidWalletAddress(walletAddress)) {
    logger.error(`POST /api/spaces/leave: Invalid walletAddress`);
    return res.status(400).json({ error: 'Valid walletAddress is required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/leave: Space ${spaceId} not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  space.participants = space.participants.filter(p => p !== walletAddress);
  space.muted = space.muted.filter(m => m !== walletAddress);
  space.coHosts = space.coHosts.filter(c => c !== walletAddress);
  space.pending = space.pending.filter(p => p !== walletAddress);
  logger.info(`POST /api/spaces/leave: ${walletAddress} left space ${spaceId}`);
  res.json(space);
});

app.post('/api/spaces/end', (req, res) => {
  const { spaceId, walletAddress } = req.body;
  if (!isValidWalletAddress(walletAddress)) {
    logger.error(`POST /api/spaces/end: Invalid walletAddress`);
    return res.status(400).json({ error: 'Valid walletAddress is required' });
  }
  const spaceIndex = spaces.findIndex(s => s.id === spaceId);
  if (spaceIndex === -1) {
    logger.error(`POST /api/spaces/end: Space ${spaceId} not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  const space = spaces[spaceIndex];
  if (space.host !== walletAddress) {
    logger.error(`POST /api/spaces/end: ${walletAddress} not host of ${spaceId}`);
    return res.status(403).json({ error: 'Only the host can end the space' });
  }
  spaces.splice(spaceIndex, 1);
  logger.info(`POST /api/spaces/end: ${walletAddress} ended space ${spaceId}`);
  res.status(200).json({ message: 'Space ended' });
});

app.post('/api/spaces/mute', (req, res) => {
  const { spaceId, walletAddress, targetAddress } = req.body;
  if (!isValidWalletAddress(walletAddress) || !isValidWalletAddress(targetAddress)) {
    logger.error(`POST /api/spaces/mute: Invalid walletAddress or targetAddress`);
    return res.status(400).json({ error: 'Valid walletAddress and targetAddress required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/mute: Space ${spaceId} not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  if (space.host !== walletAddress && !space.coHosts.includes(walletAddress)) {
    logger.error(`POST /api/spaces/mute: ${walletAddress} not authorized for ${spaceId}`);
    return res.status(403).json({ error: 'Only host or co-host can mute' });
  }
  if (!space.participants.includes(targetAddress)) {
    logger.error(`POST /api/spaces/mute: Target ${targetAddress} not in space ${spaceId}`);
    return res.status(400).json({ error: 'Target not in space' });
  }
  if (!space.muted.includes(targetAddress)) space.muted.push(targetAddress);
  logger.info(`POST /api/spaces/mute: ${walletAddress} muted ${targetAddress} in ${spaceId}`);
  res.json(space);
});

app.post('/api/spaces/unmute', (req, res) => {
  const { spaceId, walletAddress, targetAddress } = req.body;
  if (!isValidWalletAddress(walletAddress) || !isValidWalletAddress(targetAddress)) {
    logger.error(`POST /api/spaces/unmute: Invalid walletAddress or targetAddress`);
    return res.status(400).json({ error: 'Valid walletAddress and targetAddress required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/unmute: Space ${spaceId} not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  if (space.host !== walletAddress && !space.coHosts.includes(walletAddress)) {
    logger.error(`POST /api/spaces/unmute: ${walletAddress} not authorized for ${spaceId}`);
    return res.status(403).json({ error: 'Only host or co-host can unmute' });
  }
  space.muted = space.muted.filter(m => m !== targetAddress);
  logger.info(`POST /api/spaces/unmute: ${walletAddress} unmuted ${targetAddress} in ${spaceId}`);
  res.json(space);
});

app.post('/api/spaces/make-cohost', (req, res) => {
  const { spaceId, walletAddress, targetAddress } = req.body;
  if (!isValidWalletAddress(walletAddress) || !isValidWalletAddress(targetAddress)) {
    logger.error(`POST /api/spaces/make-cohost: Invalid walletAddress or targetAddress`);
    return res.status(400).json({ error: 'Valid walletAddress and targetAddress required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/make-cohost: Space ${spaceId} not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  if (space.host !== walletAddress) {
    logger.error(`POST /api/spaces/make-cohost: ${walletAddress} not host of ${spaceId}`);
    return res.status(403).json({ error: 'Only host can make co-host' });
  }
  if (!space.participants.includes(targetAddress)) {
    logger.error(`POST /api/spaces/make-cohost: Target ${targetAddress} not in space ${spaceId}`);
    return res.status(400).json({ error: 'Target not in space' });
  }
  if (!space.coHosts.includes(targetAddress)) space.coHosts.push(targetAddress);
  logger.info(`POST /api/spaces/make-cohost: ${walletAddress} made ${targetAddress} co-host in ${spaceId}`);
  res.json(space);
});

app.post('/api/spaces/remove-cohost', (req, res) => {
  const { spaceId, walletAddress, targetAddress } = req.body;
  if (!isValidWalletAddress(walletAddress) || !isValidWalletAddress(targetAddress)) {
    logger.error(`POST /api/spaces/remove-cohost: Invalid walletAddress or targetAddress`);
    return res.status(400).json({ error: 'Valid walletAddress and targetAddress required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/remove-cohost: Space ${spaceId} not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  if (space.host !== walletAddress) {
    logger.error(`POST /api/spaces/remove-cohost: ${walletAddress} not host of ${spaceId}`);
    return res.status(403).json({ error: 'Only host can remove co-host' });
  }
  space.coHosts = space.coHosts.filter(c => c !== targetAddress);
  logger.info(`POST /api/spaces/remove-cohost: ${walletAddress} removed ${targetAddress} as co-host in ${spaceId}`);
  res.json(space);
});

app.post('/api/spaces/control', (req, res) => {
  const { spaceId, walletAddress, control, value } = req.body;
  if (!isValidWalletAddress(walletAddress)) {
    logger.error(`POST /api/spaces/control: Invalid walletAddress`);
    return res.status(400).json({ error: 'Valid walletAddress required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/control: Space ${spaceId} not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  if (space.host !== walletAddress && !space.coHosts.includes(walletAddress)) {
    logger.error(`POST /api/spaces/control: ${walletAddress} not authorized for ${spaceId}`);
    return res.status(403).json({ error: 'Only host or co-host can control' });
  }
  if (control === 'lock') space.locked = value;
  else if (['restrictVideo', 'restrictMic', 'restrictChat', 'restrictScreen'].includes(control)) {
    space.restrictions[control.replace('restrict', '').toLowerCase()] = value;
  }
  logger.info(`POST /api/spaces/control: ${walletAddress} set ${control} to ${value} in ${spaceId}`);
  res.json(space);
});

// Chat Routes
app.post('/api/spaces/:spaceId/chat', async (req, res) => {
  const { spaceId } = req.params;
  const { walletAddress, text } = req.body;
  if (!isValidWalletAddress(walletAddress) || !text) {
    logger.error(`POST /api/spaces/${spaceId}/chat: Invalid input`);
    return res.status(400).json({ error: 'Valid walletAddress and text required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/${spaceId}/chat: Space not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  const message = new Message({ spaceId, sender: walletAddress, text });
  await message.save();
  logger.info(`POST /api/spaces/${spaceId}/chat: Message sent by ${walletAddress}`);
  res.json(message);
});

app.get('/api/spaces/:spaceId/chat', async (req, res) => {
  const { spaceId } = req.params;
  try {
    const messages = await Message.find({ spaceId }).sort({ timestamp: 1 });
    logger.info(`GET /api/spaces/${spaceId}/chat: Fetched messages`);
    res.json(messages);
  } catch (err) {
    logger.error(`GET /api/spaces/${spaceId}/chat failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/spaces/:spaceId/record', upload.single('recording'), async (req, res) => {
  const { spaceId } = req.params;
  const { walletAddress } = req.body;
  const recordingUrl = req.file ? req.file.path : null;
  if (!isValidWalletAddress(walletAddress) || !recordingUrl) {
    logger.error(`POST /api/spaces/${spaceId}/record: Invalid input`);
    return res.status(400).json({ error: 'Valid walletAddress and recording required' });
  }
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    logger.error(`POST /api/spaces/${spaceId}/record: Space not found`);
    return res.status(404).json({ error: 'Space not found' });
  }
  if (space.host !== walletAddress) {
    logger.error(`POST /api/spaces/${spaceId}/record: ${walletAddress} not host`);
    return res.status(403).json({ error: 'Only host can upload recording' });
  }
  space.recordingUrl = recordingUrl; // Store recording URL in space object
  logger.info(`POST /api/spaces/${spaceId}/record: Recording uploaded by ${walletAddress}`);
  res.json({ recordingUrl });
});

// Tipping Routes
app.post('/api/tips/tip', async (req, res) => {
  const { senderAddress, receiverAddress, amount } = req.body;
  if (!isValidWalletAddress(senderAddress) || !isValidWalletAddress(receiverAddress) || !amount) {
    logger.error('POST /api/tips/tip: Missing or invalid fields');
    return res.status(400).json({ error: 'Valid senderAddress, receiverAddress, and amount required' });
  }
  try {
    const senderPublicKey = new PublicKey(senderAddress);
    const receiverPublicKey = new PublicKey(receiverAddress);
    const lamports = amount * LAMPORTS_PER_SOL;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderPublicKey,
        toPubkey: receiverPublicKey,
        lamports,
      })
    );

    logger.info(`POST /api/tips/tip: Prepared tip from ${senderAddress} to ${receiverAddress} for ${amount} $SONIC`);
    res.json({ transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64') });
  } catch (err) {
    logger.error(`POST /api/tips/tip failed: ${err.message} ${err.stack}`);
    res.status(500).json({ error: 'Failed to prepare tip transaction' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));