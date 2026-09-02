import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import io from 'socket.io-client';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import InvitePage from './components/InvitePage';
import './App.css';

const AuthContext = createContext(null);
const SocketContext = createContext(null);

export const useAuth = () => useContext(AuthContext);
export const useSocket = () => useContext(SocketContext);

const isDev = window.location.port === '3000';
const API_URL = isDev
  ? `http://${window.location.hostname}:3001`
  : window.location.origin;
const socket = io(API_URL);

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      axios.get(`${API_URL}/api/auth/me`)
        .then(res => {
          setUser(res.data);
          socket.emit('user_online', res.data.id);
        })
        .catch(err => {
          if (err.response && (err.response.status === 401 || err.response.status === 403)) {
            localStorage.removeItem('token');
            setToken(null);
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      socket.emit('heartbeat', user.id);
    }, 25000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const handleUnload = () => {
      fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        keepalive: true
      });
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [user]);

  const login = async (email, password) => {
    const res = await axios.post(`${API_URL}/api/auth/login`, { email, password });
    localStorage.setItem('token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    socket.emit('user_online', res.data.user.id);
    return res.data;
  };

  const register = async (username, email, password) => {
    const res = await axios.post(`${API_URL}/api/auth/register`, { username, email, password });
    localStorage.setItem('token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    socket.emit('user_online', res.data.user.id);
    return res.data;
  };

  const logout = async () => {
    try {
      await axios.post('/api/auth/logout');
    } catch (e) {}
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    delete axios.defaults.headers.common['Authorization'];
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      <SocketContext.Provider value={socket}>
        <Router>
          <div className="app">
            <Routes>
              <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
              <Route path="/register" element={!user ? <Register /> : <Navigate to="/" />} />
              <Route path="/invite/:code" element={<InvitePage />} />
              <Route path="/*" element={user ? <Dashboard /> : <Navigate to="/login" />} />
            </Routes>
          </div>
        </Router>
      </SocketContext.Provider>
    </AuthContext.Provider>
  );
}

export default App;
