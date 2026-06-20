import "./style.css";

type ChatRole = "user" | "assistant";
type ServerMessage =
  | { type: "status"; state?: string; text?: string }
  | { type: "chat"; role?: ChatRole; text?: string; partial?: boolean }
  | { type: "error"; message?: string }
  | { type: "tool"; phase?: string; name?: string; summary?: string };

const TARGET_SAMPLE_RATE = 16_000;
const MAX_UTTERANCE_MS = 30_000;

const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const pttBtn = document.getElementById("ptt");
const chatEl = document.getElementById("chat");
const wsUrl = resolveWsUrl();

let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
let pttActive = false;
let maxUtteranceTimer: number | undefined;

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let sampleRate = 48_000;
let chunks: Float32Array[] = [];

connect();

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
    setStatus("connected");
    setError("");
  });
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    handleServerMessage(event.data);
  });
  socket.addEventListener("close", () => {
    setStatus("disconnected");
    reconnectTimer = window.setTimeout(connect, 2000);
  });
  socket.addEventListener("error", () => {
    setError("socket error");
    socket?.close();
  });
}

function handleServerMessage(raw: string): void {
  try {
    const msg = JSON.parse(raw) as ServerMessage;
    if (msg.type === "status") {
      const state = (msg.state ?? "").trim();
      setStatus((msg.text ?? msg.state ?? "").trim());
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
      appendToolCard(msg.summary ?? msg.name ?? "working…", msg.phase ?? "start");
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

function appendToolCard(text: string, phase: string): void {
  if (chatEl === null) {
    return;
  }
  const item = document.createElement("article");
  item.className = `message tool tool--${phase}`;
  const roleEl = document.createElement("span");
  roleEl.className = "role";
  roleEl.textContent = phase === "done" ? "done" : "tool";
  const textEl = document.createElement("p");
  textEl.textContent = text;
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
