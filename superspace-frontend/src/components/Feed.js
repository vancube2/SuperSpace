import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Feed.css';
import config from '../config';

function Feed({ walletAddress }) {
  const [posts, setPosts] = useState([]);
  const [content, setContent] = useState('');
  const [image, setImage] = useState(null);
  const [notification, setNotification] = useState('');
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    try {
      const res = await axios.get(`${config.API_URL}/api/posts`);
      setPosts(res.data);
    } catch (err) {
      console.error('Failed to fetch posts:', err.response?.data || err.message);
    }
  };

  const handlePostSubmit = async (e) => {
    e.preventDefault();
    if (!walletAddress) {
      setNotification('Connect your wallet first!');
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
      return;
    }
    if (!content.trim()) {
      setNotification('Post content cannot be empty!');
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
      return;
    }

    const formData = new FormData();
    formData.append('walletAddress', walletAddress);
    formData.append('content', content);
    if (image) {
      if (image.size > 5 * 1024 * 1024) { // 5MB limit
        setNotification('Image size must be less than 5MB!');
        setIsError(true);
        setTimeout(() => setNotification(''), 5000);
        return;
      }
      if (!['image/jpeg', 'image/png'].includes(image.type)) {
        setNotification('Only JPEG and PNG images are allowed!');
        setIsError(true);
        setTimeout(() => setNotification(''), 5000);
        return;
      }
      formData.append('image', image);
    }

    try {
      const res = await axios.post(`${config.API_URL}/api/posts`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPosts([res.data, ...posts]);
      setContent('');
      setImage(null);
      setNotification('Post created successfully!');
      setIsError(false);
      setTimeout(() => setNotification(''), 5000);
    } catch (err) {
      console.error('Failed to create post:', err.response?.data || err.message);
      setNotification('Failed to create post: ' + (err.response?.data?.error || err.message));
      setIsError(true);
      setTimeout(() => setNotification(''), 5000);
    }
  };

  const handleImageChange = (e) => {
    setImage(e.target.files[0]);
  };

  return (
    <div className="feed">
      <h2>Feed</h2>
      {notification && (
        <div className={`notification ${isError ? 'error' : 'success'}`}>{notification}</div>
      )}
      <form className="post-form" onSubmit={handlePostSubmit}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind?"
          className="post-input"
          maxLength={280}
        />
        <div className="post-actions">
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleImageChange}
            id="image-upload"
            className="image-upload"
          />
          <label htmlFor="image-upload" className="image-upload-label">
            {image ? image.name : 'Attach Image'}
          </label>
          <button type="submit" className="post-btn">Post</button>
        </div>
      </form>
      <div className="posts">
        {posts.map((post) => (
          <div key={post._id} className="post">
            <p className="post-wallet">{post.walletAddress.slice(0, 6)}...{post.walletAddress.slice(-4)}</p>
            <p className="post-content">{post.content}</p>
            {post.imageUrl && (
              <img src={post.imageUrl} alt="Post" className="post-image" />
            )}
            <p className="post-timestamp">{new Date(post.timestamp).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Feed;