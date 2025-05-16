import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Peer from 'simple-peer';
import './Spaces.css';
import config from '../config';

function Spaces({ walletAddress }) {
  const [spaces, setSpaces] = useState([]);
  const [activeSpace, setActiveSpace] = useState(null);
  const [peers, setPeers] = useState([]);
  const [notification, setNotification] = useState('');
  const [isError, setIsError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [joinPermission, setJoinPermission] = useState('everyone');
  const [record, setRecord] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [stream, setStream] = useState(null);
  const [videoOn, setVideoOn] = useState(false);
  const [muted, setMuted] = useState(true);
  const [chatMessages, setChatMessages] = useState([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [newMessage, setNewMessage] = useState('');
  const [reactions, setReactions] = useState([]);
  const [reactionTimestamps, setReactionTimestamps] = useState({});
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isHostControlsOpen, setIsHostControlsOpen] = useState(false);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [participantsData, setParticipantsData] = useState({});
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [speakingStatus, setSpeakingStatus] = useState({});
  const [timerAssignments, setTimerAssignments] = useState({});
  const [assigningTimeFor, setAssigningTimeFor] = useState(null);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const videoRef = useRef(null);
  const recorderRef = useRef(null);
  const recordedChunks = useRef([]);
  const emojiPickerRef = useRef(null);

  useEffect(() => {
    fetchSpaces();
    const interval = setInterval(fetchSpaces, 5000);
    const openModalListener = () => setIsModalOpen(true);
    window.addEventListener('openSpaceModal', openModalListener);
    return () => {
      clearInterval(interval);
      window.removeEventListener('openSpaceModal', openModalListener);
    };
  }, []);

  useEffect(() => {
    if (activeSpace && stream) {
      fetchParticipantsData();
      fetchMessages();
      if (activeSpace.record && !recorderRef.current) startRecording();
      detectSpeaking();
    }
  }, [activeSpace, stream]);

  useEffect(() => {
    if (Object.keys(timerAssignments).length > 0) {
      const interval = setInterval(() => {
        setTimerAssignments(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach(participant => {
            if (updated[participant].remaining > 0) {
              updated[participant].remaining--;
              if (updated[participant].remaining === 0 && participant === walletAddress) toggleMute(true);
            }
          });
          return updated;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timerAssignments]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showEmojiPicker && emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) setShowEmojiPicker(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  const fetchSpaces = async () => {
    try {
      const res = await axios.get(`${config.API_URL}/api/spaces`);
      setSpaces(res.data);
      if (activeSpace) {
        const updatedSpace = res.data.find(s => s.id === activeSpace.id);
        if (updatedSpace) {
          setActiveSpace(updatedSpace);
          setPendingUsers(updatedSpace.pending || []);
        } else if (!res.data.some(s => s.id === activeSpace.id)) leaveSpace();
      }
    } catch (err) {
      console.error('Failed to fetch spaces:', err);
    }
  };

  const fetchParticipantsData = async () => {
    if (!activeSpace) return;
    const data = {};
    for (const participant of activeSpace.participants) {
      try {
        const res = await axios.get(`${config.API_URL}/api/users/${participant}`);
        data[participant] = res.data || { username: participant.slice(0, 6), profilePicture: '', tagname: `@${participant.slice(0, 6)}` };
      } catch (err) {
        data[participant] = { username: participant.slice(0, 6), profilePicture: '', tagname: `@${participant.slice(0, 6)}` };
      }
    }
    setParticipantsData(data);
  };

  const fetchMessages = async () => {
    if (!activeSpace) return;
    try {
      const res = await axios.get(`${config.API_URL}/api/spaces/${activeSpace.id}/chat`);
      const newMessages = res.data.filter(msg => !chatMessages.some(m => m._id === msg._id));
      setChatMessages(res.data);
      if (!isChatOpen && newMessages.length > 0) setUnreadMessages(prev => prev + newMessages.length);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  };

  const detectSpeaking = () => {
    if (!stream) return;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 2048;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const checkSpeaking = () => {
      analyser.getByteFrequencyData(dataArray);
      const volume = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const isSpeaking = volume > 10;
      setSpeakingStatus(prev => ({ ...prev, [walletAddress]: isSpeaking }));
      requestAnimationFrame(checkSpeaking);
    };
    checkSpeaking();
  };

  const startRecording = () => {
    if (!stream || !activeSpace.record || recorderRef.current) return;
    const options = { mimeType: 'video/webm; codecs=vp9' };
    try {
      recorderRef.current = new MediaRecorder(stream, options);
      recordedChunks.current = [];

      recorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.current.push(event.data);
      };

      recorderRef.current.onstop = async () => {
        await stopRecording();
      };

      recorderRef.current.start();
      setNotificationSuccess('Recording started!');
    } catch (err) {
      setNotificationError('Failed to start recording: ' + err.message);
    }
  };

  const stopRecording = async () => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return;

    try {
      recorderRef.current.stop();
      const blob = new Blob(recordedChunks.current, { type: 'video/webm' });
      if (blob.size === 0) {
        console.warn('Recording blob is empty');
        setNotificationError('Recording is empty.');
        return;
      }

      const formData = new FormData();
      formData.append('recording', blob, `space-${activeSpace.id}.webm`);
      formData.append('walletAddress', walletAddress);

      let uploadSuccess = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await axios.post(`${config.API_URL}/api/spaces/${activeSpace.id}/record`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          console.log('Upload response:', res.data);
          uploadSuccess = true;
          setNotificationSuccess('Recording uploaded successfully!');
          break;
        } catch (err) {
          console.error(`Upload attempt ${attempt} failed:`, err.response?.data || err.message);
          if (attempt === 2) throw err;
        }
      }

      if (!uploadSuccess) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `space-${activeSpace.id}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setNotificationError('Failed to upload recording. Saved locally.');
      }
    } catch (err) {
      console.error('Stop recording error:', err.response?.data || err.message);
      setNotificationError('Failed to upload recording: ' + (err.response?.data?.error || err.message));
    } finally {
      recorderRef.current = null;
      recordedChunks.current = [];
    }
  };

  const handleCreateSpace = async (e) => {
    e.preventDefault();
    if (!walletAddress) return setNotificationError('Connect your wallet first!');
    if (!title.trim()) return setNotificationError('Space title cannot be empty!');
    try {
      const res = await axios.post(`${config.API_URL}/api/spaces/create`, { walletAddress, title, description, joinPermission, record });
      setSpaces([...spaces, res.data]);
      resetForm();
      setNotificationSuccess('Space created successfully!');
      joinSpace(res.data.id);
    } catch (err) {
      setNotificationError('Failed to create space: ' + (err.response?.data?.error || err.message));
    }
  };

  const joinSpace = async (spaceId) => {
    if (!walletAddress) return;
    try {
      const res = await axios.post(`${config.API_URL}/api/spaces/join`, { spaceId, walletAddress });
      if (res.status === 202) {
        setNotificationError('Awaiting approval from host or co-host.');
        return;
      }
      setActiveSpace(res.data);
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoOn });
      setStream(mediaStream);
      const peer = new Peer({ initiator: true, trickle: false, stream: mediaStream });
      peer.on('signal', data => console.log('Signal data:', data));
      peer.on('stream', remoteStream => {
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.play();
      });
      peer.on('error', err => console.error('Peer error:', err));
      setPeers([peer]);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play().catch(err => console.error('Video play error:', err));
      }
    } catch (err) {
      setNotificationError('Failed to join space: ' + (err.response?.data?.error || err.message));
    }
  };

  const confirmLeaveSpace = () => setShowLeaveConfirm(true);
  const confirmEndSpace = () => setShowEndConfirm(true);

  const leaveSpace = async () => {
    if (!activeSpace || !walletAddress) return;
    try {
      await stopRecording();
      await axios.post(`${config.API_URL}/api/spaces/leave`, { spaceId: activeSpace.id, walletAddress });
      cleanupPeers();
      setShowLeaveConfirm(false);
      setNotificationSuccess('Left space successfully!');
    } catch (err) {
      setNotificationError('Failed to leave space: ' + (err.response?.data?.error || err.message));
    }
  };

  const endSpace = async () => {
    if (!activeSpace || activeSpace.host !== walletAddress) return;
    try {
      console.log('Ending space...');
      const response = await fetch(`${config.API_URL}/api/spaces/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ spaceId: activeSpace.id, walletAddress }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
      }
      const data = await response.json();
      console.log('End space response:', data);
      cleanupPeers();
      setShowEndConfirm(false);
      setNotificationSuccess('Space ended successfully!');
    } catch (err) {
      console.error('End space error:', err.message);
      setNotificationError('Failed to end space: ' + err.message);
    }
  };

  const cleanupPeers = () => {
    try {
      if (stream) stream.getTracks().forEach(track => { track.stop(); track.enabled = false; });
      peers.forEach(peer => peer.destroy());
      setPeers([]);
      setStream(null);
      setActiveSpace(null);
      setIsMinimized(false);
      setVideoOn(false);
      setMuted(true);
      setChatMessages([]);
      setReactions([]);
      setReactionTimestamps({});
      setPendingUsers([]);
      setUnreadMessages(0);
      setSpeakingStatus({});
      setTimerAssignments({});
      fetchSpaces();
    } catch (err) {
      console.error('Error during cleanupPeers:', err);
    }
  };

  const setNotificationSuccess = (msg) => {
    setNotification(msg);
    setIsError(false);
    setTimeout(() => setNotification(''), 5000);
  };

  const setNotificationError = (msg) => {
    setNotification(msg);
    setIsError(true);
    setTimeout(() => setNotification(''), 5000);
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setJoinPermission('everyone');
    setRecord(false);
    setIsModalOpen(false);
  };

  const toggleMute = async (forceMute = false) => {
    if (!stream || (activeSpace?.restrictions?.mic && activeSpace.host !== walletAddress && !activeSpace.coHosts?.includes(walletAddress) && !forceMute)) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = forceMute ? false : !audioTrack.enabled;
      setMuted(forceMute ? true : !audioTrack.enabled);
      try {
        await axios.post(`${config.API_URL}/api/spaces/${muted ? 'unmute' : 'mute'}`, { spaceId: activeSpace.id, walletAddress, targetAddress: walletAddress });
      } catch (err) {
        console.error('Failed to update mute status:', err);
      }
    }
  };

  const toggleVideo = async () => {
    if (!stream || (activeSpace?.restrictions?.video && activeSpace.host !== walletAddress && !activeSpace.coHosts?.includes(walletAddress))) return;
    try {
      if (videoOn) {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getVideoTracks().forEach(track => track.stop());
        setStream(audioStream);
        setVideoOn(false);
        if (videoRef.current) videoRef.current.srcObject = audioStream;
      } else {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(track => track.stop());
        setStream(newStream);
        peers.forEach(peer => { if (!peer.destroyed) peer.addStream(newStream); });
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
          videoRef.current.play().catch(err => console.error('Video play error:', err));
        }
        setVideoOn(true);
      }
    } catch (err) {
      setNotificationError('Failed to toggle video: ' + err.message);
      console.error('Toggle video error:', err);
    }
  };

  const startScreenshare = async () => {
    if (!activeSpace || (activeSpace.restrictions?.screen && activeSpace.host !== walletAddress && !activeSpace.coHosts?.includes(walletAddress))) return;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const peer = peers[0];
      if (videoOn) stream.getVideoTracks().forEach(track => track.stop());
      if (peer && !peer.destroyed) peer.addStream(screenStream);
      setStream(screenStream);
      setVideoOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = screenStream;
        videoRef.current.play().catch(err => console.error('Screen share play error:', err));
      }
    } catch (err) {
      setNotificationError('Failed to start screenshare: ' + err.message);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeSpace) return;
    if (activeSpace.restrictions?.chat && activeSpace.host !== walletAddress && !activeSpace.coHosts?.includes(walletAddress)) return;
    try {
      const message = { walletAddress, text: newMessage };
      const res = await axios.post(`${config.API_URL}/api/spaces/${activeSpace.id}/chat`, message);
      setChatMessages([...chatMessages, res.data]);
      setNewMessage('');
      setUnreadMessages(0);
    } catch (err) {
      setNotificationError('Failed to send message: ' + (err.response?.status === 404 ? 'Space not found' : err.message));
    }
  };

  const addReaction = async (emoji) => {
    if (!activeSpace || activeSpace.restrictions?.chat) return;
    try {
      const now = Date.now();
      const lastReactionTime = reactionTimestamps[walletAddress] || 0;
      const withinOneMinute = now - lastReactionTime < 60 * 1000;

      let messageText = emoji;
      if (withinOneMinute) {
        const lastMessage = chatMessages.filter(m => m.sender === walletAddress).pop();
        if (lastMessage && now - new Date(lastMessage.timestamp).getTime() < 60 * 1000) {
          messageText = lastMessage.text + emoji;
          await axios.put(`${config.API_URL}/api/spaces/${activeSpace.id}/chat/${lastMessage._id}`, {
            walletAddress,
            text: messageText,
          });
          setChatMessages(prev => prev.map(m => (m._id === lastMessage._id ? { ...m, text: messageText } : m)));
        } else {
          const message = { walletAddress, text: messageText };
          const res = await axios.post(`${config.API_URL}/api/spaces/${activeSpace.id}/chat`, message);
          setChatMessages([...chatMessages, res.data]);
        }
      } else {
        const message = { walletAddress, text: messageText };
        const res = await axios.post(`${config.API_URL}/api/spaces/${activeSpace.id}/chat`, message);
        setChatMessages([...chatMessages, res.data]);
      }

      setReactionTimestamps(prev => ({ ...prev, [walletAddress]: now }));

      const timestamp = Date.now();
      const newReactions = Array.from({ length: 10 }, (_, i) => ({
        emoji,
        sender: walletAddress,
        timestamp: timestamp + i,
        x: Math.random() * 80 + 10,
        y: Math.random() * 80 + 10,
        duration: Math.random() * 4 + 4,
        size: Math.random() * 0.8 + 1.2,
      }));
      setReactions(prev => [...prev, ...newReactions]);
      setShowEmojiPicker(false);
    } catch (err) {
      console.error('Add reaction error:', err.response?.data || err.message);
      setNotificationError('Failed to send reaction: ' + err.message);
    }
  };

  const handleHostAction = async (targetAddress, action) => {
    if (!activeSpace || activeSpace.host !== walletAddress) return;
    try {
      const res = await axios.post(`${config.API_URL}/api/spaces/${action}`, { spaceId: activeSpace.id, walletAddress, targetAddress });
      setActiveSpace(res.data);
      fetchParticipantsData();
    } catch (err) {
      setNotificationError(`Failed to ${action} participant: ` + err.message);
    }
  };

  const handleHostControl = async (control, value) => {
    if (!activeSpace || (activeSpace.host !== walletAddress && !activeSpace.coHosts?.includes(walletAddress))) return;
    try {
      const res = await axios.post(`${config.API_URL}/api/spaces/control`, { spaceId: activeSpace.id, walletAddress, control, value });
      setActiveSpace(res.data);
    } catch (err) {
      setNotificationError(`Failed to update control ${control}: ` + err.message);
    }
  };

  const approveUser = async (targetAddress) => {
    if (!activeSpace || (activeSpace.host !== walletAddress && !activeSpace.coHosts?.includes(walletAddress))) return;
    try {
      const res = await axios.post(`${config.API_URL}/api/spaces/approve`, { spaceId: activeSpace.id, walletAddress, targetAddress });
      setActiveSpace(res.data);
      setPendingUsers(res.data.pending || []);
      fetchParticipantsData();
    } catch (err) {
      setNotificationError('Failed to approve user: ' + err.message);
    }
  };

  const assignTime = (participant) => {
    setAssigningTimeFor(participant);
    setHours(0);
    setMinutes(0);
    setSeconds(0);
  };

  const confirmTimeAssignment = () => {
    if (assigningTimeFor) {
      const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
      if (totalSeconds > 0) {
        setTimerAssignments(prev => ({ ...prev, [assigningTimeFor]: { remaining: totalSeconds } }));
        setNotificationSuccess(`Assigned ${hours}h ${minutes}m ${seconds}s to ${participantsData[assigningTimeFor]?.username || assigningTimeFor.slice(0, 6)}`);
      }
      setAssigningTimeFor(null);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href + `?space=${activeSpace.id}`);
    setNotificationSuccess('Link copied to clipboard!');
    setIsShareOpen(false);
  };

  const shareOptions = () => {
    if (navigator.share) {
      navigator.share({ title: activeSpace.title, text: activeSpace.description, url: window.location.href + `?space=${activeSpace.id}` })
        .then(() => setIsShareOpen(false));
    } else {
      setIsShareOpen(true);
    }
  };

  return (
    <div className="spaces">
      <div className="spaces-container">
        {notification && <div className={`notification ${isError ? 'error' : 'success'}`}>{notification}</div>}
        {!activeSpace || isMinimized ? (
          <>
            {isModalOpen && (
              <div className="modal-overlay">
                <div className="modal creation-modal">
                  <span className="mic-icon"><i className="fas fa-microphone"></i></span>
                  <h3>Create Your Space</h3>
                  <form onSubmit={handleCreateSpace}>
                    <select value={joinPermission} onChange={(e) => setJoinPermission(e.target.value)} className="modal-input">
                      <option value="invite">Only people you invite to speak</option>
                      <option value="following">People you follow</option>
                      <option value="everyone">Everyone</option>
                    </select>
                    <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Space Title" className="modal-input" />
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Space Description" className="modal-input" />
                    <label className="record-toggle">
                      <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
                      Record this space
                    </label>
                    <div className="modal-buttons">
                      <button type="submit" className="start-btn">Start</button>
                      <button type="button" onClick={() => setIsModalOpen(false)} className="cancel-btn">Cancel</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            {!activeSpace && (
              <div className="space-list">
                {spaces.map(space => (
                  <div key={space.id} className="space-item">
                    <h3>{space.title}</h3>
                    <p>Host: {space.host.slice(0, 6)}...{space.host.slice(-4)}</p>
                    <p>Participants: {space.participants.length}</p>
                    <button onClick={() => joinSpace(space.id)} className="join-btn">Join</button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="active-space">
            <div className="space-header">
              <span className="minimize-icon" onClick={() => setIsMinimized(true)}><i className="fas fa-angle-down"></i></span>
              <span className="wallet-icon"><i className="fas fa-wallet"></i></span>
              {activeSpace.record && <div className="recording-indicator"><span className="rec-dot"></span> Rec</div>}
              <h3>{activeSpace.title}</h3>
            </div>
            <hr className="divider" />
            {videoOn && <video ref={videoRef} autoPlay muted className="self-video" />}
            <div className="participants-container">
              {activeSpace.participants.map(participant => {
                const user = participantsData[participant] || { username: participant.slice(0, 6), profilePicture: '', tagname: `@${participant.slice(0, 6)}` };
                const role = participant === activeSpace.host ? 'Host' : activeSpace.coHosts?.includes(participant) ? 'Co-Host' : activeSpace.muted.includes(participant) ? 'Listener' : 'Speaker';
                const isSpeaking = participant === walletAddress ? speakingStatus[walletAddress] : !activeSpace.muted.includes(participant);
                const timeLeft = timerAssignments[participant]?.remaining || 0;
                return (
                  <div key={participant} className="participant-card">
                    <img src={user.profilePicture || 'default-avatar.png'} alt={user.username} className="participant-avatar" />
                    <span>{user.username}</span>
                    <div className="role">
                      <span className={`mic-indicator ${isSpeaking ? 'speaking' : 'muted'}`}>
                        <i className={`fas fa-microphone${isSpeaking ? '' : '-slash'}`}></i>
                      </span>
                      {role}
                      {timeLeft > 0 && <span className="timer">{Math.floor(timeLeft / 3600)}h {Math.floor((timeLeft % 3600) / 60)}m {timeLeft % 60}s</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <hr className="divider" />
            <div className="space-controls">
              <div className="left-controls">
                <span className={`control-icon large ${muted ? 'muted' : 'speaking'}`} onClick={() => toggleMute()}>
                  <i className={`fas fa-microphone${muted ? '-slash' : ''}`}></i>
                </span>
                <span className={`control-icon large ${!videoOn ? 'muted' : 'speaking'}`} onClick={toggleVideo}>
                  <i className={`fas fa-video${!videoOn ? '-slash' : ''}`}></i>
                </span>
              </div>
              <div className="center-controls">
                <span className="control-icon" onClick={() => setShowEmojiPicker(true)}><i className="fas fa-heart"></i></span>
                <span className="control-icon" onClick={() => setShowParticipants(true)}><i className="fas fa-users"></i></span>
                <span className={`control-icon ${unreadMessages > 0 ? 'chat-with-messages' : ''}`} onClick={() => { setIsChatOpen(!isChatOpen); setUnreadMessages(0); }}>
                  <i className="fas fa-comment"></i> {unreadMessages > 0 && <span className="unread-count">{unreadMessages}</span>}
                </span>
              </div>
              <div className="right-controls">
                <span className="control-icon options" onClick={() => setIsOptionsOpen(!isOptionsOpen)}><i className="fas fa-ellipsis-v"></i></span>
              </div>
            </div>
            {showEmojiPicker && (
              <div className="emoji-picker" ref={emojiPickerRef}>
                <div className="emoji-grid">
                  {['😂', '👍', '❤️', '😮', '👏', '😊', '😢', '😡', '🤔', '🎉', '🙌', '🔥', '💯', '🤩', '😎', '🙏', '💪', '🌟', '👀', '🎶', '🍕', '🚀', '🌈', '💡', '✨'].map(emoji => (
                    <span key={emoji} onClick={() => addReaction(emoji)} className="emoji-item">{emoji}</span>
                  ))}
                </div>
              </div>
            )}
            {isOptionsOpen && (
              <div className="options-modal">
                <div className="modal-header">
                  <h4>Options</h4>
                  <span className="close-icon" onClick={() => setIsOptionsOpen(false)}><i className="fas fa-times"></i></span>
                </div>
                <div className="option-item" onClick={shareOptions}><i className="fas fa-share"></i> Share Space</div>
                {(activeSpace.host === walletAddress || activeSpace.coHosts?.includes(walletAddress)) && (
                  <div className="option-item" onClick={() => setIsHostControlsOpen(true)}><i className="fas fa-tools"></i> Host Controls</div>
                )}
                {activeSpace.host === walletAddress && (
                  <div className="option-item end-space" onClick={confirmEndSpace}><i className="fas fa-stop"></i> Deal Space</div>
                )}
                <div className="option-item leave-space" onClick={confirmLeaveSpace}><i className="fas fa-sign-out-alt"></i> Leave Space</div>
              </div>
            )}
            {isShareOpen && (
              <div className="share-options">
                <button onClick={copyLink}>Copy Link</button>
                <button onClick={() => setIsShareOpen(false)}>Close</button>
              </div>
            )}
            {showParticipants && (
              <div className="participants-modal">
                <div className="modal-header">
                  <h4>Guests</h4>
                  <span className="close-icon" onClick={() => setShowParticipants(false)}><i className="fas fa-times"></i></span>
                </div>
                <div className="participant-group">
                  <h5>Host</h5>
                  {activeSpace.participants.filter(p => p === activeSpace.host).map(participant => {
                    const user = participantsData[participant];
                    return <div key={participant} className="participant-item"><img src={user.profilePicture || 'default-avatar.png'} alt={user.username} className="participant-avatar" /><span>{user.username} {user.tagname}</span></div>;
                  })}
                </div>
                {activeSpace.coHosts?.length > 0 && (
                  <div className="participant-group">
                    <h5>Co-Hosts</h5>
                    {activeSpace.participants.filter(p => activeSpace.coHosts.includes(p)).map(participant => {
                      const user = participantsData[participant];
                      return (
                        <div key={participant} className="participant-item">
                          <img src={user.profilePicture || 'default-avatar.png'} alt={user.username} className="participant-avatar" />
                          <span>{user.username} {user.tagname}</span>
                          {activeSpace.host === walletAddress && participant !== walletAddress && (
                            <div className="host-actions">
                              <button onClick={() => handleHostAction(participant, activeSpace.muted.includes(participant) ? 'unmute' : 'mute')}>
                                {activeSpace.muted.includes(participant) ? 'Unmute' : 'Mute'}
                              </button>
                              <button onClick={() => handleHostAction(participant, 'remove-cohost')}>Remove Co-Host</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="participant-group">
                  <h5>Speakers</h5>
                  {activeSpace.participants.filter(p => !activeSpace.muted.includes(p) && p !== activeSpace.host && !activeSpace.coHosts?.includes(p)).map(participant => {
                    const user = participantsData[participant];
                    return (
                      <div key={participant} className="participant-item">
                        <img src={user.profilePicture || 'default-avatar.png'} alt={user.username} className="participant-avatar" />
                        <span>{user.username} {user.tagname}</span>
                        {activeSpace.host === walletAddress && participant !== walletAddress && (
                          <div className="host-actions">
                            <button onClick={() => handleHostAction(participant, 'mute')}>Mute</button>
                            <button onClick={() => handleHostAction(participant, 'make-cohost')}>Make Co-Host</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="participant-group">
                  <h5>Listeners</h5>
                  {activeSpace.participants.filter(p => activeSpace.muted.includes(p)).map(participant => {
                    const user = participantsData[participant];
                    return (
                      <div key={participant} className="participant-item">
                        <img src={user.profilePicture || 'default-avatar.png'} alt={user.username} className="participant-avatar" />
                        <span>{user.username} {user.tagname}</span>
                        {activeSpace.host === walletAddress && participant !== walletAddress && (
                          <div className="host-actions">
                            <button onClick={() => handleHostAction(participant, 'unmute')}>Unmute</button>
                            <button onClick={() => handleHostAction(participant, 'make-cohost')}>Make Co-Host</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {isChatOpen && (
              <div className="chat-modal">
                <div className="chat-header">
                  <h4>Chat</h4>
                  <span onClick={() => setIsChatOpen(false)}><i className="fas fa-times"></i></span>
                </div>
                <div className="chat-messages">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className="chat-message">
                      <span>{participantsData[msg.sender]?.username || msg.sender.slice(0, 6)}: {msg.text}</span>
                      <span className="message-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  ))}
                </div>
                <form onSubmit={sendMessage} className="chat-input">
                  <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message" disabled={activeSpace.restrictions?.chat && activeSpace.host !== walletAddress && !activeSpace.coHosts?.includes(walletAddress)} />
                  <button type="submit" disabled={activeSpace.restrictions?.chat && activeSpace.host !== walletAddress && !activeSpace.coHosts?.includes(walletAddress)}><i className="fas fa-paper-plane"></i></button>
                </form>
              </div>
            )}
            {isHostControlsOpen && (
              <div className="host-controls-modal">
                <div className="modal-header">
                  <h4>Host Controls</h4>
                  <span className="close-icon" onClick={() => setIsHostControlsOpen(false)}><i className="fas fa-times"></i></span>
                </div>
                <div className="toggle-item" onClick={() => handleHostControl('lock', !activeSpace.locked)}><span><i className="fas fa-lock"></i> Lock Space</span><div className={`toggle ${activeSpace.locked ? 'on' : 'off'}`}></div></div>
                <div className="toggle-item" onClick={() => handleHostControl('restrictVideo', !activeSpace.restrictions?.video)}><span><i className="fas fa-video-slash"></i> Restrict Video</span><div className={`toggle ${activeSpace.restrictions?.video ? 'on' : 'off'}`}></div></div>
                <div className="toggle-item" onClick={() => handleHostControl('restrictMic', !activeSpace.restrictions?.mic)}><span><i className="fas fa-microphone-slash"></i> Restrict Mic</span><div className={`toggle ${activeSpace.restrictions?.mic ? 'on' : 'off'}`}></div></div>
                <div className="toggle-item" onClick={() => handleHostControl('restrictChat', !activeSpace.restrictions?.chat)}><span><i className="fas fa-comment-slash"></i> Restrict Chat</span><div className={`toggle ${activeSpace.restrictions?.chat ? 'on' : 'off'}`}></div></div>
                <div className="toggle-item" onClick={() => handleHostControl('restrictScreen', !activeSpace.restrictions?.screen)}><span><i className="fas fa-desktop"></i> Restrict Screen</span><div className={`toggle ${activeSpace.restrictions?.screen ? 'on' : 'off'}`}></div></div>
                {activeSpace.locked && (
                  <div className="pending-users">
                    <h4>Pending Join Requests</h4>
                    {pendingUsers.map(user => (
                      <div key={user}>
                        <span>{participantsData[user]?.username || user.slice(0, 6)}</span>
                        <button onClick={() => approveUser(user)}>Approve</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="timer-section">
                  <h4>Set Timers</h4>
                  {activeSpace.participants.map(participant => (
                    <div key={participant} className="timer-item">
                      <span>{participantsData[participant]?.username || participant.slice(0, 6)}</span>
                      <button onClick={() => assignTime(participant)}>Assign Time</button>
                    </div>
                  ))}
                </div>
                {assigningTimeFor && (
                  <div className="timer-input">
                    <h4>Assign Time for {participantsData[assigningTimeFor]?.username || assigningTimeFor.slice(0, 6)}</h4>
                    <input type="number" min="0" value={hours} onChange={(e) => setHours(Math.max(0, e.target.value))} placeholder="Hours" />
                    <input type="number" min="0" max="59" value={minutes} onChange={(e) => setMinutes(Math.max(0, Math.min(59, e.target.value)))} placeholder="Minutes" />
                    <input type="number" min="0" max="59" value={seconds} onChange={(e) => setSeconds(Math.max(0, Math.min(59, e.target.value)))} placeholder="Seconds" />
                    <div className="modal-buttons">
                      <button onClick={confirmTimeAssignment} className="start-btn">Done</button>
                      <button onClick={() => setAssigningTimeFor(null)} className="cancel-btn">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {showLeaveConfirm && (
              <div className="modal-overlay">
                <div className="modal">
                  <h3>Confirm Leave</h3>
                  <p>Are you sure you want to leave this space?</p>
                  <div className="modal-buttons">
                    <button onClick={leaveSpace} className="start-btn">Yes</button>
                    <button onClick={() => setShowLeaveConfirm(false)} className="cancel-btn">No</button>
                  </div>
                </div>
              </div>
            )}
            {showEndConfirm && (
              <div className="modal-overlay">
                <div className="modal">
                  <h3>Confirm End Space</h3>
                  <p>Are you sure you want to end this space? This will disconnect all participants.</p>
                  <div className="modal-buttons">
                    <button onClick={endSpace} className="start-btn">Yes</button>
                    <button onClick={() => setShowEndConfirm(false)} className="cancel-btn">No</button>
                  </div>
                </div>
              </div>
            )}
            <div className="reactions">
              {reactions.map((r, idx) => (
                <span
                  key={`${r.timestamp}-${idx}`}
                  className="reaction-balloon"
                  style={{
                    left: `${r.x}%`,
                    top: `${r.y}%`,
                    fontSize: `${r.size}rem`,
                    animationDuration: `${r.duration}s`,
                    background: `linear-gradient(135deg, ${['#ff6b6b', '#4ecdc4', '#45b7d1', '#96c93d', '#ffcc00'][Math.floor(Math.random() * 5)]}, transparent)`,
                  }}
                >
                  {r.emoji}
                </span>
              ))}
            </div>
          </div>
        )}
        {activeSpace && isMinimized && (
          <div className="minimized-space" onClick={() => setIsMinimized(false)}>
            <span>{activeSpace.title} (Running)</span>
            <span className="maximize-icon"><i className="fas fa-angle-up"></i></span>
          </div>
        )}
      </div>
    </div>
  );
}

export default Spaces;