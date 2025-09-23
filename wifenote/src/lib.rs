use std::collections::{HashMap, HashSet};
use std::io::prelude::*;

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};

use crate::hyperware::process::wifenote::{
    Folder, Invite, Note, NoteType, Request as NoteRequest, Response as NoteResponse,
};
use hyperware_process_lib::logging::{error, info, init_logging, Level};
use hyperware_process_lib::{
    await_message, call_init, http, http::server::HttpServerRequest, last_blob, our, vfs, Address,
    LazyLoadBlob, Message, Response,
};

wit_bindgen::generate!({
    path: "../target/wit",
    world: "wifenote-nick-dot-hypr-v0",
    generate_unused_types: true,
    additional_derives: [serde::Deserialize, serde::Serialize, process_macros::SerdeJsonInto],
});

// Current version of the state format
const CURRENT_STATE_VERSION: u32 = 1;

const ICON: &str = include_str!("./icon");

// Version 0: Original format with full notes inline
// Version 1: New format with note metadata only, content in separate files
const STATE_VERSION_WITH_SEPARATE_FILES: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct ExportData {
    version: u32,
    folders: Vec<Folder>,
    #[serde(default)]
    notes: Vec<Note>, // For backwards compatibility with v0
    #[serde(default)]
    note_metadata: Vec<NoteMetadata>, // For v1+
    #[serde(default)]
    collaboration_invites: HashMap<String, HashMap<String, String>>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, process_macros::SerdeJsonInto)]
#[serde(untagged)]
enum Msg {
    NoteRequest(NoteRequest),
    HttpRequest(HttpServerRequest),
}

// Note metadata stored in state.json (without content)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct NoteMetadata {
    id: String,
    name: String,
    folder_id: Option<String>,
    note_type: NoteType,
    is_public: bool,
    collaborators: Vec<String>,
}

impl From<Note> for NoteMetadata {
    fn from(note: Note) -> Self {
        NoteMetadata {
            id: note.id,
            name: note.name,
            folder_id: note.folder_id,
            note_type: note.note_type,
            is_public: note.is_public,
            collaborators: note.collaborators,
        }
    }
}

#[derive(Debug, Clone)]
struct State {
    drive: String,
    folders: HashMap<String, Folder>,
    notes: HashMap<String, NoteMetadata>, // Now stores metadata only
    root_items: HashSet<String>,          // IDs of folders/notes at root
    collaboration_invites: HashMap<String, HashMap<String, String>>, // note_id -> {invitee_id -> inviter_id}
}

impl State {
    fn new(drive: String) -> Self {
        State {
            drive,
            folders: HashMap::new(),
            notes: HashMap::new(),
            root_items: HashSet::new(),
            collaboration_invites: HashMap::new(),
        }
    }

