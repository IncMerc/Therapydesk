import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Users, Clock, DollarSign, Plus, ChevronRight, Search, Filter, MoreVertical, Check, X, ArrowLeft, Edit2, Trash2, Bell, Wallet, CreditCard, LogOut, Video, Link as LinkIcon, FileText } from 'lucide-react';
import { practice, video } from './api';
import TherapistRoom from './room/TherapistRoom';
import NotesPanel from './notes/NotesPanel';

// Custom Rupee Icon Component - ₹
const RupeeIcon = ({ size = 24, className = "" }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    className={className}
  >
    <line x1="6" y1="5" x2="18" y2="5" />
    <line x1="6" y1="10" x2="18" y2="10" />
    <path d="M6 5c2.5 0 6 0 7.5 0c2.5 0 4 1.5 4 3.5c0 2.5-2 4-4.5 4H6" />
    <line x1="6" y1="12.5" x2="14" y2="20" />
  </svg>
);

// Mock data
const CLIENT_TYPES = {
  professional: { label: 'Working Professional', rate: 999, currency: '₹' },
  student: { label: 'Student', rate: 599, currency: '₹' },
  international: { label: 'International', rate: 30, currency: '$' },
};


export default function TherapyPracticeApp({ initialState, therapist, onSignOut }) {
  const [activeView, setActiveView] = useState('dashboard');
  const [clients, setClients] = useState(initialState.clients);
  const [sessions, setSessions] = useState(initialState.sessions);
  const [payments, setPayments] = useState(initialState.payments);
  const [sessionCredits, setSessionCredits] = useState(initialState.credits); // { clientId: numberOfCredits }
  const [clientMeetLinks, setClientMeetLinks] = useState(initialState.meetLinks); // { clientId: meetLink }
  const [apiError, setApiError] = useState('');
  const [videoSession, setVideoSession] = useState(null);
  const [notesSession, setNotesSession] = useState(null);

  const applyState = (s) => {
    setClients(s.clients);
    setSessions(s.sessions);
    setPayments(s.payments);
    setSessionCredits(s.credits);
    setClientMeetLinks(s.meetLinks);
    setSelectedClient(prev => (prev ? s.clients.find(c => c.id === prev.id) || null : null));
  };
  // modals are declared inside this component, so app-level setState remounts them (and wipes the form).
  // save() throws instead so the modal can show the error locally
  const save = async (request) => {
    try {
      const s = await request;
      applyState(s);
      return s;
    } catch (err) {
      if (err.status === 401) onSignOut();
      throw err;
    }
  };
  const [createdSession, setCreatedSession] = useState(null); // { session, client, meetLink }
  const closeModal = () => { setShowAddModal(null); setCreatedSession(null); };

  const run = async (request) => {
    try {
      const s = await request;
      applyState(s);
      setApiError('');
      return s;
    } catch (err) {
      if (err.status === 401) { onSignOut(); return null; }
      setApiError(err.message);
      return null;
    }
  };
  const [selectedClient, setSelectedClient] = useState(null);
  const [showAddModal, setShowAddModal] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [exchangeRate, setExchangeRate] = useState(null);
  const [rateLastUpdated, setRateLastUpdated] = useState(null);

  // Fetch USD to INR exchange rate
  useEffect(() => {
    const fetchExchangeRate = async () => {
      try {
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await response.json();
        if (data.rates && data.rates.INR) {
          setExchangeRate(data.rates.INR);
          setRateLastUpdated(new Date());
        }
      } catch (error) {
        console.error('Failed to fetch exchange rate:', error);
        // Fallback rate if API fails
        setExchangeRate(83.5);
      }
    };
    fetchExchangeRate();
    // Refresh rate every hour
    const interval = setInterval(fetchExchangeRate, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Helper functions
  const getClient = (id) => clients.find(c => c.id === id);
  
  const getClientSessions = (clientId) => sessions.filter(s => s.clientId === clientId);
  
  const formatCurrency = (amount, clientType, showConversion = false) => {
    const currency = CLIENT_TYPES[clientType]?.currency || '₹';
    const formatted = `${currency}${amount.toLocaleString()}`;
    
    // Show INR conversion for international clients
    if (showConversion && clientType === 'international' && exchangeRate) {
      const inrAmount = Math.round(amount * exchangeRate);
      return `${formatted} (≈₹${inrAmount.toLocaleString()})`;
    }
    return formatted;
  };
  
  const convertToINR = (amount) => {
    if (!exchangeRate) return amount;
    return Math.round(amount * exchangeRate);
  };
  
  // Updated: Balance only counts unpaid sessions that are NOT prepaid
  const getClientBalance = (clientId) => {
    const client = getClient(clientId);
    const clientSessions = getClientSessions(clientId);
    // Only count completed sessions that are unpaid AND not prepaid
    const unpaidSessions = clientSessions.filter(s => 
      s.status === 'completed' && !s.paid && !s.prepaid
    );
    return unpaidSessions.length * (client?.rate || 0);
  };

  const getClientCredits = (clientId) => {
    return sessionCredits[clientId] || 0;
  };


  const getClientMeetLink = (clientId) => {
    return clientMeetLinks[clientId] || '';
  };

  const setClientMeetLink = (clientId, link) => run(practice.setMeetLink(clientId, link));

  const getTotalOutstanding = () => {
    return clients.reduce((sum, client) => {
      const balance = getClientBalance(client.id);
      // Convert international ($) to INR for total
      if (client.clientType === 'international' && exchangeRate) {
        return sum + (balance * exchangeRate);
      }
      return sum + balance;
    }, 0);
  };

  const getUpcomingSessions = () => {
    const today = new Date().toISOString().split('T')[0];
    return sessions
      .filter(s => s.date >= today && s.status === 'scheduled')
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  };

  // Updated: Revenue this month includes completed sessions (both paid and prepaid)
  const getThisMonthStats = () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthSessions = sessions.filter(s => s.date >= monthStart && s.status === 'completed');
    let monthRevenue = 0;
    monthSessions.forEach(s => {
      const client = getClient(s.clientId);
      if (client) {
        // Convert international to INR
        if (client.clientType === 'international' && exchangeRate) {
          monthRevenue += client.rate * exchangeRate;
        } else {
          monthRevenue += client.rate;
        }
      }
    });
    return { sessions: monthSessions.length, revenue: Math.round(monthRevenue) };
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatTime = (timeStr) => {
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  // Components
  const NavItem = ({ icon: Icon, label, view }) => (
    <button
      onClick={() => { setActiveView(view); setSelectedClient(null); }}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200 ${
        activeView === view 
          ? 'bg-emerald-50 text-emerald-700 font-medium' 
          : 'text-stone-600 hover:bg-stone-100'
      }`}
    >
      <Icon size={20} />
      <span>{label}</span>
    </button>
  );

  const StatCard = ({ icon: Icon, label, value, subtext, color, onClick }) => (
    <div 
      onClick={onClick}
      className={`bg-white rounded-2xl p-6 shadow-sm border border-stone-200/60 ${onClick ? 'cursor-pointer hover:shadow-md hover:border-stone-300 transition-all' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-stone-500 text-sm mb-1">{label}</p>
          <p className="text-3xl font-semibold text-stone-800">{value}</p>
          {subtext && <p className="text-sm text-stone-400 mt-1">{subtext}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon size={24} className="text-white" />
        </div>
      </div>
    </div>
  );

  const AddClientModal = () => {
    const [form, setForm] = useState({ name: '', email: '', phone: '', clientType: 'professional', notes: '' });
    const [step, setStep] = useState(1); // 1: forms, 2: client details
    
    const [error, setError] = useState('');
    const handleSubmit = async (e) => {
      e.preventDefault();
      try { await save(practice.createClient(form)); closeModal(); }
      catch (err) { setError(err.message); }
    };

    // Step 1: Intake Forms
    if (step === 1) {
      return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-2xl font-semibold text-stone-800 mb-2">New Client Onboarding</h2>
            <p className="text-stone-500 mb-6">Please have the client fill out these intake forms first</p>
            
            <div className="space-y-4 mb-6">
              <a 
                href="https://form.jotform.com/253003974829059" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors group"
              >
                <div>
                  <p className="font-medium text-stone-800">Intake Form 1</p>
                  <p className="text-sm text-stone-500">Basic information & consent</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center group-hover:bg-emerald-700 transition-colors">
                  <ChevronRight size={20} className="text-white" />
                </div>
              </a>
              
              <a 
                href="https://form.jotform.com/253004824628455" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 rounded-xl border-2 border-violet-200 bg-violet-50 hover:bg-violet-100 transition-colors group"
              >
                <div>
                  <p className="font-medium text-stone-800">Intake Form 2</p>
                  <p className="text-sm text-stone-500">Assessment questionnaire</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center group-hover:bg-violet-700 transition-colors">
                  <ChevronRight size={20} className="text-white" />
                </div>
              </a>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-amber-800">
                <strong>Note:</strong> Ensure client has completed both forms before proceeding
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => closeModal()}
                className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
              >
                Forms Completed →
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Step 2: Client Details
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
          <h2 className="text-2xl font-semibold text-stone-800 mb-6">Add Client Details</h2>
          {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Full Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({...form, name: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                placeholder="Enter client name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({...form, email: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                placeholder="client@email.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({...form, phone: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Client Type</label>
              <div className="space-y-2">
                {Object.entries(CLIENT_TYPES).map(([key, { label, rate, currency }]) => (
                  <label 
                    key={key}
                    className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      form.clientType === key 
                        ? 'border-emerald-500 bg-emerald-50' 
                        : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="clientType"
                        value={key}
                        checked={form.clientType === key}
                        onChange={(e) => setForm({...form, clientType: e.target.value})}
                        className="w-5 h-5 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="font-medium text-stone-700">{label}</span>
                    </div>
                    <span className="font-semibold text-emerald-600">{currency}{rate}/session</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({...form, notes: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all resize-none"
                rows={3}
                placeholder="Any relevant notes..."
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
              >
                ← Back
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
              >
                Add Client
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const AddSessionModal = () => {
    const [form, setForm] = useState({ 
      clientId: '', 
      date: '', 
      time: '', 
      duration: '50', 
      notes: '',
      addToGoogleCalendar: true
    });
    const [error, setError] = useState('');

    // Generate Google Calendar URL
    const generateGoogleCalendarUrl = (session, client) => {
      const startDate = new Date(`${session.date}T${session.time}`);
      const endDate = new Date(startDate.getTime() + session.duration * 60000);
      
      const formatGoogleDate = (date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };
      
      const meetLink = getClientMeetLink(client.id);
      
      const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: `Therapy Session - ${client.name}`,
        dates: `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`,
        details: `Session with ${client.name}${meetLink ? `\n\nMeeting link: ${meetLink}` : ''}\n\n${session.notes || ''}`,
        ...(meetLink && { location: meetLink }),
      });
      
      return `https://calendar.google.com/calendar/render?${params.toString()}`;
    };

    const handleSubmit = async (e) => {
      e.preventDefault();
      const clientId = parseInt(form.clientId);
      const client = getClient(clientId);
      const meetLink = getClientMeetLink(clientId);
      const existingIds = new Set(sessions.map(s => s.id));
      let state;
      try {
        state = await save(practice.createSession({
          clientId, date: form.date, time: form.time, duration: parseInt(form.duration), notes: form.notes,
        }));
      } catch (err) { setError(err.message); return; }
      const newSession = state.sessions.find(s => !existingIds.has(s.id));
      if (form.addToGoogleCalendar && newSession) {
        setCreatedSession({ session: newSession, client, meetLink });
      } else {
        closeModal();
      }
    };

    const handleOpenGoogleCalendar = () => {
      const url = generateGoogleCalendarUrl(createdSession.session, createdSession.client);
      window.open(url, '_blank');
      closeModal();
    };

    const copyMeetLink = () => {
      if (createdSession.meetLink) navigator.clipboard.writeText(createdSession.meetLink);
    };

    // Success screen after creating session
    if (createdSession) {
      return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-emerald-600" />
              </div>
              <h2 className="text-2xl font-semibold text-stone-800">Session Scheduled!</h2>
              <p className="text-stone-500 mt-2">
                {createdSession.client.name} • {formatDate(createdSession.session.date)} at {formatTime(createdSession.session.time)}
              </p>
            </div>

            {/* Meet Link */}
            <div className="bg-stone-50 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-stone-600">Meeting link</span>
                <button
                  onClick={copyMeetLink}
                  className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                  Copy
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 via-green-500 to-yellow-500 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                </div>
                <code className="text-sm text-stone-700 bg-white px-3 py-2 rounded-lg flex-1 border border-stone-200">
                  {createdSession.meetLink || 'No link yet. Add one from the Sessions page.'}
                </code>
              </div>
              <p className="text-xs text-stone-400 mt-2">Share this link with {createdSession.client.name.split(' ')[0]} for the video session</p>
            </div>

            {/* Google Calendar */}
            <div className="bg-blue-50 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12s4.48 10 10 10"/>
                    <path fill="#EA4335" d="M12 2C6.48 2 2 6.48 2 12h10V2z"/>
                    <path fill="#FBBC05" d="M2 12c0 5.52 4.48 10 10 10V12H2z"/>
                    <path fill="#34A853" d="M12 22c5.52 0 10-4.48 10-10H12v10z"/>
                    <path fill="#FFF" d="M12 7v10l7-5z"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-medium text-stone-800">Add to Google Calendar</p>
                  <p className="text-sm text-stone-500 mt-1">This will open Google Calendar with the session pre-filled. A Meet link will be automatically included.</p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => closeModal()}
                className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleOpenGoogleCalendar}
                className="flex-1 px-4 py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <Calendar size={18} />
                Add to Calendar
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
          <h2 className="text-2xl font-semibold text-stone-800 mb-6">Schedule Session</h2>
          {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Client</label>
              <select
                required
                value={form.clientId}
                onChange={(e) => setForm({...form, clientId: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all bg-white"
              >
                <option value="">Select a client</option>
                {clients.filter(c => c.status === 'active').map(client => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                    {getClientCredits(client.id) > 0 ? ` (${getClientCredits(client.id)} prepaid)` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-2">Date</label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => setForm({...form, date: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-2">Time</label>
                <input
                  type="time"
                  required
                  value={form.time}
                  onChange={(e) => setForm({...form, time: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Duration (minutes)</label>
              <select
                value={form.duration}
                onChange={(e) => setForm({...form, duration: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all bg-white"
              >
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="50">50 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Session Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({...form, notes: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all resize-none"
                rows={3}
                placeholder="Optional notes..."
              />
            </div>
            
            {/* Google Calendar Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-stone-50 border border-stone-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12s4.48 10 10 10"/>
                    <path fill="#EA4335" d="M12 2C6.48 2 2 6.48 2 12h10V2z"/>
                    <path fill="#FBBC05" d="M2 12c0 5.52 4.48 10 10 10V12H2z"/>
                    <path fill="#34A853" d="M12 22c5.52 0 10-4.48 10-10H12v10z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-stone-700 text-sm">Add to Google Calendar</p>
                  <p className="text-xs text-stone-500">Includes Meet link for video sessions</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setForm({...form, addToGoogleCalendar: !form.addToGoogleCalendar})}
                className={`relative w-12 h-7 rounded-full transition-colors ${form.addToGoogleCalendar ? 'bg-emerald-500' : 'bg-stone-300'}`}
              >
                <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${form.addToGoogleCalendar ? 'left-6' : 'left-1'}`} />
              </button>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => closeModal()}
                className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
              >
                Schedule
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const RecordPaymentModal = () => {
    const [form, setForm] = useState({ clientId: '', amount: '', method: 'UPI', prepaidSessions: 0 });
    const [paymentType, setPaymentType] = useState('completed'); // 'completed' or 'prepaid'
    const [selectedSessions, setSelectedSessions] = useState([]);
    
    const selectedClient = form.clientId ? getClient(parseInt(form.clientId)) : null;
    const unpaidSessions = form.clientId 
      ? sessions.filter(s => s.clientId === parseInt(form.clientId) && s.status === 'completed' && !s.paid && !s.prepaid)
      : [];
    const clientCredits = form.clientId ? getClientCredits(parseInt(form.clientId)) : 0;

    const calculatePrepaidAmount = () => {
      if (!selectedClient || !form.prepaidSessions) return 0;
      return selectedClient.rate * parseInt(form.prepaidSessions);
    };

    const [error, setError] = useState('');
    const handleSubmit = async (e) => {
      e.preventDefault();
      const clientId = parseInt(form.clientId);
      const base = { clientId, amount: parseFloat(form.amount), method: form.method };
      const body = paymentType === 'prepaid'
        ? { ...base, type: 'prepaid', prepaidSessions: parseInt(form.prepaidSessions) }
        : { ...base, type: 'completed', sessionIds: selectedSessions };
      try { await save(practice.recordPayment(body)); closeModal(); }
      catch (err) { setError(err.message); }
    };

    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
          <h2 className="text-2xl font-semibold text-stone-800 mb-6">Record Payment</h2>
          {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Client</label>
              <select
                required
                value={form.clientId}
                onChange={(e) => { setForm({...form, clientId: e.target.value, prepaidSessions: 0}); setSelectedSessions([]); }}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all bg-white"
              >
                <option value="">Select a client</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.name} {getClientCredits(client.id) > 0 ? `(${getClientCredits(client.id)} credits)` : getClientBalance(client.id) > 0 ? `(${formatCurrency(getClientBalance(client.id), client.clientType)} due)` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Show client credits if any */}
            {selectedClient && clientCredits > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <Check size={18} className="text-emerald-600" />
                  <span className="font-medium text-emerald-800">
                    {clientCredits} prepaid session{clientCredits > 1 ? 's' : ''} remaining
                  </span>
                </div>
              </div>
            )}

            {/* Payment type toggle */}
            {form.clientId && (
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-2">Payment Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentType('completed')}
                    className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      paymentType === 'completed' 
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700' 
                        : 'border-stone-200 text-stone-600 hover:border-stone-300'
                    }`}
                  >
                    Pay for Sessions
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('prepaid')}
                    className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      paymentType === 'prepaid' 
                        ? 'border-violet-500 bg-violet-50 text-violet-700' 
                        : 'border-stone-200 text-stone-600 hover:border-stone-300'
                    }`}
                  >
                    Prepay Sessions
                  </button>
                </div>
              </div>
            )}
            
            {/* For completed sessions payment */}
            {paymentType === 'completed' && unpaidSessions.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-2">Select Sessions to Pay</label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {unpaidSessions.map(session => (
                    <label 
                      key={session.id}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedSessions.includes(session.id)
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedSessions.includes(session.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSessions([...selectedSessions, session.id]);
                              // Auto-update amount
                              const newAmount = (selectedSessions.length + 1) * selectedClient.rate;
                              setForm({...form, amount: newAmount.toString()});
                            } else {
                              setSelectedSessions(selectedSessions.filter(id => id !== session.id));
                              // Auto-update amount
                              const newAmount = (selectedSessions.length - 1) * selectedClient.rate;
                              setForm({...form, amount: newAmount > 0 ? newAmount.toString() : ''});
                            }
                          }}
                          className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 rounded"
                        />
                        <div>
                          <p className="text-sm font-medium text-stone-700">{formatDate(session.date)}</p>
                          <p className="text-xs text-stone-500">{formatTime(session.time)}</p>
                        </div>
                      </div>
                      <span className="text-sm font-medium text-stone-600">
                        {formatCurrency(selectedClient.rate, selectedClient.clientType)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {paymentType === 'completed' && unpaidSessions.length === 0 && form.clientId && (
              <div className="bg-stone-50 rounded-xl p-4 text-center">
                <p className="text-stone-500">No unpaid sessions for this client</p>
              </div>
            )}
            
            {/* For prepaid sessions */}
            {paymentType === 'prepaid' && (
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-2">Number of Sessions to Prepay</label>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        setForm({
                          ...form, 
                          prepaidSessions: num,
                          amount: (selectedClient?.rate * num).toString()
                        });
                      }}
                      className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                        form.prepaidSessions === num 
                          ? 'border-violet-500 bg-violet-50 text-violet-700' 
                          : 'border-stone-200 text-stone-600 hover:border-stone-300'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
                {form.prepaidSessions > 0 && selectedClient && (
                  <p className="text-sm text-stone-500 mt-2">
                    Total: {formatCurrency(calculatePrepaidAmount(), selectedClient.clientType)}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Amount</label>
              <input
                type="number"
                required
                value={form.amount}
                onChange={(e) => setForm({...form, amount: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Payment Method</label>
              <select
                value={form.method}
                onChange={(e) => setForm({...form, method: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all bg-white"
              >
                <option value="UPI">UPI (GPay/PhonePe/Paytm)</option>
                <option value="Bank Transfer">Bank Transfer (NEFT/IMPS)</option>
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="PayPal">PayPal (International)</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => closeModal()}
                className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
              >
                Record Payment
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Interactive Eyes Component
  const BlinkingEyes = () => {
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [eyesClosed, setEyesClosed] = useState(false);
    const [isBlinking, setIsBlinking] = useState(false);
    const leftEyeRef = useRef(null);
    const rightEyeRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => {
      const handleMouseMove = (e) => {
        setMousePos({ x: e.clientX, y: e.clientY });
      };
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    // Check distance and close eyes if cursor is too close
    useEffect(() => {
      if (!leftEyeRef.current || !rightEyeRef.current) return;
      
      const leftRect = leftEyeRef.current.getBoundingClientRect();
      const rightRect = rightEyeRef.current.getBoundingClientRect();
      
      const leftCenterX = leftRect.left + leftRect.width / 2;
      const leftCenterY = leftRect.top + leftRect.height / 2;
      const rightCenterX = rightRect.left + rightRect.width / 2;
      const rightCenterY = rightRect.top + rightRect.height / 2;
      
      const leftDistance = Math.hypot(mousePos.x - leftCenterX, mousePos.y - leftCenterY);
      const rightDistance = Math.hypot(mousePos.x - rightCenterX, mousePos.y - rightCenterY);
      const minDistance = Math.min(leftDistance, rightDistance);
      
      if (minDistance < 60) {
        setEyesClosed(true);
      } else if (minDistance > 100) {
        setEyesClosed(false);
      }
    }, [mousePos]);

    // Natural blinking every 3-5 seconds
    useEffect(() => {
      const blink = () => {
        if (!eyesClosed) {
          setIsBlinking(true);
          setTimeout(() => setIsBlinking(false), 150);
        }
      };
      const interval = setInterval(blink, 3000 + Math.random() * 2000);
      return () => clearInterval(interval);
    }, [eyesClosed]);

    // Calculate pupil position based on mouse (pure function, no state updates)
    const calculatePupilPosition = (eyeRef) => {
      if (!eyeRef.current) return { x: 0, y: 0 };
      const rect = eyeRef.current.getBoundingClientRect();
      const eyeCenterX = rect.left + rect.width / 2;
      const eyeCenterY = rect.top + rect.height / 2;
      
      const angle = Math.atan2(mousePos.y - eyeCenterY, mousePos.x - eyeCenterX);
      const distance = Math.min(
        Math.hypot(mousePos.x - eyeCenterX, mousePos.y - eyeCenterY) / 12,
        10
      );
      
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance
      };
    };

    const leftPupil = calculatePupilPosition(leftEyeRef);
    const rightPupil = calculatePupilPosition(rightEyeRef);
    const showClosed = eyesClosed || isBlinking;

    return (
      <div ref={containerRef} className="flex items-center gap-4">
        {/* Left Eye */}
        <div 
          ref={leftEyeRef}
          className="relative bg-white rounded-full shadow-lg border-4 border-stone-200 overflow-hidden"
          style={{
            width: '64px',
            height: showClosed ? '8px' : '64px',
            borderRadius: showClosed ? '50px' : '50%',
            transition: 'height 0.1s ease-out',
          }}
        >
          {!showClosed && (
            <div 
              className="absolute w-8 h-8 bg-stone-800 rounded-full"
              style={{
                left: `calc(50% - 16px + ${leftPupil.x}px)`,
                top: `calc(50% - 16px + ${leftPupil.y}px)`,
              }}
            >
              <div className="absolute w-3 h-3 bg-white rounded-full top-1 left-1 opacity-80" />
            </div>
          )}
        </div>
        
        {/* Right Eye */}
        <div 
          ref={rightEyeRef}
          className="relative bg-white rounded-full shadow-lg border-4 border-stone-200 overflow-hidden"
          style={{
            width: '64px',
            height: showClosed ? '8px' : '64px',
            borderRadius: showClosed ? '50px' : '50%',
            transition: 'height 0.1s ease-out',
          }}
        >
          {!showClosed && (
            <div 
              className="absolute w-8 h-8 bg-stone-800 rounded-full"
              style={{
                left: `calc(50% - 16px + ${rightPupil.x}px)`,
                top: `calc(50% - 16px + ${rightPupil.y}px)`,
              }}
            >
              <div className="absolute w-3 h-3 bg-white rounded-full top-1 left-1 opacity-80" />
            </div>
          )}
        </div>
      </div>
    );
  };

  // Views
  const Dashboard = () => {
    const monthStats = getThisMonthStats();
    const upcoming = getUpcomingSessions().slice(0, 5);
    const clientsWithBalance = clients.filter(c => getClientBalance(c.id) > 0);
    const activeClients = clients.filter(c => c.status === 'active');

    // Dynamic greeting based on time of day
    const getGreeting = () => {
      const hour = new Date().getHours();
      if (hour < 12) return 'Good morning';
      if (hour < 17) return 'Good afternoon';
      return 'Good evening';
    };

    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-stone-800">{getGreeting()}</h1>
            <p className="text-stone-500 mt-1">Another day of making a difference</p>
          </div>
          <BlinkingEyes />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard 
            icon={Users} 
            label="Active Clients" 
            value={activeClients.length} 
            subtext={activeClients.length > 0 ? "Click to view" : "Add your first client"}
            color="bg-blue-500" 
            onClick={() => setActiveView('clients')}
          />
          <StatCard 
            icon={Clock} 
            label="Sessions This Month" 
            value={monthStats.sessions} 
            subtext={monthStats.sessions > 0 ? "Click to view" : "No sessions yet"}
            color="bg-emerald-500" 
            onClick={() => setActiveView('sessions')}
          />
          <StatCard 
            icon={RupeeIcon} 
            label="Revenue This Month" 
            value={`₹${monthStats.revenue.toLocaleString()}`} 
            subtext={monthStats.revenue > 0 ? "Click for details" : "Complete sessions to earn"}
            color="bg-violet-500" 
            onClick={() => setActiveView('payments')}
          />
          <StatCard 
            icon={Bell} 
            label="Outstanding" 
            value={`₹${Math.round(getTotalOutstanding()).toLocaleString()}`} 
            subtext={`${clientsWithBalance.length} clients`} 
            color="bg-amber-500" 
            onClick={() => setShowAddModal('payment')}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming Sessions */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200/60">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-stone-800">Upcoming Sessions</h2>
              <button 
                onClick={() => setActiveView('sessions')}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                View all
              </button>
            </div>
            {upcoming.length > 0 ? (
              <div className="space-y-3">
                {upcoming.map(session => {
                  const client = getClient(session.clientId);
                  return (
                    <div key={session.id} className="flex items-center justify-between p-4 rounded-xl bg-stone-50 hover:bg-stone-100 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-medium text-lg">
                          {client?.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <p className="font-medium text-stone-800">{client?.name}</p>
                          <p className="text-sm text-stone-500">{formatDate(session.date)} at {formatTime(session.time)}</p>
                        </div>
                      </div>
                      <span className="text-sm font-medium text-stone-600">{session.duration} min</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-stone-400">
                <Calendar size={40} className="mx-auto mb-3 opacity-50" />
                <p>No upcoming sessions</p>
              </div>
            )}
          </div>

          {/* Outstanding Balances */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200/60">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-stone-800">Outstanding Balances</h2>
              <button 
                onClick={() => setShowAddModal('payment')}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                Record payment
              </button>
            </div>
            {clientsWithBalance.length > 0 ? (
              <div className="space-y-3">
                {clientsWithBalance.map(client => {
                  const balance = getClientBalance(client.id);
                  const unpaidCount = sessions.filter(s => s.clientId === client.id && s.status === 'completed' && !s.paid && !s.prepaid).length;
                  return (
                    <div key={client.id} className="flex items-center justify-between p-4 rounded-xl bg-amber-50 border border-amber-100">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-medium text-lg">
                          {client.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <p className="font-medium text-stone-800">{client.name}</p>
                          <p className="text-sm text-stone-500">{unpaidCount} unpaid session{unpaidCount > 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <span className="text-lg font-semibold text-amber-700">
                          {formatCurrency(balance, client.clientType)}
                        </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-stone-400">
                <Check size={40} className="mx-auto mb-3 opacity-50" />
                <p>All caught up!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ClientsList = () => {
    const filteredClients = clients.filter(c => 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-stone-800">Clients</h1>
          <button 
            onClick={() => setShowAddModal('client')}
            className="flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
          >
            <Plus size={20} />
            Add Client
          </button>
        </div>

        <div className="relative">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder="Search clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
          />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200/60 overflow-hidden">
          <div className="grid grid-cols-12 gap-4 p-4 border-b border-stone-200 bg-stone-50 text-sm font-medium text-stone-500">
            <div className="col-span-4">Client</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Sessions</div>
            <div className="col-span-2">Rate</div>
            <div className="col-span-2">Balance</div>
          </div>
          {filteredClients.length === 0 ? (
            <div className="text-center py-16">
              <Users size={48} className="mx-auto mb-4 text-stone-300" />
              <h3 className="text-lg font-medium text-stone-600 mb-2">No clients yet</h3>
              <p className="text-stone-400 mb-6">Add your first client to get started</p>
              <button
                onClick={() => setShowAddModal('client')}
                className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
              >
                <Plus size={20} />
                Add First Client
              </button>
            </div>
          ) : (
            filteredClients.map(client => {
            const clientSessions = getClientSessions(client.id);
            const completedSessions = clientSessions.filter(s => s.status === 'completed').length;
            const balance = getClientBalance(client.id);
            const credits = getClientCredits(client.id);
            
            return (
              <div 
                key={client.id} 
                onClick={() => setSelectedClient(client)}
                className="grid grid-cols-12 gap-4 p-4 border-b border-stone-100 hover:bg-stone-50 cursor-pointer transition-colors items-center"
              >
                <div className="col-span-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-medium">
                    {client.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <p className="font-medium text-stone-800">{client.name}</p>
                    <p className="text-sm text-stone-400">{client.email}</p>
                  </div>
                </div>
                <div className="col-span-2">
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
                    client.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-600'
                  }`}>
                    {client.status}
                  </span>
                </div>
                <div className="col-span-2 text-stone-600">
                  {completedSessions} total
                  {credits > 0 && (
                    <span className="block text-xs text-violet-600">{credits} prepaid</span>
                  )}
                </div>
                <div className="col-span-2 text-stone-600">
                  {CLIENT_TYPES[client.clientType]?.currency || '₹'}{client.rate}/session
                </div>
                <div className="col-span-2">
                  {balance > 0 ? (
                    <span className="font-medium text-amber-600">
                      {formatCurrency(balance, client.clientType)} due
                    </span>
                  ) : (
                    <span className="text-stone-400">—</span>
                  )}
                </div>
              </div>
            );
          })
          )}
        </div>
      </div>
    );
  };

  const ClientDetail = ({ client }) => {
    const clientSessions = getClientSessions(client.id).sort((a, b) => b.date.localeCompare(a.date));
    const balance = getClientBalance(client.id);
    const credits = getClientCredits(client.id);
    const totalSessions = clientSessions.filter(s => s.status === 'completed').length;
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);

    const handleDeleteClient = async () => {
      if (await run(practice.deleteClient(client.id))) setSelectedClient(null);
    };

    const handleUpdateClient = async (updatedData) => {
      const { rate, ...patch } = updatedData; // eslint-disable-line no-unused-vars
      if (await run(practice.updateClient(client.id, patch))) setShowEditModal(false);
    };

    const handleToggleStatus = () => {
      const newStatus = client.status === 'active' ? 'paused' : 'active';
      run(practice.updateClient(client.id, { status: newStatus }));
    };

    return (
      <div className="space-y-6">
        <button 
          onClick={() => setSelectedClient(null)}
          className="flex items-center gap-2 text-stone-500 hover:text-stone-700 transition-colors"
        >
          <ArrowLeft size={20} />
          Back to clients
        </button>

        <div className="bg-white rounded-2xl p-8 shadow-sm border border-stone-200/60">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-semibold text-2xl">
                {client.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-stone-800">{client.name}</h1>
                <p className="text-stone-500 mt-1">{client.email}</p>
                <p className="text-stone-500">{client.phone}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleToggleStatus}
                className={`px-4 py-2 rounded-xl font-medium transition-colors ${
                  client.status === 'active'
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                }`}
              >
                {client.status === 'active' ? 'Pause Client' : 'Activate Client'}
              </button>
              <button
                onClick={() => setShowEditModal(true)}
                className="p-2 rounded-xl border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                <Edit2 size={18} />
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2 rounded-xl border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-6 mt-8">
            <div className="bg-stone-50 rounded-xl p-4">
              <p className="text-sm text-stone-500">Total Sessions</p>
              <p className="text-2xl font-semibold text-stone-800 mt-1">{totalSessions}</p>
            </div>
            <div className="bg-stone-50 rounded-xl p-4">
              <p className="text-sm text-stone-500">Rate</p>
              <p className="text-2xl font-semibold text-stone-800 mt-1">{formatCurrency(client.rate, client.clientType)}</p>
            </div>
            <div className={`rounded-xl p-4 ${balance > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
              <p className="text-sm text-stone-500">Balance Due</p>
              <p className={`text-2xl font-semibold mt-1 ${balance > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {balance > 0 ? formatCurrency(balance, client.clientType) : 'Paid up'}
              </p>
            </div>
            <div className={`rounded-xl p-4 ${credits > 0 ? 'bg-violet-50' : 'bg-stone-50'}`}>
              <p className="text-sm text-stone-500">Prepaid Credits</p>
              <p className={`text-2xl font-semibold mt-1 ${credits > 0 ? 'text-violet-700' : 'text-stone-800'}`}>
                {credits} session{credits !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {client.notes && (
            <div className="mt-6 p-4 rounded-xl bg-stone-50">
              <p className="text-sm font-medium text-stone-600 mb-1">Notes</p>
              <p className="text-stone-700">{client.notes}</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200/60">
          <h2 className="text-lg font-semibold text-stone-800 mb-4">Session History</h2>
          {clientSessions.length > 0 ? (
            <div className="space-y-3">
              {clientSessions.map(session => (
                <div key={session.id} className="flex items-center justify-between p-4 rounded-xl bg-stone-50">
                  <div className="flex items-center gap-4">
                    <div className={`w-3 h-3 rounded-full ${
                      session.status === 'completed' ? 'bg-emerald-500' : 
                      session.status === 'scheduled' ? 'bg-blue-500' : 'bg-stone-400'
                    }`} />
                    <div>
                      <p className="font-medium text-stone-800">{formatDate(session.date)} at {formatTime(session.time)}</p>
                      <p className="text-sm text-stone-500">{session.duration} minutes • {session.status}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-stone-700">{formatCurrency(client.rate, client.clientType)}</p>
                    {session.status === 'completed' && (
                      <span className={`text-sm ${
                        session.prepaid ? 'text-violet-600' :
                        session.paid ? 'text-emerald-600' : 'text-amber-600'
                      }`}>
                        {session.prepaid ? 'Prepaid' : session.paid ? 'Paid' : 'Unpaid'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-stone-400">
              <Clock size={40} className="mx-auto mb-3 opacity-50" />
              <p>No sessions yet</p>
            </div>
          )}
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                  <Trash2 size={28} className="text-red-600" />
                </div>
                <h2 className="text-xl font-semibold text-stone-800 mb-2">Delete Client?</h2>
                <p className="text-stone-500">
                  This will permanently delete <strong>{client.name}</strong> and all their session history ({clientSessions.length} sessions).
                </p>
                {balance > 0 && (
                  <p className="text-amber-600 mt-2 text-sm font-medium">
                    ⚠️ This client has {formatCurrency(balance, client.clientType)} in outstanding balance
                  </p>
                )}
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteClient}
                  className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
                >
                  Delete Client
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Client Modal */}
        {showEditModal && (
          <EditClientModal 
            client={client} 
            onClose={() => setShowEditModal(false)} 
            onSave={handleUpdateClient} 
          />
        )}
      </div>
    );
  };

  const EditClientModal = ({ client, onClose, onSave }) => {
    const [form, setForm] = useState({
      name: client.name,
      email: client.email,
      phone: client.phone,
      clientType: client.clientType || 'professional',
      notes: client.notes || ''
    });

    const handleSubmit = (e) => {
      e.preventDefault();
      const typeInfo = CLIENT_TYPES[form.clientType];
      onSave({...form, rate: typeInfo.rate});
    };

    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
          <h2 className="text-2xl font-semibold text-stone-800 mb-6">Edit Client</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Full Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({...form, name: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({...form, email: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({...form, phone: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Client Type</label>
              <div className="space-y-2">
                {Object.entries(CLIENT_TYPES).map(([key, { label, rate, currency }]) => (
                  <label 
                    key={key}
                    className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      form.clientType === key 
                        ? 'border-emerald-500 bg-emerald-50' 
                        : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="clientType"
                        value={key}
                        checked={form.clientType === key}
                        onChange={(e) => setForm({...form, clientType: e.target.value})}
                        className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="font-medium text-stone-700 text-sm">{label}</span>
                    </div>
                    <span className="font-semibold text-emerald-600 text-sm">{currency}{rate}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({...form, notes: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all resize-none"
                rows={3}
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const SessionsList = () => {
    const sortedSessions = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    const [copiedId, setCopiedId] = useState(null);
    const [openMenuId, setOpenMenuId] = useState(null);
    const [rescheduleSession, setRescheduleSession] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [editMeetLinkFor, setEditMeetLinkFor] = useState(null); // clientId to edit meet link for
    const [meetLinkInput, setMeetLinkInput] = useState('');

    const markComplete = (sessionId) => run(practice.completeSession(sessionId));

    const togglePayment = (sessionId) => {
      const session = sessions.find(s => s.id === sessionId);
      if (!session || session.prepaid) return; // Can't toggle prepaid sessions
      run(practice.toggleSessionPayment(sessionId));
    };

    const copyMeetLink = (link) => {
      navigator.clipboard.writeText(link);
      setCopiedId('copied');
      setTimeout(() => setCopiedId(null), 2000);
    };

    const handleDeleteSession = async (sessionId) => {
      if (await run(practice.deleteSession(sessionId))) setDeleteConfirm(null);
    };

    const handleReschedule = async (newDate, newTime) => {
      if (await run(practice.updateSession(rescheduleSession.id, { date: newDate, time: newTime }))) setRescheduleSession(null);
    };

    const openEditMeetLink = (clientId) => {
      setMeetLinkInput(getClientMeetLink(clientId));
      setEditMeetLinkFor(clientId);
    };

    const saveMeetLink = () => {
      if (editMeetLinkFor) {
        setClientMeetLink(editMeetLinkFor, meetLinkInput);
        setEditMeetLinkFor(null);
        setMeetLinkInput('');
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-stone-800">Sessions</h1>
          <button 
            onClick={() => setShowAddModal('session')}
            className="flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
          >
            <Plus size={20} />
            Schedule Session
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200/60 overflow-visible">
          <div className="grid grid-cols-12 gap-4 p-4 border-b border-stone-200 bg-stone-50 rounded-t-2xl text-sm font-medium text-stone-500">
            <div className="col-span-3">Client</div>
            <div className="col-span-3">Date & Time</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Payment</div>
            <div className="col-span-1">Call / notes</div>
            <div className="col-span-1">Actions</div>
          </div>
          <div className="relative">
          {sortedSessions.length === 0 ? (
            <div className="text-center py-16">
              <Clock size={48} className="mx-auto mb-4 text-stone-300" />
              <h3 className="text-lg font-medium text-stone-600 mb-2">No sessions yet</h3>
              <p className="text-stone-400 mb-6">{clients.length === 0 ? "Add a client first, then schedule sessions" : "Schedule your first session"}</p>
              {clients.length > 0 && (
                <button
                  onClick={() => setShowAddModal('session')}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
                >
                  <Plus size={20} />
                  Schedule First Session
                </button>
              )}
            </div>
          ) : (
            sortedSessions.map(session => {
            const client = getClient(session.clientId);
            const isUpcoming = session.status === 'scheduled';
            const clientMeetLink = getClientMeetLink(session.clientId);
            const clientCredits = getClientCredits(session.clientId);
            
            return (
              <div key={session.id} className="grid grid-cols-12 gap-4 p-4 border-b border-stone-100 hover:bg-stone-50 transition-colors items-center relative">
                <div className="col-span-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-medium text-sm">
                    {client?.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <span className="font-medium text-stone-800">{client?.name}</span>
                    {isUpcoming && clientCredits > 0 && (
                      <span className="block text-xs text-violet-600">{clientCredits} prepaid available</span>
                    )}
                  </div>
                </div>
                <div className="col-span-3 text-stone-600">
                  <div>{formatDate(session.date)} at {formatTime(session.time)}</div>
                  <div className="text-xs text-stone-400">{session.duration} minutes</div>
                </div>
                <div className="col-span-2">
                  {isUpcoming ? (
                    <button
                      onClick={() => markComplete(session.id)}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                    >
                      <Check size={14} />
                      Mark done
                    </button>
                  ) : (
                    <span className="inline-flex px-3 py-1 rounded-full text-sm font-medium bg-emerald-100 text-emerald-700">
                      Completed
                    </span>
                  )}
                </div>
                <div className="col-span-2">
                  {session.status === 'completed' ? (
                    session.prepaid ? (
                      // Prepaid sessions - show non-clickable badge
                      <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium bg-violet-100 text-violet-700">
                        <Check size={14} />
                        Prepaid
                      </span>
                    ) : (
                      // Regular sessions - clickable toggle
                      <button
                        onClick={() => togglePayment(session.id)}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                          session.paid 
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' 
                            : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        }`}
                      >
                        {session.paid ? (
                          <>
                            <Check size={14} />
                            Paid
                          </>
                        ) : (
                          <>
                            <X size={14} />
                            Unpaid
                          </>
                        )}
                      </button>
                    )
                  ) : (
                    <span className="text-sm text-stone-400">—</span>
                  )}
                </div>
                <div className="col-span-1">
                  {isUpcoming ? (
                    <button
                      onClick={() => setVideoSession(session)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
                      title="Start video session"
                    >
                      <Video size={14} />
                      Start
                    </button>
                  ) : session.notesStatus && session.notesStatus !== 'none' ? (
                    <button
                      onClick={() => setNotesSession(session)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${{
                        processing: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
                        failed: 'bg-red-50 text-red-700 hover:bg-red-100',
                        draft: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                        approved: 'bg-stone-100 text-stone-600 hover:bg-stone-200',
                        recorded: 'border border-stone-200 text-stone-600 hover:bg-stone-50',
                      }[session.notesStatus]}`}
                      title="Open transcript and notes"
                    >
                      {session.notesStatus === 'approved' ? <Check size={14} /> : <FileText size={14} />}
                      {{ processing: 'Processing…', failed: 'Notes failed', draft: 'Review notes', approved: 'Notes', recorded: 'Get notes' }[session.notesStatus]}
                    </button>
                  ) : (
                    <span className="text-sm text-stone-400">—</span>
                  )}
                </div>
                <div className="col-span-1 relative">
                  <button
                    onClick={() => setOpenMenuId(openMenuId === session.id ? null : session.id)}
                    className="p-2 rounded-lg hover:bg-stone-100 transition-colors text-stone-500"
                  >
                    <MoreVertical size={18} />
                  </button>
                  
                  {/* Dropdown Menu */}
                  {openMenuId === session.id && (
                    <div className="absolute right-0 top-10 w-60 bg-white rounded-xl shadow-lg border border-stone-200 py-2 z-10">
                      {isUpcoming && (
                        <button
                          onClick={async () => {
                            try {
                              const { clientJoinUrl } = await video.clientLink(session.id);
                              await navigator.clipboard.writeText(clientJoinUrl);
                              setCopiedId(`link-${session.id}`);
                              setTimeout(() => { setCopiedId(null); setOpenMenuId(null); }, 1200);
                            } catch (err) { setApiError(err.message); setOpenMenuId(null); }
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-2"
                        >
                          {copiedId === `link-${session.id}` ? <Check size={16} /> : <LinkIcon size={16} />}
                          {copiedId === `link-${session.id}` ? 'Link copied' : 'Copy client join link'}
                        </button>
                      )}
                      {clientMeetLink && (
                        <button
                          onClick={() => { copyMeetLink(clientMeetLink); setOpenMenuId(null); }}
                          className="w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-2"
                        >
                          <Edit2 size={16} className="invisible" />
                          Copy external meeting link
                        </button>
                      )}
                      <button
                        onClick={() => { openEditMeetLink(session.clientId); setOpenMenuId(null); }}
                        className="w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-2"
                      >
                        <Edit2 size={16} />
                        {clientMeetLink ? 'Edit external meeting link' : 'Use an external meeting link'}
                      </button>
                      {isUpcoming && (
                        <button
                          onClick={() => { setRescheduleSession(session); setOpenMenuId(null); }}
                          className="w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-2"
                        >
                          <Calendar size={16} />
                          Reschedule
                        </button>
                      )}
                      <button
                        onClick={() => { setDeleteConfirm(session); setOpenMenuId(null); }}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <Trash2 size={16} />
                        Delete Session
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
          )}
          </div>
        </div>

        {/* Edit Meet Link Modal */}
        {editMeetLinkFor && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
              <h2 className="text-2xl font-semibold text-stone-800 mb-2">Meeting Link</h2>
              <p className="text-stone-500 mb-6">Set a permanent Google Meet link for {getClient(editMeetLinkFor)?.name}</p>

              <div>
                <label className="block text-sm font-medium text-stone-600 mb-2">Google Meet Link</label>
                <input
                  type="url"
                  value={meetLinkInput}
                  onChange={(e) => setMeetLinkInput(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                  placeholder="https://meet.google.com/xxx-xxxx-xxx"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => { setEditMeetLinkFor(null); setMeetLinkInput(''); }}
                  className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveMeetLink}
                  className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
                >
                  Save Link
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reschedule Modal */}
        {rescheduleSession && (
          <RescheduleModal 
            session={rescheduleSession} 
            client={getClient(rescheduleSession.clientId)}
            onClose={() => setRescheduleSession(null)}
            onSave={handleReschedule}
          />
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                  <Trash2 size={28} className="text-red-600" />
                </div>
                <h2 className="text-xl font-semibold text-stone-800 mb-2">Delete Session?</h2>
                <p className="text-stone-500">
                  This will permanently delete the session with {getClient(deleteConfirm.clientId)?.name} on {formatDate(deleteConfirm.date)}.
                </p>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteSession(deleteConfirm.id)}
                  className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const RescheduleModal = ({ session, client, onClose, onSave }) => {
    const [newDate, setNewDate] = useState(session.date);
    const [newTime, setNewTime] = useState(session.time);

    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl">
          <h2 className="text-2xl font-semibold text-stone-800 mb-2">Reschedule Session</h2>
          <p className="text-stone-500 mb-6">Session with {client?.name}</p>
          
          <div className="bg-stone-50 rounded-xl p-4 mb-6">
            <p className="text-sm text-stone-500 mb-1">Current time</p>
            <p className="font-medium text-stone-700">{formatDate(session.date)} at {formatTime(session.time)}</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">New Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-2">New Time</label>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(newDate, newTime)}
              className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
            >
              Reschedule
            </button>
          </div>
        </div>
      </div>
    );
  };

  const PaymentsList = () => {
    const sortedPayments = [...payments].sort((a, b) => b.date.localeCompare(a.date));
    const [activeDetail, setActiveDetail] = useState(null); // 'collected', 'outstanding', 'clients'
    
    // Calculate total collected with conversion
    const totalCollected = payments.reduce((sum, p) => {
      const client = getClient(p.clientId);
      if (client?.clientType === 'international' && exchangeRate) {
        return sum + (p.amount * exchangeRate);
      }
      return sum + p.amount;
    }, 0);

    // Get clients with balance for detailed view
    const clientsWithBalance = clients.filter(c => getClientBalance(c.id) > 0).map(client => ({
      ...client,
      balance: getClientBalance(client.id),
      unpaidCount: sessions.filter(s => s.clientId === client.id && s.status === 'completed' && !s.paid && !s.prepaid).length
    }));

    // Group payments by type for breakdown
    const paymentBreakdown = {
      prepaid: payments.filter(p => p.type === 'prepaid').reduce((sum, p) => {
        const client = getClient(p.clientId);
        if (client?.clientType === 'international' && exchangeRate) return sum + (p.amount * exchangeRate);
        return sum + p.amount;
      }, 0),
      session: payments.filter(p => p.type === 'session' || p.type === 'completed').reduce((sum, p) => {
        const client = getClient(p.clientId);
        if (client?.clientType === 'international' && exchangeRate) return sum + (p.amount * exchangeRate);
        return sum + p.amount;
      }, 0),
      count: payments.length
    };

    // Interactive Stat Card
    const InteractiveStatCard = ({ icon: Icon, label, value, subtext, color, detailKey, isActive }) => (
      <div 
        onClick={() => setActiveDetail(activeDetail === detailKey ? null : detailKey)}
        className={`bg-white rounded-2xl p-6 shadow-sm border-2 cursor-pointer transition-all hover:shadow-md ${
          isActive ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-stone-200/60 hover:border-stone-300'
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-stone-500 text-sm mb-1">{label}</p>
            <p className="text-3xl font-semibold text-stone-800">{value}</p>
            {subtext && <p className="text-sm text-stone-400 mt-1">{subtext}</p>}
          </div>
          <div className={`p-3 rounded-xl ${color}`}>
            <Icon size={24} className="text-white" />
          </div>
        </div>
        <div className={`mt-3 pt-3 border-t border-stone-100 text-xs text-emerald-600 font-medium ${isActive ? '' : ''}`}>
          {isActive ? '▲ Click to collapse' : '▼ Click for details'}
        </div>
      </div>
    );

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-stone-800">Payments</h1>
          <button 
            onClick={() => setShowAddModal('payment')}
            className="flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
          >
            <Plus size={20} />
            Record Payment
          </button>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <InteractiveStatCard 
            icon={RupeeIcon} 
            label="Total Collected" 
            value={`₹${Math.round(totalCollected).toLocaleString()}`}
            subtext={`${payments.length} payment${payments.length !== 1 ? 's' : ''}`}
            color="bg-emerald-500"
            detailKey="collected"
            isActive={activeDetail === 'collected'}
          />
          <InteractiveStatCard 
            icon={Bell} 
            label="Outstanding" 
            value={`₹${Math.round(getTotalOutstanding()).toLocaleString()}`}
            subtext={`From ${clientsWithBalance.length} client${clientsWithBalance.length !== 1 ? 's' : ''}`}
            color="bg-amber-500"
            detailKey="outstanding"
            isActive={activeDetail === 'outstanding'}
          />
          <InteractiveStatCard 
            icon={Users} 
            label="Clients with Balance" 
            value={clientsWithBalance.length}
            subtext={clientsWithBalance.length > 0 ? "Needs follow-up" : "All clear!"}
            color="bg-blue-500"
            detailKey="clients"
            isActive={activeDetail === 'clients'}
          />
        </div>

        {/* Detail Panels */}
        {activeDetail === 'collected' && (
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl p-6 border border-emerald-200 animate-in slide-in-from-top-2 duration-200">
            <h3 className="text-lg font-semibold text-emerald-800 mb-4 flex items-center gap-2">
              <RupeeIcon size={20} />
              Collection Breakdown
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white/80 rounded-xl p-4">
                <p className="text-sm text-stone-500">From Prepaid Packages</p>
                <p className="text-2xl font-semibold text-emerald-700 mt-1">₹{Math.round(paymentBreakdown.prepaid).toLocaleString()}</p>
                <p className="text-xs text-stone-400 mt-1">{payments.filter(p => p.type === 'prepaid').length} prepaid purchases</p>
              </div>
              <div className="bg-white/80 rounded-xl p-4">
                <p className="text-sm text-stone-500">From Session Payments</p>
                <p className="text-2xl font-semibold text-emerald-700 mt-1">₹{Math.round(paymentBreakdown.session).toLocaleString()}</p>
                <p className="text-xs text-stone-400 mt-1">{payments.filter(p => p.type === 'session' || p.type === 'completed').length} session payments</p>
              </div>
              <div className="bg-white/80 rounded-xl p-4">
                <p className="text-sm text-stone-500">This Month's Revenue</p>
                <p className="text-2xl font-semibold text-emerald-700 mt-1">₹{getThisMonthStats().revenue.toLocaleString()}</p>
                <p className="text-xs text-stone-400 mt-1">{getThisMonthStats().sessions} sessions completed</p>
              </div>
            </div>
            {payments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-emerald-200">
                <p className="text-sm text-emerald-700 font-medium mb-2">Recent Collections</p>
                <div className="space-y-2">
                  {sortedPayments.slice(0, 3).map(p => {
                    const client = getClient(p.clientId);
                    return (
                      <div key={p.id} className="flex items-center justify-between text-sm bg-white/60 rounded-lg px-3 py-2">
                        <span className="text-stone-700">{client?.name} • {formatDate(p.date)}</span>
                        <span className="font-medium text-emerald-700">{formatCurrency(p.amount, client?.clientType)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {activeDetail === 'outstanding' && (
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-6 border border-amber-200 animate-in slide-in-from-top-2 duration-200">
            <h3 className="text-lg font-semibold text-amber-800 mb-4 flex items-center gap-2">
              <Bell size={20} />
              Outstanding Breakdown by Client
            </h3>
            {clientsWithBalance.length > 0 ? (
              <div className="space-y-3">
                {clientsWithBalance.map(client => {
                  const unpaidSessions = sessions.filter(s => 
                    s.clientId === client.id && s.status === 'completed' && !s.paid && !s.prepaid
                  );
                  return (
                    <div key={client.id} className="bg-white/80 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-medium text-sm">
                            {client.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div>
                            <p className="font-medium text-stone-800">{client.name}</p>
                            <p className="text-xs text-stone-500">{CLIENT_TYPES[client.clientType]?.label}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-semibold text-amber-700">{formatCurrency(client.balance, client.clientType)}</p>
                          <p className="text-xs text-stone-500">{client.unpaidCount} unpaid session{client.unpaidCount > 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-amber-100">
                        <p className="text-xs text-stone-500 mb-1">Unpaid sessions:</p>
                        <div className="flex flex-wrap gap-1">
                          {unpaidSessions.slice(0, 5).map(s => (
                            <span key={s.id} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                              {formatDate(s.date)}
                            </span>
                          ))}
                          {unpaidSessions.length > 5 && (
                            <span className="text-xs text-stone-500">+{unpaidSessions.length - 5} more</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-amber-700">
                <Check size={40} className="mx-auto mb-3 opacity-50" />
                <p>No outstanding balances! 🎉</p>
              </div>
            )}
          </div>
        )}

        {activeDetail === 'clients' && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200 animate-in slide-in-from-top-2 duration-200">
            <h3 className="text-lg font-semibold text-blue-800 mb-4 flex items-center gap-2">
              <Users size={20} />
              Clients Needing Follow-up
            </h3>
            {clientsWithBalance.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-white/80 rounded-xl p-4">
                    <p className="text-sm text-stone-500">Total Clients with Balance</p>
                    <p className="text-3xl font-semibold text-blue-700 mt-1">{clientsWithBalance.length}</p>
                  </div>
                  <div className="bg-white/80 rounded-xl p-4">
                    <p className="text-sm text-stone-500">Total Unpaid Sessions</p>
                    <p className="text-3xl font-semibold text-blue-700 mt-1">
                      {clientsWithBalance.reduce((sum, c) => sum + c.unpaidCount, 0)}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {clientsWithBalance
                    .sort((a, b) => b.balance - a.balance)
                    .map((client, idx) => (
                    <div 
                      key={client.id} 
                      className="flex items-center justify-between bg-white/80 rounded-xl px-4 py-3 hover:bg-white transition-colors cursor-pointer"
                      onClick={() => setSelectedClient(client)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold text-blue-600 w-6">#{idx + 1}</span>
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-medium text-xs">
                          {client.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <p className="font-medium text-stone-800">{client.name}</p>
                          <p className="text-xs text-stone-500">{client.unpaidCount} session{client.unpaidCount > 1 ? 's' : ''} unpaid</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold text-amber-600">{formatCurrency(client.balance, client.clientType)}</span>
                        <ChevronRight size={18} className="text-stone-400" />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-blue-700">
                <Check size={40} className="mx-auto mb-3 opacity-50" />
                <p>All clients are paid up! Great job! 🌟</p>
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200/60 overflow-hidden">
          <div className="grid grid-cols-12 gap-4 p-4 border-b border-stone-200 bg-stone-50 text-sm font-medium text-stone-500">
            <div className="col-span-4">Client</div>
            <div className="col-span-3">Date</div>
            <div className="col-span-2">Method</div>
            <div className="col-span-3">Amount</div>
          </div>
          {sortedPayments.map(payment => {
            const client = getClient(payment.clientId);
            const isPrepaid = payment.type === 'prepaid';
            const isSession = payment.type === 'session';
            return (
              <div key={payment.id} className="grid grid-cols-12 gap-4 p-4 border-b border-stone-100 hover:bg-stone-50 transition-colors items-center">
                <div className="col-span-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-medium text-sm">
                    {client?.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <span className="font-medium text-stone-800">{client?.name}</span>
                    {isPrepaid && (
                      <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
                        Prepaid {payment.sessionsCredit} session{payment.sessionsCredit > 1 ? 's' : ''}
                      </span>
                    )}
                    {isSession && (
                      <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                        Session
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-span-3 text-stone-600">{formatDate(payment.date)}</div>
                <div className="col-span-2">
                  <span className="inline-flex px-3 py-1 rounded-full text-sm font-medium bg-stone-100 text-stone-600">
                    {payment.method}
                  </span>
                </div>
                <div className="col-span-3 text-lg font-semibold text-emerald-600">
                  {formatCurrency(payment.amount, getClient(payment.clientId)?.clientType)}
                </div>
              </div>
            );
          })}
          {payments.length === 0 && (
            <div className="text-center py-12 text-stone-400">
              <RupeeIcon size={40} className="mx-auto mb-3 opacity-50" />
              <p>No payments recorded yet</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const CalendarView = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    const getSessionsForDay = (day) => {
      if (!day) return [];
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return sessions.filter(s => s.date === dateStr);
    };

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-stone-800">Calendar</h1>
          <button 
            onClick={() => setShowAddModal('session')}
            className="flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
          >
            <Plus size={20} />
            Schedule Session
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200/60 p-6">
          <div className="flex items-center justify-between mb-6">
            <button 
              onClick={() => setCurrentDate(new Date(year, month - 1))}
              className="p-2 rounded-lg hover:bg-stone-100 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-xl font-semibold text-stone-800">{monthNames[month]} {year}</h2>
            <button 
              onClick={() => setCurrentDate(new Date(year, month + 1))}
              className="p-2 rounded-lg hover:bg-stone-100 transition-colors rotate-180"
            >
              <ArrowLeft size={20} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-sm font-medium text-stone-500 py-2">
                {day}
              </div>
            ))}
            {days.map((day, idx) => {
              const daySessions = getSessionsForDay(day);
              const isToday = day && new Date().toDateString() === new Date(year, month, day).toDateString();
              
              return (
                <div 
                  key={idx} 
                  className={`min-h-24 p-2 rounded-xl border transition-colors ${
                    day ? 'border-stone-200 hover:border-emerald-300' : 'border-transparent'
                  } ${isToday ? 'bg-emerald-50 border-emerald-300' : ''}`}
                >
                  {day && (
                    <>
                      <span className={`text-sm font-medium ${isToday ? 'text-emerald-700' : 'text-stone-600'}`}>
                        {day}
                      </span>
                      <div className="mt-1 space-y-1">
                        {daySessions.slice(0, 3).map(session => {
                          const client = getClient(session.clientId);
                          return (
                            <div 
                              key={session.id}
                              className={`text-xs p-1 rounded truncate ${
                                session.status === 'completed' 
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}
                            >
                              {formatTime(session.time)} {client?.name.split(' ')[0]}
                            </div>
                          );
                        })}
                        {daySessions.length > 3 && (
                          <div className="text-xs text-stone-500">+{daySessions.length - 3} more</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 via-stone-50 to-emerald-50/30" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-stone-200/60 p-6 flex flex-col">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <span className="text-white font-bold text-lg">T</span>
          </div>
          <span className="text-xl font-semibold text-stone-800">TherapyDesk</span>
        </div>
        
        <nav className="space-y-2 flex-1">
          <NavItem icon={Calendar} label="Dashboard" view="dashboard" />
          <NavItem icon={Users} label="Clients" view="clients" />
          <NavItem icon={Clock} label="Sessions" view="sessions" />
          <NavItem icon={RupeeIcon} label="Payments" view="payments" />
          <NavItem icon={Calendar} label="Calendar" view="calendar" />
        </nav>

        <div className="pt-6 border-t border-stone-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white font-medium">
              {therapist.fullName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-stone-800 text-sm truncate">{therapist.fullName}</p>
              <p className="text-xs text-stone-400">Therapist</p>
            </div>
            <button onClick={onSignOut} aria-label="Sign out" title="Sign out" className="p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 p-8">
        {apiError && (
          <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{apiError}</span>
            <button onClick={() => setApiError('')} aria-label="Dismiss" className="text-red-500 hover:text-red-700"><X size={16} /></button>
          </div>
        )}
        {selectedClient ? (
          <ClientDetail client={selectedClient} />
        ) : (
          <>
            {activeView === 'dashboard' && <Dashboard />}
            {activeView === 'clients' && <ClientsList />}
            {activeView === 'sessions' && <SessionsList />}
            {activeView === 'payments' && <PaymentsList />}
            {activeView === 'calendar' && <CalendarView />}
          </>
        )}
      </main>

      {/* Modals */}
      {showAddModal === 'client' && <AddClientModal />}
      {showAddModal === 'session' && <AddSessionModal />}
      {showAddModal === 'payment' && <RecordPaymentModal />}
      {videoSession && (
        <TherapistRoom
          session={videoSession}
          clientName={getClient(videoSession.clientId)?.name || 'Client'}
          onClose={() => setVideoSession(null)}
        />
      )}
      {notesSession && (
        <NotesPanel
          session={notesSession}
          clientName={getClient(notesSession.clientId)?.name || 'Client'}
          onClose={() => { setNotesSession(null); run(practice.state()); }}
        />
      )}
    </div>
  );
}