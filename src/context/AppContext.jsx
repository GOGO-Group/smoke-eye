import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { escapeHtml } from '../utils/sanitize';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [view, setView] = useState('role');
  const [role, setRole] = useState(null);
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState({ hotkeys: {}, webpages: [] });
  const [themeMode, setThemeMode] = useState('dark');

  // interviewer state
  const [stickyNotes, setStickyNotes] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [messages, setMessages] = useState([]);
  const [focus, setFocus] = useState('caption');
  const [toast, setToast] = useState(null);
  const [badge, setBadge] = useState(false);

  // support state
  const [receivedStickies, setReceivedStickies] = useState([]);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [shownStickyId, setShownStickyId] = useState(null);

  const currentStickyIdx = useRef(0);
  const msgCounter = useRef(0);
  const roleRef = useRef(null);
  roleRef.current = role;

  // ---------- send message ----------
  const sendMsg = useCallback((text, html) => {
    const r = roleRef.current;
    if (!text?.trim()) return;
    const id = `${r}-${Date.now()}-${msgCounter.current++}`;
    const payload = { type: 'msg', id, from: r, text, html: html || escapeHtml(text) };
    setMessages(m => [...m, payload]);
    window.api.sendMessage(payload);
  }, []);

  const sendRaw = useCallback((payload) => window.api.sendMessage(payload), []);

  // ---------- sticky navigation ----------
  const showStickyAt = useCallback((idx) => {
    setStickyNotes(notes => {
      if (notes.length === 0) return notes;
      const i = ((idx % notes.length) + notes.length) % notes.length;
      currentStickyIdx.current = i;
      window.api.showSticky(notes[i]);
      return notes;
    });
  }, []);

  // ---------- capture ----------
  const doCapture = useCallback(async () => {
    const res = await window.api.captureArea();
    if (res?.ok) setToast({ text: 'Screenshot copied to clipboard', html: res.dataURL });
  }, []);

  // ---------- init ----------
  useEffect(() => {
    window.api.getSettings().then(s => {
      setSettings(s);
      if (s.themeMode) setThemeMode(s.themeMode);
    });

    window.api.onPeerStatus((s) => setConnected(!!s.connected));

    window.api.onChatMessage(async (msg) => {
      const r = roleRef.current;

      if (msg.type === 'msg') {
        setMessages(m => [...m, msg]);
        if (r === 'interviewer') {
          setBadge(true);
          setTimeout(() => setBadge(false), 3000);
          setFocus(f => {
            if (f !== 'chat') setToast({ text: msg.text, html: msg.html });
            return f;
          });
        }
      } else if (msg.type === 'edit') {
        setMessages(m => m.map(x => x.id === msg.id ? { ...x, html: msg.html } : x));
      } else if (msg.type === 'delete') {
        setMessages(m => m.filter(x => x.id !== msg.id));
      } else if (msg.type === 'clear') {
        setMessages([]);
      } else if (msg.type === 'sticky-list' && r === 'support') {
        setReceivedStickies(msg.notes || []);
      } else if (msg.type === 'show-sticky' && r === 'interviewer') {
        window.api.showSticky(msg.note);
      } else if (msg.type === 'hide-sticky' && r === 'interviewer') {
        window.api.hideSticky();
      } else if (msg.type === 'sticky-add' && r === 'interviewer') {
        setStickyNotes(n => [...n, msg.note]);
      } else if (msg.type === 'sticky-update' && r === 'interviewer') {
        setStickyNotes(n => {
          const idx = n.findIndex(x => x.id === msg.note.id);
          if (idx >= 0) { const c = [...n]; c[idx] = msg.note; return c; }
          return [...n, msg.note];
        });
        window.api.updateStickyContent(msg.note);
      } else if (msg.type === 'sticky-delete' && r === 'interviewer') {
        setStickyNotes(n => n.filter(x => x.id !== msg.id));
      } else if (msg.type === 'file-list' && r === 'support') {
        setReceivedFiles(msg.files || []);
      } else if (msg.type === 'request-file' && r === 'interviewer') {
        setUploadedFiles(files => {
          const f = files[msg.index];
          if (f) {
            window.api.readFile(f.path).then(res => {
              if (res.ok) window.api.sendMessage({ type: 'file-data', name: f.name, data: res.data });
            });
          }
          return files;
        });
      } else if (msg.type === 'file-data' && r === 'support') {
        await window.api.saveFile({ name: msg.name, data: msg.data });
      }
    });

    window.api.onHotkeyAction((a) => {
      const r = roleRef.current;
      if (a.action === 'focusPanel' && r === 'interviewer') setFocus(a.panel);
      else if (a.action === 'toggleSticky' && r === 'interviewer') showStickyAt(currentStickyIdx.current);
      else if (a.action === 'navSticky' && r === 'interviewer') showStickyAt(currentStickyIdx.current + a.dir);
      else if (a.action === 'captureArea' && r === 'interviewer') doCapture();
      else if (a.action === 'helpRequest') sendMsg('🆘 Help request', '<b>🆘 Help request</b>');
      else if (a.action === 'opacityUp' || a.action === 'opacityDown')
        window.dispatchEvent(new CustomEvent('opacity-hotkey', { detail: a.action }));
    });
  }, [showStickyAt, doCapture, sendMsg]);

  // Sync to support on connect
  useEffect(() => {
    if (connected && role === 'interviewer') {
      if (stickyNotes.length > 0) sendRaw({ type: 'sticky-list', notes: stickyNotes });
      if (uploadedFiles.length > 0)
        sendRaw({ type: 'file-list', files: uploadedFiles.map(f => ({ name: f.name, type: f.type })) });
    }
  }, [connected, role]);

  const saveSettings = async (next) => {
    const s = await window.api.setSettings(next);
    setSettings(s);
    if (s.themeMode) setThemeMode(s.themeMode);
    return s;
  };

  const toggleTheme = async () => {
    const next = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    await window.api.setSettings({ themeMode: next });
  };

  const value = {
    view, setView, role, setRole, connected,
    settings, setSettings, saveSettings,
    stickyNotes, setStickyNotes, uploadedFiles, setUploadedFiles,
    messages, setMessages, focus, setFocus,
    toast, setToast, badge,
    receivedStickies, setReceivedStickies, receivedFiles,
    shownStickyId, setShownStickyId,
    sendMsg, sendRaw, showStickyAt, doCapture,
    currentStickyIdx,
    themeMode, toggleTheme,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