    // Get the file extension for a note based on its type
    fn get_note_extension(note_type: &NoteType) -> &'static str {
        match note_type {
            NoteType::Markdown => "md",
            NoteType::Tldraw => "json",
        }
    }

    // Load note content from individual file
    fn load_note_content(&self, note_id: &str) -> anyhow::Result<Vec<u8>> {
        let metadata = self
            .notes
            .get(note_id)
            .ok_or_else(|| anyhow::anyhow!("Note metadata not found"))?;
        let ext = Self::get_note_extension(&metadata.note_type);
        let path = format!("{}/note_{}.{}", &self.drive, note_id, ext);
        let file = vfs::open_file(&path, false, None)?;
        Ok(file.read()?)
    }

    // Save note content to individual file
    fn save_note_content(&self, note_id: &str, content: &[u8]) -> anyhow::Result<()> {
        let metadata = self
            .notes
            .get(note_id)
            .ok_or_else(|| anyhow::anyhow!("Note metadata not found"))?;
        let ext = Self::get_note_extension(&metadata.note_type);
        let path = format!("{}/note_{}.{}", &self.drive, note_id, ext);
        let file = vfs::create_file(&path, None)?;

        // For markdown files, ensure they end with a newline
        if metadata.note_type == NoteType::Markdown
            && !content.is_empty()
            && !content.ends_with(b"\n")
        {
            let mut content_with_newline = content.to_vec();
            content_with_newline.push(b'\n');
            file.write(&content_with_newline)?;
        } else {
            file.write(content)?;
        }

        Ok(())
    }

    // Get full Note from NoteMetadata by loading content
    fn get_full_note(&self, metadata: &NoteMetadata) -> anyhow::Result<Note> {
        let content = self
            .load_note_content(&metadata.id)
            .unwrap_or_else(|_| Vec::new());
        Ok(Note {
            id: metadata.id.clone(),
            name: metadata.name.clone(),
            folder_id: metadata.folder_id.clone(),
            note_type: metadata.note_type.clone(),
            content,
            is_public: metadata.is_public,
            collaborators: metadata.collaborators.clone(),
        })
    }

    // Helper to generate a unique ID
    fn generate_id() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{}", time)
    }

    fn save_to_disk(&self) -> anyhow::Result<()> {
        let data = serde_json::to_vec(&ExportData {
            version: CURRENT_STATE_VERSION,
            folders: self.folders.values().cloned().collect(),
            notes: Vec::new(), // No longer store full notes in v1+
            note_metadata: self.notes.values().cloned().collect(),
            collaboration_invites: self.collaboration_invites.clone(),
        })?;

        let file = vfs::create_file(&format!("{}/state.json", &self.drive), None)?;
        file.write(&data)?;
        Ok(())
    }

    fn load_from_disk(drive: String) -> anyhow::Result<Self> {
        let file = match vfs::open_file(&format!("{}/state.json", &drive), false, None) {
            Ok(file) => file,
            Err(_) => return Ok(State::new(drive)), // If file doesn't exist, return new state
        };

        let data = file.read()?;
        let export_data: ExportData = serde_json::from_slice(&data)?;
        let export_data = migrate_export_data(export_data, &drive)?;
        let mut state = State::new(drive);

        // Reconstruct shared state
        state.collaboration_invites = export_data.collaboration_invites;

        // Reconstruct state from export data
        for folder in export_data.folders {
            if folder.parent_id.is_none() {
                state.root_items.insert(folder.id.clone());
            }
            state.folders.insert(folder.id.clone(), folder);
        }

        // Load note metadata (v1+) or migrate from full notes (v0)
        if !export_data.note_metadata.is_empty() {
            // Version 1+: Load from metadata
            for metadata in export_data.note_metadata {
                if metadata.folder_id.is_none() {
                    state.root_items.insert(metadata.id.clone());
                }
                state.notes.insert(metadata.id.clone(), metadata);
            }
        } else if !export_data.notes.is_empty() {
            // Version 0: Migrate from full notes (this shouldn't happen after migration)
            for note in export_data.notes {
                if note.folder_id.is_none() {
                    state.root_items.insert(note.id.clone());
                }
                let metadata = NoteMetadata::from(note);
                state.notes.insert(metadata.id.clone(), metadata);
            }
        }

        Ok(state)
    }
}

// Helper function to migrate state data from older versions
fn migrate_export_data(mut data: ExportData, drive: &str) -> anyhow::Result<ExportData> {
    // Return error if version is newer than current
    if data.version > CURRENT_STATE_VERSION {
        return Err(anyhow::anyhow!(
            "Cannot import data from newer version {} (current version is {})",
            data.version,
            CURRENT_STATE_VERSION
        ));
    }

    // Apply migrations sequentially based on version
    if data.version < STATE_VERSION_WITH_SEPARATE_FILES {
        // Migrate from v0 to v1: Extract note contents to separate files
        info!(
            "Migrating state from version {} to {}",
            data.version, STATE_VERSION_WITH_SEPARATE_FILES
        );

        // Convert full notes to metadata and save content separately
        let mut note_metadata = Vec::new();
        for note in data.notes.iter() {
            // Save note content to individual file with appropriate extension
            let ext = match note.note_type {
                NoteType::Markdown => "md",
                NoteType::Tldraw => "json",
            };
            let path = format!("{}/note_{}.{}", drive, note.id, ext);
            if let Ok(file) = vfs::create_file(&path, None) {
                if let Err(e) = file.write(&note.content) {
                    error!(
                        "Failed to write note content during migration for note {}: {}",
                        note.id, e
                    );
                }
            }

            // Create metadata
            note_metadata.push(NoteMetadata {
                id: note.id.clone(),
                name: note.name.clone(),
                folder_id: note.folder_id.clone(),
                note_type: note.note_type.clone(),
                is_public: note.is_public,
                collaborators: note.collaborators.clone(),
            });
        }

        data.note_metadata = note_metadata;
        data.notes = Vec::new(); // Clear old format notes
        data.version = STATE_VERSION_WITH_SEPARATE_FILES;
    }

    data.version = CURRENT_STATE_VERSION;
    Ok(data)
}

