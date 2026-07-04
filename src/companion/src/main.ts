import "./style.css";

type ChatRole = "user" | "assistant";
type ServerMessage =
  | { type: "status"; state?: string; text?: string }
  | { type: "chat"; role?: ChatRole; text?: string; partial?: boolean }
  | { type: "error"; message?: string }
  | { type: "tool"; phase?: string; name?: string; summary?: string }
  | {
      type: "launcher_command";
      action?: string;
      tab?: string;
      title?: string;
      content_type?: string;
    };

type AiContextResponse = {
  ok?: boolean;
  now_playing?: {
    active?: boolean;
    title?: string | null;
    message?: string;
  };
};

type CompanionSummaryResponse = {
  ok?: boolean;
  summary?: string;
  compiled_excerpt?: string;
  familiarity?: Record<string, unknown>;
};

const TARGET_SAMPLE_RATE = 16_000;
const MAX_UTTERANCE_MS = 30_000;

const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const pttBtn = document.getElementById("ptt");
const chatEl = document.getElementById("chat");
const composerForm = document.getElementById("composer");
const composerInput = document.getElementById("composer-input") as HTMLTextAreaElement | null;
const composerSubmit = composerForm?.querySelector("button[type='submit']");
const mirrorTabEl = document.getElementById("mirror-tab");
const mirrorOpenEl = document.getElementById("mirror-open");
const mirrorPlayingEl = document.getElementById("mirror-playing");
const mirrorToolEl = document.getElementById("mirror-tool");
const memoryToggle = document.getElementById("memory-toggle");
const memoryPanel = document.getElementById("memory-panel");
const youtubeStatusEl = document.getElementById("youtube-status");
const youtubeStartBtn = document.getElementById("youtube-auth-start");
const youtubeDisconnectBtn = document.getElementById("youtube-auth-disconnect");
const youtubeCodeEl = document.getElementById("youtube-auth-code");
const youtubeLinkEl = document.getElementById("youtube-auth-link");
const youtubeUserCodeEl = document.getElementById("youtube-user-code");
const wsUrl = resolveWsUrl();

let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
let pttActive = false;
let maxUtteranceTimer: number | undefined;
let youtubePollTimer: number | undefined;
let connected = false;
let voiceBusy = false;
let mirrorPollTimer: number | undefined;
let mirrorTab = "—";
let mirrorOpen = "—";
let mirrorTool = "—";

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let sampleRate = 48_000;
let chunks: Float32Array[] = [];

connect();
void loadYoutubeState();
startMirrorPoll();

function resolveWsUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.VITE_ORCH_WS !== undefined && env.VITE_ORCH_WS.trim() !== "") {
    return env.VITE_ORCH_WS;
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname || "127.0.0.1";
  return `${scheme}://${host}:8765/ws`;
}

function connect(): void {
  window.clearTimeout(reconnectTimer);
  socket = new WebSocket(wsUrl);
  socket.addEventListener("open", () => {
    connected = true;
    updateComposerState();
    setStatus("connected");
    setError("");
  });
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    handleServerMessage(event.data);
  });
  socket.addEventListener("close", () => {
    connected = false;
    updateComposerState();
    setStatus("disconnected");
    reconnectTimer = window.setTimeout(connect, 2000);
  });
  socket.addEventListener("error", () => {
    setError("socket error");
    socket?.close();
  });
}

function updateComposerState(): void {
  const disabled = !connected || voiceBusy;
  composerInput?.toggleAttribute("disabled", disabled);
  if (composerSubmit instanceof HTMLButtonElement) {
    composerSubmit.disabled = disabled;
  }
}

function handleServerMessage(raw: string): void {
  try {
    const msg = JSON.parse(raw) as ServerMessage;
    if (msg.type === "status") {
      const state = (msg.state ?? "").trim();
      setStatus((msg.text ?? msg.state ?? "").trim());
      voiceBusy = state === "listening" || state === "thinking";
      updateComposerState();
      if (state === "idle") {
        mirrorTool = "—";
        renderMirror();
      }
      if (state === "idle" || state === "listening") {
        setError("");
      }
      return;
    }
    if (msg.type === "chat" && msg.role !== undefined && msg.text !== undefined) {
      if (msg.partial === true && msg.role === "assistant") {
        upsertAssistantPartial(msg.text);
        return;
      }
      appendChat(msg.role, msg.text);
      return;
    }
    if (msg.type === "error") {
      setError(msg.message ?? "voice error");
      return;
    }
    if (msg.type === "tool") {
      const summary = msg.summary ?? msg.name ?? "working…";
      mirrorTool = summary;
      renderMirror();
      appendToolCard(summary, msg.phase ?? "start");
      return;
    }
    if (msg.type === "launcher_command") {
      applyLauncherMirror(msg);
      return;
    }
  } catch {
    setStatus(raw.trim());
  }
}

