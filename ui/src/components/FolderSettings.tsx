import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { TlDrawNote } from '../types/TlDraw';
import './SettingsPane.css';

const BASE_URL = import.meta.env.BASE_URL;

interface Invite {
  noteId: string;
  inviterNodeId: string;
  noteName: string;
}

interface FolderSettingsProps {
  onClose: () => void;
  onNoteUpdated: (note: TlDrawNote) => void;
}

const FolderSettings: React.FC<FolderSettingsProps> = ({ onClose, onNoteUpdated }) => {
  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

  // Fetch pending invites on mount
  useEffect(() => {
    fetchInvites();
  }, []);

  // Apply dark mode
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', darkMode.toString());
  }, [darkMode]);

  const fetchInvites = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify({ GetInvites: null }),
      });
      const data = await response.json();
      if (data.GetInvites?.Ok) {
        setPendingInvites(data.GetInvites.Ok.map((invite: any) => ({
          noteId: invite.note_id,
          inviterNodeId: invite.inviter_node_id,
          noteName: invite.note_name,
        })));
      }
    } catch (error) {
      console.error('Failed to fetch invites:', error);
      setError('Failed to fetch invites');
    }
  };

  const handleInviteResponse = async (noteId: string, inviterNodeId: string, accept: boolean) => {
    try {
      const action = accept ? 'AcceptInvite' : 'RejectInvite';
      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify({ [action]: [noteId, inviterNodeId] }),
      });
      const data = await response.json();
      if (data[action]?.Ok) {
        // Refresh invites list
        fetchInvites();
        if (accept) {
          // If we accepted, the note should appear in our list
          onNoteUpdated(data[action].Ok);
        }
      } else {
        setError(data[action]?.Err || `Failed to ${accept ? 'accept' : 'reject'} invite`);
      }
    } catch (error) {
      console.error('Failed to handle invite:', error);
      setError(`Failed to ${accept ? 'accept' : 'reject'} invite`);
    }
  };

  return (
    <div className="settings-pane">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="close-button" onClick={onClose}>
          <X size={24} />
        </button>
      </div>

      {error && (
        <div className="error-message" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="settings-section">
        <h3>Appearance</h3>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={darkMode}
            onChange={(e) => setDarkMode(e.target.checked)}
          />
          Dark Mode
        </label>
      </div>

      <div className="settings-section">
        <h3>Pending Invites</h3>
        <div className="invite-list">
          {pendingInvites.map((invite) => (
            <div key={`${invite.noteId}-${invite.inviterNodeId}`} className="invite-item">
              <span>Note: {invite.noteName}</span>
              <span>From: {invite.inviterNodeId}</span>
              <div className="invite-actions">
                <button onClick={() => handleInviteResponse(invite.noteId, invite.inviterNodeId, true)}>
                  Accept
                </button>
                <button onClick={() => handleInviteResponse(invite.noteId, invite.inviterNodeId, false)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
          {pendingInvites.length === 0 && (
            <div className="no-invites">No pending invites</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FolderSettings;