fn handle_http_request(
    req: HttpServerRequest,
    state: &mut State,
    server: &mut http::server::HttpServer,
) -> anyhow::Result<()> {
    let is_public = if let HttpServerRequest::Http(ref http_request) = req {
        http_request.path()?.starts_with("/public")
    } else {
        false
    };

    match req {
        HttpServerRequest::WebSocketOpen {
            ref path,
            channel_id,
        } => server.handle_websocket_open(path, channel_id),
        HttpServerRequest::WebSocketClose(channel_id) => server.handle_websocket_close(channel_id),
        HttpServerRequest::Http(http_request) => {
            info!("http: a");
            match http_request.method()? {
                http::Method::GET => {
                    info!("http: GET");

                    // Handle public note access through public server
                    if is_public {
                        // For backward compatibility, support both GET and POST
                        if let Some(note_id) = http_request.path()?.strip_prefix("/public/") {
                            let mut headers = HashMap::new();
                            headers
                                .insert("Content-Type".to_string(), "application/json".to_string());

                            let result = if let Some(metadata) = state.notes.get(note_id) {
                                if metadata.is_public {
                                    match state.get_full_note(metadata) {
                                        Ok(mut note) => {
                                            note.folder_id = None; // Don't expose folder structure
                                            note.collaborators = Vec::new(); // Don't expose collaborators
                                            Ok(note)
                                        }
                                        Err(_) => Err("Error loading note content".to_string()),
                                    }
                                } else {
                                    Err("Note is not public".to_string())
                                }
                            } else {
                                Err("Note not found".to_string())
                            };

                            let (status_code, response) = match result {
                                Ok(note) => {
                                    (http::StatusCode::OK, serde_json::json!({ "Ok": note }))
                                }
                                Err(msg) => (
                                    http::StatusCode::NOT_FOUND,
                                    serde_json::json!({ "Err": msg }),
                                ),
                            };

                            http::server::send_response(
                                status_code,
                                Some(headers),
                                serde_json::to_vec(&response)?,
                            );
                            return Ok(());
                        }
                    }

                    // Serve static files for all other GET requests
                    let mut headers = HashMap::new();
                    headers.insert("Content-Type".to_string(), "text/html".to_string());
                    http::server::send_response(
                        http::StatusCode::OK,
                        Some(headers),
                        include_bytes!("../../pkg/ui/index.html").to_vec(),
                    );
                }
                http::Method::POST => {
                    // Handle public note access via POST
                    if is_public {
                        if http_request.path()? == "/public" {
                            let Some(body) = last_blob() else {
                                http::server::send_response(
                                    http::StatusCode::BAD_REQUEST,
                                    None,
                                    "Missing request body".as_bytes().to_vec(),
                                );
                                return Ok(());
                            };

                            // Parse request body
                            let req: serde_json::Value = match serde_json::from_slice(&body.bytes) {
                                Ok(req) => req,
                                Err(_) => {
                                    http::server::send_response(
                                        http::StatusCode::BAD_REQUEST,
                                        None,
                                        "Invalid JSON".as_bytes().to_vec(),
                                    );
                                    return Ok(());
                                }
                            };

                            let note_id = match req.get("note_id").and_then(|v| v.as_str()) {
                                Some(id) => id,
                                None => {
                                    http::server::send_response(
                                        http::StatusCode::BAD_REQUEST,
                                        None,
                                        "Missing note_id".as_bytes().to_vec(),
                                    );
                                    return Ok(());
                                }
                            };

                            let mut headers = HashMap::new();
                            headers
                                .insert("Content-Type".to_string(), "application/json".to_string());

                            let result = if let Some(metadata) = state.notes.get(note_id) {
                                if metadata.is_public {
                                    match state.get_full_note(metadata) {
                                        Ok(mut note) => {
                                            note.folder_id = None; // Don't expose folder structure
                                            note.collaborators = Vec::new(); // Don't expose collaborators
                                            Ok(note)
                                        }
                                        Err(_) => Err("Error loading note content".to_string()),
                                    }
                                } else {
                                    Err("Note is not public".to_string())
                                }
                            } else {
                                Err("Note not found".to_string())
                            };

                            let (status_code, response) = match result {
                                Ok(note) => {
                                    (http::StatusCode::OK, serde_json::json!({ "Ok": note }))
                                }
                                Err(msg) => (
                                    http::StatusCode::NOT_FOUND,
                                    serde_json::json!({ "Err": msg }),
                                ),
                            };

                            http::server::send_response(
                                status_code,
                                Some(headers),
                                serde_json::to_vec(&response)?,
                            );
                            return Ok(());
                        }

                        http::server::send_response(
                            http::StatusCode::NOT_FOUND,
                            None,
                            "Invalid path".as_bytes().to_vec(),
                        );
                        return Ok(());
                    }
                    info!("http: POST");
                    let Some(body) = last_blob() else {
                        return Err(anyhow::anyhow!(
                            "received a POST HTTP request with no body, skipping"
                        ));
                    };
                    info!(
                        "http: POST trying to into note {:?}",
                        String::from_utf8(body.bytes.clone())
                            .map(|s| s.chars().take(10).collect::<String>())
                    );
                    let resp = handle_note_request(body.bytes.try_into()?, Some(&our()), state)?;
                    http::server::send_response(http::StatusCode::OK, None, resp.into());
                }
                _ => {
                    http::server::send_response(http::StatusCode::METHOD_NOT_ALLOWED, None, vec![]);
                }
            }
        }
        HttpServerRequest::WebSocketPush { .. } => {}
    }
    Ok(())
}

