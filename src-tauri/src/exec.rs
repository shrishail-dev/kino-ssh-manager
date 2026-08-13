//! Run a one-off command against whatever a tab is connected to.
//!
//! Remote commands open a fresh `channel_open_session()` on the SSH `Handle`
//! that the terminal is already using, so they never disturb the live shell -
//! nothing is typed into the user's session and nothing lands in their history.
//! Local-shell tabs run the same command through `sh -c`.
//!
//! Started life inside `processes`, and now that `cron` needs the identical
//! shape it lives here. `docker` keeps its own variant: it runs local commands
//! from an argument vector rather than a shell string, so it never needs quoting.

use russh::ChannelMsg;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;

use crate::ssh_session::ClientHandler;

pub type SshHandle = Arc<russh::client::Handle<ClientHandler>>;

pub const QUERY_TIMEOUT: Duration = Duration::from_secs(15);

/// Single-quote a value for safe interpolation into a remote shell command.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<u32>,
}

pub async fn exec(handle: Option<&SshHandle>, cmd: &str) -> Result<ExecOutput, String> {
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
                tokio::process::Command::new("sh")
                    .arg("-c")
                    .arg(cmd)
                    .output(),
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

/// Resolve the transport: `Some(handle)` for a remote session, `None` for local.
pub fn transport(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quote_neutralises_embedded_quotes() {
        assert_eq!(shell_quote("plain"), "'plain'");
        // The classic break-out attempt has to end up inert.
        assert_eq!(shell_quote("a'; rm -rf /; '"), r#"'a'\''; rm -rf /; '\'''"#);
    }
}
