//! Batching policy for terminal output on its way to the webview.
//!
//! Every `emit` from Rust to the frontend is expensive out of proportion to its
//! payload: tauri serialises it to JSON, wraps it in a JavaScript source string
//! and has the webview `eval` it. On Linux that means a cross-process message to
//! the WebKitWebProcess and a full JS parse - per call. A busy SSH channel hands
//! us hundreds of small packets a second, and paying that per packet is what
//! makes heavy output crawl.
//!
//! So we coalesce: batch what arrives inside a short window and emit once. The
//! subtlety is that a naive timer would also delay the *interactive* case, where
//! a keystroke echo is a single tiny packet and any added latency is felt
//! directly. Hence a leading edge - the first chunk after an idle period goes
//! out immediately, and only the packets that pile up behind it get batched.
//!
//! Net effect: typing stays as responsive as before, while `cat bigfile` turns
//! hundreds of emits per second into roughly one per window.

use std::time::{Duration, Instant};

/// How long a burst is allowed to accumulate before it must be flushed. Roughly
/// one 60 Hz frame - past this the terminal starts to look like it is lagging
/// behind the host rather than merely batching.
pub const WINDOW: Duration = Duration::from_millis(12);

/// Hard cap on a single batch, so a fast producer can't grow the buffer (and
/// the JSON payload built from it) without bound between ticks.
pub const MAX_BATCH: usize = 256 * 1024;

/// Accumulates terminal bytes and decides when they should be emitted.
///
/// The clock is passed in rather than read internally so the policy can be
/// tested without sleeping.
pub struct Coalescer {
    pending: Vec<u8>,
    deadline: Option<Instant>,
    window: Duration,
    max: usize,
}

impl Coalescer {
    pub fn new(window: Duration, max: usize) -> Self {
        Self { pending: Vec::new(), deadline: None, window, max }
    }

    /// When the caller should next call [`Coalescer::on_deadline`], or `None`
    /// while idle (in which case there is nothing to wake up for).
    pub fn deadline(&self) -> Option<Instant> {
        self.deadline
    }

    /// Feed freshly-read bytes. Returns bytes to emit *now*, if any.
    pub fn push(&mut self, data: &[u8], now: Instant) -> Option<Vec<u8>> {
        // Idle: this is the leading edge of a burst, so it goes out at once and
        // opens the window. This is the keystroke-echo path.
        if self.deadline.is_none() {
            self.deadline = Some(now + self.window);
            return Some(data.to_vec());
        }

        self.pending.extend_from_slice(data);

        // A producer fast enough to hit the cap inside one window gets flushed
        // early; waiting would only build a larger payload, not fewer of them.
        if self.pending.len() >= self.max {
            self.deadline = Some(now + self.window);
            return Some(std::mem::take(&mut self.pending));
        }
        None
    }

    /// The window elapsed. Returns the batch that accumulated, if any.
    pub fn on_deadline(&mut self, now: Instant) -> Option<Vec<u8>> {
        if self.pending.is_empty() {
            // Nothing piled up, so the burst is over: go idle so the next chunk
            // takes the leading edge again instead of waiting out a window.
            self.deadline = None;
            None
        } else {
            self.deadline = Some(now + self.window);
            Some(std::mem::take(&mut self.pending))
        }
    }

    /// Whatever is still buffered. Must be called before announcing that the
    /// session closed, or the tail of a command's output is silently dropped.
    pub fn take(&mut self) -> Option<Vec<u8>> {
        if self.pending.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.pending))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c() -> Coalescer {
        Coalescer::new(Duration::from_millis(12), 1024)
    }

    #[test]
    fn first_chunk_after_idle_is_emitted_immediately() {
        let mut c = c();
        let t0 = Instant::now();
        // The interactive case: a keystroke echo must not wait for a window.
        assert_eq!(c.push(b"a", t0).as_deref(), Some(&b"a"[..]));
        assert!(c.deadline().is_some());
    }

    #[test]
    fn chunks_inside_the_window_are_batched_not_emitted() {
        let mut c = c();
        let t0 = Instant::now();
        c.push(b"lead", t0);
        assert!(c.push(b"one", t0).is_none());
        assert!(c.push(b"two", t0).is_none());
        // ...and come out together, in order, when the window elapses.
        let batch = c.on_deadline(t0 + Duration::from_millis(12)).unwrap();
        assert_eq!(batch, b"onetwo");
    }

    #[test]
    fn an_empty_window_returns_to_idle_so_the_next_chunk_is_immediate() {
        let mut c = c();
        let t0 = Instant::now();
        c.push(b"lead", t0);
        assert!(c.on_deadline(t0 + Duration::from_millis(12)).is_none());
        assert!(c.deadline().is_none(), "should be idle again");
        // Back to the leading-edge path: immediate, not batched.
        let t1 = t0 + Duration::from_secs(5);
        assert_eq!(c.push(b"x", t1).as_deref(), Some(&b"x"[..]));
    }

    #[test]
    fn oversized_burst_flushes_early_instead_of_growing() {
        let mut c = Coalescer::new(Duration::from_millis(12), 8);
        let t0 = Instant::now();
        c.push(b"lead", t0);
        assert!(c.push(b"1234", t0).is_none());
        // Crossing the cap inside the window forces a flush.
        let out = c.push(b"5678", t0).expect("cap should force a flush");
        assert_eq!(out, b"12345678");
        assert!(c.take().is_none(), "flushed batch must not be left behind");
    }

    #[test]
    fn take_returns_the_tail_so_close_does_not_lose_output() {
        let mut c = c();
        let t0 = Instant::now();
        c.push(b"lead", t0);
        c.push(b"tail", t0);
        // This is the close path: the window never elapsed, but the bytes are
        // still owed to the terminal.
        assert_eq!(c.take().as_deref(), Some(&b"tail"[..]));
        assert!(c.take().is_none());
    }

    #[test]
    fn byte_order_is_preserved_across_a_long_burst() {
        let mut c = Coalescer::new(Duration::from_millis(12), MAX_BATCH);
        let t0 = Instant::now();
        let mut seen: Vec<u8> = Vec::new();
        let mut now = t0;
        for i in 0..500u32 {
            let chunk = format!("{i},").into_bytes();
            if let Some(out) = c.push(&chunk, now) {
                seen.extend_from_slice(&out);
            }
            if i % 20 == 0 {
                now += Duration::from_millis(12);
                if let Some(out) = c.on_deadline(now) {
                    seen.extend_from_slice(&out);
                }
            }
        }
        if let Some(out) = c.take() {
            seen.extend_from_slice(&out);
        }
        let expected: Vec<u8> = (0..500u32).flat_map(|i| format!("{i},").into_bytes()).collect();
        assert_eq!(seen, expected, "coalescing must not reorder or drop bytes");
    }
}
