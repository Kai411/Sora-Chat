# Self-hosting LiveKit for Sora

Runs Sora's party-room audio on your own VPS instead of LiveKit Cloud. Same API — when this is up, you only change the three `LIVEKIT_*` env values on the Sora server. Nothing in the app code changes.

## What you need

- **A VPS with UDP support.** Render can't do this (HTTP-only). Options:
  - Hetzner CX22 (~€4/mo) or DigitalOcean basic droplet ($6/mo) — easiest
  - Oracle Cloud "Always Free" ARM instance — $0, but signup/capacity can be finicky
  - Ubuntu 22.04+ assumed below
- **A domain you control** (Let's Encrypt certs won't issue for bare IPs — required for `wss://` and TURN/TLS). Any cheap domain works.

## 1. DNS

Create two **A records** pointing at the VPS's public IP:

```
livekit.yourdomain.com  →  <VPS IP>
turn.yourdomain.com     →  <VPS IP>
```

## 2. Firewall (on the VPS)

```sh
sudo ufw allow 22/tcp        # ssh
sudo ufw allow 80/tcp        # Let's Encrypt HTTP challenge
sudo ufw allow 443/tcp       # wss + TURN/TLS (SNI-routed by Caddy)
sudo ufw allow 7881/tcp      # WebRTC TCP fallback
sudo ufw allow 3478/udp      # TURN UDP
sudo ufw allow 50000:60000/udp  # WebRTC media
sudo ufw enable
```

(Cloud providers with their own firewall — Oracle, DO cloud firewalls — need the same ports opened there too.)

## 3. Install Docker

```sh
curl -fsSL https://get.docker.com | sh
```

## 4. Configure this directory on the VPS

Copy `infra/livekit/` to the server (git clone or `scp -r`), then fill in the placeholders — **on the server, not in the repo** (never commit real keys):

```sh
cd infra/livekit
DOMAIN=yourdomain.com
API_KEY=LK$(openssl rand -hex 6)
API_SECRET=$(openssl rand -base64 32 | tr -d '=+/')
sed -i "s/YOUR_DOMAIN/$DOMAIN/g" livekit.yaml caddy.yaml
sed -i "s/YOUR_API_KEY/$API_KEY/; s/YOUR_API_SECRET/$API_SECRET/" livekit.yaml
echo "SAVE THESE →  key: $API_KEY   secret: $API_SECRET"
```

## 5. Start it

```sh
docker compose up -d
docker compose logs -f livekit   # should settle into "starting LiveKit server"
```

Cert issuance takes ~30s on first boot (watch `docker compose logs caddy`).

## 6. Point Sora at it

In `apps/server/.env` locally and Render → Environment for staging:

```
LIVEKIT_URL=wss://livekit.yourdomain.com
LIVEKIT_API_KEY=<the key from step 4>
LIVEKIT_API_SECRET=<the secret from step 4>
```

Restart the Sora server, join a party room from two accounts, take seats, talk.

## Maintenance

- **Update:** `docker compose pull && docker compose up -d`
- **Logs:** `docker compose logs -f livekit`
- **Health:** `curl https://livekit.yourdomain.com` → returns `OK`
- Single node comfortably handles hundreds of concurrent audio users on a small VPS; audio is cheap compared to video.

## If anything fights you

LiveKit ships an official interactive generator that produces this same stack (compose + configs + even a systemd unit) with current defaults:

```sh
docker run --rm -it -v $PWD:/output livekit/generate
```

Use it as the canonical fallback and diff against these files.
