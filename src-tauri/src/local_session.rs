use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

pub enum TermCommand {
    Data(Vec<u8>),
    Resize(u16, u16),
    StartRecording(String),
    StopRecording,
    Close,
}

pub struct LocalSession {
    pub cmd_tx: std::sync::mpsc::Sender<TermCommand>,
}

pub type LocalSessions = Arc<Mutex<HashMap<String, LocalSession>>>;

pub fn connect(
    app_handle: AppHandle,
    sessions: LocalSessions,
    session_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let cmd = CommandBuilder::new("powershell.exe");

    #[cfg(not(target_os = "windows"))]
    let cmd = CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string()));

    connect_command(app_handle, sessions, session_id, cmd)
}

/// Spawn a local PTY running an arbitrary command. Used both for the default
/// shell and for `docker exec` container shells.
pub fn connect_command(
    app_handle: AppHandle,
    sessions: LocalSessions,
    session_id: String,
    cmd: CommandBuilder,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<TermCommand>();

    sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), LocalSession { cmd_tx });

    let sid = session_id.clone();
    let app_handle_read = app_handle.clone();
    let sid_read = session_id.clone();
    let sessions_read = sessions.clone();

    let recorder: Arc<Mutex<Option<crate::recorder::Recorder>>> = Arc::new(Mutex::new(None));
    let recorder_read = recorder.clone();

    // Reader thread. The PTY read is blocking, so batching can't be folded into
    // it the way the async SSH loop does - the last chunk of a burst would sit
    // in the buffer until the *next* read returned, which for an idle shell
    // means "until the user types something", i.e. a prompt that never appears.
    // So the reader only reads, and a second thread applies the same coalescing
    // policy driven by `recv_timeout`.
    let (out_tx, out_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    // Record per read, so timing in an asciicast stays true.
                    if let Ok(mut lock) = recorder_read.lock() {
                        if let Some(ref mut rec) = *lock {
                            let _ = rec.record_output(&buf[..n]);
                        }
                    }
                    if out_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // Dropping out_tx ends the emitter thread below.
    });

    // Emitter thread: batches output, then announces the close.
    thread::spawn(move || {
        use std::sync::mpsc::RecvTimeoutError;
        let data_event = format!("local-data-{}", sid_read);
        let closed_event = format!("local-closed-{}", sid_read);
        let mut batcher = crate::coalesce::Coalescer::new(
            crate::coalesce::WINDOW,
            crate::coalesce::MAX_BATCH,
        );

        loop {
            // While a burst is in flight, wake at the deadline; when idle, just
            // block until there is something to send.
            let received = match batcher.deadline() {
                Some(d) => out_rx.recv_timeout(d.saturating_duration_since(Instant::now())),
                None => out_rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match received {
                Ok(chunk) => {
                    if let Some(out) = batcher.push(&chunk, Instant::now()) {
                        app_handle_read.emit(&data_event, out).ok();
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if let Some(out) = batcher.on_deadline(Instant::now()) {
                        app_handle_read.emit(&data_event, out).ok();
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    // Flush before announcing the close, or the tail of the
                    // last command is lost.
                    if let Some(tail) = batcher.take() {
                        app_handle_read.emit(&data_event, tail).ok();
                    }
                    break;
                }
            }
        }

        sessions_read.lock().unwrap().remove(&sid_read);
        app_handle_read.emit(&closed_event, ()).ok();
    });

    let app_handle_write = app_handle.clone();
    let sessions_write = sessions.clone();

    // Writer thread
    thread::spawn(move || {
        while let Ok(cmd) = cmd_rx.recv() {
            match cmd {
                TermCommand::Data(data) => {
                    writer.write_all(&data).ok();
                }
                TermCommand::Resize(cols, rows) => {
                    pair.master
                        .resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        })
                        .ok();
                }
                TermCommand::StartRecording(path) => {
                    if let Ok(rec) =
                        crate::recorder::Recorder::new(std::path::Path::new(&path), 80, 24)
                    {
                        if let Ok(mut lock) = recorder.lock() {
                            *lock = Some(rec);
                        }
                    }
                }
                TermCommand::StopRecording => {
                    if let Ok(mut lock) = recorder.lock() {
                        *lock = None;
                    }
                }
                TermCommand::Close => {
                    child.kill().ok();
                    sessions_write.lock().unwrap().remove(&sid);
                    app_handle_write
                        .emit(&format!("local-closed-{}", sid), ())
                        .ok();
                    return;
                }
            }
        }
    });

    Ok(())
}
