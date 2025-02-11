import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import MarkdownView from './MarkdownView';
import TldrawView from './TldrawView';
import { TlDrawNote } from '../types/TlDraw';

const BASE_URL = import.meta.env.BASE_URL;

const PublicNoteView: React.FC = () => {
  const { noteId } = useParams<{ noteId: string }>();
  const [note, setNote] = useState<TlDrawNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchNote = async () => {
      try {
        const response = await fetch(`${BASE_URL}/public/${noteId}`);
        if (!response.ok) {
          throw new Error(response.statusText);
        }
        const data = await response.json();
        setNote(data);
      } catch (err) {
        setError('Note not found or not accessible');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    if (noteId) {
      fetchNote();
    }
  }, [noteId]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error || !note) {
    return <div className="error">{error || 'Note not found'}</div>;
  }

  return (
    <div className="note-view">
      {note.type === 'Markdown' ? (
        <MarkdownView note={note} readOnly={true} onEdit={() => {}} />
      ) : (
        <TldrawView note={note} readOnly={true} onEdit={() => {}} />
      )}
    </div>
  );
};

export default PublicNoteView;