function setStatus(text: string): void {
  if (statusEl !== null) {
    statusEl.textContent = text;
  }
}

function setError(text: string): void {
  if (errorEl !== null) {
    errorEl.textContent = text;
    errorEl.toggleAttribute("hidden", text.length === 0);
  }
}

function formatTabLabel(tab: string): string {
  const labels: Record<string, string> = {
    movies: "Movies",
    series: "Series",
    youtube: "YouTube",
    live: "Live",
  };
  return labels[tab] ?? tab;
}

function applyLauncherMirror(msg: Extract<ServerMessage, { type: "launcher_command" }>): void {
  const action = (msg.action ?? "").trim();
  if (action === "tab" && typeof msg.tab === "string" && msg.tab.length > 0) {
    mirrorTab = formatTabLabel(msg.tab);
  } else if (action === "open_detail") {
    const title = typeof msg.title === "string" ? msg.title.trim() : "";
    if (title.length > 0) {
      mirrorOpen = title;
    }
    if (typeof msg.tab === "string" && msg.tab.length > 0) {
      mirrorTab = formatTabLabel(msg.tab);
    }
  } else if (action === "home") {
    mirrorOpen = "—";
  }
  renderMirror();
}

function renderMirror(): void {
  if (mirrorTabEl !== null) {
    mirrorTabEl.textContent = mirrorTab;
  }
  if (mirrorOpenEl !== null) {
    mirrorOpenEl.textContent = mirrorOpen;
  }
  if (mirrorToolEl !== null) {
    mirrorToolEl.textContent = mirrorTool;
  }
}

function startMirrorPoll(): void {
  window.clearInterval(mirrorPollTimer);
  void refreshMirrorPlaying();
  mirrorPollTimer = window.setInterval(() => {
    void refreshMirrorPlaying();
  }, 5000);
}

async function refreshMirrorPlaying(): Promise<void> {
  try {
    const ctx = await catalogFetch<AiContextResponse>("/ai/context");
    const np = ctx.now_playing;
    let playing = "—";
    if (np?.active && typeof np.title === "string" && np.title.trim().length > 0) {
      playing = np.title.trim();
    } else if (typeof np?.message === "string" && np.message.trim().length > 0) {
      playing = np.message.trim();
    }
    if (mirrorPlayingEl !== null) {
      mirrorPlayingEl.textContent = playing;
    }
  } catch {
    if (mirrorPlayingEl !== null) {
      mirrorPlayingEl.textContent = "—";
    }
  }
}

async function toggleMemoryPanel(): Promise<void> {
  if (memoryPanel === null) {
    return;
  }
  const showing = !memoryPanel.hasAttribute("hidden");
  if (showing) {
    memoryPanel.setAttribute("hidden", "");
    return;
  }
  memoryPanel.textContent = "loading…";
  memoryPanel.removeAttribute("hidden");
  try {
    const data = await catalogFetch<CompanionSummaryResponse>("/voice/companion/summary");
    const parts = [data.summary, data.compiled_excerpt].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0,
    );
    memoryPanel.textContent = parts.length > 0 ? parts.join("\n\n") : "mango has no saved notes yet";
  } catch (error) {
    memoryPanel.textContent = error instanceof Error ? error.message : "memory unavailable";
  }
}

function setYoutubeStatus(text: string): void {
  if (youtubeStatusEl !== null) {
    youtubeStatusEl.textContent = text;
  }
}

function showYoutubeCode(payload: {
  user_code?: string;
  verification_url?: string;
  verification_url_complete?: string;
}): void {
  if (youtubeCodeEl !== null) {
    youtubeCodeEl.toggleAttribute("hidden", !payload.user_code);
  }
  if (youtubeUserCodeEl !== null) {
    youtubeUserCodeEl.textContent = payload.user_code ?? "";
  }
  if (youtubeLinkEl instanceof HTMLAnchorElement) {
    const href = payload.verification_url_complete || payload.verification_url || "#";
    youtubeLinkEl.href = href;
    youtubeLinkEl.textContent = payload.verification_url || "Google device login";
  }
}

