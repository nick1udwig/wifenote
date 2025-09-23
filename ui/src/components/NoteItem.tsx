import React, { useState, useRef, useEffect } from 'react';
import { TlDrawNote } from '../types/TlDraw';
import { Pencil, Trash2 } from 'lucide-react';

interface NoteItemProps {
  note: TlDrawNote;
  onSelect: (note: TlDrawNote) => void;
  onDragStart: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  className?: string;
  isNewNote?: boolean;
}

const NoteItem: React.FC<NoteItemProps> = ({
  note,
  onSelect,
  onDragStart,
  onRename,
  onDelete,
  className = '',
  isNewNote = false,
}) => {
  const [isEditing, setIsEditing] = useState(isNewNote);
  const [editName, setEditName] = useState(note.name);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);

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

  // Also focus when component mounts if it's a new note
  useEffect(() => {
    if (isNewNote && inputRef.current) {
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      });
    }
  }, [isNewNote]);

  const handleSaveEdit = async () => {
    if (editName.trim() && editName !== note.name) {
      await onRename(note.id, editName);
    } else {
      setEditName(note.name);
    }
    setIsEditing(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault(); // Prevent default touch behavior

    const touch = e.touches[0];
    const startX = touch.clientX;
    const startY = touch.clientY;

    const timer = setTimeout(() => {
      setIsDragging(true);
      onDragStart();

      // Add visual feedback
      if (noteRef.current) {
        noteRef.current.style.opacity = '0.5';
      }

      // Vibrate if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }

      // Create a drag image
      const dragImage = document.createElement('div');
      dragImage.textContent = `${note.type === 'Tldraw' ? '✏️' : '📝'} ${note.name}`;
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
      dragImage.id = `drag-image-${note.id}`;
      document.body.appendChild(dragImage);
    }, 500); // 500ms long press
    setLongPressTimer(timer);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // Clear timer if still waiting
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }

    // Remove drag image
    const dragImage = document.getElementById(`drag-image-${note.id}`);
    if (dragImage) {
      dragImage.remove();
    }

    // Reset opacity
    if (noteRef.current) {
      noteRef.current.style.opacity = '1';
    }

    if (isDragging) {
      // Find drop target
      const touch = e.changedTouches[0];
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      const droppableTarget = element?.closest('.folder, .folder-container');

      if (droppableTarget) {
        droppableTarget.classList.remove('drag-over');

        // Trigger drop
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
        });
        droppableTarget.dispatchEvent(dropEvent);
      }

      setIsDragging(false);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;

    const touch = e.touches[0];

    // Move drag image
    const dragImage = document.getElementById(`drag-image-${note.id}`);
    if (dragImage) {
      dragImage.style.left = `${touch.clientX}px`;
      dragImage.style.top = `${touch.clientY}px`;
    }

    // Find drop target
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    const droppableTarget = element?.closest('.folder, .folder-container');

    // Clear previous drag-over states
    document.querySelectorAll('.drag-over').forEach(el => {
      if (el !== droppableTarget) {
        el.classList.remove('drag-over');
      }
    });

    if (droppableTarget && droppableTarget !== noteRef.current?.closest('.folder')) {
      droppableTarget.classList.add('drag-over');
    }
  };

  return (
    <div
      ref={noteRef}
      className={`note ${className} ${isDragging ? 'dragging' : ''}`}
      draggable={!isEditing}
      onDragStart={onDragStart}
    >
      <div
        className="note-content"
        onClick={() => !isEditing && onSelect(note)}
      >
        <div className="note-name">
          <span className="note-icon">
            {note.type === 'Tldraw' ? '✏️' : '📝'}
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
                  setEditName(note.name);
                  setIsEditing(false);
                }
              }}
              className="inline-edit"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="note-text"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
            >
              {note.name}
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
              if (window.confirm('Delete this note?')) {
                onDelete(note.id).catch(err => console.error('Failed to delete note:', err));
              }
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default NoteItem;
