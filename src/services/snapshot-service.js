const http = require("http");
const https = require("https");
const logger = require("../log-manager");

class SnapshotService {
    constructor(camera) {
        this.camera = camera;
        this.snapshotUrl = new URL(camera.source.snapshotUrl);
    }

    canHandleRequest(req) {
        if (req.method !== "GET") {
            return false;
        }

        return req.url === this.camera.source.snapshotPath;
    }

    async handleRequest(req, res) {
        logger.debug("snapshot",
            `Snapshot request for ${this.camera.name}: ${req.method} ${req.url}`
        );

        try {
            await this.forwardSnapshot(res);
        } catch (err) {
            logger.error(`Snapshot proxy failed for ${this.camera.name}: ${err.message}`);
            if (!res.headersSent) {
                res.statusCode = 502;
                res.setHeader("Content-Type", "text/plain");
            }
            res.end("Snapshot proxy error");
        }
    }

    async forwardSnapshot(res) {
        const client = this.snapshotUrl.protocol === "https:" ? https : http;
        const headers = {
            Accept: "image/*,*/*;q=0.8"
        };

        if (this.snapshotUrl.username || this.snapshotUrl.password) {
            const credentials = `${decodeURIComponent(this.snapshotUrl.username)}:${decodeURIComponent(this.snapshotUrl.password)}`;
            headers.Authorization = `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
        }

        const requestOptions = {
            protocol: this.snapshotUrl.protocol,
            hostname: this.snapshotUrl.hostname,
            port: this.snapshotUrl.port || (this.snapshotUrl.protocol === "https:" ? 443 : 80),
            path: `${this.snapshotUrl.pathname}${this.snapshotUrl.search}`,
            method: "GET",
            headers
        };

        await new Promise((resolve, reject) => {
            const upstreamReq = client.request(requestOptions, (upstreamRes) => {
                if (upstreamRes.statusCode && upstreamRes.statusCode >= 400) {
                    upstreamRes.resume();
                    reject(new Error(`upstream returned HTTP ${upstreamRes.statusCode}`));
                    return;
                }

                res.statusCode = upstreamRes.statusCode || 200;

                const contentType = upstreamRes.headers["content-type"] || "image/jpeg";
                res.setHeader("Content-Type", contentType);

                const contentLength = upstreamRes.headers["content-length"];
                if (contentLength) {
                    res.setHeader("Content-Length", contentLength);
                }

                upstreamRes.on("error", reject);
                upstreamRes.on("end", resolve);
                upstreamRes.pipe(res);
            });

            upstreamReq.on("error", reject);
            upstreamReq.setTimeout(15000, () => {
                upstreamReq.destroy(new Error("snapshot request timed out"));
            });
            upstreamReq.end();
        });
    }
}

module.exports = SnapshotService;
