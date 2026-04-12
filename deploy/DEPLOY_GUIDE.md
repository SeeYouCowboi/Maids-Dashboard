# Maids Dashboard — Deployment Guide

Static Nginx deployment for Ubuntu 20.04 / 22.04 LTS.

---

## Architecture

```
Browser -> Nginx (:443 or :80) -> /var/www/maids-dashboard/ (static dist/)
                                   index.html fallback for SPA routes
Browser -> MaidsClaw gateway (:18790) <- configured via VITE_API_BASE at build time
```

No Python process. No systemd `maids-dashboard` service. Static files only.

---

## Prerequisites

- Nginx installed (`apt install nginx`)
- Bun installed locally (build machine)
- MaidsClaw checkout as sibling (`../MaidsClaw`)
- `dist/` built via `bun run build`

---

## Build

```bash
cd Maids-Dashboard
bun install
bun run build     # -> dist/
```

---

## Upload

```bash
rsync -az --delete dist/ user@your-server:/var/www/maids-dashboard/
```

---

## Nginx Configuration

```nginx
server {
    listen 80;
    server_name your-dashboard-domain.example;
    root /var/www/maids-dashboard;
    index index.html;

    # SPA fallback -- all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Do not cache index.html (ensures fresh SPA shell on deploy)
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # Long-term cache for versioned JS/CSS chunks
    location ~* \.(js|css|woff2|png|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Reload Nginx after updating:

```bash
nginx -t && systemctl reload nginx
```

---

## Cutover from Python Stack

If migrating from the old Python/FastAPI stack:

1. Stop and disable the old service:
   ```bash
   systemctl stop maids-dashboard
   systemctl disable maids-dashboard
   rm /etc/systemd/system/maids-dashboard.service
   systemctl daemon-reload
   ```
2. Port 18889 is now free (no Python backend)
3. Deploy static `dist/` as described above
4. MaidsClaw runs independently on its own port (default 18790)

---

## HTTPS (Recommended)

Use Certbot for Let's Encrypt:

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d your-dashboard-domain.example
```

The Dashboard will only send auth tokens over HTTPS (enforced client-side).

---

## MaidsClaw CORS

Ensure MaidsClaw has the production Dashboard origin in its CORS allowlist before going live. Verify with:

```bash
curl -i -X OPTIONS https://your-dashboard-domain.example \
  -H "Origin: https://your-dashboard-domain.example" \
  -H "Access-Control-Request-Method: GET"
# Expect: 204 + Access-Control-Allow-Origin header
```
