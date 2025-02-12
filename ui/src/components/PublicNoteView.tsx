import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import MarkdownView from './MarkdownView';
import TldrawView from './TldrawView';
import NotFoundView from './NotFoundView';
import { TlDrawNote, TlDrawNoteType } from '../types/TlDraw';

const BASE_URL = import.meta.env.BASE_URL;

type PublicNoteResponse = {
  Ok?: {
    id: string;
    name: string;
    content: number[];
    note_type: TlDrawNoteType;
    is_public: boolean;
  };
  Err?: string;
};

const PublicNoteView: React.FC = () => {
  const { noteId } = useParams<{ noteId: string }>();
  const [note, setNote] = useState<TlDrawNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchNote = async () => {
      if (!noteId) {
        setError('No note ID provided');
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`${BASE_URL}/public`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ note_id: noteId }),
        });
        if (!response.ok) {
          throw new Error(response.statusText);
        }

        const data: PublicNoteResponse = await response.json();

        if (data.Ok) {
          const publicNote = data.Ok;
          if (!publicNote.is_public) {
            throw new Error('Note is not public');
          }

          setNote({
            id: publicNote.id,
            name: publicNote.name,
            type: publicNote.note_type,
            content: publicNote.content,
            'folder-id': null,
            isPublic: true,
            collaborators: []
          });
        } else if (data.Err) {
          setError(data.Err);
        } else {
          setError('Invalid response from server');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch note');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNote();
  }, [noteId]);

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (error || !note) {
    return <NotFoundView error={error || 'Note not found'} />;
  }

  return (
    <div className="note-view">
      {note.type === 'Markdown' ? (
        <MarkdownView note={note} readOnly={true} />
      ) : (
        <TldrawView note={note} readOnly={true} />
      )}
    </div>
  );
};

export default PublicNoteView;
