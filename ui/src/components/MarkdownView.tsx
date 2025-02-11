import React, { useCallback, useEffect, useState } from 'react';
import useTlDrawStore from '../store/tldraw';
import ReactMarkdown from 'react-markdown';
import './MarkdownView.css';

const BASE_URL = import.meta.env.BASE_URL;

const MarkdownView: React.FC = () => {
  const { currentNote, setView } = useTlDrawStore();
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(false);

  // Load content when note changes
  useEffect(() => {
    // Check if this is a public note view
    if (window.readOnlyNote) {
      const { content: readOnlyContent } = window.readOnlyNote;
      const contentStr = new TextDecoder().decode(new Uint8Array(readOnlyContent));
      setContent(contentStr);
      setPreview(true); // Force preview mode for read-only view
      // Hide toolbar in read-only mode
      const toolbar = document.querySelector('.toolbar') as HTMLDivElement;
      if (toolbar) toolbar.style.display = 'none';
      return;
    }

    const loadContent = async () => {
      if (!currentNote) return;
      
      try {
        console.log('Loading note:', currentNote.id);
        const response = await fetch(`${BASE_URL}/api`, {
          method: 'POST',
          body: JSON.stringify({ GetNote: currentNote.id }),
        });
        const data = await response.json();
        console.log('Load response:', data);
        
        if (data.GetNote.Ok) {
          const { content } = data.GetNote.Ok;
          // For MD notes, content is stored as UTF-8 text directly
          const contentStr = new TextDecoder().decode(new Uint8Array(content));
          setContent(contentStr);
        }
      } catch (error) {
        console.error('Failed to load note content:', error);
      }
    };

    loadContent();
  }, [currentNote?.id]);

  // Save changes to backend
  const saveContent = useCallback(async (newContent: string) => {
    if (!currentNote) return;

    const contentBytes = Array.from(new TextEncoder().encode(newContent));
    const request = {
      UpdateNoteContent: [currentNote.id, contentBytes]
    };

    try {
      const response = await fetch(`${BASE_URL}/api`, {
        method: 'POST',
        body: JSON.stringify(request),
      });
      const result = await response.json();
      console.log('Save result:', result);
    } catch (error) {
      console.error('Save failed:', error);
    }
  }, [currentNote]);

  // Auto-save content changes with debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveContent(content);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [content, saveContent]);

  return (
    <div className="markdown-view">
      <div className="toolbar">
        <span className="note-name">{currentNote?.name}</span>
        <button onClick={() => setPreview(!preview)}>
          {preview ? 'Edit' : 'Preview'}
        </button>
        <button onClick={() => setView('folder')}>← Back to Folders</button>
      </div>
      <div className="markdown-content">
        {preview ? (
          <div className="preview-pane">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Type your markdown here..."
            spellCheck={false}
            autoFocus
            style={{ fontSize: '16px' }}
            readOnly={window.readOnlyNote !== undefined}
          />
        )}
      </div>
    </div>
  );
};

export default MarkdownView;