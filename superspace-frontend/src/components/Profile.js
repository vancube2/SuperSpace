import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import debounce from 'lodash/debounce';
import './Profile.css';
import defaultProfilePic from '../assets/default-profile-pic.png';
import config from '../config';

function Profile({ walletAddress, connection }) {
  const [profile, setProfile] = useState(null);
  const [username, setUsername] = useState('');
  const [tagname, setTagname] = useState('');
  const [profilePic, setProfilePic] = useState(null);
  const [notification, setNotification] = useState('');
  const [isError, setIsError] = useState(false);
  const [tipAmount, setTipAmount] = useState('');
  const [tagnameAvailable, setTagnameAvailable] = useState(null);
  const [checkingTagname, setCheckingTagname] = useState(false);
  const [lastTagnameChange, setLastTagnameChange] = useState(null);

  useEffect(() => {
    if (walletAddress) fetchProfile();
  }, [walletAddress]);

  const fetchProfile = async () => {
    try {
      const res = await axios.get(`${config.API_URL}/api/profile/${walletAddress}`);
      setProfile(res.data);
      setUsername(res.data.username || '');
      setTagname(res.data.tagname || '');
      setProfilePic(res.data.profilePicture || defaultProfilePic);
      setLastTagnameChange(res.data.lastTagnameChange || null);
    } catch (err) {
      console.error('Failed to fetch profile:', err.response?.data || err.message);
    }
  };

  const checkTagnameAvailability = useCallback(
    debounce(async (value) => {
      if (!value || value === profile?.tagname) {
        console.log(`checkTagnameAvailability: Skipping check for value=${value}, same as current tagname or empty`);
        setTagnameAvailable(null);
        setCheckingTagname(false);
        return;
      }
      console.log(`checkTagnameAvailability: Starting check for tagname=${value}`);
      setCheckingTagname(true);
      // Set a timeout to reset checkingTagname if the API takes too long
      const timeout = setTimeout(() => {
        console.warn(`checkTagnameAvailability: Timeout for tagname=${value}, resetting checkingTagname`);
        setCheckingTagname(false);
        setTagnameAvailable(null);
      }, 5000);
      try {
        const res = await axios.get(`${config.API_URL}/api/check-tagname/${encodeURIComponent(value)}`);
        clearTimeout(timeout);
        console.log(`checkTagnameAvailability: Tagname=${value}, exists=${res.data.exists}, available=${!res.data.exists}`);
        setTagnameAvailable(!res.data.exists);
      } catch (err) {
        clearTimeout(timeout);
        console.error(`checkTagnameAvailability: Error checking tagname=${value}:`, err.message);
        setTagnameAvailable(null);
      } finally {
        console.log(`checkTagnameAvailability: Completed check for tagname=${value}, checkingTagname=false`);
        setCheckingTagname(false);
      }
    }, 500),
    [profile?.tagname]
  );

  const verifyTagnameAvailability = async (value) => {
    if (!value || value === profile?.tagname) {
      console.log(`verifyTagnameAvailability: Skipping verification for value=${value}, same as current tagname or empty`);
      return true;
    }
    console.log(`verifyTagnameAvailability: Verifying tagname=${value}`);
    try {
      const res = await axios.get(`${config.API_URL}/api/check-tagname/${encodeURIComponent(value)}`);
      console.log(`verifyTagnameAvailability: Tagname=${value}, exists=${res.data.exists}, available=${!res.data.exists}`);
      return !res.data.exists;
    } catch (err) {
      console.error(`verifyTagnameAvailability: Error verifying tagname=${value}:`, err.message);
      return false;
    }
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    if (!walletAddress) {
      setNotification('Connect your wallet first!');
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
      return;
    }

    const now = Date.now();
    if (lastTagnameChange && (now - new Date(lastTagnameChange) < 7 * 24 * 60 * 60 * 1000) && tagname !== profile.tagname) {
      setNotification('You can only change your tagname once every 7 days!');
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
      return;
    }

    if (checkingTagname) {
      console.log(`handleProfileUpdate: Tagname check in progress for ${tagname}`);
      setNotification('Please wait for tagname availability check to complete!');
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
      return;
    }

    if (tagname && tagname !== profile?.tagname) {
      const isAvailable = await verifyTagnameAvailability(tagname);
      if (!isAvailable) {
        console.log(`handleProfileUpdate: Tagname=${tagname} is not available after verification`);
        setTagnameAvailable(false);
        setNotification('Tagname is not available!');
        setIsError(true);
        setTimeout(() => setNotification(''), 5000);
        return;
      }
    }

    const formData = new FormData();
    formData.append('walletAddress', walletAddress);
    formData.append('username', username);
    formData.append('tagname', tagname);
    if (profilePic && profilePic !== defaultProfilePic && profilePic instanceof File) {
      formData.append('profilePic', profilePic);
    }

    try {
      console.log(`handleProfileUpdate: Submitting tagname=${tagname}, username=${username}, hasProfilePic=${!!profilePic}`);
      const res = await axios.post(`${config.API_URL}/api/profile`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      console.log(`handleProfileUpdate: Success, response=${JSON.stringify(res.data)}`);
      setProfile({
        ...profile,
        username: res.data.username,
        tagname: res.data.tagname,
        profilePicture: res.data.profilePicUrl || profile.profilePicture,
        lastTagnameChange: res.data.lastTagnameChange,
      });
      setProfilePic(res.data.profilePicUrl || profilePic);
      setLastTagnameChange(res.data.lastTagnameChange);
      setTagnameAvailable(null); // Reset availability after successful update
      setNotification('Profile updated successfully!');
      setIsError(false);
      setTimeout(() => setNotification(''), 5000);
    } catch (err) {
      console.error('Profile update error:', err.response?.data || err.message);
      setNotification('Failed to update profile: ' + (err.response?.data?.error || err.message));
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) setProfilePic(file);
  };

  const handleTip = async () => {
    if (!walletAddress || !profile || walletAddress === profile.walletAddress) {
      setNotification('Cannot tip yourself or wallet not connected!');
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
      return;
    }
    if (!tipAmount || tipAmount <= 0) {
      setNotification('Enter a valid tip amount!');
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
      return;
    }

    try {
      const res = await axios.post(`${config.API_URL}/api/tips/tip`, {
        senderAddress: walletAddress,
        receiverAddress: profile.walletAddress,
        amount: parseFloat(tipAmount),
      });
      const transaction = new window.solanaWeb3.Transaction().deserialize(Buffer.from(res.data.transaction, 'base64'));
      const { signature } = await window.solana.signAndSendTransaction(transaction);
      await connection.confirmTransaction(signature);
      setNotification(`Tipped ${tipAmount} $SONIC successfully!`);
      setIsError(false);
      setTipAmount('');
      setTimeout(() => setNotification(''), 5000);
    } catch (err) {
      setNotification('Failed to send tip: ' + (err.response?.data?.error || err.message));
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
    }
  };

  return (
    <div className="profile">
      {notification && <div className={`notification ${isError ? 'error' : 'success'}`}>{notification}</div>}
      {walletAddress ? (
        profile ? (
          <div className="profile-details">
            <div className="profile-pic-container">
              <img src={profilePic instanceof File ? URL.createObjectURL(profilePic) : profilePic} alt="Profile" className="profile-pic" />
            </div>
            <p className="wallet-address">{profile.walletAddress} <span className="network">(Sonic)</span></p>
            <form className="profile-form" onSubmit={handleProfileUpdate}>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="profile-input" maxLength={50} />
              <input
                type="text"
                value={tagname}
                onChange={(e) => {
                  const value = e.target.value;
                  setTagname(value);
                  checkTagnameAvailability(value);
                }}
                placeholder="Tagname (e.g., @user)"
                className={`profile-input tagname-input ${checkingTagname ? 'checking' : tagnameAvailable === true ? 'available' : tagnameAvailable === false ? 'unavailable' : ''}`}
                maxLength={20}
              />
              <input type="file" accept="image/*" onChange={handleImageChange} id="profile-pic-upload" className="profile-pic-upload" />
              <label htmlFor="profile-pic-upload" className="profile-pic-label">Change Profile Picture</label>
              <button type="submit" className="update-btn" disabled={checkingTagname}>Update Profile</button>
            </form>
            {walletAddress !== profile.walletAddress && (
              <div className="tip-section">
                <input type="number" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} placeholder="Amount in $SONIC" className="tip-input" step="0.01" min="0" />
                <button onClick={handleTip} className="tip-btn">Tip $SONIC</button>
              </div>
            )}
          </div>
        ) : <p>Loading profile...</p>
      ) : <p>Connect your wallet to view or edit your profile.</p>}
    </div>
  );
}

export default Profile;