fn handle_note_request(
    req: NoteRequest,
    source: Option<&Address>,
    state: &mut State,
) -> anyhow::Result<NoteResponse> {
    let resp = 'resp: {
        match req {
            NoteRequest::CreateFolder((name, parent)) => {
                let id = State::generate_id();
                let folder = Folder {
                    id: id.clone(),
                    name,
                    parent_id: parent,
                };
                state.folders.insert(id.clone(), folder.clone());
                state.root_items.insert(id);
                state.save_to_disk()?;
                NoteResponse::CreateFolder(Ok(folder))
            }

            NoteRequest::RenameFolder((id, new_name)) => {
                if let Some(mut folder) = state.folders.get(&id).cloned() {
                    folder.name = new_name;
                    state.folders.insert(id, folder.clone());
                    state.save_to_disk()?;
                    NoteResponse::RenameFolder(Ok(folder))
                } else {
                    NoteResponse::RenameFolder(Err("Folder not found".to_string()))
                }
            }

            NoteRequest::DeleteFolder(id) => {
                if let Some(folder) = state.folders.remove(&id) {
                    state.root_items.remove(&id);
                    // Move child items to root if any
                    for note in state.notes.values_mut() {
                        if note.folder_id.as_ref() == Some(&folder.id) {
                            note.folder_id = None;
                            state.root_items.insert(note.id.clone());
                        }
                    }
                    for subfolder in state.folders.values_mut() {
                        if subfolder.parent_id.as_ref() == Some(&folder.id) {
                            subfolder.parent_id = None;
                            state.root_items.insert(subfolder.id.clone());
                        }
                    }
                    state.save_to_disk()?;
                    NoteResponse::DeleteFolder(Ok(()))
                } else {
                    NoteResponse::DeleteFolder(Err("Folder not found".to_string()))
                }
            }

            NoteRequest::MoveFolder((id, new_parent_id)) => {
                if let Some(mut folder) = state.folders.get(&id).cloned() {
                    // Validate new parent exists if some
                    if let Some(ref parent_id) = new_parent_id {
                        if !state.folders.contains_key(parent_id) {
                            return Ok(NoteResponse::MoveFolder(Err(
                                "Parent folder not found".to_string()
                            )));
                        }
                    }

                    // Remove from old parent's children or root
                    if folder.parent_id.is_some() {
                        state.root_items.remove(&id);
                    }

                    // Update folder
                    folder.parent_id = new_parent_id;
                    state.folders.insert(id.clone(), folder.clone());

                    // Add to root if needed
                    if folder.parent_id.is_none() {
                        state.root_items.insert(id);
                    }

                    state.save_to_disk()?;
                    NoteResponse::MoveFolder(Ok(folder))
                } else {
                    NoteResponse::MoveFolder(Err("Folder not found".to_string()))
                }
            }

            NoteRequest::CreateNote((name, folder_id, note_type)) => {
                // Validate folder exists if some
                if let Some(ref folder_id) = folder_id {
                    if !state.folders.contains_key(folder_id) {
                        return Ok(NoteResponse::CreateNote(Err(
                            "Parent folder not found".to_string()
                        )));
                    }
                }

                let id = State::generate_id();
                let metadata = NoteMetadata {
                    id: id.clone(),
                    name: name.clone(),
                    folder_id: folder_id.clone(),
                    note_type: note_type.clone(),
                    is_public: false,
                    collaborators: Vec::new(),
                };

                // Insert metadata first so save_note_content can access it
                state.notes.insert(id.clone(), metadata);

                // Save empty content to file
                state.save_note_content(&id, &vec![])?;
                if folder_id.is_none() {
                    state.root_items.insert(id.clone());
                }

                state.save_to_disk()?;

                // Return full Note for API compatibility
                let note = Note {
                    id,
                    name,
                    folder_id,
                    note_type,
                    content: vec![],
                    is_public: false,
                    collaborators: Vec::new(),
                };
                NoteResponse::CreateNote(Ok(note))
            }

            NoteRequest::RenameNote((id, new_name)) => {
                if let Some(mut metadata) = state.notes.get(&id).cloned() {
                    metadata.name = new_name;
                    state.notes.insert(id.clone(), metadata.clone());
                    state.save_to_disk()?;
                    // Return full Note for API compatibility
                    match state.get_full_note(&metadata) {
                        Ok(note) => NoteResponse::RenameNote(Ok(note)),
                        Err(_) => {
                            NoteResponse::RenameNote(Err("Error loading note content".to_string()))
                        }
                    }
                } else {
                    NoteResponse::RenameNote(Err("Note not found".to_string()))
                }
            }

            NoteRequest::DeleteNote(id) => {
                if let Some(metadata) = state.notes.remove(&id) {
                    state.root_items.remove(&id);
                    // Delete the note content file with correct extension
                    let ext = State::get_note_extension(&metadata.note_type);
                    let path = format!("{}/note_{}.{}", &state.drive, &id, ext);
                    if let Err(e) = vfs::remove_file(&path, None) {
                        error!("Failed to delete note content file for {}: {}", &id, e);
                    }
                    state.save_to_disk()?;
                    NoteResponse::DeleteNote(Ok(()))
                } else {
                    NoteResponse::DeleteNote(Err("Note not found".to_string()))
                }
            }

            NoteRequest::MoveNote((id, new_folder_id)) => {
                // Validate new folder exists if some
                if let Some(ref folder_id) = new_folder_id {
                    if !state.folders.contains_key(folder_id) {
                        return Ok(NoteResponse::MoveNote(Err(
                            "Parent folder not found".to_string()
                        )));
                    }
                }

                if let Some(mut metadata) = state.notes.get(&id).cloned() {
                    // Update root items tracking
                    if metadata.folder_id.is_none() {
                        state.root_items.remove(&id);
                    }
                    if new_folder_id.is_none() {
                        state.root_items.insert(id.clone());
                    }

                    metadata.folder_id = new_folder_id;
                    state.notes.insert(id.clone(), metadata.clone());
                    state.save_to_disk()?;
                    // Return full Note for API compatibility
                    match state.get_full_note(&metadata) {
                        Ok(note) => NoteResponse::MoveNote(Ok(note)),
                        Err(_) => {
                            NoteResponse::MoveNote(Err("Error loading note content".to_string()))
                        }
                    }
                } else {
                    NoteResponse::MoveNote(Err("Note not found".to_string()))
                }
            }

            NoteRequest::GetNote(id) => {
                // Allow access if:
                // 1. Note is public
                // 2. Current node is owner (checking against process name should be enough)
                // 3. Current node is a collaborator
                let Some(metadata) = state.notes.get(&id) else {
                    break 'resp NoteResponse::GetNote(Err(
                        "Not found or not authorized".to_string()
                    ));
                };
                if metadata.is_public {
                    match state.get_full_note(metadata) {
                        Ok(note) => break 'resp NoteResponse::GetNote(Ok(note)),
                        Err(_) => {
                            break 'resp NoteResponse::GetNote(Err(
                                "Error loading note content".to_string()
                            ))
                        }
                    }
                }
                let Some(source) = source else {
                    break 'resp NoteResponse::GetNote(Err(
                        "Not found or not authorized".to_string()
                    ));
                };
                if source == &our() || metadata.collaborators.contains(&source.node) {
                    match state.get_full_note(metadata) {
                        Ok(note) => NoteResponse::GetNote(Ok(note)),
                        Err(_) => {
                            NoteResponse::GetNote(Err("Error loading note content".to_string()))
                        }
                    }
                } else {
                    NoteResponse::GetNote(Err("Not found or not authorized".to_string()))
                }
            }

            NoteRequest::UpdateNoteContent((id, content)) => {
                let Some(metadata) = state.notes.get(&id).cloned() else {
                    break 'resp NoteResponse::UpdateNoteContent(Err(
                        "Not found or not authorized".to_string(),
                    ));
                };
                let Some(source) = source else {
                    break 'resp NoteResponse::UpdateNoteContent(Err(
                        "Not found or not authorized".to_string(),
                    ));
                };
                if source == &our() || metadata.collaborators.contains(&source.node) {
                    // Save content to file with appropriate extension
                    state.save_note_content(&id, &content)?;
                    // No need to update metadata or save state since content is stored separately
                    NoteResponse::UpdateNoteContent(Ok(()))
                } else {
                    NoteResponse::UpdateNoteContent(Err("Not found or not authorized".to_string()))
                }
            }

            NoteRequest::GetStructure => {
                // Convert metadata to full notes for API compatibility
                let mut notes = Vec::new();
                for metadata in state.notes.values() {
                    match state.get_full_note(metadata) {
                        Ok(note) => notes.push(note),
                        Err(_) => {
                            // If we can't load content, create note with empty content
                            notes.push(Note {
                                id: metadata.id.clone(),
                                name: metadata.name.clone(),
                                folder_id: metadata.folder_id.clone(),
                                note_type: metadata.note_type.clone(),
                                content: vec![],
                                is_public: metadata.is_public,
                                collaborators: metadata.collaborators.clone(),
                            });
                        }
                    }
                }
                NoteResponse::GetStructure(Ok((state.folders.values().cloned().collect(), notes)))
            }

            NoteRequest::ExportAll => {
                // Load all notes with content for export
                let mut notes = Vec::new();
                for metadata in state.notes.values() {
                    match state.get_full_note(metadata) {
                        Ok(note) => notes.push(note),
                        Err(_) => {
                            // If we can't load content, create note with empty content
                            notes.push(Note {
                                id: metadata.id.clone(),
                                name: metadata.name.clone(),
                                folder_id: metadata.folder_id.clone(),
                                note_type: metadata.note_type.clone(),
                                content: vec![],
                                is_public: metadata.is_public,
                                collaborators: metadata.collaborators.clone(),
                            });
                        }
                    }
                }

                // Create export data structure with full notes for compatibility
                let export_data = ExportData {
                    version: 0, // Export as v0 for compatibility
                    folders: state.folders.values().cloned().collect(),
                    notes, // Full notes for export
                    note_metadata: Vec::new(),
                    collaboration_invites: state.collaboration_invites.clone(),
                };

                // Serialize to JSON
                let json_str = serde_json::to_string(&export_data)?;

                // Compress with gzip
                let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
                encoder.write_all(json_str.as_bytes())?;
                let compressed = encoder.finish()?;

                // Return compressed bytes
                NoteResponse::ExportAll(Ok(compressed))
            }

            NoteRequest::SetNotePublic((note_id, is_public)) => {
                if let Some(mut metadata) = state.notes.get(&note_id).cloned() {
                    metadata.is_public = is_public;
                    state.notes.insert(note_id.clone(), metadata.clone());
                    state.save_to_disk()?;
                    // Return full Note for API compatibility
                    match state.get_full_note(&metadata) {
                        Ok(note) => NoteResponse::SetNotePublic(Ok(note)),
                        Err(_) => NoteResponse::SetNotePublic(Err(
                            "Error loading note content".to_string()
                        )),
                    }
                } else {
                    NoteResponse::SetNotePublic(Err("Note not found".to_string()))
                }
            }

            NoteRequest::InviteCollaborator((note_id, node_id)) => {
                if let Some(metadata) = state.notes.get(&note_id) {
                    // Create invites map for this note if it doesn't exist
                    let invites = state
                        .collaboration_invites
                        .entry(note_id.clone())
                        .or_insert_with(HashMap::new);

                    // Add new invite
                    invites.insert(node_id.clone(), our().node);

                    state.save_to_disk()?;
                    // Return full Note for API compatibility
                    match state.get_full_note(metadata) {
                        Ok(note) => NoteResponse::InviteCollaborator(Ok(note)),
                        Err(_) => NoteResponse::InviteCollaborator(Err(
                            "Error loading note content".to_string(),
                        )),
                    }
                } else {
                    NoteResponse::InviteCollaborator(Err("Note not found".to_string()))
                }
            }

            NoteRequest::RemoveCollaborator((note_id, node_id)) => {
                if let Some(mut metadata) = state.notes.get(&note_id).cloned() {
                    // Remove from collaborators if present
                    metadata.collaborators.retain(|id| id != &node_id);
                    state.notes.insert(note_id.clone(), metadata.clone());

                    // Remove any pending invites
                    if let Some(invites) = state.collaboration_invites.get_mut(&note_id) {
                        invites.remove(&node_id);
                    }

                    state.save_to_disk()?;
                    // Return full Note for API compatibility
                    match state.get_full_note(&metadata) {
                        Ok(note) => NoteResponse::RemoveCollaborator(Ok(note)),
                        Err(_) => NoteResponse::RemoveCollaborator(Err(
                            "Error loading note content".to_string(),
                        )),
                    }
                } else {
                    NoteResponse::RemoveCollaborator(Err("Note not found".to_string()))
                }
            }

            NoteRequest::AcceptInvite((note_id, inviter_node_id)) => {
                // Verify invite exists
                if let Some(invites) = state.collaboration_invites.get_mut(&note_id) {
                    if invites.get(&our().node) == Some(&inviter_node_id) {
                        if let Some(mut metadata) = state.notes.get(&note_id).cloned() {
                            // Add to collaborators
                            metadata.collaborators.push(our().node);
                            state.notes.insert(note_id.clone(), metadata.clone());

                            // Remove invite
                            invites.remove(&our().node);

                            state.save_to_disk()?;
                            // Return full Note for API compatibility
                            match state.get_full_note(&metadata) {
                                Ok(note) => NoteResponse::AcceptInvite(Ok(note)),
                                Err(_) => NoteResponse::AcceptInvite(Err(
                                    "Error loading note content".to_string(),
                                )),
                            }
                        } else {
                            NoteResponse::AcceptInvite(Err("Note not found".to_string()))
                        }
                    } else {
                        NoteResponse::AcceptInvite(Err("Invalid inviter".to_string()))
                    }
                } else {
                    NoteResponse::AcceptInvite(Err("No invite found".to_string()))
                }
            }

            NoteRequest::RejectInvite((note_id, inviter_node_id)) => {
                if let Some(invites) = state.collaboration_invites.get_mut(&note_id) {
                    if invites.get(&our().node) == Some(&inviter_node_id) {
                        // Remove invite
                        invites.remove(&our().node);
                        state.save_to_disk()?;
                        NoteResponse::RejectInvite(Ok(()))
                    } else {
                        NoteResponse::RejectInvite(Err("Invalid inviter".to_string()))
                    }
                } else {
                    NoteResponse::RejectInvite(Err("No invite found".to_string()))
                }
            }

            NoteRequest::GetInvites => {
                let mut invites = Vec::new();
                for (note_id, note_invites) in &state.collaboration_invites {
                    for (invitee_id, inviter_id) in note_invites {
                        if invitee_id == &our().node {
                            if let Some(metadata) = state.notes.get(note_id) {
                                invites.push(Invite {
                                    note_id: note_id.clone(),
                                    inviter_node_id: inviter_id.clone(),
                                    note_name: metadata.name.clone(),
                                });
                            }
                        }
                    }
                }
                NoteResponse::GetInvites(Ok(invites))
            }

            NoteRequest::ImportAll(compressed_bytes) => {
                // Decompress data
                let mut decoder = GzDecoder::new(&compressed_bytes[..]);
                let mut decompressed = String::new();
                match decoder.read_to_string(&mut decompressed) {
                    Ok(_) => (),
                    Err(e) => {
                        return Ok(NoteResponse::ImportAll(Err(format!(
                            "Failed to decompress data: {}",
                            e
                        ))))
                    }
                }

                // Parse and migrate the JSON
                let import_data: ExportData = match serde_json::from_str(&decompressed) {
                    Ok(data) => match migrate_export_data(data, &state.drive) {
                        Ok(migrated) => migrated,
                        Err(e) => return Ok(NoteResponse::ImportAll(Err(e.to_string()))),
                    },
                    Err(e) => {
                        return Ok(NoteResponse::ImportAll(Err(format!(
                            "Failed to parse JSON data: {}",
                            e
                        ))))
                    }
                };

                // Update state
                let mut new_state = state.clone();
                new_state.collaboration_invites = import_data.collaboration_invites;

                for folder in import_data.folders {
                    if folder.parent_id.is_none() {
                        new_state.root_items.insert(folder.id.clone());
                    }
                    new_state.folders.insert(folder.id.clone(), folder);
                }

                // Handle both old format (full notes) and new format (metadata)
                if !import_data.notes.is_empty() {
                    // Old format: save notes as files and create metadata
                    for note in import_data.notes {
                        if note.folder_id.is_none() {
                            new_state.root_items.insert(note.id.clone());
                        }
                        // Create and store metadata first
                        let metadata = NoteMetadata::from(note.clone());
                        new_state.notes.insert(metadata.id.clone(), metadata);
                        // Then save content to file with appropriate extension
                        new_state.save_note_content(&note.id, &note.content)?;
                    }
                } else if !import_data.note_metadata.is_empty() {
                    // New format: already have metadata
                    for metadata in import_data.note_metadata {
                        if metadata.folder_id.is_none() {
                            new_state.root_items.insert(metadata.id.clone());
                        }
                        new_state.notes.insert(metadata.id.clone(), metadata);
                    }
                }

                *state = new_state;
                state.save_to_disk()?;
                NoteResponse::ImportAll(Ok(()))
            }
        }
    };
    Ok(resp)
}

