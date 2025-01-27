import React from 'react';
import { TlDrawNote } from '../types/TlDraw';

interface NoteItemProps {
  note: TlDrawNote;
  onSelect: (note: TlDrawNote) => void;
  onDragStart: () => void;
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
}) => {
  return (
    <div
      className={`note ${className}`}
      draggable
      onDragStart={onDragStart}
    >
      <div
        className="note-content"
        onClick={() => onSelect(note)}
      >
        <div className="note-name">
          {note.type === 'Markdown' ? '📝' : '✏️'} {note.name}
        </div>
        <div className="actions">
          <button onClick={async (e) => {
            e.stopPropagation(); // Prevent triggering note selection
            const name = window.prompt('Enter new name:', note.name);
            if (name) {
              try {
                await onRename(note.id, name);
              } catch (e) {
                console.error('Failed to rename note:', e);
              }
            }
          }}>Rename</button>
          <button onClick={(e) => {
            e.stopPropagation(); // Prevent triggering note selection
            if (window.confirm('Delete this note?')) {
              onDelete(note.id);
            }
          }}>Delete</button>
        </div>
      </div>
    </div>
  );
};

export default NoteItem;
