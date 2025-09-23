import React, { useState, useRef, useEffect } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import NoteItem from './NoteItem';
import { TlDrawNote } from '../types/TlDraw';

type NoteType = TlDrawNote;

type FolderType = {
  id: string;
  name: string;
};

interface DraggingType {
  type: 'folder' | 'note';
  id: string;
}

interface FolderItemProps {
  folder: FolderType;
  depth: number;
  getChildFolders: (id: string) => FolderType[];
  getChildNotes: (id: string | null) => NoteType[];
  onDrop: (e: React.DragEvent, targetId: string | null) => void;
  setDragging: (dragging: DraggingType | undefined) => void;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  renderFolder: (folder: FolderType, depth: number) => JSX.Element;
  setCurrentNote: (note?: NoteType) => void;
  setView: (view: 'folder' | 'tldraw') => void;
  renameNote: (id: string, name: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  isNewFolder?: boolean;
}

const FolderItem: React.FC<FolderItemProps> = ({
  folder,
  depth,
  getChildFolders,
  getChildNotes,
  onDrop,
  setDragging,
  renameFolder,
  deleteFolder,
  renderFolder,
  setCurrentNote,
  setView,
  renameNote,
  deleteNote,
  isNewFolder = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(isNewFolder);
  const [editName, setEditName] = useState(folder.name);
  const [touchData, setTouchData] = useState<{ timer: NodeJS.Timeout | null; isDragging: boolean }>({
    timer: null,
    isDragging: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLDivElement>(null);

  const childFolders = getChildFolders(folder.id);
  const childNotes = getChildNotes(folder.id);
  const hasChildren = childFolders.length > 0 || childNotes.length > 0;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      // Use requestAnimationFrame for better timing
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      });
    }
  }, [isEditing]);

  // Also focus when component mounts if it's a new folder
  useEffect(() => {
    if (isNewFolder && inputRef.current) {
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      });
    }
  }, [isNewFolder]);

  const handleSaveEdit = async () => {
    if (editName.trim() && editName !== folder.name) {
      await renameFolder(folder.id, editName);
    } else {
      setEditName(folder.name);
    }
    setIsEditing(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault(); // Prevent default touch behavior

    const touch = e.touches[0];
    const startX = touch.clientX;
    const startY = touch.clientY;

    const timer = setTimeout(() => {
      setTouchData(prev => ({ ...prev, isDragging: true }));
      setDragging({ type: 'folder', id: folder.id });

      // Add visual feedback
      if (folderRef.current) {
        folderRef.current.style.opacity = '0.5';
      }

      // Vibrate if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }

      // Create a drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `📁 ${folder.name}`;
      dragImage.style.position = 'fixed';
      dragImage.style.left = `${startX}px`;
      dragImage.style.top = `${startY}px`;
      dragImage.style.zIndex = '9999';
      dragImage.style.pointerEvents = 'none';
      dragImage.style.opacity = '0.8';
      dragImage.style.padding = '8px';
      dragImage.style.background = 'var(--bg-primary)';
      dragImage.style.border = '1px solid var(--border-color)';
      dragImage.style.borderRadius = '4px';
      dragImage.id = `drag-image-${folder.id}`;
      document.body.appendChild(dragImage);
    }, 500);

    setTouchData({ timer, isDragging: false });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchData.isDragging) return;

    const touch = e.touches[0];

    // Move drag image
    const dragImage = document.getElementById(`drag-image-${folder.id}`);
    if (dragImage) {
      dragImage.style.left = `${touch.clientX}px`;
      dragImage.style.top = `${touch.clientY}px`;
    }

    // Find drop target
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    const droppableFolder = element?.closest('.folder, .folder-container');

    // Clear previous drag-over states
    document.querySelectorAll('.drag-over').forEach(el => {
      if (el !== droppableFolder) {
        el.classList.remove('drag-over');
      }
    });

    if (droppableFolder && droppableFolder !== folderRef.current) {
      droppableFolder.classList.add('drag-over');
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // Clear timer if still waiting
    if (touchData.timer) {
      clearTimeout(touchData.timer);
    }

    // Remove drag image
    const dragImage = document.getElementById(`drag-image-${folder.id}`);
    if (dragImage) {
      dragImage.remove();
    }

    // Reset opacity
    if (folderRef.current) {
      folderRef.current.style.opacity = '1';
    }

    if (touchData.isDragging) {
      // Find drop target
      const touch = e.changedTouches[0];
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      const droppableFolder = element?.closest('.folder, .folder-container');

      if (droppableFolder) {
        droppableFolder.classList.remove('drag-over');

        // Trigger drop
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
        });
        droppableFolder.dispatchEvent(dropEvent);
      }

      setDragging(undefined);
    }

    setTouchData({ timer: null, isDragging: false });
  };

  return (
    <div
      ref={folderRef}
      className={`folder ${isDragOver ? 'drag-over' : ''} ${!isExpanded && hasChildren ? 'collapsed' : ''}`}
      style={{ marginLeft: `${depth * 20}px` }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragOver) setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        onDrop(e, folder.id);
      }}
    >
      <div className="folder-header">
        <div className="folder-name">
          <span
            className="folder-icon"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '📂' : '📁'}
          </span>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveEdit();
                } else if (e.key === 'Escape') {
                  setEditName(folder.name);
                  setIsEditing(false);
                }
              }}
              className="inline-edit"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="folder-text"
              draggable={!isEditing}
              onDragStart={() => setDragging({ type: 'folder', id: folder.id })}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {folder.name}
            </span>
          )}
        </div>
        <div className="actions">
          <button
            className="icon-button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            <Pencil size={16} />
          </button>
          <button
            className="icon-button"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm('Delete this folder?')) {
                deleteFolder(folder.id).catch(err => console.error('Failed to delete folder:', err));
              }
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="folder-contents">
          {childFolders.map((f) => renderFolder(f, depth + 1))}
          {childNotes.map((note) => (
            <div key={note.id}>
              <NoteItem
                note={note}
                onSelect={() => {
                  setCurrentNote(note);
                  setView('tldraw');
                }}
                onDragStart={() => setDragging({ type: 'note', id: note.id })}
                onRename={renameNote}
                onDelete={deleteNote}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FolderItem;
