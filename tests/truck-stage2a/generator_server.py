import http.server
import socketserver
import os
import urllib.parse
import base64
import json

PORT = 8089
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

class GeneratorHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/save-image":
            query = urllib.parse.parse_qs(parsed.query)
            filename = query.get("name", ["output.webp"])[0]
            
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode("utf-8"))
                b64_data = data["data"].split(",")[1]
                raw_bytes = base64.b64decode(b64_data)
                
                # Save to tests/truck-stage2a/
                test_out = os.path.join(ROOT_DIR, "tests", "truck-stage2a", filename)
                with open(test_out, "wb") as f:
                    f.write(raw_bytes)
                
                # Save to public/models/ as well
                public_out = os.path.join(ROOT_DIR, "wastewatch", "frontend", "public", "models", filename)
                with open(public_out, "wb") as f:
                    f.write(raw_bytes)
                    
                print(f"[GeneratorServer] Successfully saved: {filename} ({len(raw_bytes)} bytes)")
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "size": len(raw_bytes), "file": filename}).encode("utf-8"))
            except Exception as e:
                print(f"[GeneratorServer] Error saving {filename}: {e}")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        else:
            self.send_error(404, "Not found")

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), GeneratorHandler) as httpd:
        print(f"[GeneratorServer] Serving {ROOT_DIR} at http://localhost:{PORT}")
        httpd.serve_forever()
