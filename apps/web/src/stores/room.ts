import { defineStore } from "pinia";
import type { Room as LiveKitRoom } from "livekit-client";
import { assetUrl, serverBase, socket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import { useAppStore } from "./app";
import type { MusicTrack, PublicUser, RoomInfo, RoomMsg, RoomMusic, RoomState, Seat, SeatLayout } from "../types";

// LiveKit connection lives at module scope (non-reactive) so audio survives
// minimizing the room; only the status string is reactive state.
let lkRoom: LiveKitRoom | null = null;
let lkAudioEls: HTMLMediaElement[] = [];

// Shared room music player — module scope so it keeps playing while minimized.
let musicEl: HTMLAudioElement | null = null;
let musicListenersBound = false;
function ensureMusicEl(store: any): HTMLAudioElement {
  if (!musicEl) {
    musicEl = new Audio();
    musicEl.preload = "auto";
    // Required before the src is ever set: Supabase Storage serves music
    // cross-origin, and Web Audio processing (below) silently produces no
    // sound from an unmarked cross-origin element even when the response has
    // permissive CORS headers.
    musicEl.crossOrigin = "anonymous";
  }
  if (!musicListenersBound) {
    musicListenersBound = true;
    musicEl.addEventListener("timeupdate", () => (store.musicPosition = musicEl!.currentTime));
    musicEl.addEventListener("loadedmetadata", () => (store.musicDuration = musicEl!.duration || 0));
    musicEl.addEventListener("ended", () => {
      // Loop the playlist by default — only a controller (owner/staff)
      // advances; the server's trackId check prevents a double-advance if
      // more than one controller's client fires this at once.
      if (store.canControlMusic()) store.nextTrack();
    });
  }
  return musicEl;
}

// Music volume on iOS: <audio>.volume is a documented WebKit no-op — only the
// hardware buttons control media volume there, so the slider "works" on
// desktop and silently does nothing on iPhone. Routing through a Web Audio
// GainNode sidesteps that (iOS does respect gain). Kept as its own
// AudioContext, entirely separate from the LiveKit voice-boost graph, so
// disconnecting/reconnecting voice can never affect music playback.
let musicCtx: AudioContext | null = null;
let musicGain: GainNode | null = null;
let musicSource: MediaElementAudioSourceNode | null = null;

function applyMusicVolume(el: HTMLAudioElement, volume: number) {
  el.volume = volume; // native fallback path; harmless where it's a no-op
  try {
    if (!musicCtx) {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      musicCtx = new Ctx();
    }
    if (!musicSource) {
      // Can only be created once per element — cache it for the element's
      // lifetime (it's a module-level singleton, so this runs once ever).
      musicSource = musicCtx.createMediaElementSource(el);
      musicGain = musicCtx.createGain();
      musicSource.connect(musicGain).connect(musicCtx.destination);
    }
    musicGain!.gain.value = volume;
    // Only silence the native element (handing output to the gain node) once
    // the context is confirmed running; while suspended, leave it audible at
    // its native volume so sound isn't lost to a blocked AudioContext.
    const sync = () => (el.muted = musicCtx!.state === "running");
    musicCtx.resume().then(sync).catch(() => {});
    sync();
  } catch {
    // Web Audio unavailable — native volume above is already applied.
  }
}

export type RoomAudioStatus = "off" | "connecting" | "on" | "unavailable";

// Playback boost: an <audio> element maxes out at volume 1.0, which is too
// quiet for comfortable listening, so remote voices are routed through a Web
// Audio gain stage that can amplify past 1.0, with a compressor acting as a
// limiter so the extra gain doesn't distort loud peaks.
const VOICE_GAIN = 2.6;
let audioCtx: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;
const trackGain = new Map<string, () => void>(); // track sid -> cleanup

function ensureAudioGraph() {
  if (audioCtx) return;
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  audioCtx = new Ctx();
  limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(audioCtx.destination);
}

function boostTrack(track: any, el: HTMLMediaElement) {
  try {
    ensureAudioGraph();
    const ctx = audioCtx!;
    // Chrome only feeds a WebRTC track into Web Audio while it's also attached
    // to a media element, so keep the element as a sink and let the gain graph
    // do the actual output.
    const source = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    const gain = ctx.createGain();
    gain.gain.value = VOICE_GAIN;
    source.connect(gain).connect(limiter!);
    // Only silence the element (handing output to the boosted graph) once the
    // context is actually running; if it's suspended, the element stays
    // audible so voices aren't lost to a blocked AudioContext.
    const sync = () => (el.muted = ctx.state === "running");
    ctx.resume().then(sync).catch(() => {});
    sync();
    trackGain.set(track.sid ?? "", () => {
      source.disconnect();
      gain.disconnect();
    });
  } catch {
    // Web Audio unavailable — leave the element unmuted so voices still play
    // (quiet, but audible) rather than going silent.
  }
}

function teardownAudioGraph() {
  for (const cleanup of trackGain.values()) cleanup();
  trackGain.clear();
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  limiter = null;
}

/**
 * Bias mobile audio output toward the loudspeaker instead of the earpiece.
 * iOS routes a mic-active WebRTC session to the receiver ("phone call" mode);
 * the WebKit AudioSession API lets us ask for "playback" while only listening,
 * which forces the speaker. A seated speaker still needs "play-and-record"
 * (earpiece on iOS) — true speaker-while-talking requires the native layer
 * (Capacitor: AVAudioSession.overrideOutputAudioPort(.speaker)).
 */
function routeAudio(seated: boolean) {
  const session = (navigator as any).audioSession;
  if (!session) return;
  try {
    session.type = seated ? "play-and-record" : "playback";
  } catch {}
}

/**
 * The active room lives in a global store so leaving the room *page* doesn't
 * leave the room itself — a dock pill (RoomDock) keeps it reachable anywhere.
 * Call features force-leave via router logic, per product rule.
 */
export const useRoomStore = defineStore("room", {
  state: () => ({
    room: null as RoomInfo | null,
    messages: [] as RoomMsg[],
    members: [] as PublicUser[],
    seats: Array(10).fill(null) as (Seat | null)[],
    hostId: 0,
    admins: [] as number[],
    requests: [] as { user: PublicUser; seat: number }[],
    inviteSeat: null as number | null, // pending seat invite for me
    unread: 0,
    viewing: false, // true while RoomView is on screen
    audio: "off" as RoomAudioStatus,
    layout: "grid" as SeatLayout,
    locked: false,
    disabled: [] as number[],
    background: null as string | null,
    kickedFrom: null as string | null, // room name we were just kicked from
    speaking: [] as number[], // user ids currently talking (from LiveKit)
    music: null as RoomMusic | null,
    musicClockSkew: 0, // serverNow - clientNow, for position sync
    musicBlocked: false, // autoplay was blocked; needs a user tap
    musicVolume: Math.min(1, Math.max(0, Number(localStorage.getItem("sora:musicVol") ?? 0.7))),
    musicPosition: 0, // seconds, ticks live from the <audio> element
    musicDuration: 0, // seconds, once metadata loads
    myTracks: [] as MusicTrack[],
  }),
  getters: {
    myUserId(): number {
      return useAppStore().user?.id ?? -1;
    },
    isHost(): boolean {
      return this.hostId === this.myUserId;
    },
    isStaff(): boolean {
      return this.isHost || this.admins.includes(this.myUserId);
    },
    mySeatIndex(state): number {
      return state.seats.findIndex((s) => s?.id === this.myUserId);
    },
    myRequestSeat(state): number | null {
      return state.requests.find((r) => r.user.id === this.myUserId)?.seat ?? null;
    },
    iAmDisabled(state): boolean {
      return state.disabled.includes(this.myUserId);
    },
    isDisabled(): (userId: number) => boolean {
      return (userId: number) => this.disabled.includes(userId);
    },
  },
  actions: {
    bind() {
      socket.on("room:message", ({ roomId, message }: { roomId: string; message: RoomMsg }) => {
        if (roomId !== this.room?.id) return;
        this.messages.push(message);
        if (this.messages.length > 200) this.messages.shift();
        if (!this.viewing) this.unread++;
      });
      socket.on("room:members", ({ roomId, members }: { roomId: string; members: PublicUser[] }) => {
        if (roomId === this.room?.id) this.members = members;
      });
      socket.on("room:state", (state: RoomState) => {
        if (state.roomId !== this.room?.id) return;
        this.applyState(state);
        this.syncMic();
      });
      socket.on("room:seatInvite", ({ roomId, seat }: { roomId: string; seat: number }) => {
        if (roomId === this.room?.id) this.inviteSeat = seat;
      });
      socket.on("room:kicked", ({ roomId, roomName }: { roomId: string; roomName: string }) => {
        if (roomId !== this.room?.id) return;
        this.disconnectAudio();
        this.stopMusicLocal();
        this.$reset();
        this.kickedFrom = roomName;
      });
      socket.on("room:music", (payload: { roomId: string; music: RoomMusic | null; serverNow: number }) => {
        if (payload.roomId !== this.room?.id) return;
        this.musicClockSkew = payload.serverNow - Date.now();
        this.music = payload.music;
        this.syncMusic();
      });
    },
    /** Returns true on success, or the join error string ("pin_required" | "pin_wrong"). */
    async join(roomId: string, pin?: string): Promise<true | string> {
      if (this.room?.id === roomId) return true;
      const res = await socket.emitWithAck("room:join", { roomId, pin });
      if (!res) return "gone";
      if (res.error) return res.error;
      if (this.room) this.leave(); // switching rooms
      this.room = res.room;
      this.messages = res.messages;
      this.members = res.members;
      this.applyState(res.state);
      this.inviteSeat = res.myInviteSeat;
      this.unread = 0;
      this.connectAudio();
      if (res.music) {
        this.musicClockSkew = res.music.serverNow - Date.now();
        this.music = res.music.music;
        this.syncMusic();
      }
      return true;
    },
    applyState(state: RoomState) {
      this.seats = state.seats;
      this.hostId = state.hostId;
      this.admins = state.admins;
      this.requests = state.requests;
      this.layout = state.layout ?? "grid";
      this.locked = !!state.locked;
      this.disabled = state.disabled ?? [];
      this.background = state.background ?? null;
      if (this.room) {
        if (state.name) this.room.name = state.name;
        this.room.locked = !!state.locked;
      }
    },
    async rename(name: string): Promise<string | null> {
      if (!this.room) return null;
      const res = await socket.emitWithAck("room:rename", { roomId: this.room.id, name });
      if (res?.error) return res.error;
      this.room.name = res.name;
      return null;
    },
    leave() {
      if (this.room) socket.emit("room:leave", { roomId: this.room.id });
      this.disconnectAudio();
      this.stopMusicLocal();
      this.$reset();
    },
    // ---- room music -------------------------------------------------------
    /** Align the local <audio> with the shared room state. */
    syncMusic() {
      const el = ensureMusicEl(this);
      const m = this.music;
      if (!m) {
        el.pause();
        el.removeAttribute("src");
        this.musicPosition = 0;
        this.musicDuration = 0;
        return;
      }
      const src = new URL(assetUrl(m.src), serverBase || window.location.origin).href;
      if (el.src !== src) {
        el.src = src;
        this.musicDuration = 0;
      }
      applyMusicVolume(el, this.musicVolume);
      const position = m.offset + (m.playing ? (Date.now() + this.musicClockSkew - m.startedAt) / 1000 : 0);
      if (Math.abs(el.currentTime - position) > 1.5) el.currentTime = Math.max(0, position);
      if (m.playing) {
        el.play()
          .then(() => (this.musicBlocked = false))
          .catch(() => (this.musicBlocked = true)); // autoplay policy — needs a tap
      } else {
        el.pause();
      }
    },
    /** Retry after an autoplay block, from a user gesture. */
    tapToHearMusic() {
      this.musicBlocked = false;
      this.syncMusic();
    },
    /** Per-listener music volume (0–1), remembered across rooms. */
    setMusicVolume(v: number) {
      this.musicVolume = Math.min(1, Math.max(0, v));
      if (musicEl) applyMusicVolume(musicEl, this.musicVolume);
      localStorage.setItem("sora:musicVol", String(this.musicVolume));
    },
    stopMusicLocal() {
      musicEl?.pause();
      musicEl?.removeAttribute("src");
      this.musicPosition = 0;
      this.musicDuration = 0;
    },
    async loadMyTracks() {
      this.myTracks = (await socket.emitWithAck("music:list")) ?? [];
    },
    async uploadMusic(file: File): Promise<string | null> {
      if (!supabase) return "Not signed in";
      const { data } = await supabase.auth.getSession();
      if (!data.session) return "Not signed in";
      try {
        const res = await fetch(`${serverBase}/music`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${data.session.access_token}`,
            // header values must be Latin1 — encode so unicode filenames work
            "x-filename": encodeURIComponent(file.name),
            "content-type": "application/octet-stream",
          },
          body: file,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) return body?.error ?? `Upload failed (server said ${res.status})`;
        if (!body) return "Upload failed — unexpected response";
        this.myTracks = [body, ...this.myTracks];
        return null;
      } catch {
        return "Upload failed — the server may be waking up, try again in a moment";
      }
    },
    async deleteMusic(id: number) {
      const res = await socket.emitWithAck("music:delete", { id });
      if (Array.isArray(res)) this.myTracks = res;
    },
    /** Reorder your library; `ids` is the full track id list in new order. */
    async reorderMusic(ids: number[]) {
      const res = await socket.emitWithAck("music:reorder", { ids });
      if (Array.isArray(res)) this.myTracks = res;
      return Array.isArray(res) ? null : (res?.error ?? "Reorder failed");
    },
    /** Link the currently playing track into my own library (no re-upload). */
    async addCurrentToPlaylist(): Promise<string | null> {
      if (!this.room) return null;
      const res = await socket.emitWithAck("music:addFromRoom", { roomId: this.room.id });
      if (Array.isArray(res?.list)) this.myTracks = res.list;
      return res?.error ?? null;
    },
    async playTrack(id: number): Promise<string | null> {
      if (!this.room) return null;
      const res = await socket.emitWithAck("room:musicPlay", { roomId: this.room.id, id });
      return res?.error ?? null;
    },
    pauseMusic() {
      if (this.room) socket.emit("room:musicPause", { roomId: this.room.id });
    },
    resumeMusic() {
      if (this.room) socket.emit("room:musicResume", { roomId: this.room.id });
    },
    stopMusic() {
      if (this.room) socket.emit("room:musicStop", { roomId: this.room.id });
    },
    /** Scrub to a position in seconds (controller only). */
    seekMusic(time: number) {
      if (this.room && this.canControlMusic()) {
        this.musicPosition = time; // optimistic, so the slider doesn't snap back
        socket.emit("room:musicSeek", { roomId: this.room.id, time });
      }
    },
    nextTrack() {
      if (this.room) socket.emit("room:musicNext", { roomId: this.room.id, trackId: this.music?.trackId });
    },
    prevTrack() {
      if (this.room) socket.emit("room:musicPrev", { roomId: this.room.id, trackId: this.music?.trackId });
    },
    canControlMusic(): boolean {
      return !!this.music && (this.music.ownerId === this.myUserId || this.isStaff);
    },
    /** Connect to the room's LiveKit session; remote audio plays via hidden elements. */
    async connectAudio() {
      if (!this.room || lkRoom) return;
      const roomId = this.room.id;
      const res = await socket.emitWithAck("livekit:token", { roomId });
      if (res?.error || !res?.token) {
        this.audio = "unavailable";
        return;
      }
      this.audio = "connecting";
      try {
        const { Room, RoomEvent } = await import("livekit-client");
        const lk = new Room();
        lkRoom = lk;
        lk.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind !== "audio") return;
          const el = track.attach();
          el.style.display = "none";
          document.body.appendChild(el);
          lkAudioEls.push(el);
          boostTrack(track, el);
        });
        lk.on(RoomEvent.TrackUnsubscribed, (track) => {
          const sid = track.sid ?? "";
          trackGain.get(sid)?.();
          trackGain.delete(sid);
          for (const el of track.detach()) {
            el.remove();
            lkAudioEls = lkAudioEls.filter((x) => x !== el);
          }
        });
        lk.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          this.speaking = speakers.map((p) => Number(p.identity)).filter(Number.isFinite);
        });
        lk.on(RoomEvent.Disconnected, () => {
          if (lkRoom === lk) this.disconnectAudio();
        });
        await lk.connect(res.url, res.token);
        // Room may have been left while we were connecting.
        if (this.room?.id !== roomId) {
          lk.disconnect();
          return;
        }
        this.audio = "on";
        this.syncMic();
      } catch {
        this.audio = "unavailable";
        lkRoom?.disconnect();
        lkRoom = null;
      }
    },
    /** Publish the mic only while seated, unmuted, and not force-muted. */
    async syncMic() {
      if (!lkRoom || this.audio !== "on") return;
      const onSeat = this.seats.some((s) => s?.id === this.myUserId);
      const seat = this.seats.find((s) => s?.id === this.myUserId);
      const enable = !!seat && !seat.muted && !seat.blocked;
      // Route to loudspeaker while a pure listener; publishing needs record mode.
      routeAudio(onSeat);
      try {
        await lkRoom.localParticipant.setMicrophoneEnabled(enable);
      } catch {
        // Mic permission denied — reflect reality on the seat state.
        if (enable) this.setMuted(true);
      }
    },
    disconnectAudio() {
      const lk = lkRoom;
      lkRoom = null;
      lk?.disconnect();
      teardownAudioGraph();
      for (const el of lkAudioEls) el.remove();
      lkAudioEls = [];
      this.audio = "off";
      this.speaking = [];
    },
    send(text: string) {
      if (this.room) socket.emit("room:message", { roomId: this.room.id, text });
    },
    requestSeat(seat: number) {
      if (this.room) socket.emit("seat:request", { roomId: this.room.id, seat });
    },
    cancelRequest() {
      if (this.room) socket.emit("seat:cancel", { roomId: this.room.id });
    },
    grantSeat(userId: number) {
      if (this.room) socket.emit("seat:grant", { roomId: this.room.id, userId });
    },
    denySeat(userId: number) {
      if (this.room) socket.emit("seat:deny", { roomId: this.room.id, userId });
    },
    inviteToSeat(userId: number, seat: number) {
      if (this.room) socket.emit("seat:invite", { roomId: this.room.id, userId, seat });
    },
    acceptInvite() {
      if (this.room) socket.emit("seat:accept", { roomId: this.room.id });
      this.inviteSeat = null;
    },
    declineInvite() {
      if (this.room) socket.emit("seat:decline", { roomId: this.room.id });
      this.inviteSeat = null;
    },
    leaveSeat() {
      if (this.room) socket.emit("seat:leave", { roomId: this.room.id });
    },
    setMuted(muted: boolean) {
      if (this.room) socket.emit("seat:mute", { roomId: this.room.id, muted });
    },
    async setAdmin(userId: number, admin: boolean): Promise<string | null> {
      if (!this.room) return null;
      const res = await socket.emitWithAck("admin:set", { roomId: this.room.id, userId, admin });
      return res?.error ?? null;
    },
    forceMute(userId: number, blocked: boolean) {
      if (this.room) socket.emit("seat:forceMute", { roomId: this.room.id, userId, blocked });
    },
    removeFromSeat(userId: number) {
      if (this.room) socket.emit("seat:remove", { roomId: this.room.id, userId });
    },
    kick(userId: number) {
      if (this.room) socket.emit("room:kick", { roomId: this.room.id, userId });
    },
    disableUser(userId: number, disabled: boolean) {
      if (this.room) socket.emit("seat:disable", { roomId: this.room.id, userId, disabled });
    },
    async setPin(pin: string | null): Promise<string | null> {
      if (!this.room) return null;
      const res = await socket.emitWithAck("room:setPin", { roomId: this.room.id, pin });
      return res?.error ?? null;
    },
    setLayout(layout: SeatLayout) {
      if (this.room) socket.emit("room:layout", { roomId: this.room.id, layout });
    },
    setBackground(src: string | null) {
      if (this.room) socket.emit("room:setBackground", { roomId: this.room.id, src });
    },
    backgrounds(): Promise<{ id: string; src: string }[]> {
      return socket.emitWithAck("room:backgrounds");
    },
    /** Host > admin > member; you can't moderate yourself or your rank. */
    canModerate(targetId: number): boolean {
      const me = this.myUserId;
      if (me === targetId) return false;
      if (this.hostId === me) return true;
      if (this.admins.includes(me)) return targetId !== this.hostId && !this.admins.includes(targetId);
      return false;
    },
  },
});
