import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TlDrawNote, ImportRequest } from '../types/TlDraw';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Apply dark mode
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
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

  const handleExport = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify({ ExportAll: null }),
      });

      if (!response.ok) throw new Error('Failed to export');

      const data = await response.json();
      if (!data.ExportAll?.Ok) {
        throw new Error('Export failed: ' + (data.ExportAll?.Err || 'Unknown error'));
      }

      // Create a Uint8Array from the compressed data
      const compressedData = new Uint8Array(data.ExportAll.Ok);
      const blob = new Blob([compressedData], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'wifenote-export.json.gz';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      setError(error instanceof Error ? error.message : 'Failed to export');
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const compressedData = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(compressedData));

      const request: ImportRequest = { ImportAll: bytes };

      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify(request),
      });

      const result = await response.json();
      if (result.ImportAll?.Err) {
        throw new Error('Import failed: ' + result.ImportAll.Err);
      }

      if (!response.ok) throw new Error('Failed to import');
      event.target.value = '';

      // Refresh the structure after import
      onNoteUpdated({} as TlDrawNote);
    } catch (error) {
      console.error('Import failed:', error);
      setError(error instanceof Error ? error.message : 'Failed to import file');
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
            onChange={(e) => {
              setDarkMode(e.target.checked);
              localStorage.setItem('darkMode', e.target.checked.toString());
            }}
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

      <div className="settings-section">
        <h3>Data Management</h3>
        <div className="data-management-buttons">
          <button onClick={handleExport} className="export-button">
            <span className="material-icons">upload</span>
            Export All Data
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="import-button">
            <span className="material-icons">download</span>
            Import Data
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json.gz,.json"
            style={{ display: 'none' }}
            onChange={handleImport}
          />
        </div>
      </div>
    </div>
  );
};

export default FolderSettings;
