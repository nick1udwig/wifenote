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

interface SettingsPaneProps {
  note: TlDrawNote;
  onClose: () => void;
  onNoteUpdated: (note: TlDrawNote) => void;
}

const SettingsPane: React.FC<SettingsPaneProps> = ({ note, onClose, onNoteUpdated }) => {
  const [isPublic, setIsPublic] = useState(note.isPublic);
  const [newCollaborator, setNewCollaborator] = useState('');
  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const [darkMode, setDarkMode] = useState(() => {
    const override = localStorage.getItem('darkMode');
    return override ? override === 'true' : darkModeMediaQuery.matches;
  });

  // Handle system theme changes
  useEffect(() => {
    const handleThemeChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('darkMode')) {
        setDarkMode(e.matches);
      }
    };
    darkModeMediaQuery.addEventListener('change', handleThemeChange);
    return () => darkModeMediaQuery.removeEventListener('change', handleThemeChange);
  }, []);

  // Fetch pending invites on mount
  useEffect(() => {
    fetchInvites();
  }, []);

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

  const handlePublicToggle = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify({ SetNotePublic: [note.id, !isPublic] }),
      });
      const data = await response.json();
      if (data.SetNotePublic?.Ok) {
        setIsPublic(!isPublic);
        // Keep the same type when updating the note's public status
        const updatedNote = {
          ...data.SetNotePublic.Ok,
          type: note.type
        };
        onNoteUpdated(updatedNote);
      } else {
        setError(data.SetNotePublic?.Err || 'Failed to update note visibility');
      }
    } catch (error) {
      console.error('Failed to toggle public status:', error);
      setError('Failed to update note visibility');
    }
  };

  const handleInviteCollaborator = async () => {
    if (!newCollaborator.trim()) return;

    try {
      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify({ InviteCollaborator: [note.id, newCollaborator] }),
      });
      const data = await response.json();
      if (data.InviteCollaborator?.Ok) {
        setNewCollaborator('');
        onNoteUpdated(data.InviteCollaborator.Ok);
      } else {
        setError(data.InviteCollaborator?.Err || 'Failed to invite collaborator');
      }
    } catch (error) {
      console.error('Failed to invite collaborator:', error);
      setError('Failed to invite collaborator');
    }
  };

  const handleRemoveCollaborator = async (nodeId: string) => {
    try {
      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify({ RemoveCollaborator: [note.id, nodeId] }),
      });
      const data = await response.json();
      if (data.RemoveCollaborator?.Ok) {
        onNoteUpdated(data.RemoveCollaborator.Ok);
      } else {
        setError(data.RemoveCollaborator?.Err || 'Failed to remove collaborator');
      }
    } catch (error) {
      console.error('Failed to remove collaborator:', error);
      setError('Failed to remove collaborator');
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

  // Apply dark mode and save override only when explicitly changed
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  return (
    <div className="settings-pane">
      <div className="settings-header">
        <h2>Note Settings</h2>
        <button className="close-button" onClick={onClose}>
          <X size={24} />
        </button>
      </div>

      <div className="settings-section">
        <h3>Appearance</h3>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={darkMode}
            onChange={(e) => {
              setDarkMode(e.target.checked);
              localStorage.setItem('darkMode', e.target.checked.toString());
            }}
          />
          Dark Mode
        </label>
      </div>

      {error && (
        <div className="error-message" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="settings-section">
        <h3>Visibility</h3>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={handlePublicToggle}
          />
          Public Note
        </label>
        {isPublic && (
          <div className="public-link">
            Share link: {window.location.origin}{BASE_URL}/public/{note.id}
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>Collaborators</h3>
        <div className="collaborator-list">
          {note.collaborators.map((nodeId) => (
            <div key={nodeId} className="collaborator-item">
              <span>{nodeId}</span>
              <button onClick={() => handleRemoveCollaborator(nodeId)}>Remove</button>
            </div>
          ))}
        </div>
        <div className="invite-form">
          <input
            type="text"
            value={newCollaborator}
            onChange={(e) => setNewCollaborator(e.target.value)}
            placeholder="Enter node ID"
          />
          <button onClick={handleInviteCollaborator}>Invite</button>
        </div>
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

export default SettingsPane;