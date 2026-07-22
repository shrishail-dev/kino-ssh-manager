//! Process manager - list and signal processes on the connected host, or
//! locally when invoked from a local-shell tab.
//!
//! Mirrors the transport split used by `docker`/`metrics`: remote queries run on
//! a fresh `channel_open_session()` over the existing SSH `Handle` (so they
//! never disturb the live terminal), local queries run through `sh -c`.

use russh::ChannelMsg;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;

use crate::ssh_session::ClientHandler;

type SshHandle = Arc<russh::client::Handle<ClientHandler>>;

const QUERY_TIMEOUT: Duration = Duration::from_secs(15);

/// Fields are emitted headerless (`=` suffix) and sorted by CPU. Capped so a
/// busy host can't flood the UI.
const PS_CMD: &str =
    "ps -eo pid=,ppid=,pcpu=,pmem=,rss=,user=,stat=,args= --sort=-pcpu 2>/dev/null | head -n 500";

#[derive(Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub cpu: f32,
    pub mem: f32,
    pub rss_kb: u64,
    pub user: String,
    /// `ps` state code, e.g. "S", "Rl", "Z".
    pub state: String,
    pub command: String,
}

/// Single-quote a value for safe interpolation into a remote shell command.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

struct ExecOutput {
    stdout: String,
    stderr: String,
    code: Option<u32>,
}

async fn exec(handle: Option<&SshHandle>, cmd: &str) -> Result<ExecOutput, String> {
    match handle {
        Some(handle) => {
            let mut channel = handle
                .channel_open_session()
                .await
                .map_err(|e| format!("Failed to open channel: {}", e))?;
            channel
                .exec(true, cmd)
                .await
                .map_err(|e| format!("exec failed: {}", e))?;

            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let mut code: Option<u32> = None;
            let read = timeout(QUERY_TIMEOUT, async {
                loop {
                    match channel.wait().await {
                        Some(ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            stderr.extend_from_slice(&data)
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => code = Some(exit_status),
                        Some(ChannelMsg::Close) | None => break,
                        _ => {}
                    }
                }
            })
            .await;
            if read.is_err() {
                return Err("Command timed out".to_string());
            }
            Ok(ExecOutput {
                stdout: String::from_utf8_lossy(&stdout).to_string(),
                stderr: String::from_utf8_lossy(&stderr).to_string(),
                code,
            })
        }
        None => {
            let output = timeout(
                QUERY_TIMEOUT,
                tokio::process::Command::new("sh").arg("-c").arg(cmd).output(),
            )
            .await
            .map_err(|_| "Command timed out".to_string())?
            .map_err(|e| format!("Failed to run command: {}", e))?;
            Ok(ExecOutput {
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                code: output.status.code().map(|c| c as u32),
            })
        }
    }
}

/// Parse one headerless `ps` row. Everything after the 7th column is the
/// command line, which may itself contain spaces.
fn parse_line(line: &str) -> Option<ProcessInfo> {
    let mut parts = line.split_whitespace();
    let pid = parts.next()?.parse().ok()?;
    let ppid = parts.next()?.parse().ok()?;
    let cpu = parts.next()?.parse().ok()?;
    let mem = parts.next()?.parse().ok()?;
    let rss_kb = parts.next()?.parse().ok()?;
    let user = parts.next()?.to_string();
    let state = parts.next()?.to_string();
    let command = parts.collect::<Vec<_>>().join(" ");
    if command.is_empty() {
        return None;
    }
    Some(ProcessInfo {
        pid,
        ppid,
        cpu,
        mem,
        rss_kb,
        user,
        state,
        command,
    })
}

pub fn parse_ps(text: &str) -> Vec<ProcessInfo> {
    text.lines().filter_map(parse_line).collect()
}

/// Resolve the transport: `Some(handle)` for a remote session, `None` for local.
fn transport(
    state: &crate::AppState,
    session_id: &str,
    local: bool,
) -> Result<Option<SshHandle>, String> {
    if local {
        return Ok(None);
    }
    let guard = state.sessions.lock().unwrap();
    let session = guard.get(session_id).ok_or("SSH session is not open")?;
    Ok(Some(Arc::clone(&session.handle)))
}

#[tauri::command]
pub async fn processes_list(
    state: tauri::State<'_, crate::AppState>,
    session_id: String,
    local: bool,
) -> Result<Vec<ProcessInfo>, String> {
    let handle = transport(&state, &session_id, local)?;
    let out = exec(handle.as_ref(), PS_CMD).await?;
    if out.stdout.trim().is_empty() {
        let msg = out.stderr.trim();
        if !msg.is_empty() {
            return Err(msg.to_string());
        }
        return Err("`ps` returned nothing - is it available on this host?".to_string());
    }
    Ok(parse_ps(&out.stdout))
}

/// Send a signal to a pid. `signal` is a name like "TERM" or "KILL".
#[tauri::command]
pub async fn process_kill(
    state: tauri::State<'_, crate::AppState>,
    session_id: String,
    local: bool,
    pid: u32,
    signal: String,
) -> Result<(), String> {
    // Only allow a known-safe signal set; never interpolate raw user input.
    let sig = match signal.to_uppercase().as_str() {
        "TERM" => "TERM",
        "KILL" => "KILL",
        "HUP" => "HUP",
        "INT" => "INT",
        other => return Err(format!("Unsupported signal: {}", other)),
    };
    let handle = transport(&state, &session_id, local)?;
    let cmd = format!("kill -{} {}", sig, shell_quote(&pid.to_string()));
    let out = exec(handle.as_ref(), &cmd).await?;
    if matches!(out.code, Some(0) | None) {
        return Ok(());
    }
    let msg = out.stderr.trim();
    Err(if msg.is_empty() {
        format!("Failed to signal pid {}", pid)
    } else {
        msg.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ps_rows_including_spaced_command() {
        let text = "\
  1234     1  12.5  3.2  51200 root     Ssl  /usr/bin/dockerd -H fd:// --containerd=/run/x.sock
    42     1   0.0  0.1   2048 alice    S    /bin/bash
";
        let procs = parse_ps(text);
        assert_eq!(procs.len(), 2);
        assert_eq!(procs[0].pid, 1234);
        assert_eq!(procs[0].ppid, 1);
        assert_eq!(procs[0].cpu, 12.5);
        assert_eq!(procs[0].mem, 3.2);
        assert_eq!(procs[0].rss_kb, 51200);
        assert_eq!(procs[0].user, "root");
        assert_eq!(procs[0].state, "Ssl");
        assert_eq!(
            procs[0].command,
            "/usr/bin/dockerd -H fd:// --containerd=/run/x.sock"
        );
        assert_eq!(procs[1].user, "alice");
    }

    #[test]
    fn skips_malformed_rows() {
        assert!(parse_ps("garbage\n\n  99 1 0.0 0.0 100 root S\n").is_empty());
    }
}