fn handle_message(
    message: &Message,
    state: &mut State,
    server: &mut http::server::HttpServer,
) -> anyhow::Result<()> {
    match message.body().try_into() {
        Ok(Msg::NoteRequest(req)) => {
            let resp = handle_note_request(req, Some(message.source()), state)?;
            Response::new().body(resp).send()?;
        }
        Ok(Msg::HttpRequest(req)) => handle_http_request(req, state, server)?,
        Err(e) => {
            return Err(anyhow::anyhow!(
                "Failed to parse message: {:?}; error: {}",
                String::from_utf8(message.body().to_vec()),
                e
            ))
        }
    }
    // Convert metadata to full notes for websocket updates
    let mut notes = Vec::new();
    for metadata in state.notes.values() {
        match state.get_full_note(metadata) {
            Ok(note) => notes.push(note),
            Err(_) => {
                // If we can't load content, create note with empty content
                notes.push(Note {
                    id: metadata.id.clone(),
                    name: metadata.name.clone(),
                    folder_id: metadata.folder_id.clone(),
                    note_type: metadata.note_type.clone(),
                    content: vec![],
                    is_public: metadata.is_public,
                    collaborators: metadata.collaborators.clone(),
                });
            }
        }
    }

    server.ws_push_all_channels(
        "/",
        http::server::WsMessageType::Text,
        LazyLoadBlob {
            mime: None,
            bytes: NoteResponse::GetStructure(Ok((
                state.folders.values().cloned().collect(),
                notes,
            )))
            .into(),
        },
    );
    Ok(())
}