async function catalogFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/catalog${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof (data as { error?: string }).error === "string"
      ? (data as { error: string }).error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

async function loadYoutubeState(): Promise<void> {
  try {
    const state = await catalogFetch<{
      configured?: { api_key?: boolean; oauth_client?: boolean };
      auth?: { authenticated?: boolean; configured?: boolean };
      refresh?: { last_error?: string | null };
    }>("/youtube/state");
    if (state.auth?.authenticated) {
      setYoutubeStatus("connected");
    } else if (!state.auth?.configured) {
      setYoutubeStatus("OAuth client missing on Pi");
    } else if (!state.configured?.api_key) {
      setYoutubeStatus("API key missing on Pi");
    } else if (state.refresh?.last_error) {
      setYoutubeStatus(`needs attention: ${state.refresh.last_error}`);
    } else {
      setYoutubeStatus("not connected");
    }
  } catch {
    setYoutubeStatus("YouTube status unavailable");
  }
}

async function startYoutubeAuth(): Promise<void> {
  window.clearInterval(youtubePollTimer);
  try {
    const started = await catalogFetch<{
      session_id: string;
      user_code: string;
      verification_url: string;
      verification_url_complete?: string;
      interval_sec?: number;
    }>("/youtube/auth/start", { method: "POST" });
    showYoutubeCode(started);
    setYoutubeStatus("waiting for Google login…");
    const pollMs = Math.max(1000, (started.interval_sec ?? 5) * 1000);
    youtubePollTimer = window.setInterval(() => {
      void pollYoutubeAuth(started.session_id);
    }, pollMs);
    void pollYoutubeAuth(started.session_id);
  } catch (error) {
    setYoutubeStatus(error instanceof Error ? error.message : "could not start YouTube auth");
  }
}

async function pollYoutubeAuth(sessionId: string): Promise<void> {
  try {
    const poll = await catalogFetch<{ status?: string; interval_sec?: number }>(
      `/youtube/auth/poll?session_id=${encodeURIComponent(sessionId)}`,
    );
    if (poll.status === "authenticated") {
      window.clearInterval(youtubePollTimer);
      showYoutubeCode({});
      setYoutubeStatus("connected");
      return;
    }
    if (poll.status === "expired") {
      window.clearInterval(youtubePollTimer);
      setYoutubeStatus("code expired — connect again");
      return;
    }
    setYoutubeStatus(poll.status === "slow_down" ? "waiting — Google asked us to slow down" : "waiting for Google login…");
  } catch (error) {
    window.clearInterval(youtubePollTimer);
    setYoutubeStatus(error instanceof Error ? error.message : "YouTube auth failed");
  }
}

async function disconnectYoutube(): Promise<void> {
  window.clearInterval(youtubePollTimer);
  try {
    await catalogFetch("/youtube/auth/disconnect", { method: "POST" });
    showYoutubeCode({});
    setYoutubeStatus("not connected");
  } catch (error) {
    setYoutubeStatus(error instanceof Error ? error.message : "could not disconnect YouTube");
  }
}

function appendToolCard(text: string, phase: string): void {
  if (chatEl === null) {
    return;
  }
  const display = phase === "done" && text.startsWith("Creating AI catalog")
    ? `${text} — building rail in background`
    : text;
  const item = document.createElement("article");
  item.className = `message tool tool--${phase}`;
  const roleEl = document.createElement("span");
  roleEl.className = "role";
  roleEl.textContent = phase === "done" ? "done" : "tool";
  const textEl = document.createElement("p");
  textEl.textContent = display;
  item.append(roleEl, textEl);
  chatEl.append(item);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function appendChat(role: ChatRole, text: string): void {
  if (chatEl === null) {
    return;
  }
  if (role === "assistant") {
    chatEl.querySelector('article.message.assistant[data-partial="true"]')?.remove();
  }
  const item = document.createElement("article");
  item.className = `message ${role}`;
  if (role === "assistant") {
    item.dataset.partial = "false";
  }
  const roleEl = document.createElement("span");
  roleEl.className = "role";
  roleEl.textContent = role === "user" ? "you" : "mango";
  const textEl = document.createElement("p");
  textEl.textContent = text;
  item.append(roleEl, textEl);
  chatEl.append(item);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function upsertAssistantPartial(text: string): void {
  if (chatEl === null) {
    return;
  }
  let item = chatEl.querySelector<HTMLElement>('article.message.assistant[data-partial="true"]');
  if (item === null) {
    item = document.createElement("article");
    item.className = "message assistant";
    item.dataset.partial = "true";
    const roleEl = document.createElement("span");
    roleEl.className = "role";
    roleEl.textContent = "mango";
    const textEl = document.createElement("p");
    item.append(roleEl, textEl);
    chatEl.append(item);
  }
  const textEl = item.querySelector("p");
  if (textEl !== null) {
    textEl.textContent = text;
  }
  item.dataset.partial = "true";
  chatEl.scrollTop = chatEl.scrollHeight;
}

function send(msg: Record<string, string>): boolean {
  if (socket?.readyState !== WebSocket.OPEN) {
    setError("not connected to mango");
    return false;
  }
  socket.send(JSON.stringify(msg));
  return true;
}

async function startPtt(): Promise<void> {
  if (pttActive) {
    return;
  }
  if (!window.isSecureContext || navigator.mediaDevices === undefined) {
    setError("open the companion over HTTPS to use the microphone");
    return;
  }
  if (socket?.readyState !== WebSocket.OPEN) {
    setError("waiting for mango connection");
    return;
  }

  try {
    await startCapture();
  } catch (error) {
    setError(error instanceof Error ? error.message : "microphone unavailable");
    await stopCapture();
    return;
  }

  pttActive = true;
  pttBtn?.classList.add("active");
  setError("");
  send({ type: "ptt_start" });
  maxUtteranceTimer = window.setTimeout(() => {
    setError("sent first 30 seconds");
    void endPtt();
  }, MAX_UTTERANCE_MS);
}

async function endPtt(): Promise<void> {
  if (!pttActive) {
    return;
  }
  pttActive = false;
  window.clearTimeout(maxUtteranceTimer);
  pttBtn?.classList.remove("active");

  try {
    const captured = await stopCapture();
    if (captured.length === 0) {
      send({ type: "ptt_cancel" });
      setError("no microphone audio captured");
      return;
    }
    send({ type: "ptt_end", pcm_b64: bytesToBase64(captured) });
  } catch (error) {
    send({ type: "ptt_cancel" });
    setError(error instanceof Error ? error.message : "could not encode microphone audio");
  }
}

async function startCapture(): Promise<void> {
  chunks = [];
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: TARGET_SAMPLE_RATE },
      echoCancellation: true,
      // Noise suppression can clip Hindi/Hinglish consonants on phone mics.
      noiseSuppression: false,
      autoGainControl: true,
    },
  });
  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioContextCtor === undefined) {
    throw new Error("Web Audio is not available");
  }
  audioContext = new AudioContextCtor();
  sampleRate = audioContext.sampleRate;
  await audioContext.resume();
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  // ScriptProcessor is deprecated, but reliable for short PTT without AudioWorklet
  // module loading on LAN certs. Route through zero-gain — never to speakers
  // (monitoring caused echo on phone mic).
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
    if (!pttActive) {
      return;
    }
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  sourceNode.connect(processorNode);
  processorNode.connect(silentGain);
  silentGain.connect(audioContext.destination);
}

