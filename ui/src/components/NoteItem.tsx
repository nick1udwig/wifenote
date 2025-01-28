import React from 'react';
import { TlDrawNote } from '../types/TlDraw';
import { Pencil, Trash2 } from 'lucide-react';

interface NoteItemProps {
  note: TlDrawNote;
  onSelect: (note: TlDrawNote) => void;
  onDragStart: () => void;
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
  className?: string;
}

const NoteItem: React.FC<NoteItemProps> = ({
  note,
  onSelect,
  onDragStart,
  onRename,
  onDelete,
  className = '',
  onTouchStart,
}) => {
  return (
    <div
      className={`note ${className}`}
      draggable
      onDragStart={onDragStart}
      onTouchStart={onTouchStart}
    >
      <div
        className="note-content"
        onClick={() => onSelect(note)}
      >
        <div className="note-name">
          {note.type === 'Tldraw' ? '✏️' : '📝'} {note.name}
        </div>
        <div className="actions">
          <button
            className="icon-button"
            onClick={async (e) => {
              e.stopPropagation(); // Prevent triggering note selection
              const name = window.prompt('Enter new name:', note.name);
              if (name) {
                try {
                  await onRename(note.id, name);
                } catch (e) {
                  console.error('Failed to rename note:', e);
                }
              }
            }}
          >
            <Pencil size={16} />
          </button>
          <button
            className="icon-button"
            onClick={(e) => {
              e.stopPropagation(); // Prevent triggering note selection
              if (window.confirm('Delete this note?')) {
                onDelete(note.id);
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
