#!/usr/bin/env python3
"""Local server for Tiny Butterfly, on port 8790, no caching.

Also keeps your colours on this Mac: GET /api/data returns data.json, PUT /api/data replaces it (the
previous version is kept as data.prev.json). Both files stay out of git. It only listens on this Mac
(127.0.0.1); your phone reaches it privately over Tailscale:
    tailscale serve --bg --https=8790 http://localhost:8790   ->  https://<your-mac>.<tailnet>.ts.net:8790
"""
import http.server
import json
import os
import socketserver

PORT = 8790
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data.json")
PREV = os.path.join(ROOT, "data.prev.json")
MAX_BODY = 5 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _path(self):
        return self.path.split("?")[0]

    def _json(self, code, body):
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self._path()
        if path == "/api/data":
            try:
                with open(DATA) as f:
                    return self._json(200, f.read())
            except FileNotFoundError:
                return self._json(200, '{"days":{},"palettes":[],"lastVisual":null}')
        # Never serve dotfiles/dot-folders (.git, .claude) or the data files directly
        parts = [p for p in path.split("/") if p]
        if any(p.startswith(".") for p in parts) or (parts and parts[-1] in ("data.json", "data.prev.json")):
            self.send_error(404)
            return
        super().do_GET()

    def do_PUT(self):
        if self._path() != "/api/data":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY:
            return self._json(400, '{"error":"size"}')
        try:
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload.get("days"), dict) or not isinstance(payload.get("palettes"), list):
                raise ValueError("shape")
        except (ValueError, AttributeError):
            return self._json(400, '{"error":"not a Tiny Butterfly state"}')
        if os.path.exists(DATA):
            os.replace(DATA, PREV)  # keep one previous version, just in case
        tmp = DATA + ".tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
        os.replace(tmp, DATA)  # written whole or not at all
        self._json(200, '{"ok":true}')

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"🦋 Tiny Butterfly → http://localhost:{PORT}")
        print(f"   on your phone: your Mac's Tailscale address, port {PORT} (see README)")
        httpd.serve_forever()