async function stopCapture(): Promise<Uint8Array> {
  processorNode?.disconnect();
  sourceNode?.disconnect();
  mediaStream?.getTracks().forEach((track) => {
    track.stop();
  });
  await audioContext?.close();

  processorNode = null;
  sourceNode = null;
  mediaStream = null;
  audioContext = null;

  const merged = mergeChunks(chunks);
  chunks = [];
  if (merged.length === 0) {
    return new Uint8Array();
  }
  const downsampled = resampleMono(merged, sampleRate, TARGET_SAMPLE_RATE);
  return floatToPcm16Le(downsampled);
}

function mergeChunks(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function resampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) {
    return input;
  }
  const ratio = fromRate / toRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const before = Math.floor(sourceIndex);
    const after = Math.min(before + 1, input.length - 1);
    const weight = sourceIndex - before;
    output[i] = input[before] * (1 - weight) + input[after] * weight;
  }
  return output;
}

function floatToPcm16Le(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(i * 2, value, true);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

if (pttBtn instanceof HTMLButtonElement) {
  pttBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    void startPtt();
  });
  window.addEventListener("pointerup", () => {
    void endPtt();
  });
  pttBtn.addEventListener("pointercancel", () => {
    void endPtt();
  });
  pttBtn.addEventListener("lostpointercapture", () => {
    void endPtt();
  });
}

if (youtubeStartBtn instanceof HTMLButtonElement) {
  youtubeStartBtn.addEventListener("click", () => {
    void startYoutubeAuth();
  });
}

if (youtubeDisconnectBtn instanceof HTMLButtonElement) {
  youtubeDisconnectBtn.addEventListener("click", () => {
    void disconnectYoutube();
  });
}

if (memoryToggle instanceof HTMLButtonElement) {
  memoryToggle.addEventListener("click", () => {
    void toggleMemoryPanel();
  });
}

if (composerForm instanceof HTMLFormElement && composerInput instanceof HTMLTextAreaElement) {
  composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = composerInput.value.trim();
    if (text.length === 0) {
      return;
    }
    if (send({ type: "chat_send", text })) {
      composerInput.value = "";
      composerInput.focus();
    }
  });

  composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composerForm.requestSubmit();
    }
  });
}
