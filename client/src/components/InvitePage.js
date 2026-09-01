import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../App';
import './Auth.css';

const API_URL = window.location.origin;

function InvitePage() {
  const { code } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('joining...');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      setStatus('redirecting to login...');
      setTimeout(() => navigate('/login'), 1500);
      return;
    }

    axios.post(`${API_URL}/api/invites/${code}/join`)
      .then(res => {
        setStatus(`Joined ${res.data.name}!`);
        setTimeout(() => navigate('/'), 1500);
      })
      .catch(err => {
        const msg = err.response?.data?.error || 'Failed to join';
        setError(msg);
        setStatus('');
      });
  }, [code, user, navigate]);

  return (
    <div className="auth-container">
      <div className="auth-box" style={{ textAlign: 'center' }}>
        <h2>Invite</h2>
        {status && <p style={{ color: '#3ba55c', marginTop: 16 }}>{status}</p>}
        {error && <p style={{ color: '#ed4245', marginTop: 16 }}>{error}</p>}
      </div>
    </div>
  );
}

export default InvitePage;
