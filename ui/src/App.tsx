import { useEffect, useState } from "react"
import KinodeClientApi from "@kinode/client-api"
import "./App.css"
import useTlDrawStore from "./store/tldraw"
import FolderView from "./components/FolderView"
import TldrawView from "./components/TldrawView"
import MarkdownView from "./components/MarkdownView"
import { StructureResponse, ApiFolder, ApiNote, TlDrawFolder, TlDrawNote } from "./types/TlDraw"

const BASE_URL = import.meta.env.BASE_URL
if (window.our) window.our.process = BASE_URL?.replace("/", "")

const PROXY_TARGET = `${(import.meta.env.VITE_NODE_URL || "http://localhost:8080")}${BASE_URL}`

const WEBSOCKET_URL = import.meta.env.DEV
  ? `${PROXY_TARGET.replace('http', 'ws')}`
  : undefined

function App() {
  const [isPublicView, setIsPublicView] = useState(false);
  const { view, currentNote, setStructure, setCurrentNote } = useTlDrawStore()
  const [nodeConnected, setNodeConnected] = useState(true)
  const [initializing, setInitializing] = useState(true)

  // Handle view type determination and public note loading
  useEffect(() => {
    const path = window.location.pathname;
    const noteIdMatch = path.match(/\/public\/(.+)$/);
    console.log(`path, noteIdMatch: ${path}, ${noteIdMatch}`);

    if (noteIdMatch) {
      setIsPublicView(true);
      const noteId = noteIdMatch[1];

      console.log(`fetching ${noteId} from ${BASE_URL}/public...`);
      // Fetch public note using the public API
      fetch(`${BASE_URL}/public`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ note_id: noteId }),
      })
        .then(response => {
          if (!response.ok) {
            throw new Error('Note not found or not public');
          }
          return response.json();
        })
        .then(note => {
          const noteOk = note.Ok;
          const transformedNote: TlDrawNote = {
            id: noteOk.id,
            name: noteOk.name,
            'folder-id': noteOk.folder_id,
            content: noteOk.content,
            type: noteOk.note_type,
            isPublic: noteOk.is_public,
            collaborators: noteOk.collaborators,
          };
          console.log(`got tldrawnote ${JSON.stringify(transformedNote)} from ${BASE_URL}/public/${noteId}...`);
          setCurrentNote(transformedNote);
        })
        .catch(error => {
          console.error('Error loading public note:', error);
          // Handle error display
        })
        .finally(() => setInitializing(false));
    } else {
      setIsPublicView(false);
      setInitializing(false);
    }
  }, [])

  // Initialize dark mode from localStorage
  useEffect(() => {
    const storedDarkMode = localStorage.getItem('darkMode');
    if (storedDarkMode === 'true') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else if (storedDarkMode === 'false') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, []);

  useEffect(() => {
    // Get structure using http
    fetch(`${BASE_URL}/api`, {
      method: 'POST',
      body: '"GetStructure"',
    })
      .then((response) => response.json())
      .then((data: StructureResponse) => {
        const structure = data.GetStructure;
        if ('Ok' in structure) {
          const [folders, notes] = structure.Ok;

          // Transform the data to match expected format
          const transformedFolders = (folders as ApiFolder[]).map((f: ApiFolder): TlDrawFolder => ({
            id: f.id,
            name: f.name,
            'parent-id': f.parent_id // Convert snake_case to kebab-case
          }));

          const transformedNotes = (notes as ApiNote[]).map((n: ApiNote): TlDrawNote => ({
            id: n.id,
            name: n.name,
            'folder-id': n.folder_id, // Convert snake_case to kebab-case
            content: n.content,
            type: n.note_type,
            isPublic: n.is_public,
            collaborators: n.collaborators,
          }));

          console.log('Initial structure:', { transformedFolders, transformedNotes });
          setStructure(transformedFolders, transformedNotes);
        }
      })
      .catch((error) => console.error('Failed to fetch initial structure:', error))

    // Connect to the Kinode via websocket
    if (window.our?.node && window.our?.process) {
      new KinodeClientApi({
        uri: WEBSOCKET_URL,
        nodeId: window.our.node,
        processId: window.our.process,
        onOpen: (_event, _api) => {
          console.log("Connected to Kinode")
        },
        onMessage: (message, _api) => {
          try {
            // Parse the message if it's a string
            const data = typeof message === 'string' ? JSON.parse(message) : message;
            console.log("WebSocket received message", data);

            // Handle real-time updates
            if (data && typeof data === 'object' && 'GetStructure' in data) {
              const structure = data.GetStructure;
              if ('Ok' in structure) {
                const [folders, notes] = structure.Ok;

                // Transform the data to match expected format
                const transformedFolders = (folders as ApiFolder[]).map((f: ApiFolder): TlDrawFolder => ({
                  id: f.id,
                  name: f.name,
                  'parent-id': f.parent_id // Convert snake_case to kebab-case
                }));

                  const transformedNotes = (notes as ApiNote[]).map((n: ApiNote): TlDrawNote => ({
                    id: n.id,
                    name: n.name,
                    'folder-id': n.folder_id, // Convert snake_case to kebab-case
                    content: n.content,
                    type: n.note_type,
                    isPublic: n.is_public,
                    collaborators: n.collaborators,
                  }));

                // Re-apply the transform and update state
                setStructure(transformedFolders, transformedNotes);
                console.log('Set structure with:', { transformedFolders, transformedNotes });
              }
            }
          } catch (error) {
            console.error("Error handling WebSocket message", error)
          }
        },
      })
    } else {
      setNodeConnected(false)
    }
  }, [])

  if (initializing) {
    return <div>Loading...</div>
  }

  if (!nodeConnected && !window.readOnlyNote) {
    return (
      <div className="node-not-connected">
        <h2 style={{ color: "red" }}>Node not connected</h2>
        <h4>
          You need to start a node at {PROXY_TARGET} before you can use this UI
          in development.
        </h4>
      </div>
    )
  }

  console.log(`isPublicView, currentNote: ${isPublicView}, ${JSON.stringify(currentNote)}`);
  return (
    <div className="app">
      {isPublicView ? (
        // Public view only shows the note content
        currentNote?.type === 'Markdown' ? (
          <MarkdownView note={currentNote} readOnly={true} />
        ) : (
          <TldrawView note={currentNote} readOnly={true} />
        )
      ) : (
        // Private authenticated view
        view === 'folder' ? (
          <FolderView />
        ) : currentNote?.type === 'Markdown' ? (
          <MarkdownView note={currentNote} />
        ) : (
          <TldrawView note={currentNote} />
        )
      )}
    </div>
  )
}

export default App
