#!/usr/bin/env python3
"""Local dev server for Tiny Butterfly. Serves this folder on port 8790, no caching."""
import http.server
import os
import socket
import socketserver

PORT = 8790
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        # Never serve dotfiles/dot-folders (.git, .claude)
        if any(part.startswith(".") for part in self.path.split("?")[0].split("/") if part):
            self.send_error(404)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return None


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"🦋 Tiny Butterfly → http://localhost:{PORT}")
        ip = lan_ip()
        if ip:
            print(f"   on your phone (same Wi-Fi) → http://{ip}:{PORT}")
        httpd.serve_forever()
