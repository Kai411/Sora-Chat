import { socket } from "./socket";

export interface CallHandle {
  toggleMute(): boolean;
  hangup(): void;
}

/**
 * P2P audio call over a matched session, signaled through the server.
 * The callee announces readiness before the caller sends its offer, so
 * neither side can miss SDP while getUserMedia is still pending.
 */
export async function startCall(
  sessionId: string,
  isCaller: boolean,
  onRemoteStream: (stream: MediaStream) => void,
  onConnectionState: (state: RTCPeerConnectionState) => void
): Promise<CallHandle> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.ontrack = (e) => onRemoteStream(e.streams[0]);
  pc.onconnectionstatechange = () => onConnectionState(pc.connectionState);
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("rtc:signal", { sessionId, data: { candidate: e.candidate } });
  };

  const onSignal = async ({ sessionId: sid, data }: { sessionId: string; data: any }) => {
    if (sid !== sessionId) return;
    try {
      if (data.ready && isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("rtc:signal", { sessionId, data: { sdp: pc.localDescription } });
      } else if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("rtc:signal", { sessionId, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (err) {
      console.warn("[rtc] signal error", err);
    }
  };
  socket.on("rtc:signal", onSignal);

  const local = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of local.getTracks()) pc.addTrack(track, local);

  if (!isCaller) socket.emit("rtc:signal", { sessionId, data: { ready: true } });

  let muted = false;
  return {
    toggleMute() {
      muted = !muted;
      for (const t of local.getAudioTracks()) t.enabled = !muted;
      return muted;
    },
    hangup() {
      socket.off("rtc:signal", onSignal);
      for (const t of local.getTracks()) t.stop();
      pc.close();
    },
  };
}