call_init!(init);
fn init(our: Address) {
    init_logging(Level::DEBUG, Level::INFO, None, None, None).unwrap();
    info!("{our}: begin");

    let drive = vfs::create_drive(our.package_id(), "notes", None).unwrap();

    let mut state = State::load_from_disk(drive.clone()).unwrap_or_else(|e| {
        error!("Error loading state: {e}, starting fresh");
        State::new(drive.clone())
    });

    // Set up HTTP server
    let mut server = http::server::HttpServer::new(5);
    // Private endpoints
    let private_config = http::server::HttpBindingConfig::default();
    server
        .bind_http_path("/api", private_config.clone())
        .unwrap();
    server
        .bind_ws_path("/", http::server::WsBindingConfig::default())
        .unwrap();

    // Public endpoints
    let public_config = http::server::HttpBindingConfig::default().authenticated(false);
    server
        .bind_http_path("/public", public_config.clone())
        .unwrap();
    server
        .serve_ui("ui", vec!["/"], public_config.clone())
        .unwrap();

    hyperware_process_lib::homepage::add_to_homepage("wifenote", Some(ICON), Some(""), None);

    loop {
        match await_message() {
            Err(send_error) => error!("got SendError: {send_error}"),
            Ok(ref message) => match handle_message(message, &mut state, &mut server) {
                Ok(_) => {}
                Err(e) => error!("got error while handling message: {e:?}"),
            },
        }
    }
}
