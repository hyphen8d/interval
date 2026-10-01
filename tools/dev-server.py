# INTERVAL dev server: python3 tools/dev-server.py 8000
#
# Serves the app with no-store headers (so a soft reload always gets the
# current bytes) from an ALLOWLIST, not the whole directory. The repo root is
# a working directory, and SIGNAL learned the hard way (2026-09-02) that a
# static server on a working directory serves whatever secret someone drops
# into it next. This binds every interface, which makes the allowlist the
# only thing between the LAN and the repo.
#
# A second copy of the rule lives in tools/admin-server.mjs servable().
# Change one, change both: tests/admin-server.test.mjs runs the same lists
# against both servers.

import http.server
import os
import posixpath
import socketserver
import sys
import urllib.parse

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

# Root JSON by name, not extension (2026-10-01): any .json used to pass, so a
# secrets.json dropped in the root was served. LICENSE and NOTICE travel with
# the MIT engine in src/. See the admin server's copy for the whole story.
STATIC_DIRS = {'fonts', 'src', 'screenshots'}
STATIC_TOP_EXT = {'.js', '.html', '.md', '.ico', '.png', '.jpg', '.svg'}
STATIC_TOP_NAMES = {'build.json', 'editorial.json', 'markets.json', 'LICENSE', 'NOTICE'}


def servable(rel):
    if rel == '':
        return True  # the index
    parts = rel.split('/')
    if any(seg.startswith('.') for seg in parts):
        return False
    if len(parts) == 1:
        return rel in STATIC_TOP_NAMES or os.path.splitext(rel)[1].lower() in STATIC_TOP_EXT
    if parts[0] == 'tools':
        if len(parts) == 2 and parts[1].endswith('.html'):
            return True
        return len(parts) == 3 and parts[1] == 'lib' and parts[2].endswith('.mjs')
    return parts[0] in STATIC_DIRS


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
                      '': 'text/plain'}

    def send_head(self):
        rel = urllib.parse.urlsplit(self.path).path
        rel = posixpath.normpath(urllib.parse.unquote(rel)).strip('/')
        if rel == '.':
            rel = ''
        if not servable(rel):
            self.send_error(404, 'Not Found')
            return None
        # No directory listings: a directory is served only as its index.
        if rel and os.path.isdir(rel):
            self.send_error(404, 'Not Found')
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    with ReusableTCPServer(('', port), NoCacheHandler) as httpd:
        print(f'INTERVAL (no-store) on port {port}')
        httpd.serve_forever()
